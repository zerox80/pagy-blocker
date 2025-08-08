/**
 * @file background.js
 * @description Service Worker für Pagy Blocker - Domain-basierte Filtersteuerung
 * @version 9.0.0
 */

import { EXTENSION_CONFIG, RULE_CONFIG } from '../core/config.js';
import { backgroundLogger } from '../core/logger.js';
import { debounce, PerformanceTimer } from '../core/utilities.js';
import { blockerEngine } from '../core/blocker-engine.js';

// State management
class BackgroundState {
    constructor() {
        this.precompiledFilterCount = 0;
        this.isInitialized = false;
        this.activeOperations = new Set();
        this.iconUpdateQueue = new Map();
    }

    async initialize() {
        if (this.isInitialized) return;
        
        const timer = new PerformanceTimer('Background initialization');
        
        try {
            // Initialize blocker engine
            await blockerEngine.initialize();
            
            await this.initializeFilterCount();
            await this.initializeStorage();
            await this.updateDynamicRules();
            
            this.isInitialized = true;
            backgroundLogger.info('Background script initialized successfully');
            
            // Log performance stats
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
            // Prefer the precompiled JSON ruleset (this is what DNR actually uses from manifest)
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
        // Fallback to TXT count
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
            // Initialize disabled domains storage (no-op if unavailable)
            const disabledDomains = await blockerEngine.getDisabledDomains();
            backgroundLogger.debug('Storage initialized', { disabledDomainsCount: disabledDomains.length });
        } catch (error) {
            backgroundLogger.error('Failed to initialize storage', { error: error.message });
            // Initialize with empty array if storage fails
            await blockerEngine.setDisabledDomains([]);
        }
    }
}

const state = new BackgroundState();

// Dynamic rules management
const updateDynamicRules = async () => {
    const operationId = 'updateDynamicRules';
    
    // Prevent concurrent operations
    if (state.activeOperations.has(operationId)) {
        backgroundLogger.debug('Dynamic rules update already in progress');
        return;
    }
    
    state.activeOperations.add(operationId);
    const timer = new PerformanceTimer('Update dynamic rules');
    
    try {
        const disabledDomains = await blockerEngine.getDisabledDomains();
        
        // Validate domains
        const validDomains = disabledDomains
            .filter(domain => blockerEngine.isValidDomain(domain))
            .slice(0, EXTENSION_CONFIG.LIMITS.MAX_DYNAMIC_RULES);

        if (validDomains.length !== disabledDomains.length) {
            backgroundLogger.warn('Invalid domains filtered out', { 
                original: disabledDomains.length, 
                valid: validDomains.length 
            });
        }

        // Always keep dynamic rules in a clean state
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const rulesToRemove = existingRules.map(rule => rule.id);

        const rulesToAdd = validDomains.map((domain, index) => ({
            id: index + 1,
            priority: EXTENSION_CONFIG.PRIORITIES.ALLOW_RULE,
            action: { type: RULE_CONFIG.ACTIONS.ALLOW },
            condition: { 
                requestDomains: [domain], 
                resourceTypes: RULE_CONFIG.RESOURCE_TYPES
            }
        }));

        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: rulesToRemove,
            addRules: rulesToAdd
        });

        // Note: Removed automatic tab reload to prevent unwanted page reloads.
        // The extension will work without forcing a reload - content scripts
        // and dynamic rules will handle state changes automatically.

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

// Add updateDynamicRules to state class
state.updateDynamicRules = updateDynamicRules;

// Icon management with debouncing
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

        // For non-web URLs use default icon
        if (!domain) {
            await chrome.action.setIcon({ path: EXTENSION_CONFIG.ICONS.DEFAULT, tabId });
            return;
        }

        const isPausedForDomain = await blockerEngine.isDomainDisabled(domain);
        const iconPath = isPausedForDomain ? EXTENSION_CONFIG.ICONS.DISABLED : EXTENSION_CONFIG.ICONS.DEFAULT;
        
        await chrome.action.setIcon({ path: iconPath, tabId });
        
        // Badge text for additional information
        const badgeText = isPausedForDomain ? '⏸' : '';
        await chrome.action.setBadgeText({ text: badgeText, tabId });
        
        backgroundLogger.debug('Icon updated', { tabId, domain, isPaused: isPausedForDomain });
        
    } catch (error) {
        // Tab might not exist anymore - normal during fast tab switching
        if (!error.message.includes('No tab with id')) {
            backgroundLogger.error('Failed to update icon', { tabId, error: error.message });
        }
    } finally {
        state.activeOperations.delete(operationId);
    }
}, 100); // Debounce icon updates

// Message handler with improved error handling
class MessageHandler {
    static async handleGetPopupData() {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const domain = blockerEngine.getDomainFromUrl(activeTab?.url);
        const isPaused = domain ? await blockerEngine.isDomainDisabled(domain) : false;
        
        // Get enhanced blocking statistics
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

            // Notify all content scripts about the state change
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
                        // Tab might not exist anymore or be loading
                    }
                });

            await Promise.allSettled(notificationPromises);

            // Reload only the currently active tab in the current window
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
                // Log detailed error information
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

// Event listeners
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

// Tab event listeners with proper error handling
chrome.tabs.onActivated.addListener((activeInfo) => {
    updateIcon(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
        updateIcon(tabId);
    }
});

// Initialize immediately if service worker is already running
(async () => {
    try {
        await state.initialize();
    } catch (error) {
        backgroundLogger.error('Initial state initialization failed', { error: error.message });
    }
})();
