/**
 * @file blocker-engine.js
 * @description Schlanke Werbeblocker-Engine auf Basis von Chromes declarativeNetRequest API
 * @version 11.0
 */

import { getDomainFromUrl as utilGetDomainFromUrl, isValidDomain as utilIsValidDomain } from './utilities.js';
import { EXTENSION_CONFIG } from './config.js';
import StorageManager from './storage.js';
import { createLogger } from './logger.js';

const engineLogger = createLogger('Engine');

/**
 * Zentrale Blocker-Engine, die Chromes native declarativeNetRequest API nutzt
 */
export class BlockerEngine {
    constructor() {
        this.isInitialized = false;
        this.startTime = Date.now();
        this.filterRules = [];
        // Cache für deaktivierte Domains (beschleunigt häufige Nachfragen)
        this._disabledDomains = null;
        this._disabledDomainsSet = null;
        this._storageListenerAttached = false;
        // Leichter Stats-Cache, um wiederholte teure Abfragen zu vermeiden
        this._statsCache = { time: 0, blockedRequests: 0 };
        // Promise-basiertes Lock für Domain-Änderungen
        this._domainLock = Promise.resolve();
        // Zentrale Storage-Instanz
        this._storage = new StorageManager();
    }

    /**
     * Erwirbt das Lock, um atomare Domain-Änderungen sicherzustellen.
     * @returns {Promise<Function>} Eine Promise, die zu einer release-Funktion auflöst.
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

    async initialize() {
        const initStart = Date.now();
        
        try {
            // Filterregeln laden (nur zur Anzeige/Zählung)
            this.filterRules = await this.loadFilterRules();

            // Storage-Listener nur einmal registrieren
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
                    // Listener optional – keine harten Abhängigkeiten
                }
            }
            
            this.isInitialized = true;
            
            const initTime = Date.now() - initStart;
            // Hinweis zur Initialisierungsdauer
            engineLogger.info(`Blocker engine initialized in ${initTime.toFixed(2)}ms`);
            
            return true;
        } catch (error) {
            // Fehlermeldung bei gescheiterter Initialisierung
            engineLogger.error('Failed to initialize blocker engine', { error: error.message });
            return false;
        }
    }

    /**
     * Liefert zusammengefasste Sperr-/Blockierstatistiken
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

        // Kurzer TTL-Cache (1.5s), reduziert Last bei schnellen UI-Updates
        const now = Date.now();
        if (now - this._statsCache.time < 1500) {
            return {
                initialized: true,
                filterCount: this.filterRules.length,
                runtime: runtime,
                blockedRequests: this._statsCache.blockedRequests
            };
        }
        
        // Methode 1: Echte Daten über Chromes declarativeNetRequest API abrufen
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

        // Die Zählung basiert nun ausschließlich auf der getMatchedRules API.
        // Die Schätzung wurde entfernt, um die Code-Komplexität zu reduzieren
        // und eine irreführende, ungenaue Statistik zu vermeiden.
        const result = {
            initialized: true,
            filterCount: this.filterRules.length,
            runtime: runtime,
            blockedRequests: blockedCount
        };

        // Cache aktualisieren
        this._statsCache = { time: now, blockedRequests: blockedCount };
        return result;
    }

    /**
     * Funktionen zur Domain-Verarbeitung
     */
    getDomainFromUrl(url) {
        return utilGetDomainFromUrl(url);
    }

    isValidDomain(domain) {
        return utilIsValidDomain(domain);
    }

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

    async isDomainDisabled(domain) {
        // Schneller Lookup über Set
        if (!this._disabledDomainsSet) {
            await this.getDisabledDomains();
        }
        return this._disabledDomainsSet?.has(domain) || false;
    }

    /**
     * Lädt Filterregeln aus den mitgelieferten Dateien
     */
    async loadFilterRules() {
        // Bevorzugt das vor-kompilierte JSON (schneller, kleiner, MV3-freundlich)
        try {
            const response = await fetch(chrome.runtime.getURL('/filter_lists/filter_precompiled.json'));
            if (response.ok) {
                const json = await response.json();
                return Array.isArray(json) ? json : [];
            }
        } catch (error) {
            engineLogger.warn('Could not load precompiled filter list', { error: error.message });
        }

        // Fallback: optimierte Textliste für Notfälle (nur zur Anzeige/Zählung)
        try {
            const response = await fetch(chrome.runtime.getURL('/filter_lists/filter_optimized.txt'));
            if (response.ok) {
                const text = await response.text();
                const lines = text.split('\n')
                    .map(line => line.trim())
                    .filter(line => line &&
                        !line.startsWith('!') && // Kommentare
                        !line.startsWith('[') && // Metadaten
                        !line.startsWith('@@') && // Ausnahmen
                        !line.includes('##') && !line.includes('#@#') && !line.includes('#?#') // kosmetisch
                    );
                return lines;
            }
        } catch (error) {
            engineLogger.warn('Could not load optimized filter list', { error: error.message });
        }

        return [];
    }

    destroy() {
        this.isInitialized = false;
        this.filterRules = [];
        this._disabledDomains = null;
        this._disabledDomainsSet = null;
        // Hinweis zur Bereinigung
        engineLogger.info('Blocker engine destroyed');
    }

    // Interne Hilfsfunktion zur Cache-Aktualisierung
    _updateDisabledDomainsCache(domains) {
        const list = Array.isArray(domains) ? domains.slice(0) : [];
        this._disabledDomains = list;
        this._disabledDomainsSet = new Set(list);
    }
}

// Export singleton instance
export const blockerEngine = new BlockerEngine();
