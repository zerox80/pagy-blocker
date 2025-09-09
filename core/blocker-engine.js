/**
 * @file blocker-engine.js
 * @description Schlanke Werbeblocker-Engine auf Basis von Chromes declarativeNetRequest API
 * @version 10.5
 */

import { getDomainFromUrl as utilGetDomainFromUrl, isValidDomain as utilIsValidDomain } from './utilities.js';

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
    }

    async initialize() {
        const initStart = Date.now();
        
        try {
            // Filterregeln laden (nur zur Anzeige/Zählung)
            this.filterRules = await this.loadFilterRules();

            // Storage-Listener nur einmal registrieren
            if (!this._storageListenerAttached && chrome?.storage?.onChanged) {
                try {
                    chrome.storage.onChanged.addListener((changes, areaName) => {
                        if (areaName === 'local' && changes?.disabledDomains) {
                            const newValue = Array.isArray(changes.disabledDomains.newValue)
                                ? changes.disabledDomains.newValue
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
            // Hinweis in der Konsole zur Initialisierungsdauer
            console.log(`Blocker engine initialized in ${initTime.toFixed(2)}ms`);
            
            return true;
        } catch (error) {
            // Fehlermeldung bei gescheiterter Initialisierung
            console.error('Failed to initialize blocker engine:', error);
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
            console.debug('Chrome DNR API unavailable:', error.message);
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
        // Cache nutzen, falls vorhanden
        if (Array.isArray(this._disabledDomains)) {
            return this._disabledDomains;
        }

        try {
            const result = await chrome.storage?.local?.get?.('disabledDomains');
            const domains = Array.isArray(result?.disabledDomains) ? result.disabledDomains : [];
            this._updateDisabledDomainsCache(domains);
            return this._disabledDomains;
        } catch (error) {
            console.error('Failed to retrieve disabled domains:', error);
            this._updateDisabledDomainsCache([]);
            return this._disabledDomains;
        }
    }

    async setDisabledDomains(domains) {
        try {
            await chrome.storage?.local?.set?.({ 
                disabledDomains: Array.isArray(domains) ? domains : [] 
            });
            this._updateDisabledDomainsCache(Array.isArray(domains) ? domains : []);
        } catch (error) {
            console.error('Failed to save disabled domains:', error);
        }
    }

    async addDisabledDomain(domain) {
        // Um Race Conditions zu vermeiden, Daten direkt vor der Änderung lesen
        const { disabledDomains: currentDomains = [] } = await chrome.storage.local.get('disabledDomains');

        if (this.isValidDomain(domain) && !currentDomains.includes(domain)) {
            const updatedDomains = [...currentDomains, domain];
            await this.setDisabledDomains(updatedDomains);
        }
    }

    async removeDisabledDomain(domain) {
        // Um Race Conditions zu vermeiden, Daten direkt vor der Änderung lesen
        const { disabledDomains: currentDomains = [] } = await chrome.storage.local.get('disabledDomains');

        if (currentDomains.includes(domain)) {
            const updatedDomains = currentDomains.filter(d => d !== domain);
            await this.setDisabledDomains(updatedDomains);
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
            console.warn('Could not load precompiled filter list:', error);
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
            console.warn('Could not load optimized filter list:', error);
        }

        return [];
    }

    destroy() {
        this.isInitialized = false;
        this.filterRules = [];
        this._disabledDomains = null;
        this._disabledDomainsSet = null;
        // Hinweis in der Konsole zur Bereinigung
        console.log('Blocker engine destroyed');
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
