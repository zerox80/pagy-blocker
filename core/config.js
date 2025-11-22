/**
 * @file Central configuration for Pagy Blocker.
 * @version 11.2
 */

/**
 * Extension configuration.
 * @const {object}
 */
export const EXTENSION_CONFIG = Object.freeze({
    /** The name of the extension. */
    NAME: 'Pagy Blocker',
    /** The version of the extension. */
    VERSION: '11.2',
    /** Storage keys used by the extension. */
    STORAGE_KEYS: {
        /** Key for storing disabled domains. */
        DISABLED_DOMAINS: 'disabledDomains',
        /** Key for storing user settings. */
        USER_SETTINGS: 'userSettings',
        /** Key for storing the filter cache. */
        FILTER_CACHE: 'filterCache'
    },
    /** Various limits used in the extension. */
    LIMITS: {
        /** Maximum number of dynamic rules. */
        MAX_DYNAMIC_RULES: 100,
        /** Maximum length of a domain. */
        MAX_DOMAIN_LENGTH: 253,
        /** Maximum length of a domain label. */
        MAX_LABEL_LENGTH: 63,
        /** Maximum length of a URL. */
        MAX_URL_LENGTH: 500,
        /** Maximum number of rules. */
        MAX_RULES_COUNT: 30000,
        /** Timeout for validation in milliseconds. */
        VALIDATION_TIMEOUT_MS: 10000
    },
    /** Rule priorities. */
    PRIORITIES: {
        /** Default rule priority. */
        DEFAULT_RULE: 100,
        /** Priority for allow rules. */
        ALLOW_RULE: 200,
        /** Priority for important rules. */
        IMPORTANT_RULE: 1000
    },
    /** Icon paths. */
    ICONS: {
        /** Path to the default icon. */
        DEFAULT: '/icons/icon128.png',
        /** Path to the disabled icon. */
        DISABLED: '/icons/deaktivieren.png'
    },
    /** Performance-related settings. */
    PERFORMANCE: {
        /** Batch size for processing items. */
        BATCH_SIZE: 200,
        /** Maximum number of concurrent batches. */
        MAX_CONCURRENT_BATCHES: 4,
        /** Debounce delay in milliseconds. */
        DEBOUNCE_DELAY: 300,
        /** Cache time-to-live in milliseconds (1 hour). */
        CACHE_TTL: 3600000
    }
});

/**
 * Logging configuration.
 * @const {object}
 */
export const LOG_CONFIG = Object.freeze({
    /** Log levels. */
    LEVELS: {
        /** Error log level. */
        ERROR: 0,
        /** Warning log level. */
        WARN: 1,
        /** Info log level. */
        INFO: 2,
        /** Debug log level. */
        DEBUG: 3
    },
    /** Default log level. */
    DEFAULT_LEVEL: 1, // WARN
    /** Prefix for log messages. */
    PREFIX: '[Pagy Blocker]'
});

/**
 * Rule configuration.
 * @const {object}
 */
export const RULE_CONFIG = Object.freeze({
    /** Rule actions. */
    ACTIONS: {
        /** Block action. */
        BLOCK: 'block',
        /** Allow action. */
        ALLOW: 'allow',
        /** Redirect action. */
        REDIRECT: 'redirect',
        /** Upgrade scheme action. */
        UPGRADE_SCHEME: 'upgradeScheme',
        /** Modify headers action. */
        MODIFY_HEADERS: 'modifyHeaders'
    },
    /** Resource types. */
    RESOURCE_TYPES: [
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
    ]
});

export default EXTENSION_CONFIG;
