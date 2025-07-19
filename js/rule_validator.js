/**
 * JSON Rule Validation Module for Pagy Blocker
 * 
 * Provides comprehensive validation for precompiled JSON rule structures
 * Ensures rule integrity, validates required fields, and checks for compliance
 * with Chrome's declarativeNetRequest API requirements.
 * 
 * Features:
 * - Rule structure validation
 * - ID uniqueness and sequential numbering validation
 * - urlFilter pattern validation
 * - Resource type validation
 * - JSON schema validation
 * - Performance optimized validation functions
 */

// Validation configuration constants
const VALIDATION_CONFIG = {
    // Maximum rule ID allowed by Chrome declarativeNetRequest API
    MAX_RULE_ID: 300000,
    
    // Maximum priority value
    MAX_PRIORITY: 2147483647,
    
    // Valid action types
    VALID_ACTION_TYPES: ['block', 'allow', 'redirect', 'upgradeScheme', 'modifyHeaders'],
    
    // Valid resource types according to Chrome declarativeNetRequest API
    VALID_RESOURCE_TYPES: [
        'main_frame',
        'sub_frame', 
        'stylesheet',
        'script',
        'image',
        'font',
        'object',
        'xmlhttprequest',
        'ping',
        'csp_report',
        'media',
        'websocket',
        'webtransport',
        'webbundle',
        'other'
    ],
    
    // Maximum length for URL filters
    MAX_URL_FILTER_LENGTH: 2000,
    
    // Validation performance limits
    MAX_RULES_COUNT: 30000,
    VALIDATION_TIMEOUT_MS: 10000
};

/**
 * Validation error class for better error handling
 */
class RuleValidationError extends Error {
    constructor(message, ruleIndex = null, ruleId = null, errorCode = null) {
        super(message);
        this.name = 'RuleValidationError';
        this.ruleIndex = ruleIndex;
        this.ruleId = ruleId;
        this.errorCode = errorCode;
    }
}

/**
 * Validates the basic structure of a single rule
 * @param {Object} rule - The rule object to validate
 * @param {number} index - The index of the rule in the array
 * @returns {Object} Validation result with isValid and errors
 */
function validateRuleStructure(rule, index) {
    const errors = [];
    
    // Check if rule is an object
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        return {
            isValid: false,
            errors: [`Rule at index ${index} must be an object`]
        };
    }
    
    // Validate required fields exist
    const requiredFields = ['id', 'priority', 'action', 'condition'];
    for (const field of requiredFields) {
        if (!(field in rule)) {
            errors.push(`Rule at index ${index} missing required field: ${field}`);
        }
    }
    
    // Validate rule ID
    if ('id' in rule) {
        if (!Number.isInteger(rule.id) || rule.id < 1 || rule.id > VALIDATION_CONFIG.MAX_RULE_ID) {
            errors.push(`Rule at index ${index} has invalid ID: ${rule.id}. Must be integer between 1 and ${VALIDATION_CONFIG.MAX_RULE_ID}`);
        }
    }
    
    // Validate priority
    if ('priority' in rule) {
        if (!Number.isInteger(rule.priority) || rule.priority < 1 || rule.priority > VALIDATION_CONFIG.MAX_PRIORITY) {
            errors.push(`Rule at index ${index} has invalid priority: ${rule.priority}. Must be integer between 1 and ${VALIDATION_CONFIG.MAX_PRIORITY}`);
        }
    }
    
    // Validate action object
    if ('action' in rule) {
        if (!rule.action || typeof rule.action !== 'object') {
            errors.push(`Rule at index ${index} action must be an object`);
        } else {
            if (!rule.action.type || !VALIDATION_CONFIG.VALID_ACTION_TYPES.includes(rule.action.type)) {
                errors.push(`Rule at index ${index} has invalid action type: ${rule.action.type}. Must be one of: ${VALIDATION_CONFIG.VALID_ACTION_TYPES.join(', ')}`);
            }
        }
    }
    
    // Validate condition object
    if ('condition' in rule) {
        const conditionValidation = validateRuleCondition(rule.condition, index);
        errors.push(...conditionValidation.errors);
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validates rule condition object
 * @param {Object} condition - The condition object to validate
 * @param {number} ruleIndex - The index of the rule
 * @returns {Object} Validation result
 */
function validateRuleCondition(condition, ruleIndex) {
    const errors = [];
    
    if (!condition || typeof condition !== 'object') {
        return {
            isValid: false,
            errors: [`Rule at index ${ruleIndex} condition must be an object`]
        };
    }
    
    // Validate urlFilter if present
    if ('urlFilter' in condition) {
        const urlFilterValidation = validateUrlFilter(condition.urlFilter, ruleIndex);
        errors.push(...urlFilterValidation.errors);
    }
    
    // Validate regexFilter if present
    if ('regexFilter' in condition) {
        try {
            new RegExp(condition.regexFilter);
        } catch (error) {
            errors.push(`Rule at index ${ruleIndex} has invalid regexFilter: ${error.message}`);
        }
        
        if (condition.regexFilter.length > VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH) {
            errors.push(`Rule at index ${ruleIndex} regexFilter too long: ${condition.regexFilter.length} chars. Max: ${VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH}`);
        }
    }
    
    // Validate resourceTypes if present
    if ('resourceTypes' in condition) {
        const resourceTypesValidation = validateResourceTypes(condition.resourceTypes, ruleIndex);
        errors.push(...resourceTypesValidation.errors);
    }
    
    // Validate domains arrays if present
    const domainFields = ['domains', 'excludedDomains', 'requestDomains', 'excludedRequestDomains', 'initiatorDomains', 'excludedInitiatorDomains'];
    for (const field of domainFields) {
        if (field in condition) {
            if (!Array.isArray(condition[field])) {
                errors.push(`Rule at index ${ruleIndex} condition.${field} must be an array`);
            } else {
                for (const domain of condition[field]) {
                    if (typeof domain !== 'string' || domain.length === 0) {
                        errors.push(`Rule at index ${ruleIndex} condition.${field} contains invalid domain: ${domain}`);
                    }
                }
            }
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validates URL filter pattern
 * @param {string} urlFilter - The URL filter to validate
 * @param {number} ruleIndex - The index of the rule
 * @returns {Object} Validation result
 */
function validateUrlFilter(urlFilter, ruleIndex) {
    const errors = [];
    
    if (typeof urlFilter !== 'string') {
        errors.push(`Rule at index ${ruleIndex} urlFilter must be a string`);
        return { isValid: false, errors };
    }
    
    if (urlFilter.length === 0) {
        errors.push(`Rule at index ${ruleIndex} urlFilter cannot be empty`);
    }
    
    if (urlFilter.length > VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH) {
        errors.push(`Rule at index ${ruleIndex} urlFilter too long: ${urlFilter.length} chars. Max: ${VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH}`);
    }
    
    // Basic pattern validation for common filter syntax
    const invalidChars = urlFilter.match(/[\x00-\x1F\x7F]/);
    if (invalidChars) {
        errors.push(`Rule at index ${ruleIndex} urlFilter contains invalid control characters`);
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validates resource types array
 * @param {Array} resourceTypes - Array of resource types
 * @param {number} ruleIndex - The index of the rule
 * @returns {Object} Validation result
 */
function validateResourceTypes(resourceTypes, ruleIndex) {
    const errors = [];
    
    if (!Array.isArray(resourceTypes)) {
        return {
            isValid: false,
            errors: [`Rule at index ${ruleIndex} resourceTypes must be an array`]
        };
    }
    
    if (resourceTypes.length === 0) {
        errors.push(`Rule at index ${ruleIndex} resourceTypes cannot be empty`);
    }
    
    for (const resourceType of resourceTypes) {
        if (typeof resourceType !== 'string') {
            errors.push(`Rule at index ${ruleIndex} resourceType must be string: ${resourceType}`);
        } else if (!VALIDATION_CONFIG.VALID_RESOURCE_TYPES.includes(resourceType)) {
            errors.push(`Rule at index ${ruleIndex} invalid resourceType: ${resourceType}. Valid types: ${VALIDATION_CONFIG.VALID_RESOURCE_TYPES.join(', ')}`);
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validates rule ID uniqueness and sequential numbering
 * @param {Array} rules - Array of rules to validate
 * @returns {Object} Validation result
 */
function validateRuleIds(rules) {
    const errors = [];
    const seenIds = new Set();
    const ids = [];
    
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (!rule || typeof rule.id !== 'number') {
            continue; // Skip invalid rules, they'll be caught by structure validation
        }
        
        const id = rule.id;
        ids.push(id);
        
        // Check for duplicate IDs
        if (seenIds.has(id)) {
            errors.push(`Duplicate rule ID found: ${id} at rule index ${i}`);
        } else {
            seenIds.add(id);
        }
    }
    
    // Check for sequential numbering (optional but recommended)
    if (ids.length > 0) {
        ids.sort((a, b) => a - b);
        let expectedId = 1;
        const gaps = [];
        
        for (const id of ids) {
            if (id > expectedId) {
                gaps.push(`Missing rule IDs: ${expectedId} to ${id - 1}`);
                expectedId = id + 1;
            } else {
                expectedId = id + 1;
            }
        }
        
        if (gaps.length > 0 && gaps.length < 10) { // Only report if gaps are manageable
            console.warn('Rule ID gaps detected (not critical):', gaps);
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors,
        stats: {
            totalIds: ids.length,
            uniqueIds: seenIds.size,
            duplicates: ids.length - seenIds.size
        }
    };
}

/**
 * Validates the entire ruleset JSON structure
 * @param {Array} rules - The rules array to validate
 * @param {Object} options - Validation options
 * @returns {Object} Complete validation result
 */
function validateRuleset(rules, options = {}) {
    const startTime = Date.now();
    const validationResult = {
        isValid: true,
        errors: [],
        warnings: [],
        stats: {
            totalRules: 0,
            validRules: 0,
            invalidRules: 0,
            validationTime: 0
        }
    };
    
    try {
        // Basic input validation
        if (!Array.isArray(rules)) {
            throw new RuleValidationError('Rules must be an array', null, null, 'INVALID_INPUT');
        }
        
        if (rules.length === 0) {
            validationResult.warnings.push('Empty rules array provided');
            validationResult.stats.validationTime = Date.now() - startTime;
            return validationResult;
        }
        
        if (rules.length > VALIDATION_CONFIG.MAX_RULES_COUNT) {
            throw new RuleValidationError(`Too many rules: ${rules.length}. Maximum allowed: ${VALIDATION_CONFIG.MAX_RULES_COUNT}`, null, null, 'TOO_MANY_RULES');
        }
        
        validationResult.stats.totalRules = rules.length;
        
        // Validate each rule structure
        let validRulesCount = 0;
        const allErrors = [];
        
        for (let i = 0; i < rules.length; i++) {
            // Check timeout to prevent blocking
            if (Date.now() - startTime > VALIDATION_CONFIG.VALIDATION_TIMEOUT_MS) {
                throw new RuleValidationError('Validation timeout exceeded', i, null, 'TIMEOUT');
            }
            
            const ruleValidation = validateRuleStructure(rules[i], i);
            if (ruleValidation.isValid) {
                validRulesCount++;
            } else {
                allErrors.push(...ruleValidation.errors);
            }
        }
        
        // Validate rule IDs
        const idValidation = validateRuleIds(rules);
        allErrors.push(...idValidation.errors);
        
        // Set final validation state
        validationResult.isValid = allErrors.length === 0;
        validationResult.errors = allErrors;
        validationResult.stats.validRules = validRulesCount;
        validationResult.stats.invalidRules = rules.length - validRulesCount;
        validationResult.stats.idStats = idValidation.stats;
        
        if (allErrors.length > 0) {
            console.error(`Rule validation failed: ${allErrors.length} errors found`);
        }
        
    } catch (error) {
        validationResult.isValid = false;
        if (error instanceof RuleValidationError) {
            validationResult.errors.push(error.message);
        } else {
            validationResult.errors.push(`Validation error: ${error.message}`);
        }
        console.error('Rule validation exception:', error);
    }
    
    validationResult.stats.validationTime = Date.now() - startTime;
    return validationResult;
}

/**
 * Validates precompiled JSON file before loading
 * @param {string} jsonContent - JSON content as string
 * @returns {Object} Validation result with parsed rules if valid
 */
function validatePrecompiledJson(jsonContent) {
    const validationResult = {
        isValid: false,
        rules: null,
        errors: [],
        warnings: []
    };
    
    try {
        // Validate JSON structure
        if (typeof jsonContent !== 'string' || jsonContent.trim().length === 0) {
            validationResult.errors.push('JSON content must be a non-empty string');
            return validationResult;
        }
        
        // Parse JSON
        let parsedRules;
        try {
            parsedRules = JSON.parse(jsonContent);
        } catch (parseError) {
            validationResult.errors.push(`Invalid JSON format: ${parseError.message}`);
            return validationResult;
        }
        
        // Validate ruleset
        const rulesetValidation = validateRuleset(parsedRules);
        
        validationResult.isValid = rulesetValidation.isValid;
        validationResult.errors = rulesetValidation.errors;
        validationResult.warnings = rulesetValidation.warnings;
        validationResult.stats = rulesetValidation.stats;
        
        if (rulesetValidation.isValid) {
            validationResult.rules = parsedRules;
        }
        
    } catch (error) {
        validationResult.errors.push(`Validation error: ${error.message}`);
        console.error('JSON validation error:', error);
    }
    
    return validationResult;
}

/**
 * Quick validation for performance-critical scenarios
 * Only validates critical fields that could cause Chrome API failures
 * @param {Array} rules - Rules array to validate
 * @returns {boolean} True if rules pass quick validation
 */
function quickValidateRules(rules) {
    if (!Array.isArray(rules) || rules.length === 0) {
        return false;
    }
    
    for (let i = 0; i < Math.min(rules.length, 10); i++) { // Sample first 10 rules
        const rule = rules[i];
        if (!rule || typeof rule !== 'object' ||
            !Number.isInteger(rule.id) || rule.id < 1 ||
            !rule.action || !rule.action.type ||
            !rule.condition) {
            return false;
        }
    }
    
    return true;
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    module.exports = {
        validateRuleset,
        validatePrecompiledJson,
        validateRuleStructure,
        validateRuleIds,
        quickValidateRules,
        RuleValidationError,
        VALIDATION_CONFIG
    };
} else if (typeof window !== 'undefined') {
    // Browser environment
    window.RuleValidator = {
        validateRuleset,
        validatePrecompiledJson,
        validateRuleStructure,
        validateRuleIds,
        quickValidateRules,
        RuleValidationError,
        VALIDATION_CONFIG
    };
}