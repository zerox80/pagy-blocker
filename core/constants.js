// core/constants.js
// Centralized constants shared across the extension (pure ES module)

/*
 * NOTE:  These constants have been extracted from various legacy modules to improve
 *        discoverability and maintainability.  Over time we will migrate the
 *        original modules to import from here instead of keeping their own copies.
 */

// Filter-rule type identifiers – used by the parser, validator and runtime
export const RULE_TYPES = Object.freeze({
    NETWORK: 'network',
    COMMENT: 'comment',
    INVALID: 'invalid',
});

// Character allow-lists (kept in one place for stricter validation / easier auditing)
export const CHARSETS = Object.freeze({
    DOMAIN: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-',
    URL: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_~:/?#[]@!$&'()*+,;=%",
    WILDCARD: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-*/',
});

// Generic validation limits – can be tweaked centrally
export const LIMITS = Object.freeze({
    MAX_URL_LENGTH: 500,
    MAX_DOMAIN_LENGTH: 253,
    MAX_LABEL_LENGTH: 63,
});
