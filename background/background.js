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

        const operationId = 'initialize';
        if (this.activeOperations.has(operationId)) {
            backgroundLogger.debug('Initialization already in progress.');
            return;
        }
        this.activeOperations.add(operationId);

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
            throw error; // Fehler weitergeben, damit ensureInitialized ihn fangen kann
        } finally {
            timer.end();
            this.activeOperations.delete(operationId);
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

// --- Robuste Initialisierungslogik ---
let initializationPromise = null;

// Stellt sicher, dass die Initialisierung nur einmal ausgeführt wird und
// weitere Anfragen auf das Ergebnis warten.
const ensureInitialized = async () => {
    // Wenn bereits initialisiert, sofort zurückkehren.
    if (state.isInitialized) {
        return;
    }
    // Wenn die Initialisierung bereits läuft, auf das Promise warten.
    if (initializationPromise) {
        return initializationPromise;
    }

    // Initialisierung starten und das Promise speichern.
    initializationPromise = (async () => {
        try {
            await state.initialize();
        } catch (error) {
            backgroundLogger.error('Initialization failed, will retry on next event.', { error: error?.message });
            // Promise zurücksetzen, damit ein erneuter Versuch gestartet werden kann.
            initializationPromise = null;
            // Fehler weiterwerfen, damit der Aufrufer darauf reagieren kann.
            throw error;
        }
    })();

    return initializationPromise;
};


/**
 * Liest die aktuell vom Add-on verwalteten dynamischen Regeln.
 * @returns {Promise<{existingRulesMap: Map<string, object>, maxId: number}>}
 */
const getManagedDynamicRules = async () => {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRulesMap = new Map();
    let maxId = 0;

    for (const rule of existingRules) {
        maxId = Math.max(maxId, rule.id);
        const { initiatorDomains } = rule.condition;
        const { type } = rule.action;

        // Nur unsere eigenen "allow" Regeln berücksichtigen
        if (
            type === RULE_CONFIG.ACTIONS.ALLOW &&
            rule.priority === EXTENSION_CONFIG.PRIORITIES.ALLOW_RULE &&
            Array.isArray(initiatorDomains) &&
            initiatorDomains.length === 1
        ) {
            existingRulesMap.set(initiatorDomains[0], rule);
        }
    }
    return { existingRulesMap, maxId };
};

/**
 * Erstellt eine neue dynamische "allow"-Regel.
 * @param {string} domain - Die Domain für die Regel.
 * @param {number} id - Die eindeutige ID für die Regel.
 * @returns {object} Das Regelobjekt.
 */
const createNewAllowRule = (domain, id) => {
    const dynamicResourceTypes = RULE_CONFIG.RESOURCE_TYPES.filter(t => t !== 'main_frame');
    return {
        id,
        priority: EXTENSION_CONFIG.PRIORITIES.ALLOW_RULE,
        action: { type: RULE_CONFIG.ACTIONS.ALLOW },
        condition: {
            initiatorDomains: [domain],
            resourceTypes: dynamicResourceTypes,
        },
    };
};


/**
 * Berechnet die Änderungen (hinzufügen/entfernen) für die dynamischen Regeln.
 * @param {string[]} desiredDomains - Liste der Domains, die pausiert sein sollen.
 * @param {Map<string, object>} existingRulesMap - Map der existierenden Regeln.
 * @param {number} maxId - Die höchste aktuell verwendete Regel-ID.
 * @returns {{rulesToAdd: object[], rulesToRemove: number[]}}
 */
const calculateRuleChanges = (desiredDomains, existingRulesMap, maxId) => {
    const rulesToRemove = [];
    const rulesToAdd = [];
    let nextId = maxId + 1;

    const desiredSet = new Set(desiredDomains);
    const dynamicResourceTypes = RULE_CONFIG.RESOURCE_TYPES.filter(t => t !== 'main_frame');

    // Prüfen, welche existierenden Regeln entfernt oder aktualisiert werden müssen
    for (const [domain, rule] of existingRulesMap.entries()) {
        const isStillDesired = desiredSet.has(domain);
        const currentResourceTypes = rule.condition.resourceTypes || [];
        const areResourceTypesEqual =
            currentResourceTypes.length === dynamicResourceTypes.length &&
            currentResourceTypes.every((t, i) => t === dynamicResourceTypes[i]);

        if (!isStillDesired || !areResourceTypesEqual) {
            // Regel wird nicht mehr gebraucht oder ist veraltet -> entfernen
            rulesToRemove.push(rule.id);
        }
    }

    // Prüfen, welche neuen Regeln hinzugefügt werden müssen
    for (const domain of desiredDomains) {
        const existingRule = existingRulesMap.get(domain);
        if (!existingRule) {
            // Neue Domain -> Regel hinzufügen
            rulesToAdd.push(createNewAllowRule(domain, nextId++));
        } else {
            // Existierende Domain, aber evtl. veraltet (und wurde oben zum Entfernen markiert)
            const currentResourceTypes = existingRule.condition.resourceTypes || [];
            const areResourceTypesEqual =
                currentResourceTypes.length === dynamicResourceTypes.length &&
                currentResourceTypes.every((t, i) => t === dynamicResourceTypes[i]);

            if (!areResourceTypesEqual) {
                // Ressourcentypen haben sich geändert -> Regel mit neuer ID neu erstellen
                rulesToAdd.push(createNewAllowRule(domain, nextId++));
            }
        }
    }

    return { rulesToAdd, rulesToRemove };
};


// Verwaltung dynamischer Regeln (Diff-basiert, vermeidet Full-Replace)
const updateDynamicRules = async () => {
    const operationId = 'updateDynamicRules';
    
    if (state.activeOperations.has(operationId)) {
        backgroundLogger.debug('Dynamic rules update already in progress');
        return;
    }
    
    state.activeOperations.add(operationId);
    const timer = new PerformanceTimer('Dynamische Regeln aktualisieren');
    
    try {
        const disabledDomains = await blockerEngine.getDisabledDomains();
        
        const validDomains = disabledDomains
            .filter(domain => blockerEngine.isValidDomain(domain))
            .slice(0, EXTENSION_CONFIG.LIMITS.MAX_DYNAMIC_RULES);

        if (validDomains.length !== disabledDomains.length) {
            backgroundLogger.warn('Invalid domains filtered out', { 
                original: disabledDomains.length, 
                valid: validDomains.length 
            });
        }

        const { existingRulesMap, maxId } = await getManagedDynamicRules();

        const { rulesToAdd, rulesToRemove } = calculateRuleChanges(
            validDomains,
            existingRulesMap,
            maxId
        );

        if (rulesToRemove.length > 0 || rulesToAdd.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: rulesToRemove,
                addRules: rulesToAdd
            });
            backgroundLogger.info('Dynamic rules updated', {
                removed: rulesToRemove.length,
                added: rulesToAdd.length
            });
        } else {
            backgroundLogger.debug('No dynamic rule changes needed.');
        }

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
const updateIcon = debounce(async (tabId, tab) => { // 'tab' ist optional
    const operationId = `updateIcon-${tabId}`;
    
    if (state.activeOperations.has(operationId)) {
        return;
    }
    
    state.activeOperations.add(operationId);
    
    try {
        await ensureInitialized(); // Warten, bis der State bereit ist

        if (!tabId || typeof tabId !== 'number') {
            backgroundLogger.error('Invalid tabId for updateIcon', { tabId });
            return;
        }

        // Tab-Informationen nur bei Bedarf abrufen
        const currentTab = tab || await chrome.tabs.get(tabId);
        const domain = blockerEngine.getDomainFromUrl(currentTab.url);

        // Für Nicht-Web-URLs das Standard-Icon verwenden
        if (!domain) {
            await chrome.action.setIcon({ path: EXTENSION_CONFIG.ICONS.DEFAULT, tabId });
            await chrome.action.setBadgeText({ text: '', tabId });
            state.tabIconCache.delete(tabId);
            return;
        }

        const isPausedForDomain = await blockerEngine.isDomainDisabled(domain);

        // Redundante Updates vermeiden, indem der Zustand vor dem Update geprüft wird.
        const prev = state.tabIconCache.get(tabId);
        if (prev && prev.domain === domain && prev.isPaused === isPausedForDomain) {
            // Zustand hat sich nicht geändert, kein Update nötig.
            backgroundLogger.debug('Icon state for tab is unchanged, skipping update', { tabId });
            return;
        }

        const iconPath = isPausedForDomain ? EXTENSION_CONFIG.ICONS.DISABLED : EXTENSION_CONFIG.ICONS.DEFAULT;
        const badgeText = isPausedForDomain ? '⏸' : '';

        // API-Aufrufe nur ausführen, wenn sich der jeweilige Wert geändert hat.
        if (!prev || prev.iconPath !== iconPath) {
            await chrome.action.setIcon({ path: iconPath, tabId });
        }
        if (!prev || prev.badgeText !== badgeText) {
            await chrome.action.setBadgeText({ text: badgeText, tabId });
        }

        // Cache mit dem neuen Zustand aktualisieren.
        state.tabIconCache.set(tabId, { domain, isPaused: isPausedForDomain, iconPath, badgeText });
        
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

        const operationId = `toggleDomain-${domain}`;
        if (state.activeOperations.has(operationId)) {
            backgroundLogger.warn('Toggle operation already in progress for this domain', { domain });
            return { success: false, reason: 'Operation already in progress' };
        }
        state.activeOperations.add(operationId);

        const timer = new PerformanceTimer(`Toggle domain ${domain}`);
        
        try {
            if (isPaused) {
                await blockerEngine.addDisabledDomain(domain);
            } else {
                await blockerEngine.removeDisabledDomain(domain);
            }

            await updateDynamicRules();

            // Alle relevanten Content Scripts über den Zustandswechsel informieren
            const tabs = await chrome.tabs.query({ url: `*://${domain}/*` });
            const notificationPromises = tabs.map(async (tab) => {
                try {
                    await chrome.tabs.sendMessage(tab.id, {
                        command: 'updatePauseState',
                        isPaused: isPaused
                    });
                } catch (e) {
                    // Tab existiert ggf. nicht mehr oder lädt gerade, das ist ok.
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
            state.activeOperations.delete(operationId);
        }
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        try {
            // Vor jeder Nachrichtenverarbeitung sicherstellen, dass die Erweiterung initialisiert ist.
            await ensureInitialized();
            
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
            // Bei Initialisierungsfehlern eine spezifische Nachricht senden.
            if (error.message.includes('Initialization failed')) {
                sendResponse({ error: 'Extension failed to initialize. Please try again.' });
            } else {
                sendResponse({ error: error.message });
            }
        }
    })();
    return true; // Asynchrone Antwort
});

// --- Ereignis-Listener ---

chrome.runtime.onInstalled.addListener(async (details) => {
    backgroundLogger.info('Extension installed/updated', { reason: details.reason });
    await ensureInitialized();
});

chrome.runtime.onStartup.addListener(async () => {
    backgroundLogger.info('Extension starting up');
    await ensureInitialized();
});

// Tab-Listener mit robuster Fehlerbehandlung
chrome.tabs.onActivated.addListener((activeInfo) => {
    updateIcon(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Icon-Update nur bei relevanter Statusänderung oder URL-Wechsel
    if (changeInfo.status === 'complete' || changeInfo.url) {
        updateIcon(tabId, tab); // Übergibt das Tab-Objekt, um chrome.tabs.get zu sparen
    }
});

// Tabs aus Cache entfernen, wenn sie geschlossen werden
chrome.tabs.onRemoved.addListener((tabId) => {
    state.tabIconCache.delete(tabId);
});
