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

// URL filter patterns and validation with ReDoS protection
const URL_PATTERN_REGEX = {
    // Basic URL patterns (||domain.com^, |https://example.com) - enhanced with stricter validation
    DOMAIN_ANCHOR: /^\|\|([a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,63})\^?$/,
    URL_ANCHOR: /^\|https?:\/\/[^\s]{1,500}$/,
    // Wildcard patterns (*ads*, /ads/, etc.) - length limited to prevent ReDoS
    WILDCARD: /^[*\/]?[a-zA-Z0-9._\-*\/]{1,100}[*\/]?$/,
    // Exception rules (@@)
    EXCEPTION: /^@@/,
    // Cosmetic rules (##, #@#, #?#) - limited length for security
    COSMETIC: /^([^#]{0,100})(#{1,2}|#@#|#\?#)(.{1,500})$/,
    // Element hiding rules - enhanced with length limits
    ELEMENT_HIDE: /^([^#]{0,100})(##|#@#)([a-zA-Z0-9\[\]._#:,-\s"'=*^$|()]{1,300})$/
};

// Regex timeout function to prevent ReDoS attacks
function safeRegexTest(regex, input, timeoutMs = 100) {
    return new Promise((resolve) => {
        let timeoutId = null;
        let resolved = false;
        
        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };
        
        const safeResolve = (result) => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(result);
            }
        };
        
        timeoutId = setTimeout(() => {
            safeResolve({ success: false, error: 'Regex timeout - potential ReDoS attack' });
        }, timeoutMs);
        
        // Execute regex asynchronously to allow timeout to work
        setTimeout(() => {
            if (!resolved) {
                try {
                    const result = regex.test(input);
                    safeResolve({ success: true, result });
                } catch (error) {
                    safeResolve({ success: false, error: error.message });
                }
            }
        }, 0);
    });
}

function safeRegexMatch(regex, input, timeoutMs = 100) {
    return new Promise((resolve) => {
        let timeoutId = null;
        let resolved = false;
        
        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };
        
        const safeResolve = (result) => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(result);
            }
        };
        
        timeoutId = setTimeout(() => {
            safeResolve({ success: false, error: 'Regex timeout - potential ReDoS attack' });
        }, timeoutMs);
        
        // Execute regex asynchronously to allow timeout to work
        setTimeout(() => {
            if (!resolved) {
                try {
                    const result = input.match(regex);
                    safeResolve({ success: true, result });
                } catch (error) {
                    safeResolve({ success: false, error: error.message });
                }
            }
        }, 0);
    });
}

// Filter options validation
const VALID_OPTIONS = new Set([
    'script', 'image', 'stylesheet', 'object', 'xmlhttprequest', 'subdocument',
    'document', 'websocket', 'webrtc', 'popup', 'third-party', 'match-case',
    'collapse', 'donottrack', 'important', 'sitekey', 'genericblock',
    'generichide', 'elemhide', 'ping', 'font', 'media', 'other', 'beacon'
]);

// Domain validation regex
const DOMAIN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

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
    
    // Enhanced domain validation
    const testResult = await safeRegexTest(DOMAIN_REGEX, cleaned);
    if (!testResult.success) {
        return { isValid: false, error: testResult.error };
    }
    if (!testResult.result || cleaned.length > 253) {
        return { isValid: false, error: 'Invalid domain format or too long' };
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

    // Enhanced security checks for dangerous content
    const dangerousPatterns = [
        '<', '>', '"', 'javascript:', 'data:', 'vbscript:', 'eval(',
        'function(', 'onclick=', 'onload=', 'onerror=', 'expression(',
        'import(', 'require(', 'fetch(', 'XMLHttpRequest'
    ];
    
    for (const dangerous of dangerousPatterns) {
        if (pattern.toLowerCase().includes(dangerous)) {
            return { isValid: false, error: `Pattern contains dangerous content: ${dangerous}` };
        }
    }

    // Check maximum length to prevent DoS - reduced from 1000 to 500
    if (pattern.length > 500) {
        return { isValid: false, error: 'Pattern exceeds maximum length (500 characters)' };
    }

    // Validate domain anchor patterns (||domain.com^) with timeout protection
    if (pattern.startsWith('||')) {
        const regexResult = await safeRegexTest(URL_PATTERN_REGEX.DOMAIN_ANCHOR, pattern);
        if (!regexResult.success) {
            return { isValid: false, error: regexResult.error };
        }
        
        const matchResult = await safeRegexMatch(URL_PATTERN_REGEX.DOMAIN_ANCHOR, pattern);
        if (!matchResult.success) {
            return { isValid: false, error: matchResult.error };
        }
        if (matchResult.result) {
            const domainResult = await sanitizeDomain(matchResult.result[1]);
            if (!domainResult.isValid) {
                return { isValid: false, error: domainResult.error };
            }
            return { isValid: true, type: 'domain_anchor', domain: domainResult.domain };
        }
        return { isValid: false, error: 'Invalid domain anchor pattern' };
    }

    // Validate URL anchor patterns (|https://example.com) with timeout protection
    if (pattern.startsWith('|') && !pattern.startsWith('||')) {
        const regexResult = await safeRegexTest(URL_PATTERN_REGEX.URL_ANCHOR, pattern);
        if (!regexResult.success) {
            return { isValid: false, error: regexResult.error };
        }
        if (regexResult.result) {
            return { isValid: true, type: 'url_anchor' };
        }
        return { isValid: false, error: 'Invalid URL anchor pattern' };
    }

    // Validate wildcard patterns with timeout protection
    const wildcardResult = await safeRegexTest(URL_PATTERN_REGEX.WILDCARD, pattern);
    if (!wildcardResult.success) {
        return { isValid: false, error: wildcardResult.error };
    }
    if (wildcardResult.result) {
        return { isValid: true, type: 'wildcard' };
    }

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
                    const testResult = await safeRegexTest(DOMAIN_REGEX, cleanDomain);
                    if (!testResult.success) {
                        errors.push(`Regex error for domain: ${cleanDomain} - ${testResult.error}`);
                    } else if (!testResult.result) {
                        errors.push(`Invalid domain in options: ${cleanDomain}`);
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
 * Validates cosmetic rule syntax
 * @param {string} selector - CSS selector part of cosmetic rule
 * @returns {Promise<Object>} Validation result
 */
async function validateCosmeticSelector(selector) {
    if (!selector || typeof selector !== 'string') {
        return { isValid: false, error: 'Selector must be a non-empty string' };
    }

    // Basic length check
    if (selector.length > 1000) {
        return { isValid: false, error: 'Selector exceeds maximum length' };
    }

    // Check for potentially dangerous patterns
    if (selector.includes('javascript:') || selector.includes('data:') || 
        selector.includes('<script') || selector.includes('eval(') || 
        selector.includes('vbscript:') || selector.includes('function(') || 
        selector.includes('expression(') || selector.includes('import(')) {
        return { isValid: false, error: 'Selector contains potentially dangerous content' };
    }

    // Basic CSS selector validation (simplified)
    try {
        // This is a basic check - in a real implementation, you might use a CSS parser
        const matchResult = await safeRegexMatch(/^[a-zA-Z0-9\[\]._#:,\-\s"'=*^$|()]+$/, selector);
        if (!matchResult.success) {
            return { isValid: false, error: matchResult.error };
        }
        if (matchResult.result) {
            return { isValid: true };
        }
        return { isValid: false, error: 'Invalid CSS selector syntax' };
    } catch (error) {
        return { isValid: false, error: 'Failed to validate CSS selector' };
    }
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

    // Cosmetic rules
    if (rule.includes('##') || rule.includes('#@#') || rule.includes('#?#')) {
        const cosmeticMatchResult = await safeRegexMatch(URL_PATTERN_REGEX.COSMETIC, rule);
        if (cosmeticMatchResult.success && cosmeticMatchResult.result) {
            const operator = cosmeticMatchResult.result[2];
            return operator === '##' || operator === '#@#' ? RULE_TYPES.ELEMENT_HIDE : RULE_TYPES.COSMETIC;
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
    const cosmeticMatchResult = await safeRegexMatch(URL_PATTERN_REGEX.COSMETIC, rule);
    if (!cosmeticMatchResult.success || !cosmeticMatchResult.result) {
        return null;
    }

    const cosmeticMatch = cosmeticMatchResult.result;
    const domains = cosmeticMatch[1];
    const operator = cosmeticMatch[2];
    const selector = cosmeticMatch[3];

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
        // Validate each domain
        for (const domain of domainList) {
            const cleanDomain = domain.startsWith('~') ? domain.slice(1) : domain;
            if (cleanDomain) {
                const testResult = await safeRegexTest(DOMAIN_REGEX, cleanDomain);
                if (!testResult.success) {
                    console.warn(`Regex error for domain in cosmetic rule: ${cleanDomain} - ${testResult.error}`);
                    return null;
                } else if (!testResult.result) {
                    console.warn(`Invalid domain in cosmetic rule: ${cleanDomain}`);
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
 * Enhanced rule processing function with error handling
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

    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        
        try {
            // Validate compliance first
            const compliance = validateRuleCompliance(rule);
            if (!compliance.isCompliant) {
                results.errors.push({
                    line: i + 1,
                    rule: rule,
                    errors: compliance.issues
                });
                results.statistics.invalid++;
                continue;
            }

            // Parse the rule
            const parsed = await parseRule(rule);
            if (parsed) {
                results.parsed.push(parsed);
                results.statistics.valid++;
                
                // Update type statistics
                if (parsed.type === RULE_TYPES.NETWORK) {
                    results.statistics.network++;
                } else if (parsed.type === RULE_TYPES.COSMETIC || parsed.type === RULE_TYPES.ELEMENT_HIDE) {
                    results.statistics.cosmetic++;
                }
            } else {
                // Rule was skipped (likely comment or empty)
                results.statistics.comments++;
            }
        } catch (error) {
            results.errors.push({
                line: i + 1,
                rule: rule,
                errors: [`Parse error: ${error.message}`]
            });
            results.statistics.invalid++;
        }
    }

    return results;
}

// Export functions for both CommonJS and ES modules
const exports = {
    parseRule,
    updateRules,
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