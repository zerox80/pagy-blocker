/**
 * @file core/ruleParser.js
 * @description Umfassender Regelparser mit erweiterter Syntaxvalidierung.
 * @version 11.1

 */

// SICHERHEIT: Erkennt URL-codierte Angriffsvektoren.
function isEncodedAttack(input) {
    const dangerousEncodedPatterns = [
        '%3c%73%63%72%69%70%74', // <script
        '%6a%61%76%61%73%63%72%69%70%74', // javascript
        '%65%76%61%6c', // eval
        '%61%6c%65%72%74', // alert
        '%64%6f%63%75%6d%65%6e%74', // document
        '%77%69%6e%64%6f%77', // window
        '%75%72%6c%28', // url(
        '%65%78%70%72%65%73%73%69%6f%6e', // expression
        '%6f%6e%6c%6f%61%64', // onload
        '%6f%6e%65%72%72%6f%72', // onerror
        '%3c%69%66%72%61%6d%65', // <iframe
        '%3c%6f%62%6a%65%63%74', // <object
        '%3c%65%6d%62%65%64', // <embed
    ];
    const lowerInput = input.toLowerCase();
    return dangerousEncodedPatterns.some((pattern) => lowerInput.includes(pattern));
}

// Filteroptions-Validierung
const VALID_OPTIONS = new Set([
    'script',
    'image',
    'stylesheet',
    'object',
    'xmlhttprequest',
    'subdocument',
    'document',
    'websocket',
    'webrtc',
    'popup',
    'third-party',
    'match-case',
    'donottrack',
    'important',
    'sitekey',
    'ping',
    'font',
    'media',
    'other',
]);

/**
 * Verbesserte Domain-Säuberung mit strengerer Validierung.
 */
function sanitizeDomain(domain) {
    if (!domain || typeof domain !== 'string') {
        return { isValid: false, error: 'Domain muss ein nicht leerer String sein' };
    }
    const cleaned = domain
        .replace(/[<>'"(){}[\]\\]/g, '')
        .toLowerCase()
        .trim();
    if (
        cleaned.includes('..') ||
        cleaned.startsWith('.') ||
        cleaned.endsWith('.') ||
        cleaned.includes('localhost') ||
        cleaned.includes('127.0.0.1') ||
        cleaned.includes('0.0.0.0') ||
        cleaned.includes('::1')
    ) {
        return { isValid: false, error: 'Domain enthält verdächtige Muster' };
    }
    return { isValid: true, domain: cleaned };
}

/**
 * Verbesserte Validierung von URL-Filtermustern mit ReDoS-Schutz.
 */
export function validateURLPattern(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return { isValid: false, error: 'Muster muss ein nicht leerer String sein' };
    }
    const dangerousPatterns = [
        '<script',
        '</script',
        'javascript:',
        'data:',
        'vbscript:',
        'file:',
        'ftp:',
        'eval(',
        'function(',
        'constructor(',
        'settimeout(',
        'setinterval(',
        'onclick=',
        'onload=',
        'onerror=',
        'onmouseover=',
        'onfocus=',
        'onblur=',
        'onchange=',
        'onsubmit=',
        'onkeydown=',
        'onkeyup=',
        'onkeypress=',
        'expression(',
        '@import',
        'url(',
        'background:url',
        'background-image:url',
        'import(',
        'require(',
        'importscripts(',
        '__import__',
        'fetch(',
        'xmlhttprequest',
        'websocket',
        'eventsource',
        'filesystem:',
        'blob:',
        'about:',
        '&#',
        '<',
        '>',
        '"',
        "\\'",
        'union select',
        'drop table',
        'delete from',
        'insert into',
        '$(',
        '`',
        'cmd.exe',
        '/bin/',
        'powershell',
        '{{',
        '}}',
        '<%',
        '%>',
        '{%',
        '%}',
        'amF2YXNjcmlwdA==',
        'ZXZhbA==',
        'c2NyaXB0',
    ];
    const lowerPattern = pattern.toLowerCase();
    for (const dangerous of dangerousPatterns) {
        if (lowerPattern.includes(dangerous.toLowerCase())) {
            return { isValid: false, error: `Muster enthält gefährlichen Inhalt: ${dangerous}` };
        }
    }
    const forbiddenChars = [
        '\0',
        '\x01',
        '\x02',
        '\x03',
        '\x04',
        '\x05',
        '\x06',
        '\x07',
        '\x08',
        '\x0b',
        '\x0c',
        '\x0e',
        '\x0f',
    ];
    for (const char of forbiddenChars) {
        if (pattern.includes(char)) {
            return { isValid: false, error: `Muster enthält verbotenes Steuerzeichen` };
        }
    }
    if (pattern.includes('%') && isEncodedAttack(pattern)) {
        return { isValid: false, error: 'Muster enthält codierten Angriffsvektor' };
    }
    if (pattern.length > 500) {
        return { isValid: false, error: 'Muster überschreitet die maximale Länge (500 Zeichen)' };
    }
    return { isValid: true, type: 'network' };
}

/**
 * Validiert Filteroptionen (z.B. $script,third-party).
 */
export function validateFilterOptions(options) {
    if (!options) {
        return { isValid: true, parsedOptions: [] };
    }
    const optionList = options.split(',').map((opt) => opt.trim().toLowerCase());
    const parsedOptions = [];
    const errors = [];
    for (const option of optionList) {
        const isNegated = option.startsWith('~');
        const baseOption = isNegated ? option.slice(1) : option;
        if (baseOption.startsWith('domain=')) {
            if (isNegated) {
                errors.push('Die Option "domain" darf nicht negiert werden.');
            } else {
                const domainValues = [];
                const domains = baseOption.slice(7).split('|');
                for (const domain of domains) {
                    const isDomainNegated = domain.startsWith('~');
                    const cleanDomainName = isDomainNegated ? domain.slice(1) : domain;

                    if (cleanDomainName) {
                        const testResult = sanitizeDomain(cleanDomainName);
                        if (!testResult.isValid) {
                            errors.push(
                                `Ungültige Domain in den Optionen: ${cleanDomainName} - ${testResult.error}`
                            );
                        } else {
                            domainValues.push({ name: testResult.domain, negated: isDomainNegated });
                        }
                    }
                }
                if (domainValues.length > 0) {
                    parsedOptions.push({ type: 'domain', value: domainValues, negated: false });
                }
            }
        } else if (VALID_OPTIONS.has(baseOption)) {
            parsedOptions.push({ type: 'filter', value: baseOption, negated: isNegated });
        } else {
            errors.push(`Unbekannte Filteroption: ${baseOption}`);
        }
    }
    return {
        isValid: errors.length === 0,
        parsedOptions,
        errors,
    };
}

/**
 * Verbesserter Regelparser mit umfassender Validierung.
 */
export function parseRule(rule) {
    if (!rule || typeof rule !== 'string') {
        return null;
    }
    const normalizedRule = rule.trim();
    if (normalizedRule.length === 0) {
        return null;
    }
    if (normalizedRule.startsWith('!') || normalizedRule.startsWith('[')) {
        return null;
    }
    // Kosmetische Filter werden nicht mehr unterstützt.
    if (
        normalizedRule.includes('##') ||
        normalizedRule.includes('#@#') ||
        normalizedRule.includes('#?#')
    ) {
        return null;
    }

    try {
        return parseNetworkRule(normalizedRule);
    } catch (error) {
        console.warn(`Failed to parse rule: ${rule}`, error);
        return null;
    }
}

/**
 * Parst Regeln für die Netzwerkfilterung.
 */
function parseNetworkRule(rule) {
    const isException = rule.startsWith('@@');
    const cleanRule = isException ? rule.slice(2) : rule;
    const dollarIndex = cleanRule.lastIndexOf('$');
    let pattern = cleanRule;
    let options = '';
    if (dollarIndex !== -1 && dollarIndex < cleanRule.length - 1) {
        pattern = cleanRule.slice(0, dollarIndex);
        options = cleanRule.slice(dollarIndex + 1);
    }
    const patternValidation = validateURLPattern(pattern);
    if (!patternValidation.isValid) {
        return null;
    }
    let parsedOptions = null;
    if (options) {
        const optionsValidation = validateFilterOptions(options);
        if (!optionsValidation.isValid) {
            return null;
        }
        parsedOptions = optionsValidation.parsedOptions;
    }
    return {
        rule: rule,
        type: 'network',
        pattern: pattern,
        options: parsedOptions,
        isException: isException,
        patternType: patternValidation.type,
        isValid: true,
    };
}
