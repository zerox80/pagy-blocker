/**
 * @file Storage abstraction layer for Pagy Blocker.
 * @version 11.2
 */

import { EXTENSION_CONFIG } from './config.js';
import { createLogger } from './logger.js';
import { retryAsync, isExtensionContextValid } from './utilities.js';

const logger = createLogger('Storage');

/**
 * Manages storage operations with caching and retry mechanisms.
 */
class StorageManager {
    /**
     * Constructs a new StorageManager instance.
     */
    constructor() {
        this.cache = new Map();
        this.cacheTimestamps = new Map();
        this.pendingOperations = new Map();
    }

    /**
     * Retrieves data from storage with cache support.
     * @param {string} key - The key of the item to retrieve.
     * @param {boolean} [useCache=true] - Whether to use the cache.
     * @returns {Promise<*>} A promise that resolves to the retrieved value.
     */
    async get(key, useCache = true) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        if (useCache && this.isCacheValid(key)) {
            logger.debug('Retrieved from cache', { key });
            return this.cache.get(key);
        }

        if (this.pendingOperations.has(key)) {
            return this.pendingOperations.get(key);
        }

        const operation = retryAsync(async () => {
            const result = await chrome.storage.local.get(key);
            const value = result[key];

            if (useCache) {
                this.updateCache(key, value);
            }

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
     * Sets data in storage with cache update.
     * @param {string} key - The key of the item to set.
     * @param {*} value - The value to set.
     * @returns {Promise<void>}
     */
    async set(key, value) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        await retryAsync(async () => {
            await chrome.storage.local.set({ [key]: value });

            this.updateCache(key, value);

            logger.debug('Stored to storage', { key, valueType: typeof value });
        }, 3, 1000);
    }

    /**
     * Removes data from storage.
     * @param {string} key - The key of the item to remove.
     * @returns {Promise<void>}
     */
    async remove(key) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        await retryAsync(async () => {
            await chrome.storage.local.remove(key);

            this.cache.delete(key);
            this.cacheTimestamps.delete(key);

            logger.debug('Removed from storage', { key });
        }, 3, 1000);
    }

    /**
     * Clears all stored data.
     * @returns {Promise<void>}
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
     * Gets the storage usage.
     * @returns {Promise<{bytesInUse: number}>} A promise that resolves to an object with the number of bytes in use.
     */
    async getUsage() {
        if (!isExtensionContextValid()) {
            return { bytesInUse: 0 };
        }

        try {
            const bytesInUse = await chrome.storage.local.getBytesInUse();
            return { bytesInUse };
        } catch (error) {
            logger.warn('Failed to get storage usage', { error: error.message });
            return { bytesInUse: 0 };
        }
    }

    /**
     * Updates the cache with a new value.
     * @param {string} key - The key of the item to update.
     * @param {*} value - The new value.
     */
    updateCache(key, value) {
        this.cache.set(key, value);
        this.cacheTimestamps.set(key, Date.now());
    }

    /**
     * Checks if the cache for a given key is valid.
     * @param {string} key - The key to check.
     * @returns {boolean} True if the cache is valid, false otherwise.
     */
    isCacheValid(key) {
        if (!this.cache.has(key)) {
            return false;
        }

        const timestamp = this.cacheTimestamps.get(key);
        return timestamp && (Date.now() - timestamp < EXTENSION_CONFIG.PERFORMANCE.CACHE_TTL);
    }

    /**
     * Clears the cache.
     */
    clearCache() {
        this.cache.clear();
        this.cacheTimestamps.clear();
        logger.debug('Cache cleared');
    }

    /**
     * Performs batch get operations for better performance.
     * @param {string[]} keys - An array of keys to retrieve.
     * @returns {Promise<object>} A promise that resolves to an object with the retrieved key-value pairs.
     */
    async batchGet(keys) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        const result = await chrome.storage.local.get(keys);

        keys.forEach(key => {
            if (key in result) {
                this.updateCache(key, result[key]);
            }
        });

        logger.debug('Batch retrieved from storage', { keys, foundKeys: Object.keys(result) });
        return result;
    }

    /**
     * Performs batch set operations for better performance.
     * @param {object} data - An object with key-value pairs to set.
     * @returns {Promise<void>}
     */
    async batchSet(data) {
        if (!isExtensionContextValid()) {
            throw new Error('Extension context is invalid');
        }

        await chrome.storage.local.set(data);

        Object.entries(data).forEach(([key, value]) => {
            this.updateCache(key, value);
        });

        logger.debug('Batch stored to storage', { keys: Object.keys(data) });
    }
}

export default StorageManager;
