/**
 * JSON-Regelvalidierungsmodul für Pagy Blocker
 * 
 * Bietet umfassende Validierung für vorkompilierte JSON-Regelstrukturen
 * Stellt die Regelintegrität sicher, validiert erforderliche Felder und überprüft die
 * Konformität mit den Anforderungen der declarativeNetRequest-API von Chrome.
 * 
 * Funktionen:
 * - Regelstrukturvalidierung
 * - Validierung der ID-Eindeutigkeit und der sequenziellen Nummerierung
 * - Validierung des urlFilter-Musters
 * - Validierung des Ressourcentyps
 * - JSON-Schema-Validierung
 * - Leistungsoptimierte Validierungsfunktionen
 */

// Validierungskonstanten
const VALIDATION_CONFIG = {
    // Maximale Regel-ID, die von der Chrome declarativeNetRequest-API erlaubt ist
    MAX_RULE_ID: 300000,
    
    // Maximaler Prioritätswert
    MAX_PRIORITY: 2147483647,
    
    // Gültige Aktionstypen
    VALID_ACTION_TYPES: ['block', 'allow', 'redirect', 'upgradeScheme', 'modifyHeaders'],
    
    // Gültige Ressourcentypen gemäß der Chrome declarativeNetRequest-API
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
    
    // Maximale Länge für URL-Filter
    MAX_URL_FILTER_LENGTH: 2000,
    
    // Leistungsgrenzen für die Validierung
    MAX_RULES_COUNT: 30000,
    VALIDATION_TIMEOUT_MS: 10000
};

/**
 * Validierungsfehlerklasse für eine bessere Fehlerbehandlung
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
 * Validiert die grundlegende Struktur einer einzelnen Regel
 * @param {Object} rule - Das zu validierende Regelobjekt
 * @param {number} index - Der Index der Regel im Array
 * @returns {Object} Validierungsergebnis mit isValid und errors
 */
function validateRuleStructure(rule, index) {
    const errors = [];
    
    // Überprüfen, ob die Regel ein Objekt ist
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        return {
            isValid: false,
            errors: [`Regel an Index ${index} muss ein Objekt sein`]
        };
    }
    
    // Überprüfen, ob erforderliche Felder vorhanden sind
    const requiredFields = ['id', 'priority', 'action', 'condition'];
    for (const field of requiredFields) {
        if (!(field in rule)) {
            errors.push(`Regel an Index ${index} fehlt das erforderliche Feld: ${field}`);
        }
    }
    
    // Regel-ID validieren
    if ('id' in rule) {
        if (!Number.isInteger(rule.id) || rule.id < 1 || rule.id > VALIDATION_CONFIG.MAX_RULE_ID) {
            errors.push(`Regel an Index ${index} hat eine ungültige ID: ${rule.id}. Muss eine ganze Zahl zwischen 1 und ${VALIDATION_CONFIG.MAX_RULE_ID} sein`);
        }
    }
    
    // Priorität validieren
    if ('priority' in rule) {
        if (!Number.isInteger(rule.priority) || rule.priority < 1 || rule.priority > VALIDATION_CONFIG.MAX_PRIORITY) {
            errors.push(`Regel an Index ${index} hat eine ungültige Priorität: ${rule.priority}. Muss eine ganze Zahl zwischen 1 und ${VALIDATION_CONFIG.MAX_PRIORITY} sein`);
        }
    }
    
    // Aktionsobjekt validieren
    if ('action' in rule) {
        if (!rule.action || typeof rule.action !== 'object') {
            errors.push(`Regel an Index ${index} Aktion muss ein Objekt sein`);
        } else {
            if (!rule.action.type || !VALIDATION_CONFIG.VALID_ACTION_TYPES.includes(rule.action.type)) {
                errors.push(`Regel an Index ${index} hat einen ungültigen Aktionstyp: ${rule.action.type}. Muss einer von folgenden sein: ${VALIDATION_CONFIG.VALID_ACTION_TYPES.join(', ')}`);
            }
        }
    }
    
    // Bedingungsobjekt validieren
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
 * Validiert das Bedingungsobjekt einer Regel
 * @param {Object} condition - Das zu validierende Bedingungsobjekt
 * @param {number} ruleIndex - Der Index der Regel
 * @returns {Object} Validierungsergebnis
 */
function validateRuleCondition(condition, ruleIndex) {
    const errors = [];
    
    if (!condition || typeof condition !== 'object') {
        return {
            isValid: false,
            errors: [`Regel an Index ${ruleIndex} Bedingung muss ein Objekt sein`]
        };
    }
    
    // urlFilter validieren, falls vorhanden
    if ('urlFilter' in condition) {
        const urlFilterValidation = validateUrlFilter(condition.urlFilter, ruleIndex);
        errors.push(...urlFilterValidation.errors);
    }
    
    // regexFilter validieren, falls vorhanden
    if ('regexFilter' in condition) {
        try {
            new RegExp(condition.regexFilter);
        } catch (error) {
            errors.push(`Regel an Index ${ruleIndex} hat einen ungültigen regexFilter: ${error.message}`);
        }
        
        if (condition.regexFilter.length > VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH) {
            errors.push(`Regel an Index ${ruleIndex} regexFilter zu lang: ${condition.regexFilter.length} Zeichen. Maximal: ${VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH}`);
        }
    }
    
    // Ressourcentypen validieren, falls vorhanden
    if ('resourceTypes' in condition) {
        const resourceTypesValidation = validateResourceTypes(condition.resourceTypes, ruleIndex);
        errors.push(...resourceTypesValidation.errors);
    }
    
    // Domains-Arrays validieren, falls vorhanden
    const domainFields = ['domains', 'excludedDomains', 'requestDomains', 'excludedRequestDomains', 'initiatorDomains', 'excludedInitiatorDomains'];
    for (const field of domainFields) {
        if (field in condition) {
            if (!Array.isArray(condition[field])) {
                errors.push(`Regel an Index ${ruleIndex} condition.${field} muss ein Array sein`);
            } else {
                for (const domain of condition[field]) {
                    if (typeof domain !== 'string' || domain.length === 0) {
                        errors.push(`Regel an Index ${ruleIndex} condition.${field} enthält eine ungültige Domain: ${domain}`);
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
 * Validiert das URL-Filtermuster
 * @param {string} urlFilter - Der zu validierende URL-Filter
 * @param {number} ruleIndex - Der Index der Regel
 * @returns {Object} Validierungsergebnis
 */
function validateUrlFilter(urlFilter, ruleIndex) {
    const errors = [];
    
    if (typeof urlFilter !== 'string') {
        errors.push(`Regel an Index ${ruleIndex} urlFilter muss eine Zeichenfolge sein`);
        return { isValid: false, errors };
    }
    
    if (urlFilter.length === 0) {
        errors.push(`Regel an Index ${ruleIndex} urlFilter darf nicht leer sein`);
    }
    
    if (urlFilter.length > VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH) {
        errors.push(`Regel an Index ${ruleIndex} urlFilter zu lang: ${urlFilter.length} Zeichen. Maximal: ${VALIDATION_CONFIG.MAX_URL_FILTER_LENGTH}`);
    }
    
    // Grundlegende Mustervalidierung für gängige Filter-Syntax
    const invalidChars = urlFilter.match(/[\x00-\x1F\x7F]/);
    if (invalidChars) {
        errors.push(`Regel an Index ${ruleIndex} urlFilter enthält ungültige Steuerzeichen`);
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validiert das Ressourcentyp-Array
 * @param {Array} resourceTypes - Array von Ressourcentypen
 * @param {number} ruleIndex - Der Index der Regel
 * @returns {Object} Validierungsergebnis
 */
function validateResourceTypes(resourceTypes, ruleIndex) {
    const errors = [];
    
    if (!Array.isArray(resourceTypes)) {
        return {
            isValid: false,
            errors: [`Regel an Index ${ruleIndex} resourceTypes muss ein Array sein`]
        };
    }
    
    if (resourceTypes.length === 0) {
        errors.push(`Regel an Index ${ruleIndex} resourceTypes darf nicht leer sein`);
    }
    
    for (const resourceType of resourceTypes) {
        if (typeof resourceType !== 'string') {
            errors.push(`Regel an Index ${ruleIndex} resourceType muss eine Zeichenfolge sein: ${resourceType}`);
        } else if (!VALIDATION_CONFIG.VALID_RESOURCE_TYPES.includes(resourceType)) {
            errors.push(`Regel an Index ${ruleIndex} ungültiger resourceType: ${resourceType}. Gültige Typen: ${VALIDATION_CONFIG.VALID_RESOURCE_TYPES.join(', ')}`);
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validiert die Eindeutigkeit der Regel-IDs und die sequenzielle Nummerierung
 * @param {Array} rules - Array von Regeln zur Validierung
 * @returns {Object} Validierungsergebnis
 */
function validateRuleIds(rules) {
    const errors = [];
    const seenIds = new Set();
    const ids = [];
    
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (!rule || typeof rule.id !== 'number') {
            continue; // Ungültige Regeln überspringen, werden bei der Strukturvalidierung erkannt
        }
        
        const id = rule.id;
        ids.push(id);
        
        // Überprüfen auf doppelte IDs
        if (seenIds.has(id)) {
            errors.push(`Doppelte Regel-ID gefunden: ${id} bei Regelindex ${i}`);
        } else {
            seenIds.add(id);
        }
    }
    
    // Überprüfen auf Lücken in der sequenziellen Nummerierung (optional, aber empfohlen)
    if (ids.length > 0) {
        ids.sort((a, b) => a - b);
        let expectedId = 1;
        const gaps = [];
        
        for (const id of ids) {
            if (id > expectedId) {
                gaps.push(`Fehlende Regel-IDs: ${expectedId} bis ${id - 1}`);
                expectedId = id + 1;
            } else {
                expectedId = id + 1;
            }
        }
        
        if (gaps.length > 0 && gaps.length < 10) { // Nur melden, wenn Lücken überschaubar sind
            console.warn('Regel-ID-Lücken erkannt (nicht kritisch):', gaps);
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
 * Validiert die gesamte Regeln-JSON-Struktur
 * @param {Array} rules - Das zu validierende Regeln-Array
 * @param {Object} options - Validierungsoptionen
 * @returns {Object} Vollständiges Validierungsergebnis
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
        // Grundlegende Eingangsvalidierung
        if (!Array.isArray(rules)) {
            throw new RuleValidationError('Regeln müssen ein Array sein', null, null, 'INVALID_INPUT');
        }
        
        if (rules.length === 0) {
            validationResult.warnings.push('Leeres Regeln-Array bereitgestellt');
            validationResult.stats.validationTime = Date.now() - startTime;
            return validationResult;
        }
        
        if (rules.length > VALIDATION_CONFIG.MAX_RULES_COUNT) {
            throw new RuleValidationError(`Zu viele Regeln: ${rules.length}. Maximal erlaubt: ${VALIDATION_CONFIG.MAX_RULES_COUNT}`, null, null, 'TOO_MANY_RULES');
        }
        
        validationResult.stats.totalRules = rules.length;
        
        // Validierung der Regelstruktur
        let validRulesCount = 0;
        const allErrors = [];
        
        for (let i = 0; i < rules.length; i++) {
            // Timeout überprüfen, um Blockierungen zu vermeiden
            if (Date.now() - startTime > VALIDATION_CONFIG.VALIDATION_TIMEOUT_MS) {
                throw new RuleValidationError('Validierungs-Timeout überschritten', i, null, 'TIMEOUT');
            }
            
            const ruleValidation = validateRuleStructure(rules[i], i);
            if (ruleValidation.isValid) {
                validRulesCount++;
            } else {
                allErrors.push(...ruleValidation.errors);
            }
        }
        
        // Validierung der Regel-IDs
        const idValidation = validateRuleIds(rules);
        allErrors.push(...idValidation.errors);
        
        // Endgültigen Validierungsstatus festlegen
        validationResult.isValid = allErrors.length === 0;
        validationResult.errors = allErrors;
        validationResult.stats.validRules = validRulesCount;
        validationResult.stats.invalidRules = rules.length - validRulesCount;
        validationResult.stats.idStats = idValidation.stats;
        
        if (allErrors.length > 0) {
            console.error(`Regelvalidierung fehlgeschlagen: ${allErrors.length} Fehler gefunden`);
        }
        
    } catch (error) {
        validationResult.isValid = false;
        if (error instanceof RuleValidationError) {
            validationResult.errors.push(error.message);
        } else {
            validationResult.errors.push(`Validierungsfehler: ${error.message}`);
        }
        console.error('Regelvalidierungs-Ausnahme:', error);
    }
    
    validationResult.stats.validationTime = Date.now() - startTime;
    return validationResult;
}

/**
 * Validiert eine vorkompilierte JSON-Datei vor dem Laden
 * @param {string} jsonContent - JSON-Inhalt als Zeichenfolge
 * @returns {Object} Validierungsergebnis mit analysierten Regeln, wenn gültig
 */
function validatePrecompiledJson(jsonContent) {
    const validationResult = {
        isValid: false,
        rules: null,
        errors: [],
        warnings: []
    };
    
    try {
        // Validierung der JSON-Struktur
        if (typeof jsonContent !== 'string' || jsonContent.trim().length === 0) {
            validationResult.errors.push('JSON-Inhalt muss eine nicht leere Zeichenfolge sein');
            return validationResult;
        }
        
        // JSON parsen
        let parsedRules;
        try {
            parsedRules = JSON.parse(jsonContent);
        } catch (parseError) {
            validationResult.errors.push(`Ungültiges JSON-Format: ${parseError.message}`);
            return validationResult;
        }
        
        // Regeln-Satz validieren
        const rulesetValidation = validateRuleset(parsedRules);
        
        validationResult.isValid = rulesetValidation.isValid;
        validationResult.errors = rulesetValidation.errors;
        validationResult.warnings = rulesetValidation.warnings;
        validationResult.stats = rulesetValidation.stats;
        
        if (rulesetValidation.isValid) {
            validationResult.rules = parsedRules;
        }
        
    } catch (error) {
        validationResult.errors.push(`Validierungsfehler: ${error.message}`);
        console.error('JSON-Validierungsfehler:', error);
    }
    
    return validationResult;
}

/**
 * Schnelle Validierung für leistungs kritische Szenarien
 * Validiert nur kritische Felder, die zu Chrome-API-Fehlern führen könnten
 * @param {Array} rules - Zu validierende Regeln
 * @returns {boolean} Wahr, wenn Regeln die schnelle Validierung bestehen
 */
function quickValidateRules(rules) {
    if (!Array.isArray(rules) || rules.length === 0) {
        return false;
    }
    
    for (let i = 0; i < Math.min(rules.length, 10); i++) { // Erste 10 Regeln stichprobenartig prüfen
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

// Exportiere Funktionen zur Verwendung in anderen Modulen
if (typeof module !== 'undefined' && module.exports) {
    // Node.js-Umgebung
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
    // Browser-Umgebung
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