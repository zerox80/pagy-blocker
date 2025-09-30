// core/ruleValidator.js
// Thin ES-module wrapper that re-exports the legacy validator implementation.
// New code should import from "core/ruleValidator". This lets us gradually
// refactor the heavy validator without breaking existing callers.

/**
 * JSON-Regelvalidierungsmodul für Pagy Blocker
 *
 * Bietet umfassende Validierung für vorkompilierte JSON-Regelstrukturen
 * Stellt die Regelintegrität sicher, validiert erforderliche Felder und überprüft die
 * Konformität mit den Anforderungen der declarativeNetRequest-API von Chrome.
 */

// Validierungskonstanten
export const VALIDATION_CONFIG = {
    MAX_RULE_ID: 300000,
    MAX_PRIORITY: 2147483647,
    VALID_ACTION_TYPES: ['block', 'allow', 'redirect', 'upgradeScheme', 'modifyHeaders'],
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
    MAX_URL_FILTER_LENGTH: 2000,
    MAX_RULES_COUNT: 30000,
    VALIDATION_TIMEOUT_MS: 10000,
};

/**
 * Validiert die grundlegende Struktur einer einzelne Regel
 */
export function validateRuleStructure(rule, index) {
    const errors = [];
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        return {
            isValid: false,
            errors: [`Regel an Index ${index} muss ein Objekt sein`],
        };
    }
    const requiredFields = ['id', 'priority', 'action', 'condition'];
    for (const field of requiredFields) {
        if (!(field in rule)) {
            errors.push(`Regel an Index ${index} fehlt das erforderliche Feld: ${field}`);
        }
    }
    if ('id' in rule) {
        if (!Number.isInteger(rule.id) || rule.id < 1 || rule.id > VALIDATION_CONFIG.MAX_RULE_ID) {
            errors.push(
                `Regel an Index ${index} hat eine ungültige ID: ${rule.id}. Muss eine ganze Zahl zwischen 1 und ${VALIDATION_CONFIG.MAX_RULE_ID} sein`
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
                `Regel an Index ${index} hat eine ungültige Priorität: ${rule.priority}. Muss eine ganze Zahl zwischen 1 und ${VALIDATION_CONFIG.MAX_PRIORITY} sein`
            );
        }
    }
    if ('action' in rule) {
        if (!rule.action || typeof rule.action !== 'object') {
            errors.push(`Regel an Index ${index} Aktion muss ein Objekt sein`);
        } else {
            if (
                !rule.action.type ||
                !VALIDATION_CONFIG.VALID_ACTION_TYPES.includes(rule.action.type)
            ) {
                errors.push(
                    `Regel an Index ${index} hat einen ungültigen Aktionstyp: ${rule.action.type}. Muss einer von folgenden sein: ${VALIDATION_CONFIG.VALID_ACTION_TYPES.join(', ')}`
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
 * Validiert das Bedingungsobjekt einer Regel
 */
export function validateRuleCondition(condition, ruleIndex) {
    const errors = [];
    if (!condition || typeof condition !== 'object') {
        return {
            isValid: false,
            errors: [`Regel an Index ${ruleIndex} Bedingung muss ein Objekt sein`],
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
                `Regel an Index ${ruleIndex} hat einen ungültigen regexFilter: ${error.message}`
            );
        }
        if (condition.regexFilter.length > VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH) {
            errors.push(
                `Regel an Index ${ruleIndex} regexFilter zu lang: ${condition.regexFilter.length} Zeichen. Maximal: ${VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH}`
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
                errors.push(`Regel an Index ${ruleIndex} condition.${field} muss ein Array sein`);
            } else {
                for (const domain of condition[field]) {
                    if (typeof domain !== 'string' || domain.length === 0) {
                        errors.push(
                            `Regel an Index ${ruleIndex} condition.${field} enthält eine ungültige Domain: ${domain}`
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
 * Validiert das URL-Filtermuster
 */
export function validateUrlFilter(urlFilter, ruleIndex) {
    const errors = [];
    if (typeof urlFilter !== 'string') {
        errors.push(`Regel an Index ${ruleIndex} urlFilter muss eine Zeichenfolge sein`);
        return { isValid: false, errors };
    }
    if (urlFilter.length === 0) {
        errors.push(`Regel an Index ${ruleIndex} urlFilter darf nicht leer sein`);
    }
    if (urlFilter.length > VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH) {
        errors.push(
            `Regel an Index ${ruleIndex} urlFilter zu lang: ${urlFilter.length} Zeichen. Maximal: ${VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH}`
        );
    }
        // eslint-disable-next-line no-control-regex
    const invalidChars = urlFilter.match(/[\u0000-\u001F\u007F]/);
    if (invalidChars) {
        errors.push(`Regel an Index ${ruleIndex} urlFilter enthält ungültige Steuerzeichen`);
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}

/**
 * Validiert das Ressourcentyp-Array
 */
export function validateResourceTypes(resourceTypes, ruleIndex) {
    const errors = [];
    if (!Array.isArray(resourceTypes)) {
        return {
            isValid: false,
            errors: [`Regel an Index ${ruleIndex} resourceTypes muss ein Array sein`],
        };
    }
    if (resourceTypes.length === 0) {
        errors.push(`Regel an Index ${ruleIndex} resourceTypes darf nicht leer sein`);
    }
    for (const resourceType of resourceTypes) {
        if (typeof resourceType !== 'string') {
            errors.push(
                `Regel an Index ${ruleIndex} resourceType muss eine Zeichenfolge sein: ${resourceType}`
            );
        } else if (!VALIDATION_CONFIG.VALID_RESOURCE_TYPES.includes(resourceType)) {
            errors.push(
                `Regel an Index ${ruleIndex} ungültiger resourceType: ${resourceType}. Gültige Typen: ${VALIDATION_CONFIG.VALID_RESOURCE_TYPES.join(', ')}`
            );
        }
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}
