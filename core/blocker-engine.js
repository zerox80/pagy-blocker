/**
 * @file Blocker engine based on Chrome's declarativeNetRequest API.
 * @version 11.3
 */

import { getDomainFromUrl as utilGetDomainFromUrl, isValidDomain as utilIsValidDomain } from './utilities.js';
import { EXTENSION_CONFIG } from './config.js';
import StorageManager from './storage.js';
import { createLogger } from './logger.js';

const engineLogger = createLogger('Engine');

/**
 * Core blocker engine using Chrome's native declarativeNetRequest API.
 */
export class BlockerEngine {
    /**
     * Constructs a new BlockerEngine instance.
     */
    constructor() {
        this.isInitialized = false;
        this.startTime = Date.now();
        this.filterRules = [];
        /** @private @type {string[]|null} */
        this._disabledDomains = null;
        /** @private @type {Set<string>|null} */
        this._disabledDomainsSet = null;
        /** @private */
        this._storageListenerAttached = false;
        /** @private */
        this._statsCache = { time: 0, blockedRequests: 0 };
        /** @private */
        this._domainLock = Promise.resolve();
        /** @private */
        this._storage = new StorageManager();
    }

    /**
     * Acquires a lock to ensure atomic domain changes.
     * @private
     * @returns {Promise<Function>} A promise that resolves to a release function.
     */
    _acquireLock() {
        let release;
        const newLock = new Promise(resolve => {
            release = resolve;
        });
        const oldLock = this._domainLock;
        this._domainLock = newLock;
        return oldLock.then(() => release);
    }

    /**
     * Initializes the blocker engine.
     * @returns {Promise<boolean>} A promise that resolves to true if initialization is successful, false otherwise.
     */
    async initialize() {
        const initStart = Date.now();

        try {
            this.filterRules = await this.loadFilterRules();

            if (!this._storageListenerAttached && chrome?.storage?.onChanged) {
                try {
                    const DISABLED_KEY = EXTENSION_CONFIG.STORAGE_KEYS.DISABLED_DOMAINS;
                    chrome.storage.onChanged.addListener((changes, areaName) => {
                        if (areaName === 'local' && changes?.[DISABLED_KEY]) {
                            const newValue = Array.isArray(changes[DISABLED_KEY].newValue)
                                ? changes[DISABLED_KEY].newValue
                                : [];
                            this._updateDisabledDomainsCache(newValue);
                        }
                    });
                    this._storageListenerAttached = true;
                } catch (_) {
                    // Listener is optional, no hard dependencies.
                }
            }

            this.isInitialized = true;

            const initTime = Date.now() - initStart;
            engineLogger.info(`Blocker engine initialized in ${initTime.toFixed(2)}ms`);

            return true;
        } catch (error) {
            engineLogger.error('Failed to initialize blocker engine', { error: error.message });
            return false;
        }
    }

    /**
     * Retrieves blocking and filtering statistics.
     * @returns {Promise<object>} A promise that resolves to an object with statistics.
     */
    async getStats() {
        if (!this.isInitialized) {
            return {
                initialized: false,
                filterCount: 0,
                runtime: 0,
                blockedRequests: 0
            };
        }

        const runtime = Date.now() - this.startTime;
        let blockedCount = 0;

        const now = Date.now();
        if (now - this._statsCache.time < 1500) {
            return {
                initialized: true,
                filterCount: this.filterRules.length,
                runtime: runtime,
                blockedRequests: this._statsCache.blockedRequests
            };
        }

        try {
            if (typeof chrome?.declarativeNetRequest?.getMatchedRules === 'function') {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (activeTab?.id) {
                    const info = await chrome.declarativeNetRequest.getMatchedRules({ tabId: activeTab.id });
                    if (info?.rulesMatchedInfo && info.rulesMatchedInfo.length > 0) {
                        blockedCount = info.rulesMatchedInfo.length;
                    }
                }
            }
        } catch (error) {
            engineLogger.debug('Chrome DNR API unavailable', { error: error.message });
        }

        const result = {
            initialized: true,
            filterCount: this.filterRules.length,
            runtime: runtime,
            blockedRequests: blockedCount
        };

        this._statsCache = { time: now, blockedRequests: blockedCount };
        return result;
    }

    /**
     * Extracts the domain from a URL.
     * @param {string} url - The URL to extract the domain from.
     * @returns {string|null} The extracted domain or null if the URL is invalid.
     */
    getDomainFromUrl(url) {
        return utilGetDomainFromUrl(url);
    }

    /**
     * Checks if a domain is valid.
     * @param {string} domain - The domain to validate.
     * @returns {boolean} True if the domain is valid, false otherwise.
     */
    isValidDomain(domain) {
        return utilIsValidDomain(domain);
    }

    /**
     * Retrieves the list of disabled domains.
     * @returns {Promise<string[]>} A promise that resolves to an array of disabled domains.
     */
    async getDisabledDomains() {
        const release = await this._acquireLock();
        try {
            if (Array.isArray(this._disabledDomains)) {
                return this._disabledDomains;
            }
            const DISABLED_KEY = EXTENSION_CONFIG.STORAGE_KEYS.DISABLED_DOMAINS;
            const value = await this._storage.get(DISABLED_KEY);
            const domains = Array.isArray(value) ? value : [];
            this._updateDisabledDomainsCache(domains);
            return this._disabledDomains;
        } catch (error) {
            engineLogger.error('Failed to retrieve disabled domains', { error: error.message });
            this._updateDisabledDomainsCache([]);
            return this._disabledDomains;
        } finally {
            release();
        }
    }

    /**
     * Sets the list of disabled domains.
     * @param {string[]} domains - An array of domains to disable.
     * @returns {Promise<void>}
     */
    async setDisabledDomains(domains) {
        const release = await this._acquireLock();
        try {
            const domainsToSet = Array.isArray(domains) ? domains : [];
            const DISABLED_KEY = EXTENSION_CONFIG.STORAGE_KEYS.DISABLED_DOMAINS;
            await this._storage.set(DISABLED_KEY, domainsToSet);
            this._updateDisabledDomainsCache(domainsToSet);
        } catch (error) {
            engineLogger.error('Failed to save disabled domains', { error: error.message });
        } finally {
            release();
        }
    }

    /**
     * Adds a domain to the list of disabled domains.
     * @param {string} domain - The domain to add.
     * @returns {Promise<void>}
     */
    async addDisabledDomain(domain) {
        const release = await this._acquireLock();
        try {
            const DISABLED_KEY = EXTENSION_CONFIG.STORAGE_KEYS.DISABLED_DOMAINS;
            const currentValue = await this._storage.get(DISABLED_KEY);
            const currentDomains = Array.isArray(currentValue) ? currentValue : [];
            if (this.isValidDomain(domain) && !currentDomains.includes(domain)) {
                const updatedDomains = [...currentDomains, domain];
                await this._storage.set(DISABLED_KEY, updatedDomains);
                this._updateDisabledDomainsCache(updatedDomains);
            }
        } catch (error) {
            engineLogger.error('Error adding disabled domain', { error: error.message });
        } finally {
            release();
        }
    }

    /**
     * Removes a domain from the list of disabled domains.
     * @param {string} domain - The domain to remove.
     * @returns {Promise<void>}
     */
    async removeDisabledDomain(domain) {
        const release = await this._acquireLock();
        try {
            const DISABLED_KEY = EXTENSION_CONFIG.STORAGE_KEYS.DISABLED_DOMAINS;
            const currentValue = await this._storage.get(DISABLED_KEY);
            const currentDomains = Array.isArray(currentValue) ? currentValue : [];
            if (currentDomains.includes(domain)) {
                const updatedDomains = currentDomains.filter(d => d !== domain);
                await this._storage.set(DISABLED_KEY, updatedDomains);
                this._updateDisabledDomainsCache(updatedDomains);
            }
        } catch (error) {
            engineLogger.error('Error removing disabled domain', { error: error.message });
        } finally {
            release();
        }
    }

    /**
     * Checks if a domain is disabled.
     * @param {string} domain - The domain to check.
     * @returns {Promise<boolean>} A promise that resolves to true if the domain is disabled, false otherwise.
     */
    async isDomainDisabled(domain) {
        if (!this._disabledDomainsSet) {
            await this.getDisabledDomains();
        }
        return this._disabledDomainsSet?.has(domain) || false;
    }

    /**
     * Loads filter rules from the packaged files.
     * @returns {Promise<Array<object|string>>} A promise that resolves to an array of filter rules.
     */
    async loadFilterRules() {
        try {
            const response = await fetch(chrome.runtime.getURL('/filter_lists/filter_precompiled.json'));
            if (response.ok) {
                const json = await response.json();
                return Array.isArray(json) ? json : [];
            }
        } catch (error) {
            engineLogger.warn('Could not load precompiled filter list', { error: error.message });
        }

        try {
            const response = await fetch(chrome.runtime.getURL('/filter_lists/filter_optimized.txt'));
            if (response.ok) {
                const text = await response.text();
                const lines = text.split('\n')
                    .map(line => line.trim())
                    .filter(line => line &&
                        !line.startsWith('!') &&
                        !line.startsWith('[') &&
                        !line.startsWith('@@') &&
                        !line.includes('##') && !line.includes('#@#') && !line.includes('#?#')
                    );
                return lines;
            }
        } catch (error) {
            engineLogger.warn('Could not load optimized filter list', { error: error.message });
        }

        return [];
    }

    /**
     * Destroys the blocker engine instance.
     */
    destroy() {
        this.isInitialized = false;
        this.filterRules = [];
        this._disabledDomains = null;
        this._disabledDomainsSet = null;
        engineLogger.info('Blocker engine destroyed');
    }

    /**
     * Updates the cache for disabled domains.
     * @private
     * @param {string[]} domains - An array of domains to cache.
     */
    _updateDisabledDomainsCache(domains) {
        const list = Array.isArray(domains) ? domains.slice(0) : [];
        this._disabledDomains = list;
        this._disabledDomainsSet = new Set(list);
    }
}

// Export singleton instance
export const blockerEngine = new BlockerEngine();
