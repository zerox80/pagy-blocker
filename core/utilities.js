/**
 * @file core/utilities.js
 * @description Centralized utility functions for Pagy Blocker
 * @version 7.1.0
 */

import { EXTENSION_CONFIG } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('Utilities');

/**
 * Safely extracts domain from URL with comprehensive validation
 */
export function getDomainFromUrl(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }

    try {
        const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
        const hostname = parsedUrl.hostname.toLowerCase();
        
        // Additional validation
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
 * Validates domain using character-based analysis (ReDoS-safe)
 */
export function isValidDomain(domain) {
    if (!domain || typeof domain !== 'string') {
        return false;
    }

    // Length checks
    if (domain.length > EXTENSION_CONFIG.LIMITS.MAX_DOMAIN_LENGTH) {
        return false;
    }

    // Basic format checks
    if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
        return false;
    }

    // Security checks for localhost and private IPs
    const suspiciousDomains = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    if (suspiciousDomains.includes(domain)) {
        return false;
    }

    // Split and validate each label
    const labels = domain.split('.');
    if (labels.length < 2) {
        return false;
    }

    return labels.every(label => {
        if (!label || label.length > EXTENSION_CONFIG.LIMITS.MAX_LABEL_LENGTH) {
            return false;
        }
        
        // Character validation using allowlist
        for (let i = 0; i < label.length; i++) {
            // Assuming a-z, A-Z, 0-9, ., - are allowed
            const charCode = label.charCodeAt(i);
            if (!((charCode >= 97 && charCode <= 122) || // a-z
                  (charCode >= 65 && charCode <= 90) || // A-Z
                  (charCode >= 48 && charCode <= 57) || // 0-9
                  charCode === 45 || // -
                  charCode === 46)) { // .
                return false;
            }
        }
        
        return true;
    });
}

/**
 * Validates string against allowed character set (ReDoS-safe)
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
 * Debounce function for performance optimization
 */
export function debounce(func, delay = EXTENSION_CONFIG.PERFORMANCE.DEBOUNCE_DELAY) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

/**
 * Throttle function for rate limiting
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
 * Safe JSON parsing with error handling
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
 * Deep clone object safely
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
 * Retry mechanism for async operations
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
 * Performance timing utility
 */
export class PerformanceTimer {
    constructor(label) {
        this.label = label;
        this.startTime = performance.now();
    }

    end() {
        const duration = performance.now() - this.startTime;
        logger.debug(`Performance: ${this.label}`, { duration: `${duration.toFixed(2)}ms` });
        return duration;
    }
}

/**
 * Memory usage monitoring
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
 * Sanitize user input to prevent XSS
 */
export function sanitizeInput(input) {
    if (typeof input !== 'string') {
        return '';
    }
    
    return input
        .replace(/[<>'"&]/g, char => {
            switch (char) {
                case '<': return '<';
                case '>': return '>';
                case '"': return '"';
                case "'": return '&#x27;';
                case '&': return '&';
                default: return char;
            }
        })
        .trim()
        .slice(0, 1000); // Limit length
}

/**
 * Generate unique ID
 */
export function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if extension context is valid
 */
export function isExtensionContextValid() {
    try {
        return chrome?.runtime?.id !== undefined;
    } catch (error) {
        return false;
    }
}

/**
 * Batch process array with concurrency control
 */
export async function batchProcess(items, processor, batchSize = EXTENSION_CONFIG.PERFORMANCE.BATCH_SIZE) {
    const results = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);
        
        // Yield control to prevent blocking
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
