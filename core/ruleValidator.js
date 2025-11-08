/**
 * @file JSON rule validation module for Pagy Blocker.
 * @version 1.0
 *
 * Provides comprehensive validation for pre-compiled JSON rule structures,
 * ensuring rule integrity, validating required fields, and checking for
 * conformance with Chrome's declarativeNetRequest API requirements.
 */

/**
 * Validation constants.
 * @const {object}
 */
export const VALIDATION_CONFIG = {
    /** Maximum rule ID. */
    MAX_RULE_ID: 300000,
    /** Maximum rule priority. */
    MAX_PRIORITY: 2147483647,
    /** Valid action types. */
    VALID_ACTION_TYPES: ['block', 'allow', 'redirect', 'upgradeScheme', 'modifyHeaders'],
    /** Valid resource types. */
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
        'other',
    ],
    /** Maximum length of a URL filter. */
    MAX_URL_FILTER_LENGTH: 2000,
    /** Maximum number of rules. */
    MAX_RULES_COUNT: 30000,
    /** Validation timeout in milliseconds. */
    VALIDATION_TIMEOUT_MS: 10000,
};

/**
 * Validates the basic structure of a single rule.
 * @param {object} rule - The rule object to validate.
 * @param {number} index - The index of the rule in the ruleset.
 * @returns {{isValid: boolean, errors: string[]}} An object indicating if the rule is valid and a list of errors.
 */
export function validateRuleStructure(rule, index) {
    const errors = [];
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        return {
            isValid: false,
            errors: [`Rule at index ${index} must be an object`],
        };
    }
    const requiredFields = ['id', 'priority', 'action', 'condition'];
    for (const field of requiredFields) {
        if (!(field in rule)) {
            errors.push(`Rule at index ${index} is missing required field: ${field}`);
        }
    }
    if ('id' in rule) {
        if (!Number.isInteger(rule.id) || rule.id < 1 || rule.id > VALIDATION_CONFIG.MAX_RULE_ID) {
            errors.push(
                `Rule at index ${index} has an invalid ID: ${rule.id}. Must be an integer between 1 and ${VALIDATION_CONFIG.MAX_RULE_ID}`
            );
        }
    }
    if ('priority' in rule) {
        if (
            !Number.isInteger(rule.priority) ||
            rule.priority < 1 ||
            rule.priority > VALIDATION_CONFIG.MAX_PRIORITY
        ) {
            errors.push(
                `Rule at index ${index} has an invalid priority: ${rule.priority}. Must be an integer between 1 and ${VALIDATION_CONFIG.MAX_PRIORITY}`
            );
        }
    }
    if ('action' in rule) {
        if (!rule.action || typeof rule.action !== 'object') {
            errors.push(`Rule at index ${index} action must be an object`);
        } else {
            if (
                !rule.action.type ||
                !VALIDATION_CONFIG.VALID_ACTION_TYPES.includes(rule.action.type)
            ) {
                errors.push(
                    `Rule at index ${index} has an invalid action type: ${rule.action.type}. Must be one of: ${VALIDATION_CONFIG.VALID_ACTION_TYPES.join(', ')}`
                );
            }
        }
    }
    if ('condition' in rule) {
        const conditionValidation = validateRuleCondition(rule.condition, index);
        errors.push(...conditionValidation.errors);
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Validates the condition object of a rule.
 * @param {object} condition - The condition object to validate.
 * @param {number} ruleIndex - The index of the rule in the ruleset.
 * @returns {{isValid: boolean, errors: string[]}} An object indicating if the condition is valid and a list of errors.
 */
export function validateRuleCondition(condition, ruleIndex) {
    const errors = [];
    if (!condition || typeof condition !== 'object') {
        return {
            isValid: false,
            errors: [`Rule at index ${ruleIndex} condition must be an object`],
        };
    }
    if ('urlFilter' in condition) {
        const urlFilterValidation = validateUrlFilter(condition.urlFilter, ruleIndex);
        errors.push(...urlFilterValidation.errors);
    }
    if ('regexFilter' in condition) {
        try {
            new RegExp(condition.regexFilter);
        } catch (error) {
            errors.push(
                `Rule at index ${ruleIndex} has an invalid regexFilter: ${error.message}`
            );
        }
        if (condition.regexFilter.length > VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH) {
            errors.push(
                `Rule at index ${ruleIndex} regexFilter is too long: ${condition.regexFilter.length} characters. Maximum: ${VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH}`
            );
        }
    }
    if ('resourceTypes' in condition) {
        const resourceTypesValidation = validateResourceTypes(condition.resourceTypes, ruleIndex);
        errors.push(...resourceTypesValidation.errors);
    }
    const domainFields = [
        'domains',
        'excludedDomains',
        'requestDomains',
        'excludedRequestDomains',
        'initiatorDomains',
        'excludedInitiatorDomains',
    ];
    for (const field of domainFields) {
        if (field in condition) {
            if (!Array.isArray(condition[field])) {
                errors.push(`Rule at index ${ruleIndex} condition.${field} must be an array`);
            } else {
                for (const domain of condition[field]) {
                    if (typeof domain !== 'string' || domain.length === 0) {
                        errors.push(
                            `Rule at index ${ruleIndex} condition.${field} contains an invalid domain: ${domain}`
                        );
                    }
                }
            }
        }
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Validates the URL filter pattern.
 * @param {string} urlFilter - The URL filter to validate.
 * @param {number} ruleIndex - The index of the rule in the ruleset.
 * @returns {{isValid: boolean, errors: string[]}} An object indicating if the URL filter is valid and a list of errors.
 */
export function validateUrlFilter(urlFilter, ruleIndex) {
    const errors = [];
    if (typeof urlFilter !== 'string') {
        errors.push(`Rule at index ${ruleIndex} urlFilter must be a string`);
        return { isValid: false, errors };
    }
    if (urlFilter.length === 0) {
        errors.push(`Rule at index ${ruleIndex} urlFilter cannot be empty`);
    }
    if (urlFilter.length > VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH) {
        errors.push(
            `Rule at index ${ruleIndex} urlFilter is too long: ${urlFilter.length} characters. Maximum: ${VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH}`
        );
    }
    const invalidChars = urlFilter.match(/[\u0000-\u001F\u007F]/);
    if (invalidChars) {
        errors.push(`Rule at index ${ruleIndex} urlFilter contains invalid control characters`);
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Validates the resource types array.
 * @param {string[]} resourceTypes - The array of resource types to validate.
 * @param {number} ruleIndex - The index of the rule in the ruleset.
 * @returns {{isValid: boolean, errors: string[]}} An object indicating if the resource types are valid and a list of errors.
 */
export function validateResourceTypes(resourceTypes, ruleIndex) {
    const errors = [];
    if (!Array.isArray(resourceTypes)) {
        return {
            isValid: false,
            errors: [`Rule at index ${ruleIndex} resourceTypes must be an array`],
        };
    }
    if (resourceTypes.length === 0) {
        errors.push(`Rule at index ${ruleIndex} resourceTypes cannot be empty`);
    }
    for (const resourceType of resourceTypes) {
        if (typeof resourceType !== 'string') {
            errors.push(
                `Rule at index ${ruleIndex} resourceType must be a string: ${resourceType}`
            );
        } else if (!VALIDATION_CONFIG.VALID_RESOURCE_TYPES.includes(resourceType)) {
            errors.push(
                `Rule at index ${ruleIndex} has an invalid resourceType: ${resourceType}. Valid types are: ${VALIDATION_CONFIG.VALID_RESOURCE_TYPES.join(', ')}`
            );
        }
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}
