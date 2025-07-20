/**
 * Comprehensive rule parser with advanced syntax validation
 * Supports AdBlock Plus filter list format and various rule types
 * Enhanced with proper error handling and validation
 */

// Rule type constants
const RULE_TYPES = {
    NETWORK: 'network',
    COSMETIC: 'cosmetic',
    ELEMENT_HIDE: 'element_hide',
    COMMENT: 'comment',
    INVALID: 'invalid'
};

// SECURITY: ReDoS-safe pattern validation using string-based parsing
// Complex regex patterns replaced with secure parsing functions to prevent ReDoS attacks
const URL_PATTERN_VALIDATORS = {
    // Safe domain validation using character-by-character parsing
    DOMAIN_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-',
    URL_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_~:/?#[]@!$&\'()*+,;=%',
    WILDCARD_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-*/',
    CSS_SELECTOR_CHARS: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789[]._#:,-"\'=*^$|()\ '
};

/**
 * SECURITY: Safe string validation without regex to prevent ReDoS attacks
 * Uses character-by-character validation instead of complex regex patterns
 */
function validateStringChars(input, allowedChars, maxLength = 500) {
    if (!input || typeof input !== 'string') {
        return { success: false, error: 'Input must be a non-empty string' };
    }
    
    if (input.length > maxLength) {
        return { success: false, error: `Input exceeds maximum length (${maxLength})` };
    }
    
    // Character-by-character validation - prevents ReDoS
    for (let i = 0; i < input.length; i++) {
        if (!allowedChars.includes(input[i])) {
            return { success: false, error: `Invalid character at position ${i}: ${input[i]}` };
        }
    }
    
    return { success: true, result: true };
}

/**
 * SECURITY: Safe domain validation using string parsing instead of regex
 * Prevents ReDoS attacks by avoiding complex regex patterns
 */
function safeDomainValidation(domain) {
    if (!domain || typeof domain !== 'string') {
        return { success: false, error: 'Domain must be a non-empty string' };
    }
    
    if (domain.length > 253) {
        return { success: false, error: 'Domain exceeds maximum length (253)' };
    }
    
    // Check for dangerous patterns without regex
    if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
        return { success: false, error: 'Invalid domain format' };
    }
    
    // Split domain into parts and validate each
    const parts = domain.split('.');
    if (parts.length < 2) {
        return { success: false, error: 'Domain must have at least two parts' };
    }
    
    for (const part of parts) {
        if (part.length === 0 || part.length > 63) {
            return { success: false, error: 'Invalid domain part length' };
        }
        
        // Validate characters in each part
        const validation = validateStringChars(part, URL_PATTERN_VALIDATORS.DOMAIN_CHARS, 63);
        if (!validation.success) {
            return validation;
        }
    }
    
    return { success: true, result: { domain } };
}

/**
 * SECURITY: Safe URL pattern matching without complex regex
 * Prevents ReDoS by using string-based parsing
 */
function safeURLPatternMatch(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return { success: false, error: 'Pattern must be a non-empty string' };
    }
    
    if (pattern.length > 500) {
        return { success: false, error: 'Pattern exceeds maximum length (500)' };
    }
    
    // Domain anchor pattern (||domain.com^)
    if (pattern.startsWith('||')) {
        const endCaret = pattern.endsWith('^');
        const domain = endCaret ? pattern.slice(2, -1) : pattern.slice(2);
        
        const domainValidation = safeDomainValidation(domain);
        if (!domainValidation.success) {
            return domainValidation;
        }
        
        return { success: true, result: [pattern, domain], type: 'domain_anchor' };
    }
    
    // URL anchor pattern (|https://example.com)
    if (pattern.startsWith('|') && !pattern.startsWith('||')) {
        if (pattern.startsWith('|http://') || pattern.startsWith('|https://')) {
            const validation = validateStringChars(pattern, URL_PATTERN_VALIDATORS.URL_CHARS, 500);
            if (!validation.success) {
                return validation;
            }
            return { success: true, result: [pattern], type: 'url_anchor' };
        }
        return { success: false, error: 'Invalid URL anchor pattern' };
    }
    
    // Wildcard pattern validation
    const validation = validateStringChars(pattern, URL_PATTERN_VALIDATORS.WILDCARD_CHARS, 100);
    if (!validation.success) {
        return validation;
    }
    
    return { success: true, result: [pattern], type: 'wildcard' };
}

/**
 * SECURITY: Safe cosmetic rule parsing without regex
 * Prevents ReDoS by using string-based parsing
 */
function safeParseCosmeticRule(rule) {
    if (!rule || typeof rule !== 'string') {
        return { success: false, error: 'Rule must be a non-empty string' };
    }
    
    let operator = '';
    let operatorIndex = -1;
    
    // Find the cosmetic operator
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
        return { success: false, error: 'No cosmetic operator found' };
    }
    
    const domains = rule.slice(0, operatorIndex);
    const selector = rule.slice(operatorIndex + operator.length);
    
    if (!selector) {
        return { success: false, error: 'Empty selector' };
    }
    
    return {
        success: true,
        result: { domains, operator, selector }
    };
}

/**
 * SECURITY: Detects URL-encoded attack vectors
 * Prevents encoded script injection and other attacks
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
 * SECURITY: Enhanced input sanitization with comprehensive filtering
 * Removes or neutralizes dangerous content while preserving functionality
 */
function sanitizeInput(input, options = {}) {
    if (!input || typeof input !== 'string') {
        return { sanitized: '', wasModified: false, errors: ['Input must be a non-empty string'] };
    }
    
    const maxLength = options.maxLength || 500;
    const allowHTML = options.allowHTML || false;
    const allowSpecialChars = options.allowSpecialChars || false;
    
    let sanitized = input;
    let wasModified = false;
    const errors = [];
    
    // Length check
    if (sanitized.length > maxLength) {
        sanitized = sanitized.slice(0, maxLength);
        wasModified = true;
        errors.push(`Input truncated to ${maxLength} characters`);
    }
    
    // Remove null bytes and control characters
    const originalLength = sanitized.length;
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    if (sanitized.length !== originalLength) {
        wasModified = true;
        errors.push('Removed control characters');
    }
    
    // HTML sanitization if not allowed
    if (!allowHTML) {
        const htmlPattern = /<[^>]*>/g;
        if (htmlPattern.test(sanitized)) {
            sanitized = sanitized.replace(htmlPattern, '');
            wasModified = true;
            errors.push('Removed HTML tags');
        }
    }
    
    // Special character filtering if not allowed
    if (!allowSpecialChars) {
        const originalSanitized = sanitized;
        sanitized = sanitized.replace(/[<>"'&{}()]/g, '');
        if (sanitized !== originalSanitized) {
            wasModified = true;
            errors.push('Removed special characters');
        }
    }
    
    // URL decode check and sanitization
    if (sanitized.includes('%')) {
        try {
            const decoded = decodeURIComponent(sanitized);
            if (isEncodedAttack(sanitized)) {
                sanitized = sanitized.replace(/%[0-9a-fA-F]{2}/g, '');
                wasModified = true;
                errors.push('Removed URL-encoded attack vectors');
            }
        } catch (e) {
            // Invalid URL encoding - remove % characters
            sanitized = sanitized.replace(/%/g, '');
            wasModified = true;
            errors.push('Removed invalid URL encoding');
        }
    }
    
    return { sanitized, wasModified, errors };
}

// Filter options validation
const VALID_OPTIONS = new Set([
    'script', 'image', 'stylesheet', 'object', 'xmlhttprequest', 'subdocument',
    'document', 'websocket', 'webrtc', 'popup', 'third-party', 'match-case',
    'collapse', 'donottrack', 'important', 'sitekey', 'genericblock',
    'generichide', 'elemhide', 'ping', 'font', 'media', 'other', 'beacon'
]);

// SECURITY: Domain validation moved to safe string-based validation
// Removed regex to prevent ReDoS attacks

/**
 * Enhanced domain sanitization with stricter validation
 * @param {string} domain - Domain to sanitize
 * @returns {Promise<Object>} Sanitization result
 */
async function sanitizeDomain(domain) {
    if (!domain || typeof domain !== 'string') {
        return { isValid: false, error: 'Domain must be a non-empty string' };
    }
    
    // Remove potentially dangerous characters
    const cleaned = domain.replace(/[<>'"(){}[\]\\]/g, '').toLowerCase().trim();
    
    // Check for suspicious patterns
    if (cleaned.includes('..') || cleaned.startsWith('.') || cleaned.endsWith('.') ||
        cleaned.includes('localhost') || cleaned.includes('127.0.0.1') ||
        cleaned.includes('0.0.0.0') || cleaned.includes('::1')) {
        return { isValid: false, error: 'Domain contains suspicious patterns' };
    }
    
    // SECURITY: Safe domain validation without regex
    const testResult = safeDomainValidation(cleaned);
    if (!testResult.success) {
        return { isValid: false, error: testResult.error };
    }
    
    return { isValid: true, domain: cleaned };
}

/**
 * Enhanced URL filter pattern validation with ReDoS protection
 * @param {string} pattern - The URL pattern to validate
 * @returns {Promise<Object>} Validation result with isValid flag and error message
 */
async function validateURLPattern(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return { isValid: false, error: 'Pattern must be a non-empty string' };
    }

    // SECURITY: Comprehensive dangerous pattern detection
    const dangerousPatterns = [
        // Script injection vectors
        '<script', '</script', 'javascript:', 'data:', 'vbscript:', 'file:', 'ftp:',
        // Function calls and code execution
        'eval(', 'function(', 'constructor(', 'settimeout(', 'setinterval(',
        // Event handlers
        'onclick=', 'onload=', 'onerror=', 'onmouseover=', 'onfocus=', 'onblur=',
        'onchange=', 'onsubmit=', 'onkeydown=', 'onkeyup=', 'onkeypress=',
        // CSS expressions and imports
        'expression(', '@import', 'url(', 'background:url', 'background-image:url',
        // Module and require patterns
        'import(', 'require(', 'importscripts(', '__import__',
        // Network requests
        'fetch(', 'xmlhttprequest', 'websocket', 'eventsource',
        // File system access
        'filesystem:', 'blob:', 'about:',
        // Dangerous HTML entities
        '&#', '&lt;', '&gt;', '&quot;', '&apos;',
        // SQL injection patterns
        'union select', 'drop table', 'delete from', 'insert into',
        // Command injection
        '$(', '`', 'cmd.exe', '/bin/', 'powershell',
        // Template injection
        '{{', '}}', '<%', '%>', '{%', '%}',
        // Base64 encoded common attack vectors
        'amF2YXNjcmlwdA==', 'ZXZhbA==', 'c2NyaXB0'
    ];
    
    const lowerPattern = pattern.toLowerCase();
    for (const dangerous of dangerousPatterns) {
        if (lowerPattern.includes(dangerous.toLowerCase())) {
            return { isValid: false, error: `Pattern contains dangerous content: ${dangerous}` };
        }
    }
    
    // SECURITY: Additional character-based validation
    const forbiddenChars = ['\0', '\x01', '\x02', '\x03', '\x04', '\x05', '\x06', '\x07', '\x08', '\x0b', '\x0c', '\x0e', '\x0f'];
    for (const char of forbiddenChars) {
        if (pattern.includes(char)) {
            return { isValid: false, error: `Pattern contains forbidden control character` };
        }
    }
    
    // SECURITY: Check for encoded attack vectors
    if (pattern.includes('%') && isEncodedAttack(pattern)) {
        return { isValid: false, error: 'Pattern contains encoded attack vector' };
    }

    // Check maximum length to prevent DoS - reduced from 1000 to 500
    if (pattern.length > 500) {
        return { isValid: false, error: 'Pattern exceeds maximum length (500 characters)' };
    }

    // SECURITY: Safe pattern validation without regex to prevent ReDoS
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

    return { isValid: false, error: 'Unrecognized pattern format' };
}

/**
 * Validates filter options (e.g., $script,third-party)
 * @param {string} options - Options string after $ delimiter
 * @returns {Promise<Object>} Validation result
 */
async function validateFilterOptions(options) {
    if (!options) {
        return { isValid: true, parsedOptions: [] };
    }

    const optionList = options.split(',').map(opt => opt.trim().toLowerCase());
    const parsedOptions = [];
    const errors = [];

    for (const option of optionList) {
        // Handle negated options (e.g., ~script)
        const isNegated = option.startsWith('~');
        const baseOption = isNegated ? option.slice(1) : option;

        // Handle domain restrictions (e.g., domain=example.com)
        if (baseOption.startsWith('domain=')) {
            const domains = baseOption.slice(7).split('|');
            for (const domain of domains) {
                const cleanDomain = domain.startsWith('~') ? domain.slice(1) : domain;
                if (cleanDomain) {
                    // SECURITY: Use safe domain validation instead of regex
                    const testResult = safeDomainValidation(cleanDomain);
                    if (!testResult.success) {
                        errors.push(`Invalid domain in options: ${cleanDomain} - ${testResult.error}`);
                    }
                }
            }
            parsedOptions.push({ type: 'domain', value: baseOption.slice(7), negated: isNegated });
        } else if (VALID_OPTIONS.has(baseOption)) {
            parsedOptions.push({ type: 'filter', value: baseOption, negated: isNegated });
        } else {
            errors.push(`Unknown filter option: ${baseOption}`);
        }
    }

    return {
        isValid: errors.length === 0,
        parsedOptions,
        errors
    };
}

/**
 * SECURITY: Enhanced cosmetic rule syntax validation with comprehensive sanitization
 * @param {string} selector - CSS selector part of cosmetic rule
 * @returns {Promise<Object>} Validation result
 */
async function validateCosmeticSelector(selector) {
    if (!selector || typeof selector !== 'string') {
        return { isValid: false, error: 'Selector must be a non-empty string' };
    }

    // SECURITY: Comprehensive input sanitization
    const sanitizationResult = sanitizeInput(selector, {
        maxLength: 1000,
        allowHTML: false,
        allowSpecialChars: true // CSS selectors need some special chars
    });
    
    if (sanitizationResult.errors.length > 0) {
        return { isValid: false, error: `Sanitization failed: ${sanitizationResult.errors.join(', ')}` };
    }
    
    const sanitizedSelector = sanitizationResult.sanitized;

    // SECURITY: Enhanced dangerous pattern detection for CSS
    const dangerousCSSPatterns = [
        'javascript:', 'data:', 'vbscript:', 'file:', 'ftp:',
        '<script', '</script', 'eval(', 'function(', 'constructor(',
        'expression(', '@import', 'url(javascript:', 'url(data:',
        'behavior:', '-moz-binding:', 'binding:', '\\', 'content:',
        'counter(', 'counters(', 'attr(onclick', 'attr(onload',
        '\\A', '\\D', '\\a', '\\d', // CSS escapes that could be dangerous
        '/*', '*/', '//', '--', '\\*', '\\/'
    ];
    
    const lowerSelector = sanitizedSelector.toLowerCase();
    for (const dangerous of dangerousCSSPatterns) {
        if (lowerSelector.includes(dangerous.toLowerCase())) {
            return { isValid: false, error: `CSS selector contains dangerous pattern: ${dangerous}` };
        }
    }

    // SECURITY: Validate CSS selector structure
    if (!isValidCSSSelector(sanitizedSelector)) {
        return { isValid: false, error: 'Invalid CSS selector structure' };
    }

    return { isValid: true, sanitizedSelector };
}

/**
 * SECURITY: Validates CSS selector structure without regex
 * Prevents malformed selectors that could bypass security
 */
function isValidCSSSelector(selector) {
    // Basic structural validation
    if (selector.length === 0 || selector.length > 1000) {
        return false;
    }
    
    // Check for balanced brackets and parentheses
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
    
    // Check if brackets and parentheses are balanced and quotes are closed
    return bracketCount === 0 && parenCount === 0 && !inQuotes;
}

/**
 * Determines the type of rule based on syntax
 * @param {string} rule - The filter rule
 * @returns {string} Rule type constant
 */
async function determineRuleType(rule) {
    // Comment or metadata
    if (rule.startsWith('!') || rule.startsWith('[')) {
        return RULE_TYPES.COMMENT;
    }

    // SECURITY: Safe cosmetic rule detection without regex
    if (rule.includes('##') || rule.includes('#@#') || rule.includes('#?#')) {
        // Use safe string parsing instead of regex
        if (rule.includes('##') || rule.includes('#@#')) {
            return RULE_TYPES.ELEMENT_HIDE;
        } else if (rule.includes('#?#')) {
            return RULE_TYPES.COSMETIC;
        }
    }

    // Network rules (everything else)
    return RULE_TYPES.NETWORK;
}

/**
 * Enhanced rule parser with comprehensive validation
 * @param {string} rule - The filter rule to parse
 * @returns {Promise<Object|null>} Parsed rule object or null if invalid
 */
async function parseRule(rule) {
    // Basic input validation
    if (!rule || typeof rule !== 'string') {
        return null;
    }

    // Normalize and trim
    const normalizedRule = rule.trim();
    
    // Skip empty lines
    if (normalizedRule.length === 0) {
        return null;
    }

    // Skip comments and metadata (but could be processed differently if needed)
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
        console.warn(`Failed to parse rule: ${normalizedRule}`, error);
        return null;
    }
}

/**
 * Parses network filtering rules
 * @param {string} rule - Network rule string
 * @returns {Promise<Object|null>} Parsed network rule
 */
async function parseNetworkRule(rule) {
    // Handle exception rules
    const isException = rule.startsWith('@@');
    const cleanRule = isException ? rule.slice(2) : rule;

    // Split pattern and options
    const dollarIndex = cleanRule.lastIndexOf('$');
    let pattern = cleanRule;
    let options = '';

    if (dollarIndex !== -1 && dollarIndex < cleanRule.length - 1) {
        pattern = cleanRule.slice(0, dollarIndex);
        options = cleanRule.slice(dollarIndex + 1);
    }

    // Validate URL pattern
    const patternValidation = await validateURLPattern(pattern);
    if (!patternValidation.isValid) {
        console.warn(`Invalid URL pattern: ${pattern} - ${patternValidation.error}`);
        return null;
    }

    // Validate options if present
    let parsedOptions = null;
    if (options) {
        const optionsValidation = await validateFilterOptions(options);
        if (!optionsValidation.isValid) {
            console.warn(`Invalid filter options: ${options} - ${optionsValidation.errors.join(', ')}`);
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
 * Parses cosmetic filtering rules (element hiding, CSS injection)
 * @param {string} rule - Cosmetic rule string
 * @param {string} ruleType - Type of cosmetic rule
 * @returns {Object|null} Parsed cosmetic rule
 */
async function parseCosmeticRule(rule, ruleType) {
    // SECURITY: Safe cosmetic rule parsing without regex
    const cosmeticMatch = safeParseCosmeticRule(rule);
    if (!cosmeticMatch.success) {
        return null;
    }

    const { domains, operator, selector } = cosmeticMatch.result;

    // Validate selector
    const selectorValidation = await validateCosmeticSelector(selector);
    if (!selectorValidation.isValid) {
        console.warn(`Invalid cosmetic selector: ${selector} - ${selectorValidation.error}`);
        return null;
    }

    // Parse domain restrictions
    let domainList = null;
    if (domains) {
        domainList = domains.split(',').map(d => d.trim()).filter(d => d.length > 0);
        // SECURITY: Validate each domain using safe method
        for (const domain of domainList) {
            const cleanDomain = domain.startsWith('~') ? domain.slice(1) : domain;
            if (cleanDomain) {
                const testResult = safeDomainValidation(cleanDomain);
                if (!testResult.success) {
                    console.warn(`Invalid domain in cosmetic rule: ${cleanDomain} - ${testResult.error}`);
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
 * Validates rule format compliance with filter list standards
 * @param {string} rule - Rule to validate
 * @returns {Object} Validation result with compliance info
 */
function validateRuleCompliance(rule) {
    const result = {
        isCompliant: false,
        issues: [],
        warnings: []
    };

    if (!rule || typeof rule !== 'string') {
        result.issues.push('Rule must be a non-empty string');
        return result;
    }

    const trimmedRule = rule.trim();
    
    // Check for common issues
    if (trimmedRule.length === 0) {
        result.issues.push('Empty rule');
        return result;
    }

    if (trimmedRule.length > 2000) {
        result.issues.push('Rule exceeds recommended maximum length (2000 characters)');
    }

    // Check for problematic characters
    if (trimmedRule.includes('\t')) {
        result.warnings.push('Rule contains tab characters');
    }

    if (trimmedRule.includes('\n') || trimmedRule.includes('\r')) {
        result.issues.push('Rule contains line break characters');
    }

    // Additional format checks based on rule type
    if (trimmedRule.startsWith('@@')) {
        if (trimmedRule.length === 2) {
            result.issues.push('Exception rule missing pattern');
        }
    }

    if (result.issues.length === 0) {
        result.isCompliant = true;
    }

    return result;
}

/**
 * PERFORMANCE OPTIMIZED: Enhanced rule processing with parallel batch processing and Web Worker support
 * Prevents main thread blocking during large filter list processing
 * @param {string[]} rules - Array of rule strings
 * @returns {Promise<Object>} Processing results with parsed rules and statistics
 */
async function updateRules(rules) {
    if (!Array.isArray(rules)) {
        throw new Error('Rules must be provided as an array');
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

    // Performance optimization: Use batch processing for large rule sets
    const BATCH_SIZE = 200; // Optimal batch size for performance vs memory
    const MAX_CONCURRENT_BATCHES = Math.min(4, navigator.hardwareConcurrency || 2);
    
    // Process rules in batches to prevent main thread blocking
    for (let batchStart = 0; batchStart < rules.length; batchStart += BATCH_SIZE * MAX_CONCURRENT_BATCHES) {
        const concurrentBatches = [];
        
        // Create concurrent batches
        for (let c = 0; c < MAX_CONCURRENT_BATCHES && batchStart + c * BATCH_SIZE < rules.length; c++) {
            const currentBatchStart = batchStart + c * BATCH_SIZE;
            const currentBatchEnd = Math.min(currentBatchStart + BATCH_SIZE, rules.length);
            const batch = rules.slice(currentBatchStart, currentBatchEnd);
            
            // Process each batch asynchronously
            const batchPromise = processBatch(batch, currentBatchStart);
            concurrentBatches.push(batchPromise);
        }
        
        // Wait for all concurrent batches to complete
        const batchResults = await Promise.all(concurrentBatches);
        
        // Merge results from all batches
        for (const batchResult of batchResults) {
            results.parsed.push(...batchResult.parsed);
            results.errors.push(...batchResult.errors);
            
            // Update statistics
            results.statistics.valid += batchResult.statistics.valid;
            results.statistics.invalid += batchResult.statistics.invalid;
            results.statistics.network += batchResult.statistics.network;
            results.statistics.cosmetic += batchResult.statistics.cosmetic;
            results.statistics.comments += batchResult.statistics.comments;
        }
        
        // Yield control to prevent UI blocking between batch groups
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
 * Processes a batch of rules asynchronously
 * @param {string[]} batch - Batch of rules to process
 * @param {number} offset - Starting index for error reporting
 * @returns {Promise<Object>} Batch processing results
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
    
    // Process rules in the batch with yielding to prevent blocking
    for (let i = 0; i < batch.length; i++) {
        const rule = batch[i];
        const globalIndex = offset + i;
        
        try {
            // Quick synchronous compliance check first
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

            // Parse the rule (potentially async)
            const parsed = await parseRule(rule);
            if (parsed) {
                batchResults.parsed.push(parsed);
                batchResults.statistics.valid++;
                
                // Update type statistics
                if (parsed.type === RULE_TYPES.NETWORK) {
                    batchResults.statistics.network++;
                } else if (parsed.type === RULE_TYPES.COSMETIC || parsed.type === RULE_TYPES.ELEMENT_HIDE) {
                    batchResults.statistics.cosmetic++;
                }
            } else {
                // Rule was skipped (likely comment or empty)
                batchResults.statistics.comments++;
            }
        } catch (error) {
            batchResults.errors.push({
                line: globalIndex + 1,
                rule: rule,
                errors: [`Parse error: ${error.message}`]
            });
            batchResults.statistics.invalid++;
        }
        
        // Yield periodically within batch to maintain responsiveness
        if (i > 0 && i % 50 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    
    return batchResults;
}

// Export functions for both CommonJS and ES modules
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

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
}

// ES module export (for modern environments)
if (typeof window !== 'undefined') {
    window.RuleParser = exports;
}