/**
 * @file Central utility functions for Pagy Blocker.
 * @version 11.3
 */

import { EXTENSION_CONFIG } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('Utilities');

/**
 * Safely extracts the domain from a URL with comprehensive validation.
 * @param {string} url - The URL to extract the domain from.
 * @returns {string|null} The extracted domain or null if the URL is invalid.
 */
export function getDomainFromUrl(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }

    try {
        const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
        const hostname = parsedUrl.hostname.toLowerCase();

        if (!isValidDomain(hostname)) {
            return null;
        }

        return hostname;
    } catch (error) {
        logger.debug('Invalid URL provided', { url, error: error.message });
        return null;
    }
}

/**
 * Validates domains using character-based checks (ReDoS-safe).
 * @param {string} domain - The domain to validate.
 * @returns {boolean} True if the domain is valid, false otherwise.
 */
export function isValidDomain(domain) {
    if (!domain || typeof domain !== 'string') {
        return false;
    }

    if (domain.length > EXTENSION_CONFIG.LIMITS.MAX_DOMAIN_LENGTH) {
        return false;
    }

    if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
        return false;
    }

    const suspiciousDomains = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    if (suspiciousDomains.includes(domain)) {
        return false;
    }

    const labels = domain.split('.');
    if (labels.length < 2) {
        return false;
    }

    return labels.every(label => {
        if (!label || label.length > EXTENSION_CONFIG.LIMITS.MAX_LABEL_LENGTH) {
            return false;
        }

        for (let i = 0; i < label.length; i++) {
            const charCode = label.charCodeAt(i);
            if (!((charCode >= 97 && charCode <= 122) || // a-z
                (charCode >= 65 && charCode <= 90) || // A-Z
                (charCode >= 48 && charCode <= 57) || // 0-9
                charCode === 45)) { // -
                return false;
            }
        }

        return true;
    });
}

/**
 * Validates a string against an allowed character set (ReDoS-safe).
 * @param {string} input - The string to validate.
 * @param {string} allowedChars - A string of allowed characters.
 * @param {number} [maxLength=EXTENSION_CONFIG.LIMITS.MAX_URL_LENGTH] - The maximum allowed length.
 * @returns {{isValid: boolean, error?: string}} An object indicating if the string is valid and an error message if not.
 */
export function validateStringChars(input, allowedChars, maxLength = EXTENSION_CONFIG.LIMITS.MAX_URL_LENGTH) {
    if (!input || typeof input !== 'string') {
        return { isValid: false, error: 'Input must be a non-empty string' };
    }

    if (input.length > maxLength) {
        return { isValid: false, error: `Input exceeds maximum length (${maxLength})` };
    }

    for (let i = 0; i < input.length; i++) {
        if (!allowedChars.includes(input[i])) {
            return { isValid: false, error: `Invalid character at position ${i}: ${input[i]}` };
        }
    }

    return { isValid: true };
}

/**
 * Debounce function for performance optimization.
 * @param {Function} func - The function to debounce.
 * @param {number} [delay=EXTENSION_CONFIG.PERFORMANCE.DEBOUNCE_DELAY] - The debounce delay in milliseconds.
 * @returns {Function} The debounced function.
 */
export function debounce(func, delay = EXTENSION_CONFIG.PERFORMANCE.DEBOUNCE_DELAY) {
    let timeoutId;
    function debounced(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    }
    debounced.cancel = () => clearTimeout(timeoutId);
    return debounced;
}

/**
 * Throttle function to limit the rate of function calls.
 * @param {Function} func - The function to throttle.
 * @param {number} limit - The throttle limit in milliseconds.
 * @returns {Function} The throttled function.
 */
export function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Safely parses JSON with error handling.
 * @param {string} jsonString - The JSON string to parse.
 * @param {*} [fallback=null] - The value to return on parsing failure.
 * @returns {*} The parsed JSON object or the fallback value.
 */
export function safeJsonParse(jsonString, fallback = null) {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        logger.warn('JSON parsing failed', { jsonString, error: error.message });
        return fallback;
    }
}

/**
 * Deeply clones an object.
 * @param {*} obj - The object to clone.
 * @returns {*} The cloned object.
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }

    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item));
    }

    const cloned = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }

    return cloned;
}

/**
 * Retry mechanism for asynchronous operations.
 * @param {Function} fn - The asynchronous function to retry.
 * @param {number} [maxRetries=3] - The maximum number of retries.
 * @param {number} [delay=1000] - The delay between retries in milliseconds.
 * @returns {Promise<*>} A promise that resolves with the result of the function.
 */
export async function retryAsync(fn, maxRetries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }

            logger.debug(`Retry attempt ${attempt} failed`, { error: error.message });
            await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
    }
}

/**
 * Tool for measuring execution times.
 */
export class PerformanceTimer {
    /**
     * Constructs a new PerformanceTimer instance.
     * @param {string} label - The label for the timer.
     */
    constructor(label) {
        this.label = label;
        this.startTime = performance.now();
    }

    /**
     * Ends the timer and logs the duration.
     * @returns {number} The duration in milliseconds.
     */
    end() {
        const duration = performance.now() - this.startTime;
        logger.debug(`Performance: ${this.label}`, { duration: `${duration.toFixed(2)}ms` });
        return duration;
    }
}

/**
 * Monitors memory usage.
 * @returns {{used: number, total: number, limit: number}|null} An object with memory usage information or null if not available.
 */
export function getMemoryUsage() {
    if (typeof performance !== 'undefined' && performance.memory) {
        return {
            used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
            total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
            limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
        };
    }
    return null;
}

/**
 * Sanitizes user input (XSS prevention).
 * @param {string} input - The input string to sanitize.
 * @returns {string} The sanitized string.
 */
export function sanitizeInput(input) {
    if (typeof input !== 'string') {
        return '';
    }

    return input
        .replace(/[&<>"']/g, (char) => {
            switch (char) {
                case '&': return '&amp;';
                case '<': return '&lt;';
                case '>': return '&gt;';
                case '"': return '&quot;';
                case "'": return '&#x27;';
                default: return char;
            }
        })
        .trim()
        .slice(0, 1000); // Limit maximum length
}

/**
 * Generates a unique ID.
 * @returns {string} A unique ID.
 */
export function generateId() {
    const rand = Math.random().toString(36).slice(2, 11);
    return `${Date.now()}-${rand}`;
}

/**
 * Checks if the extension context is valid.
 * @returns {boolean} True if the context is valid, false otherwise.
 */
export function isExtensionContextValid() {
    try {
        return !!(
            typeof chrome !== 'undefined' &&
            chrome?.runtime &&
            (chrome.runtime.id !== undefined || typeof chrome.runtime.getURL === 'function')
        );
    } catch (error) {
        return false;
    }
}

/**
 * Batch processes an array with concurrency control.
 * @param {*[]} items - The array of items to process.
 * @param {Function} processor - The function to process each item.
 * @param {number} [batchSize=EXTENSION_CONFIG.PERFORMANCE.BATCH_SIZE] - The batch size.
 * @returns {Promise<*[]>} A promise that resolves to an array of processed items.
 */
export async function batchProcess(items, processor, batchSize = EXTENSION_CONFIG.PERFORMANCE.BATCH_SIZE) {
    const results = [];

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);

        if (i + batchSize < items.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    return results;
}

export default {
    getDomainFromUrl,
    isValidDomain,
    validateStringChars,
    debounce,
    throttle,
    safeJsonParse,
    deepClone,
    retryAsync,
    PerformanceTimer,
    getMemoryUsage,
    sanitizeInput,
    generateId,
    isExtensionContextValid,
    batchProcess
};
