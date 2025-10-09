/**
 * @file core/storage.js
 * @description Speicher-Abstraktionsschicht für Pagy Blocker
 * @version 11.1
 */

import { EXTENSION_CONFIG } from './config.js';
import { createLogger } from './logger.js';
import { retryAsync, isExtensionContextValid } from './utilities.js';

const logger = createLogger('Storage');

class StorageManager {
    constructor() {
        this.cache = new Map();
        this.cacheTimestamps = new Map();
        this.pendingOperations = new Map();
    }

    /**
     * Daten aus dem Speicher lesen – mit Cache-Unterstützung
     */
    async get(key, useCache = true) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        // Zuerst den Cache prüfen
        if (useCache && this.isCacheValid(key)) {
            logger.debug('Retrieved from cache', { key });
            return this.cache.get(key);
        }

        // Doppelte gleichzeitige Operationen vermeiden
        if (this.pendingOperations.has(key)) {
            return this.pendingOperations.get(key);
        }

        const operation = retryAsync(async () => {
            const result = await chrome.storage.local.get(key);
            const value = result[key];
            
            // Cache aktualisieren
            if (useCache) {
                this.updateCache(key, value);
            }
            
            // Hinweis: Wert aus dem Speicher gelesen
            logger.debug('Retrieved from storage', { key, hasValue: value !== undefined });
            return value;
        }, 3, 1000);

        this.pendingOperations.set(key, operation);
        
        try {
            const result = await operation;
            return result;
        } finally {
            this.pendingOperations.delete(key);
        }
    }

    /**
     * Daten im Speicher setzen – mit Cache-Aktualisierung
     */
    async set(key, value) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        await retryAsync(async () => {
            await chrome.storage.local.set({ [key]: value });
            
            // Update cache
            this.updateCache(key, value);
            
            // Hinweis: Wert im Speicher geschrieben
            logger.debug('Stored to storage', { key, valueType: typeof value });
        }, 3, 1000);
    }

    /**
     * Daten aus dem Speicher entfernen
     */
    async remove(key) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        await retryAsync(async () => {
            await chrome.storage.local.remove(key);
            
            // Auch aus dem Cache entfernen
            this.cache.delete(key);
            this.cacheTimestamps.delete(key);
            
            logger.debug('Removed from storage', { key });
        }, 3, 1000);
    }

    /**
     * Alle gespeicherten Daten löschen
     */
    async clear() {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        await chrome.storage.local.clear();
        this.cache.clear();
        this.cacheTimestamps.clear();
        
        logger.info('Cleared all storage data');
    }

    /**
     * Speicherbelegung ermitteln
     */
    async getUsage() {
        if (!isExtensionContextValid()) {
            return { bytesInUse: 0 };
        }

        try {
            const bytesInUse = await chrome.storage.local.getBytesInUse();
            return { bytesInUse };
        } catch (error) {
            // Warnung: Speicherbelegung konnte nicht ermittelt werden
            logger.warn('Failed to get storage usage', { error: error.message });
            return { bytesInUse: 0 };
        }
    }

    /**
     * Cache-Verwaltung
     */
    updateCache(key, value) {
        this.cache.set(key, value);
        this.cacheTimestamps.set(key, Date.now());
    }

    isCacheValid(key) {
        if (!this.cache.has(key)) {
            return false;
        }

        const timestamp = this.cacheTimestamps.get(key);
        return timestamp && (Date.now() - timestamp < EXTENSION_CONFIG.PERFORMANCE.CACHE_TTL);
    }

    clearCache() {
        this.cache.clear();
        this.cacheTimestamps.clear();
        logger.debug('Cache cleared');
    }

    /**
     * Batch-Operationen für bessere Performance
     */
    async batchGet(keys) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        const result = await chrome.storage.local.get(keys);
        
        // Cache für alle gelesenen Werte aktualisieren
        keys.forEach(key => {
            if (key in result) {
                this.updateCache(key, result[key]);
            }
        });

        logger.debug('Batch retrieved from storage', { keys, foundKeys: Object.keys(result) });
        return result;
    }

    async batchSet(data) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        await chrome.storage.local.set(data);
        
        // Cache für alle gesetzten Werte aktualisieren
        Object.entries(data).forEach(([key, value]) => {
            this.updateCache(key, value);
        });

        logger.debug('Batch stored to storage', { keys: Object.keys(data) });
    }
}

// Default export
export default StorageManager;
