/**
 * @file background.js
 * @description Service Worker für Pagy Blocker - Domain-basierte Filtersteuerung
 * @version 10.5
 */

import { EXTENSION_CONFIG, RULE_CONFIG } from '../core/config.js';
import { backgroundLogger } from '../core/logger.js';
import { debounce, PerformanceTimer } from '../core/utilities.js';
import { blockerEngine } from '../core/blocker-engine.js';

// Zustandsverwaltung
class BackgroundState {
    constructor() {
        this.precompiledFilterCount = 0;
        this.isInitialized = false;
        this.activeOperations = new Set();
        this.iconUpdateQueue = new Map();
        // Cache zuletzt gesetzter Icon-/Badge-States pro Tab zur Vermeidung redundanter Updates
        this.tabIconCache = new Map(); // tabId -> { domain, iconPath, badgeText }
    }

    async initialize() {
        if (this.isInitialized) return;
        
        const timer = new PerformanceTimer('Background initialization');
        
        try {
            // Blocker-Engine initialisieren
            await blockerEngine.initialize();
            
            await this.initializeFilterCount();
            await this.initializeStorage();
            await this.updateDynamicRules();
            
            this.isInitialized = true;
            backgroundLogger.info('Background script initialized successfully');
            
            // Performance-Werte protokollieren
            const stats = await blockerEngine.getStats();
            backgroundLogger.info('Blocker stats:', stats);
        } catch (error) {
            backgroundLogger.error('Failed to initialize background script', { error: error.message });
            throw error;
        } finally {
            timer.end();
        }
    }

    async initializeFilterCount() {
        try {
            // Bevorzugt das vor-kompilierte JSON-Regelset (wird von DNR aus dem Manifest geladen)
            const resp = await fetch(chrome.runtime.getURL('/filter_lists/filter_precompiled.json'));
            if (resp.ok) {
                const json = await resp.json();
                this.precompiledFilterCount = Array.isArray(json) ? json.length : 0;
                backgroundLogger.info('Filter count initialized from JSON', { count: this.precompiledFilterCount });
                return;
            }
        } catch (e) {
            backgroundLogger.warn('Failed to load JSON rules, will try TXT fallback', { error: e?.message });
        }
        // Fallback: Anzahl aus der TXT-Datei ermitteln
        try {
            const filterRules = await blockerEngine.loadFilterRules();
            this.precompiledFilterCount = Array.isArray(filterRules) ? filterRules.length : 0;
            backgroundLogger.info('Filter count initialized from TXT file', { count: this.precompiledFilterCount });
        } catch (error) {
            backgroundLogger.error('Failed to initialize filter count', { error: error.message });
            this.precompiledFilterCount = 0;
        }
    }

    async initializeStorage() {
        try {
            // Speicher für deaktivierte Domains initialisieren (no-op, falls nicht verfügbar)
            const disabledDomains = await blockerEngine.getDisabledDomains();
            backgroundLogger.debug('Storage initialized', { disabledDomainsCount: disabledDomains.length });
        } catch (error) {
            backgroundLogger.error('Failed to initialize storage', { error: error.message });
            // Bei Fehlern mit leerem Array initialisieren
            await blockerEngine.setDisabledDomains([]);
        }
    }
}

const state = new BackgroundState();

// Verwaltung dynamischer Regeln (Diff-basiert, vermeidet Full-Replace)
const updateDynamicRules = async () => {
    const operationId = 'updateDynamicRules';
    
    // Gleichzeitige Ausführungen verhindern
    if (state.activeOperations.has(operationId)) {
        backgroundLogger.debug('Dynamic rules update already in progress');
        return;
    }
    
    state.activeOperations.add(operationId);
    const timer = new PerformanceTimer('Dynamische Regeln aktualisieren');
    
    try {
        const disabledDomains = await blockerEngine.getDisabledDomains();
        
        // Domains validieren
        const validDomains = disabledDomains
            .filter(domain => blockerEngine.isValidDomain(domain))
            .slice(0, EXTENSION_CONFIG.LIMITS.MAX_DYNAMIC_RULES);

        if (validDomains.length !== disabledDomains.length) {
            backgroundLogger.warn('Invalid domains filtered out', { 
                original: disabledDomains.length, 
                valid: validDomains.length 
            });
        }

        // Aktuelle dynamische Regeln lesen und in Map ablegen
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const domainToRule = new Map();
        const usedIds = new Set();

        for (const rule of existingRules) {
            usedIds.add(rule.id);
            const initiators = rule?.condition?.initiatorDomains;
            const actionType = rule?.action?.type;
            const priority = rule?.priority;
            // Nur unsere eigenen Allow-Regeln berücksichtigen
            if (
                Array.isArray(initiators) &&
                initiators.length === 1 &&
                actionType === RULE_CONFIG.ACTIONS.ALLOW &&
                priority === EXTENSION_CONFIG.PRIORITIES.ALLOW_RULE
            ) {
                domainToRule.set(initiators[0], rule);
            }
        }

        const desired = new Set(validDomains);
        const existing = new Set(domainToRule.keys());

        // Für dynamische Allow-Regeln die Ressourcentypen ohne main_frame verwenden
        const dynamicResourceTypes = (RULE_CONFIG.RESOURCE_TYPES || []).filter(t => t !== 'main_frame');

        // Zu entfernende Regeln = existieren, aber nicht mehr gewünscht
        const rulesToRemove = [];
        for (const domain of existing) {
            if (!desired.has(domain)) {
                rulesToRemove.push(domainToRule.get(domain).id);
            } else {
                // Falls sich die Ressourcentypen geändert haben, neu anlegen
                const rule = domainToRule.get(domain);
                const rt = rule?.condition?.resourceTypes || [];
                const sameRT = Array.isArray(rt) && rt.length === dynamicResourceTypes.length && rt.every((t, i) => t === dynamicResourceTypes[i]);
                if (!sameRT) {
                    rulesToRemove.push(rule.id);
                    existing.delete(domain);
                }
            }
        }

        // Zu ergänzende Regeln = gewünscht, aber nicht vorhanden
        const rulesToAdd = [];

        // Kleine Hilfsfunktion: kleinste freie ID finden
        const nextFreeId = () => {
            let id = 1;
            while (usedIds.has(id)) id++;
            usedIds.add(id);
            return id;
        };

        for (const domain of desired) {
            if (!existing.has(domain)) {
                rulesToAdd.push({
                    id: nextFreeId(),
                    priority: EXTENSION_CONFIG.PRIORITIES.ALLOW_RULE,
                    action: { type: RULE_CONFIG.ACTIONS.ALLOW },
                    condition: {
                        initiatorDomains: [domain],
                        resourceTypes: dynamicResourceTypes
                    }
                });
            }
        }

        if (rulesToRemove.length > 0 || rulesToAdd.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: rulesToRemove,
                addRules: rulesToAdd
            });
        }

        // Hinweis: Automatisches Neuladen von Tabs entfernt, um ungewollte Reloads zu vermeiden.
        // Die Erweiterung funktioniert ohne erzwungenes Neuladen – Content Scripts
        // und dynamische Regeln greifen automatisch.

        backgroundLogger.info('Dynamic rules updated', {
            removed: rulesToRemove.length,
            added: rulesToAdd.length
        });

    } catch (error) {
        backgroundLogger.error('Failed to update dynamic rules', { 
            error: error.message,
            stack: error.stack 
        });
        throw error;
    } finally {
        state.activeOperations.delete(operationId);
        timer.end();
    }
};

// updateDynamicRules in die State-Klasse hängen
state.updateDynamicRules = updateDynamicRules;

// Icon-Aktualisierung mit Debounce
const updateIcon = debounce(async (tabId) => {
    const operationId = `updateIcon-${tabId}`;
    
    if (state.activeOperations.has(operationId)) {
        return;
    }
    
    state.activeOperations.add(operationId);
    
    try {
        if (!tabId || typeof tabId !== 'number') {
            backgroundLogger.error('Invalid tabId for updateIcon', { tabId });
            return;
        }

        const tab = await chrome.tabs.get(tabId);
        const domain = blockerEngine.getDomainFromUrl(tab.url);

        // Für Nicht-Web-URLs das Standard-Icon verwenden
        if (!domain) {
            await chrome.action.setIcon({ path: EXTENSION_CONFIG.ICONS.DEFAULT, tabId });
            return;
        }

        const isPausedForDomain = await blockerEngine.isDomainDisabled(domain);
        const iconPath = isPausedForDomain ? EXTENSION_CONFIG.ICONS.DISABLED : EXTENSION_CONFIG.ICONS.DEFAULT;
        const badgeText = isPausedForDomain ? '⏸' : '';

        // Redundante Updates vermeiden
        const prev = state.tabIconCache.get(tabId);
        if (!prev || prev.domain !== domain || prev.iconPath !== iconPath) {
            await chrome.action.setIcon({ path: iconPath, tabId });
        }
        if (!prev || prev.badgeText !== badgeText) {
            await chrome.action.setBadgeText({ text: badgeText, tabId });
        }

        state.tabIconCache.set(tabId, { domain, iconPath, badgeText });
        
        backgroundLogger.debug('Icon updated', { tabId, domain, isPaused: isPausedForDomain });
        
    } catch (error) {
        // Tab existiert ggf. nicht mehr – normal beim schnellen Wechseln
        if (!error.message.includes('No tab with id')) {
            backgroundLogger.error('Failed to update icon', { tabId, error: error.message });
        }
    } finally {
        state.activeOperations.delete(operationId);
    }
}, 100); // Icon-Updates entprellen

// Nachrichten-Handler mit verbesserter Fehlerbehandlung
class MessageHandler {
    static async handleGetPopupData() {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const domain = blockerEngine.getDomainFromUrl(activeTab?.url);
        const isPaused = domain ? await blockerEngine.isDomainDisabled(domain) : false;
        
        // Erweiterte Blockier-Statistiken abfragen
        const stats = await blockerEngine.getStats();
        
        return {
            isPaused,
            domain,
            filterCount: state.precompiledFilterCount,
            stats
        };
    }

    static async handleGetState(sender) {
        const domain = blockerEngine.getDomainFromUrl(sender.tab?.url);
        if (!domain) {
            return { isPaused: false };
        }
        
        const isPaused = await blockerEngine.isDomainDisabled(domain);
        return { isPaused, domain };
    }

    static async handleToggleDomainState({ domain, isPaused }) {
        if (!domain || !blockerEngine.isValidDomain(domain)) {
            throw new Error('Invalid domain provided');
        }

        const timer = new PerformanceTimer(`Toggle domain ${domain}`);
        
        try {
            if (isPaused) {
                await blockerEngine.addDisabledDomain(domain);
            } else {
                await blockerEngine.removeDisabledDomain(domain);
            }

            await updateDynamicRules();

            // Alle Content Scripts über den Zustandswechsel informieren
            const tabs = await chrome.tabs.query({});
            const notificationPromises = tabs
                .filter(tab => blockerEngine.getDomainFromUrl(tab.url) === domain)
                .map(async (tab) => {
                    try {
                        await chrome.tabs.sendMessage(tab.id, {
                            command: 'updatePauseState',
                            isPaused: isPaused
                        });
                    } catch (e) {
                        // Tab existiert ggf. nicht mehr oder lädt gerade
                    }
                });

            await Promise.allSettled(notificationPromises);

            // Nur den aktuell aktiven Tab im aktuellen Fenster neu laden
            try {
                const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (activeTab?.id && activeTab?.url) {
                    const activeTabDomain = blockerEngine.getDomainFromUrl(activeTab.url);
                    
                    if (activeTabDomain === domain) {
                        await chrome.tabs.reload(activeTab.id);
                        backgroundLogger.info('Active tab reloaded after domain toggle', { 
                            tabId: activeTab.id, 
                            domain: domain 
                        });
                    }
                }
            } catch (e) {
                // Ausführliche Fehlerinformation protokollieren
                backgroundLogger.error('Active tab reload failed', { 
                    error: e?.message, 
                    stack: e?.stack 
                });
            }

            return { success: true };
        } finally {
            timer.end();
        }
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        try {
            let result;
            
            switch (message.command) {
                case 'getPopupData':
                    result = await MessageHandler.handleGetPopupData();
                    break;
                case 'getState':
                    result = await MessageHandler.handleGetState(sender);
                    break;
                case 'toggleDomainState':
                    result = await MessageHandler.handleToggleDomainState(message);
                    break;
                default:
                    throw new Error(`Unknown command: ${message.command}`);
            }
            
            sendResponse(result);
        } catch (error) {
            backgroundLogger.error('Message handler error', { 
                command: message.command, 
                error: error.message 
            });
            sendResponse({ error: error.message });
        }
    })();
    return true;
});

// Ereignis-Listener
chrome.runtime.onInstalled.addListener(async (details) => {
    backgroundLogger.info('Extension installed/updated', { reason: details.reason });
    
    try {
        await state.initialize();
        backgroundLogger.info('Extension initialization completed');
    } catch (error) {
        backgroundLogger.error('Extension initialization failed', { error: error.message });
    }
});

chrome.runtime.onStartup.addListener(async () => {
    backgroundLogger.info('Extension startup');
    
    try {
        await state.initialize();
    } catch (error) {
        backgroundLogger.error('Extension startup failed', { error: error.message });
    }
});

// Tab-Listener mit robuster Fehlerbehandlung
chrome.tabs.onActivated.addListener((activeInfo) => {
    updateIcon(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
        updateIcon(tabId);
    }
});

// Tabs aus Cache entfernen, wenn sie geschlossen werden
chrome.tabs.onRemoved.addListener((tabId) => {
    state.tabIconCache.delete(tabId);
});

// Sofort initialisieren, falls der Service Worker bereits läuft
(async () => {
    try {
        await state.initialize();
    } catch (error) {
        backgroundLogger.error('Initial state initialization failed', { error: error.message });
    }
})();
