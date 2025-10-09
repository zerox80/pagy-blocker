/**
 * @file core/utilities.js
 * @description Zentrale Hilfsfunktionen für Pagy Blocker
 * @version 11.1
 */

import { EXTENSION_CONFIG } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('Utilities');

/**
 * Extrahiert sicher die Domain aus einer URL mit umfassender Validierung
 */
export function getDomainFromUrl(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }

    try {
        const parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
        const hostname = parsedUrl.hostname.toLowerCase();
        
        // Zusätzliche Validierung
        if (!isValidDomain(hostname)) {
            return null;
        }
        
        return hostname;
    } catch (error) {
        // Ungültige URL protokollieren (Debug)
        logger.debug('Invalid URL provided', { url, error: error.message });
        return null;
    }
}

/**
 * Validiert Domains über eine zeichenbasierte Prüfung (ReDoS-sicher)
 */
export function isValidDomain(domain) {
    if (!domain || typeof domain !== 'string') {
        return false;
    }

    // Längenprüfungen
    if (domain.length > EXTENSION_CONFIG.LIMITS.MAX_DOMAIN_LENGTH) {
        return false;
    }

    // Grundlegende Formatprüfungen
    if (domain.includes('..') || domain.startsWith('.') || domain.endsWith('.')) {
        return false;
    }

    // Sicherheitsprüfung für localhost und private IPs
    const suspiciousDomains = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    if (suspiciousDomains.includes(domain)) {
        return false;
    }

    // Aufteilen und jedes Label prüfen
    const labels = domain.split('.');
    if (labels.length < 2) {
        return false;
    }

    return labels.every(label => {
        if (!label || label.length > EXTENSION_CONFIG.LIMITS.MAX_LABEL_LENGTH) {
            return false;
        }
        
        // Zeichenprüfung anhand einer Allowlist
        for (let i = 0; i < label.length; i++) {
            // Erlaubt werden a-z, A-Z, 0-9, -
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
 * Prüft einen String gegen einen erlaubten Zeichensatz (ReDoS-sicher)
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
 * Debounce-Funktion zur Performance-Optimierung
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
 * Throttle-Funktion zur Begrenzung der Aufrufrate
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
 * Sicheres Parsen von JSON mit Fehlerbehandlung
 */
export function safeJsonParse(jsonString, fallback = null) {
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        // Warnung bei fehlgeschlagenem JSON-Parsing
        logger.warn('JSON parsing failed', { jsonString, error: error.message });
        return fallback;
    }
}

/**
 * Tiefes Klonen eines Objekts (sicher)
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
 * Wiederholungsmechanismus für asynchrone Operationen
 */
export async function retryAsync(fn, maxRetries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            
            // Hinweis bei fehlgeschlagenem Versuch
            logger.debug(`Retry attempt ${attempt} failed`, { error: error.message });
            await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
    }
}

/**
 * Werkzeug zur Messung von Ausführungszeiten
 */
export class PerformanceTimer {
    constructor(label) {
        this.label = label;
        this.startTime = performance.now();
    }

    end() {
        const duration = performance.now() - this.startTime;
        // Zeitmessung protokollieren
        logger.debug(`Performance: ${this.label}`, { duration: `${duration.toFixed(2)}ms` });
        return duration;
    }
}

/**
 * Überwachung der Speicherauslastung
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
 * Nutzer-Eingaben bereinigen (XSS-Prävention)
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
        .slice(0, 1000); // Maximale Länge begrenzen
}

/**
 * Eindeutige ID erzeugen
 */
export function generateId() {
    const rand = Math.random().toString(36).slice(2, 11);
    return `${Date.now()}-${rand}`;
}

/**
 * Prüfen, ob der Erweiterungs-Kontext gültig ist
 */
export function isExtensionContextValid() {
    try {
        // Gültig, wenn eine Runtime vorhanden ist und entweder eine ID
        // oder zumindest getURL (z. B. in Testumgebungen) verfügbar ist
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
 * Batch-Verarbeitung eines Arrays mit Parallelitätskontrolle
 */
export async function batchProcess(items, processor, batchSize = EXTENSION_CONFIG.PERFORMANCE.BATCH_SIZE) {
    const results = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);
        
        // Steuerung kurz abgeben, um Blocking zu vermeiden
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
