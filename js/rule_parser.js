/**
 * Umfassender Regelparser mit erweiterter Syntaxvalidierung
 * Unterstützt das Filterlistenformat von AdBlock Plus und verschiedene Regeltypen
 * Verbesserte Fehlerbehandlung und Validierung
 */

// Regeltyp-Konstanten
const RULE_TYPES = {
    NETWORK: 'network',
    COSMETIC: 'cosmetic',
    ELEMENT_HIDE: 'element_hide',
    COMMENT: 'comment',
    INVALID: 'invalid'
};

// SICHERHEIT: ReDoS-sichere Mustervalidierung mit zeichenbasierter Analyse
// Komplexe Regex-Muster wurden durch sichere Analysefunktionen ersetzt, um ReDoS-Angriffe zu verhindern
const URL_PATTERN_VALIDATORS = {
    // Sichere Domain-Validierung mit zeichenweiser Analyse
    DOMAIN_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-',
    URL_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_~:/?#[]@!$&\'()*+,;=%',
    WILDCARD_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-*/',
    CSS_SELECTOR_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789[]._#:,-"\'=*^$|()\ '
};

/**
 * SICHERHEIT: Sichere Zeichenvalidierung ohne Regex zur Vermeidung von ReDoS-Angriffen
 * Verwendet zeichenweise Validierung anstelle komplexer Regex-Muster
 */
function validateStringChars(input, allowedChars, maxLength = 500) {
    if (!input || typeof input !== 'string') {
        return { success: false, error: 'Eingabe muss ein nicht leerer String sein' };
    }
    
    if (input.length > maxLength) {
        return { success: false, error: `Eingabe überschreitet die maximale Länge (${maxLength})` };
    }
    
    // Zeichenweise Validierung - verhindert ReDoS
    for (let i = 0; i < input.length; i++) {
        if (!allowedChars.includes(input[i])) {
            return { success: false, error: `Ungültiges Zeichen an Position ${i}: ${input[i]}` };
        }
    }
    
    return { success: true, result: true };
}

/**
 * SICHERHEIT: Sichere Domain-Validierung mit zeichenbasierter Analyse anstelle von Regex
 * Verhindert ReDoS-Angriffe durch Vermeidung komplexer Regex-Muster
 */
function safeDomainValidation(domain) {
    if (!domain || typeof domain !== 'string') {
        return { success: false, error: 'Domain muss ein nicht leerer String sein' };
    }
    
    if (domain.length > 253) {
        return { success: false, error: 'Domain überschreitet die maximale Länge (253)' };
    }
    
    // Überprüfung auf gefährliche Muster ohne Regex
    if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
        return { success: false, error: 'Ungültiges Domain-Format' };
    }
    
    // Aufteilen der Domain in Teile und Validierung jedes Teils
    const parts = domain.split('.');
    if (parts.length < 2) {
        return { success: false, error: 'Domain muss aus mindestens zwei Teilen bestehen' };
    }
    
    for (const part of parts) {
        if (part.length === 0 || part.length > 63) {
            return { success: false, error: 'Ungültige Länge des Domain-Teils' };
        }
        
        // Validierung der Zeichen in jedem Teil
        const validation = validateStringChars(part, URL_PATTERN_VALIDATORS.DOMAIN_CHARS, 63);
        if (!validation.success) {
            return validation;
        }
    }
    
    return { success: true, result: { domain } };
}

/**
 * SICHERHEIT: Sichere URL-Mustererkennung ohne komplexe Regex
 * Verhindert ReDoS durch zeichenbasierte Analyse
 */
function safeURLPatternMatch(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return { success: false, error: 'Muster muss ein nicht leerer String sein' };
    }
    
    if (pattern.length > 500) {
        return { success: false, error: 'Muster überschreitet die maximale Länge (500)' };
    }
    
    // Domain-Anker-Muster (||domain.com^)
    if (pattern.startsWith('||')) {
        const endCaret = pattern.endsWith('^');
        const domain = endCaret ? pattern.slice(2, -1) : pattern.slice(2);
        
        const domainValidation = safeDomainValidation(domain);
        if (!domainValidation.success) {
            return domainValidation;
        }
        
        return { success: true, result: [pattern, domain], type: 'domain_anchor' };
    }
    
    // URL-Anker-Muster (|https://example.com)
    if (pattern.startsWith('|') && !pattern.startsWith('||')) {
        if (pattern.startsWith('|http://') || pattern.startsWith('|https://')) {
            const validation = validateStringChars(pattern, URL_PATTERN_VALIDATORS.URL_CHARS, 500);
            if (!validation.success) {
                return validation;
            }
            return { success: true, result: [pattern], type: 'url_anchor' };
        }
        return { success: false, error: 'Ungültiges URL-Anker-Muster' };
    }
    
    // Wildcard-Muster-Validierung
    const validation = validateStringChars(pattern, URL_PATTERN_VALIDATORS.WILDCARD_CHARS, 100);
    if (!validation.success) {
        return validation;
    }
    
    return { success: true, result: [pattern], type: 'wildcard' };
}

/**
 * SICHERHEIT: Sichere Parsing von kosmetischen Regeln ohne Regex
 * Verhindert ReDoS durch zeichenbasierte Analyse
 */
function safeParseCosmeticRule(rule) {
    if (!rule || typeof rule !== 'string') {
        return { success: false, error: 'Regel muss ein nicht leerer String sein' };
    }
    
    let operator = '';
    let operatorIndex = -1;
    
    // Finden des kosmetischen Operators
    if (rule.includes('#?#')) {
        operator = '#?#';
        operatorIndex = rule.indexOf('#?#');
    } else if (rule.includes('#@#')) {
        operator = '#@#';
        operatorIndex = rule.indexOf('#@#');
    } else if (rule.includes('##')) {
        operator = '##';
        operatorIndex = rule.indexOf('##');
    } else {
        return { success: false, error: 'Kein kosmetischer Operator gefunden' };
    }
    
    const domains = rule.slice(0, operatorIndex);
    const selector = rule.slice(operatorIndex + operator.length);
    
    if (!selector) {
        return { success: false, error: 'Leerer Selektor' };
    }
    
    return {
        success: true,
        result: { domains, operator, selector }
    };
}

/**
 * SICHERHEIT: Erkennt URL-codierte Angriffsvektoren
 * Verhindert codierte Skripteinschleusungen und andere Angriffe
 */
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
        '%3c%65%6d%62%65%64' // <embed
    ];
    
    const lowerInput = input.toLowerCase();
    return dangerousEncodedPatterns.some(pattern => lowerInput.includes(pattern));
}

/**
 * SICHERHEIT: Verbesserte Eingabesäuberung mit umfassender Filterung
 * Entfernt oder neutralisiert gefährliche Inhalte und bewahrt gleichzeitig die Funktionalität
 */
function sanitizeInput(input, options = {}) {
    if (!input || typeof input !== 'string') {
        return { sanitized: '', wasModified: false, errors: ['Eingabe muss ein nicht leerer String sein'] };
    }
    
    const maxLength = options.maxLength || 500;
    const allowHTML = options.allowHTML || false;
    const allowSpecialChars = options.allowSpecialChars || false;
    
    let sanitized = input;
    let wasModified = false;
    const errors = [];
    
    // Längenüberprüfung
    if (sanitized.length > maxLength) {
        sanitized = sanitized.slice(0, maxLength);
        wasModified = true;
        errors.push(`Eingabe auf ${maxLength} Zeichen gekürzt`);
    }
    
    // Entfernen von Null-Bytes und Steuerzeichen
    const originalLength = sanitized.length;
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    if (sanitized.length !== originalLength) {
        wasModified = true;
        errors.push('Steuerzeichen entfernt');
    }
    
    // HTML-Säuberung, wenn nicht erlaubt
    if (!allowHTML) {
        const htmlPattern = /<[^>]*>/g;
        if (htmlPattern.test(sanitized)) {
            sanitized = sanitized.replace(htmlPattern, '');
            wasModified = true;
            errors.push('HTML-Tags entfernt');
        }
    }
    
    // Filterung von Sonderzeichen, wenn nicht erlaubt
    if (!allowSpecialChars) {
        const originalSanitized = sanitized;
        sanitized = sanitized.replace(/[<>"'&{}()]/g, '');
        if (sanitized !== originalSanitized) {
            wasModified = true;
            errors.push('Sonderzeichen entfernt');
        }
    }
    
    // Überprüfung und Säuberung von URL-Decodierungen
    if (sanitized.includes('%')) {
        try {
            const decoded = decodeURIComponent(sanitized);
            if (isEncodedAttack(sanitized)) {
                sanitized = sanitized.replace(/%[0-9a-fA-F]{2}/g, '');
                wasModified = true;
                errors.push('Entfernte URL-codierte Angriffsvektoren');
            }
        } catch (e) {
            // Ungültige URL-Codierung - % Zeichen entfernen
            sanitized = sanitized.replace(/%/g, '');
            wasModified = true;
            errors.push('Entfernte ungültige URL-Codierung');
        }
    }
    
    return { sanitized, wasModified, errors };
}

// Filteroptions-Validierung
const VALID_OPTIONS = new Set([
    'script', 'image', 'stylesheet', 'object', 'xmlhttprequest', 'subdocument',
    'document', 'websocket', 'webrtc', 'popup', 'third-party', 'match-case',
    'collapse', 'donottrack', 'important', 'sitekey', 'genericblock',
    'generichide', 'elemhide', 'ping', 'font', 'media', 'other', 'beacon'
]);

// SICHERHEIT: Domain-Validierung auf sichere zeichenbasierte Validierung umgestellt
// Regex entfernt, um ReDoS-Angriffe zu verhindern

/**
 * Verbesserte Domain-Säuberung mit strengerer Validierung
 * @param {string} domain - Zu säubernde Domain
 * @returns {Promise<Object>} Ergebnis der Säuberung
 */
async function sanitizeDomain(domain) {
    if (!domain || typeof domain !== 'string') {
        return { isValid: false, error: 'Domain muss ein nicht leerer String sein' };
    }
    
    // Entfernen potenziell gefährlicher Zeichen
    const cleaned = domain.replace(/[<>'"(){}[\]\\]/g, '').toLowerCase().trim();
    
    // Überprüfung auf verdächtige Muster
    if (cleaned.includes('..') || cleaned.startsWith('.') || cleaned.endsWith('.') ||
        cleaned.includes('localhost') || cleaned.includes('127.0.0.1') ||
        cleaned.includes('0.0.0.0') || cleaned.includes('::1')) {
        return { isValid: false, error: 'Domain enthält verdächtige Muster' };
    }
    
    // SICHERHEIT: Sichere Domain-Validierung ohne Regex
    const testResult = safeDomainValidation(cleaned);
    if (!testResult.success) {
        return { isValid: false, error: testResult.error };
    }
    
    return { isValid: true, domain: cleaned };
}

/**
 * Verbesserte Validierung von URL-Filtermustern mit ReDoS-Schutz
 * @param {string} pattern - Das zu validierende URL-Muster
 * @returns {Promise<Object>} Validierungsergebnis mit isValid-Flag und Fehlermeldung
 */
async function validateURLPattern(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return { isValid: false, error: 'Muster muss ein nicht leerer String sein' };
    }

    // SICHERHEIT: Umfassende Erkennung gefährlicher Muster
    const dangerousPatterns = [
        // Skripteinschleusungsvektoren
        '<script', '</script', 'javascript:', 'data:', 'vbscript:', 'file:', 'ftp:',
        // Funktionsaufrufe und Codeausführung
        'eval(', 'function(', 'constructor(', 'settimeout(', 'setinterval(',
        // Ereignis-Handler
        'onclick=', 'onload=', 'onerror=', 'onmouseover=', 'onfocus=', 'onblur=',
        'onchange=', 'onsubmit=', 'onkeydown=', 'onkeyup=', 'onkeypress=',
        // CSS-Ausdrücke und -Importe
        'expression(', '@import', 'url(', 'background:url', 'background-image:url',
        // Modul- und Require-Muster
        'import(', 'require(', 'importscripts(', '__import__',
        // Netzwerk-Anfragen
        'fetch(', 'xmlhttprequest', 'websocket', 'eventsource',
        // Dateisystemzugriff
        'filesystem:', 'blob:', 'about:',
        // Gefährliche HTML-Entities
        '&#', '&lt;', '&gt;', '&quot;', '&apos;',
        // SQL-Injektionsmuster
        'union select', 'drop table', 'delete from', 'insert into',
        // Befehlsinjektion
        '$(', '`', 'cmd.exe', '/bin/', 'powershell',
        // Template-Injektion
        '{{', '}}', '<%', '%>', '{%', '%}',
        // Base64-codierte häufige Angriffsvektoren
        'amF2YXNjcmlwdA==', 'ZXZhbA==', 'c2NyaXB0'
    ];
    
    const lowerPattern = pattern.toLowerCase();
    for (const dangerous of dangerousPatterns) {
        if (lowerPattern.includes(dangerous.toLowerCase())) {
            return { isValid: false, error: `Muster enthält gefährlichen Inhalt: ${dangerous}` };
        }
    }
    
    // SICHERHEIT: Zusätzliche zeichenbasierte Validierung
    const forbiddenChars = ['\0', '\x01', '\x02', '\x03', '\x04', '\x05', '\x06', '\x07', '\x08', '\x0b', '\x0c', '\x0e', '\x0f'];
    for (const char of forbiddenChars) {
        if (pattern.includes(char)) {
            return { isValid: false, error: `Muster enthält verbotenes Steuerzeichen` };
        }
    }
    
    // SICHERHEIT: Überprüfung auf codierte Angriffsvektoren
    if (pattern.includes('%') && isEncodedAttack(pattern)) {
        return { isValid: false, error: 'Muster enthält codierten Angriffsvektor' };
    }

    // Überprüfung der maximalen Länge zur Vermeidung von DoS - reduziert von 1000 auf 500
    if (pattern.length > 500) {
        return { isValid: false, error: 'Muster überschreitet die maximale Länge (500 Zeichen)' };
    }

    // SICHERHEIT: Sichere Mustervalidierung ohne Regex zur Vermeidung von ReDoS
    const patternResult = safeURLPatternMatch(pattern);
    if (!patternResult.success) {
        return { isValid: false, error: patternResult.error };
    }
    
    if (patternResult.type === 'domain_anchor') {
        const domainResult = await sanitizeDomain(patternResult.result[1]);
        if (!domainResult.isValid) {
            return { isValid: false, error: domainResult.error };
        }
        return { isValid: true, type: 'domain_anchor', domain: domainResult.domain };
    }
    
    return { isValid: true, type: patternResult.type };
}

/**
 * Validiert Filteroptionen (z.B. $script,third-party)
 * @param {string} options - Options-String nach dem $-Trennzeichen
 * @returns {Promise<Object>} Validierungsergebnis
 */
async function validateFilterOptions(options) {
    if (!options) {
        return { isValid: true, parsedOptions: [] };
    }

    const optionList = options.split(',').map(opt => opt.trim().toLowerCase());
    const parsedOptions = [];
    const errors = [];

    for (const option of optionList) {
        // Behandlung negierter Optionen (z.B. ~script)
        const isNegated = option.startsWith('~');
        const baseOption = isNegated ? option.slice(1) : option;

        // Behandlung von Domain-Beschränkungen (z.B. domain=example.com)
        if (baseOption.startsWith('domain=')) {
            const domains = baseOption.slice(7).split('|');
            for (const domain of domains) {
                const cleanDomain = domain.startsWith('~') ? domain.slice(1) : domain;
                if (cleanDomain) {
                    // SICHERHEIT: Verwendung sicherer Domain-Validierung anstelle von Regex
                    const testResult = safeDomainValidation(cleanDomain);
                    if (!testResult.success) {
                        errors.push(`Ungültige Domain in den Optionen: ${cleanDomain} - ${testResult.error}`);
                    }
                }
            }
            parsedOptions.push({ type: 'domain', value: baseOption.slice(7), negated: isNegated });
        } else if (VALID_OPTIONS.has(baseOption)) {
            parsedOptions.push({ type: 'filter', value: baseOption, negated: isNegated });
        } else {
            errors.push(`Unbekannte Filteroption: ${baseOption}`);
        }
    }

    return {
        isValid: errors.length === 0,
        parsedOptions,
        errors
    };
}

/**
 * SICHERHEIT: Verbesserte Validierung der kosmetischen Regel-Syntax mit umfassender Säuberung
 * @param {string} selector - CSS-Selektor-Teil der kosmetischen Regel
 * @returns {Promise<Object>} Validierungsergebnis
 */
async function validateCosmeticSelector(selector) {
    if (!selector || typeof selector !== 'string') {
        return { isValid: false, error: 'Selektor muss ein nicht leerer String sein' };
    }

    // SICHERHEIT: Umfassende Eingabesäuberung
    const sanitizationResult = sanitizeInput(selector, {
        maxLength: 1000,
        allowHTML: false,
        allowSpecialChars: true // CSS-Selektoren benötigen einige Sonderzeichen
    });
    
    if (sanitizationResult.errors.length > 0) {
        return { isValid: false, error: `Säuberung fehlgeschlagen: ${sanitizationResult.errors.join(', ')}` };
    }
    
    const sanitizedSelector = sanitizationResult.sanitized;

    // SICHERHEIT: Verbesserte Erkennung gefährlicher Muster für CSS
    const dangerousCSSPatterns = [
        'javascript:', 'data:', 'vbscript:', 'file:', 'ftp:',
        '<script', '</script', 'eval(', 'function(', 'constructor(',
        'expression(', '@import', 'url(javascript:', 'url(data:',
        'behavior:', '-moz-binding:', 'binding:', '\\', 'content:',
        'counter(', 'counters(', 'attr(onclick', 'attr(onload',
        '\\A', '\\D', '\\a', '\\d', // CSS-Escape-Sequenzen, die gefährlich sein könnten
        '/*', '*/', '//', '--', '\\*', '\\/'
    ];
    
    const lowerSelector = sanitizedSelector.toLowerCase();
    for (const dangerous of dangerousCSSPatterns) {
        if (lowerSelector.includes(dangerous.toLowerCase())) {
            return { isValid: false, error: `CSS-Selektor enthält gefährliches Muster: ${dangerous}` };
        }
    }

    // SICHERHEIT: Validierung der CSS-Selektor-Struktur
    if (!isValidCSSSelector(sanitizedSelector)) {
        return { isValid: false, error: 'Ungültige CSS-Selektor-Struktur' };
    }

    return { isValid: true, sanitizedSelector };
}

/**
 * SICHERHEIT: Validiert die CSS-Selektor-Struktur ohne Regex
 * Verhindert fehlerhafte Selektoren, die Sicherheitsüberprüfungen umgehen könnten
 */
function isValidCSSSelector(selector) {
    // Grundlegende strukturelle Validierung
    if (selector.length === 0 || selector.length > 1000) {
        return false;
    }
    
    // Überprüfung auf ausgewogene Klammern und Klammeraffen
    let bracketCount = 0;
    let parenCount = 0;
    let inQuotes = false;
    let quoteChar = '';
    
    for (let i = 0; i < selector.length; i++) {
        const char = selector[i];
        
        if (!inQuotes) {
            if (char === '"' || char === "'") {
                inQuotes = true;
                quoteChar = char;
            } else if (char === '[') {
                bracketCount++;
            } else if (char === ']') {
                bracketCount--;
                if (bracketCount < 0) return false;
            } else if (char === '(') {
                parenCount++;
            } else if (char === ')') {
                parenCount--;
                if (parenCount < 0) return false;
            }
        } else {
            if (char === quoteChar && selector[i-1] !== '\\') {
                inQuotes = false;
                quoteChar = '';
            }
        }
    }
    
    // Überprüfung, ob Klammern und Klammeraffen ausgewogen und Anführungszeichen geschlossen sind
    return bracketCount === 0 && parenCount === 0 && !inQuotes;
}

/**
 * Bestimmt den Regeltyp basierend auf der Syntax
 * @param {string} rule - Die Filterregel
 * @returns {string} Regeltyp-Konstante
 */
async function determineRuleType(rule) {
    // Kommentar oder Metadaten
    if (rule.startsWith('!') || rule.startsWith('[')) {
        return RULE_TYPES.COMMENT;
    }

    // SICHERHEIT: Sichere Erkennung kosmetischer Regeln ohne Regex
    if (rule.includes('##') || rule.includes('#@#') || rule.includes('#?#')) {
        // Verwendung sicherer zeichenbasierter Analyse anstelle von Regex
        if (rule.includes('##') || rule.includes('#@#')) {
            return RULE_TYPES.ELEMENT_HIDE;
        } else if (rule.includes('#?#')) {
            return RULE_TYPES.COSMETIC;
        }
    }

    // Netzwerkregeln (alles andere)
    return RULE_TYPES.NETWORK;
}

/**
 * Verbesserter Regelparser mit umfassender Validierung
 * @param {string} rule - Die zu parsende Filterregel
 * @returns {Promise<Object|null>} Parsed Regelobjekt oder null, wenn ungültig
 */
async function parseRule(rule) {
    // Grundlegende Eingabevalidierung
    if (!rule || typeof rule !== 'string') {
        return null;
    }

    // Normalisieren und Trimmen
    const normalizedRule = rule.trim();
    
    // Leere Zeilen überspringen
    if (normalizedRule.length === 0) {
        return null;
    }

    // Kommentare und Metadaten überspringen (könnten aber bei Bedarf anders verarbeitet werden)
    if (normalizedRule.startsWith('!') || normalizedRule.startsWith('[')) {
        return null;
    }

    try {
        const ruleType = await determineRuleType(normalizedRule);
        
        if (ruleType === RULE_TYPES.NETWORK) {
            return await parseNetworkRule(normalizedRule);
        } else if (ruleType === RULE_TYPES.ELEMENT_HIDE || ruleType === RULE_TYPES.COSMETIC) {
            return await parseCosmeticRule(normalizedRule, ruleType);
        }

        return null;
    } catch (error) {
        console.warn(`Fehler beim Parsen der Regel: ${normalizedRule}`, error);
        return null;
    }
}

/**
 * Parst Regeln für die Netzwerkfilterung
 * @param {string} rule - Netzwerkregel-String
 * @returns {Promise<Object|null>} Parsed Netzwerkregel
 */
async function parseNetworkRule(rule) {
    // Behandlung von Ausnahmeregeln
    const isException = rule.startsWith('@@');
    const cleanRule = isException ? rule.slice(2) : rule;

    // Aufteilen von Muster und Optionen
    const dollarIndex = cleanRule.lastIndexOf('$');
    let pattern = cleanRule;
    let options = '';

    if (dollarIndex !== -1 && dollarIndex < cleanRule.length - 1) {
        pattern = cleanRule.slice(0, dollarIndex);
        options = cleanRule.slice(dollarIndex + 1);
    }

    // Validierung des URL-Musters
    const patternValidation = await validateURLPattern(pattern);
    if (!patternValidation.isValid) {
        console.warn(`Ungültiges URL-Muster: ${pattern} - ${patternValidation.error}`);
        return null;
    }

    // Validierung der Optionen, falls vorhanden
    let parsedOptions = null;
    if (options) {
        const optionsValidation = await validateFilterOptions(options);
        if (!optionsValidation.isValid) {
            console.warn(`Ungültige Filteroptionen: ${options} - ${optionsValidation.errors.join(', ')}`);
            return null;
        }
        parsedOptions = optionsValidation.parsedOptions;
    }

    return {
        rule: rule,
        type: RULE_TYPES.NETWORK,
        pattern: pattern,
        options: parsedOptions,
        isException: isException,
        patternType: patternValidation.type,
        isValid: true
    };
}

/**
 * Parst kosmetische Filterregeln (Elementverbergung, CSS-Injektion)
 * @param {string} rule - Kosmetische Regel als String
 * @param {string} ruleType - Typ der kosmetischen Regel
 * @returns {Object|null} Parsed kosmetische Regel
 */
async function parseCosmeticRule(rule, ruleType) {
    // SICHERHEIT: Sicheres Parsing kosmetischer Regeln ohne Regex
    const cosmeticMatch = safeParseCosmeticRule(rule);
    if (!cosmeticMatch.success) {
        return null;
    }

    const { domains, operator, selector } = cosmeticMatch.result;

    // Validierung des Selektors
    const selectorValidation = await validateCosmeticSelector(selector);
    if (!selectorValidation.isValid) {
        console.warn(`Ungültiger kosmetischer Selektor: ${selector} - ${selectorValidation.error}`);
        return null;
    }

    // Parsen der Domain-Beschränkungen
    let domainList = null;
    if (domains) {
        domainList = domains.split(',').map(d => d.trim()).filter(d => d.length > 0);
        // SICHERHEIT: Validierung jeder Domain mit sicherer Methode
        for (const domain of domainList) {
            const cleanDomain = domain.startsWith('~') ? domain.slice(1) : domain;
            if (cleanDomain) {
                const testResult = safeDomainValidation(cleanDomain);
                if (!testResult.success) {
                    console.warn(`Ungültige Domain in der kosmetischen Regel: ${cleanDomain} - ${testResult.error}`);
                    return null;
                }
            }
        }
    }

    return {
        rule: rule,
        type: ruleType,
        domains: domainList,
        operator: operator,
        selector: selector,
        isException: operator === '#@#',
        isValid: true
    };
}

/**
 * Validiert die Regelkonformität mit den Standards der Filterliste
 * @param {string} rule - Zu validierende Regel
 * @returns {Object} Validierungsergebnis mit Konformitätsinformationen
 */
function validateRuleCompliance(rule) {
    const result = {
        isCompliant: false,
        issues: [],
        warnings: []
    };

    if (!rule || typeof rule !== 'string') {
        result.issues.push('Regel muss ein nicht leerer String sein');
        return result;
    }

    const trimmedRule = rule.trim();
    
    // Überprüfung auf häufige Probleme
    if (trimmedRule.length === 0) {
        result.issues.push('Leere Regel');
        return result;
    }

    if (trimmedRule.length > 2000) {
        result.issues.push('Regel überschreitet die empfohlene maximale Länge (2000 Zeichen)');
    }

    // Überprüfung auf problematische Zeichen
    if (trimmedRule.includes('\t')) {
        result.warnings.push('Regel enthält Tabulatorzeichen');
    }

    if (trimmedRule.includes('\n') || trimmedRule.includes('\r')) {
        result.issues.push('Regel enthält Zeilenumbruchzeichen');
    }

    // Zusätzliche Formatüberprüfungen basierend auf dem Regeltyp
    if (trimmedRule.startsWith('@@')) {
        if (trimmedRule.length === 2) {
            result.issues.push('Ausnahmeregel ohne Muster');
        }
    }

    if (result.issues.length === 0) {
        result.isCompliant = true;
    }

    return result;
}

/**
 * LEISTUNGSOPTIMIERT: Verbesserte Regelverarbeitung mit paralleler Batch-Verarbeitung und Web-Worker-Unterstützung
 * Verhindert das Blockieren des Hauptthreads während der Verarbeitung großer Filterlisten
 * @param {string[]} rules - Array von Regel-Strings
 * @returns {Promise<Object>} Verarbeitungsergebnisse mit geparsten Regeln und Statistiken
 */
async function updateRules(rules) {
    if (!Array.isArray(rules)) {
        throw new Error('Regeln müssen als Array bereitgestellt werden');
    }

    const results = {
        parsed: [],
        errors: [],
        statistics: {
            total: rules.length,
            valid: 0,
            invalid: 0,
            network: 0,
            cosmetic: 0,
            comments: 0
        }
    };

    // Leistungsoptimierung: Verwendung der Batch-Verarbeitung für große Regelsets
    const BATCH_SIZE = 200; // Optimale Batch-Größe für Leistung vs. Speicher
    const MAX_CONCURRENT_BATCHES = Math.min(4, navigator.hardwareConcurrency || 2);
    
    // Verarbeitung der Regeln in Batches, um das Blockieren des Hauptthreads zu verhindern
    for (let batchStart = 0; batchStart < rules.length; batchStart += BATCH_SIZE * MAX_CONCURRENT_BATCHES) {
        const concurrentBatches = [];
        
        // Erstellung gleichzeitiger Batches
        for (let c = 0; c < MAX_CONCURRENT_BATCHES && batchStart + c * BATCH_SIZE < rules.length; c++) {
            const currentBatchStart = batchStart + c * BATCH_SIZE;
            const currentBatchEnd = Math.min(currentBatchStart + BATCH_SIZE, rules.length);
            const batch = rules.slice(currentBatchStart, currentBatchEnd);
            
            // Verarbeitung jedes Batches asynchron
            const batchPromise = processBatch(batch, currentBatchStart);
            concurrentBatches.push(batchPromise);
        }
        
        // Warten auf den Abschluss aller gleichzeitigen Batches
        const batchResults = await Promise.all(concurrentBatches);
        
        // Zusammenführen der Ergebnisse aus allen Batches
        for (const batchResult of batchResults) {
            results.parsed.push(...batchResult.parsed);
            results.errors.push(...batchResult.errors);
            
            // Aktualisierung der Statistiken
            results.statistics.valid += batchResult.statistics.valid;
            results.statistics.invalid += batchResult.statistics.invalid;
            results.statistics.network += batchResult.statistics.network;
            results.statistics.cosmetic += batchResult.statistics.cosmetic;
            results.statistics.comments += batchResult.statistics.comments;
        }
        
        // Kontrolle abgeben, um das Blockieren der Benutzeroberfläche zwischen Batch-Gruppen zu verhindern
        if (batchStart + BATCH_SIZE * MAX_CONCURRENT_BATCHES < rules.length) {
            await new Promise(resolve => {
                if (window.requestIdleCallback) {
                    requestIdleCallback(resolve, { timeout: 5 });
                } else {
                    setTimeout(resolve, 1);
                }
            });
        }
    }

    return results;
}

/**
 * Verarbeitet ein Batch von Regeln asynchron
 * @param {string[]} batch - Batch von Regeln zur Verarbeitung
 * @param {number} offset - Startindex für die Fehlerberichterstattung
 * @returns {Promise<Object>} Ergebnisse der Batch-Verarbeitung
 */
async function processBatch(batch, offset) {
    const batchResults = {
        parsed: [],
        errors: [],
        statistics: {
            valid: 0,
            invalid: 0,
            network: 0,
            cosmetic: 0,
            comments: 0
        }
    };
    
    // Verarbeitung der Regeln im Batch mit Kontrolle abgeben, um Blockierungen zu vermeiden
    for (let i = 0; i < batch.length; i++) {
        const rule = batch[i];
        const globalIndex = offset + i;
        
        try {
            // Zunächst schnelle synchrone Konformitätsprüfung
            const compliance = validateRuleCompliance(rule);
            if (!compliance.isCompliant) {
                batchResults.errors.push({
                    line: globalIndex + 1,
                    rule: rule,
                    errors: compliance.issues
                });
                batchResults.statistics.invalid++;
                continue;
            }

            // Regel parsen (möglicherweise asynchron)
            const parsed = await parseRule(rule);
            if (parsed) {
                batchResults.parsed.push(parsed);
                batchResults.statistics.valid++;
                
                // Aktualisierung der Typstatistiken
                if (parsed.type === RULE_TYPES.NETWORK) {
                    batchResults.statistics.network++;
                } else if (parsed.type === RULE_TYPES.COSMETIC || parsed.type === RULE_TYPES.ELEMENT_HIDE) {
                    batchResults.statistics.cosmetic++;
                }
            } else {
                // Regel wurde übersprungen (wahrscheinlich Kommentar oder leer)
                batchResults.statistics.comments++;
            }
        } catch (error) {
            batchResults.errors.push({
                line: globalIndex + 1,
                rule: rule,
                errors: [`Parse-Fehler: ${error.message}`]
            });
            batchResults.statistics.invalid++;
        }
        
        // Periodisches Kontrollabgeben innerhalb des Batches, um die Reaktionsfähigkeit aufrechtzuerhalten
        if (i > 0 && i % 50 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    return batchResults;
}

// Exportieren von Funktionen für sowohl CommonJS- als auch ES-Module
const exports = {
    parseRule,
    updateRules,
    processBatch,
    validateURLPattern,
    validateFilterOptions,
    validateCosmeticSelector,
    validateRuleCompliance,
    RULE_TYPES
};

// CommonJS-Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
}

// ES-Modul-Export (für moderne Umgebungen)
if (typeof window !== 'undefined') {
    window.RuleParser = exports;
}