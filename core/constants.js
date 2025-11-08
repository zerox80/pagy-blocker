/**
 * @file Centralized constants shared across the extension.
 * @version 1.0
 */

/**
 * Filter-rule type identifiers used by the parser, validator, and runtime.
 * @const {object}
 */
export const RULE_TYPES = Object.freeze({
    /** Network rule type. */
    NETWORK: 'network',
    /** Comment rule type. */
    COMMENT: 'comment',
    /** Invalid rule type. */
    INVALID: 'invalid',
});

/**
 * Character allow-lists for stricter validation and easier auditing.
 * @const {object}
 */
export const CHARSETS = Object.freeze({
    /** Allowed characters for domains. */
    DOMAIN: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-',
    /** Allowed characters for URLs. */
    URL: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_~:/?#[]@!$&'()*+,;=%",
    /** Allowed characters for wildcards. */
    WILDCARD: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-*/',
});

/**
 * Generic validation limits that can be tweaked centrally.
 * @const {object}
 */
export const LIMITS = Object.freeze({
    /** Maximum length of a URL. */
    MAX_URL_LENGTH: 500,
    /** Maximum length of a domain. */
    MAX_DOMAIN_LENGTH: 253,
    /** Maximum length of a domain label. */
    MAX_LABEL_LENGTH: 63,
});
