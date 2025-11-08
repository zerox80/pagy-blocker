/**
 * @file Service Worker for Pagy Blocker - Domain-based filter control.
 * @version 11.1
 */

import { EXTENSION_CONFIG, RULE_CONFIG } from '../core/config.js';
import { backgroundLogger } from '../core/logger.js';
import { debounce, PerformanceTimer } from '../core/utilities.js';
import { blockerEngine } from '../core/blocker-engine.js';

/**
 * Pre-calculated resource types for dynamic allow rules (excluding main_frame).
 * @const {string[]}
 */
const DYNAMIC_RESOURCE_TYPES = (RULE_CONFIG.RESOURCE_TYPES || []).filter(t => t !== 'main_frame');
/**
 * Set of pre-calculated resource types for efficient lookups.
 * @const {Set<string>}
 */
const DYNAMIC_RESOURCE_TYPES_SET = new Set(DYNAMIC_RESOURCE_TYPES);

/**
 * Set of allowed message commands.
 * @const {Set<string>}
 */
const ALLOWED_COMMANDS = new Set(['getPopupData', 'getState', 'toggleDomainState']);

/**
 * Checks if a message sender is trusted.
 * @param {object} sender - The sender of the message.
 * @returns {boolean} True if the sender is trusted, false otherwise.
 */
function isTrustedSender(sender) {
    try {
        return !!(sender && (sender.id === chrome.runtime.id || sender.tab));
    } catch (_) {
        return false;
    }
}

/**
 * Validates the payload for a toggle command.
 * @param {object} message - The message payload to validate.
 * @throws {Error} If the payload is invalid.
 */
function validateTogglePayload(message) {
    if (typeof message !== 'object' || message === null) {
        throw new Error('Invalid message payload');
    }
    const { domain, isPaused } = message;
    if (typeof domain !== 'string' || !blockerEngine.isValidDomain(domain)) {
        throw new Error('Invalid domain provided');
    }
    if (typeof isPaused !== 'boolean') {
        throw new Error('Invalid isPaused flag');
    }
}

/**
 * Debounce time for icon updates in milliseconds.
 * @const {number}
 */
const ICON_DEBOUNCE_MS = Math.min(EXTENSION_CONFIG.PERFORMANCE?.DEBOUNCE_DELAY ?? 150, 150);

/**
 * Manages the state of the background script.
 */
class BackgroundState {
    /**
     * Constructs a new BackgroundState instance.
     */
    constructor() {
        this.precompiledFilterCount = 0;
        this.isInitialized = false;
        this.activeOperations = new Set();
        this.iconUpdateQueue = new Map();
        this.tabIconCache = new Map(); // tabId -> { domain, iconPath, badgeText }
    }

    /**
     * Initializes the background state.
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.isInitialized) return;

        const timer = new PerformanceTimer('Background initialization');
        
        try {
            await blockerEngine.initialize();
            
            await this.initializeFilterCount();
            await this.initializeStorage();
            await this.updateDynamicRules();
            
            this.isInitialized = true;
            backgroundLogger.info('Background script initialized successfully');
            
            const stats = await blockerEngine.getStats();
            backgroundLogger.info('Blocker stats:', stats);
        } catch (error) {
            backgroundLogger.error('Failed to initialize background script', { error: error.message });
            throw error;
        } finally {
            timer.end();
        }
    }

    /**
     * Initializes the filter count from the pre-compiled rules.
     * @returns {Promise<void>}
     */
    async initializeFilterCount() {
        try {
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
        try {
            const filterRules = await blockerEngine.loadFilterRules();
            this.precompiledFilterCount = Array.isArray(filterRules) ? filterRules.length : 0;
            backgroundLogger.info('Filter count initialized from TXT file', { count: this.precompiledFilterCount });
        } catch (error) {
            backgroundLogger.error('Failed to initialize filter count', { error: error.message });
            this.precompiledFilterCount = 0;
        }
    }

    /**
     * Initializes the storage for disabled domains.
     * @returns {Promise<void>}
     */
    async initializeStorage() {
        try {
            const disabledDomains = await blockerEngine.getDisabledDomains();
            backgroundLogger.debug('Storage initialized', { disabledDomainsCount: disabledDomains.length });
        } catch (error) {
            backgroundLogger.error('Failed to initialize storage', { error: error.message });
            await blockerEngine.setDisabledDomains([]);
        }
    }
}

const state = new BackgroundState();

/**
 * Manages dynamic rules in a diff-based manner to avoid full replacement.
 * @returns {Promise<void>}
 */
const updateDynamicRules = async () => {
    const operationId = 'updateDynamicRules';
    
    if (state.activeOperations.has(operationId)) {
        backgroundLogger.debug('Dynamic rules update already in progress');
        return;
    }
    
    state.activeOperations.add(operationId);
    const timer = new PerformanceTimer('Update dynamic rules');
    
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

        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const domainToRule = new Map();
        const usedIds = new Set();

        for (const rule of existingRules) {
            usedIds.add(rule.id);
            const initiators = rule?.condition?.initiatorDomains;
            const actionType = rule?.action?.type;
            const priority = rule?.priority;
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

        const dynamicResourceTypes = DYNAMIC_RESOURCE_TYPES;

        const rulesToRemove = [];
        for (const domain of existing) {
            if (!desired.has(domain)) {
                rulesToRemove.push(domainToRule.get(domain).id);
            } else {
                const rule = domainToRule.get(domain);
                const rt = Array.isArray(rule?.condition?.resourceTypes) ? rule.condition.resourceTypes : [];
                const rtSet = new Set(rt);
                const sameRT = rtSet.size === DYNAMIC_RESOURCE_TYPES_SET.size && [...DYNAMIC_RESOURCE_TYPES_SET].every(t => rtSet.has(t));
                if (!sameRT) {
                    rulesToRemove.push(rule.id);
                    existing.delete(domain);
                }
            }
        }

        const rulesToAdd = [];

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

state.updateDynamicRules = updateDynamicRules;

/**
 * Updates the extension icon with debouncing.
 * @param {number} tabId - The ID of the tab to update the icon for.
 * @returns {Promise<void>}
 */
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

        if (!domain) {
            await chrome.action.setIcon({ path: EXTENSION_CONFIG.ICONS.DEFAULT, tabId });
            return;
        }

        const isPausedForDomain = await blockerEngine.isDomainDisabled(domain);
        const iconPath = isPausedForDomain ? EXTENSION_CONFIG.ICONS.DISABLED : EXTENSION_CONFIG.ICONS.DEFAULT;
        const badgeText = isPausedForDomain ? '⏸' : '';
        const badgeBg = isPausedForDomain ? [120, 120, 120, 255] : [0, 0, 0, 0];

        const prev = state.tabIconCache.get(tabId);
        if (!prev || prev.domain !== domain || prev.iconPath !== iconPath) {
            await chrome.action.setIcon({ path: iconPath, tabId });
        }
        if (!prev || prev.badgeText !== badgeText) {
            await chrome.action.setBadgeText({ text: badgeText, tabId });
            await chrome.action.setBadgeBackgroundColor({ color: badgeBg, tabId });
        }

        state.tabIconCache.set(tabId, { domain, iconPath, badgeText });
        
        backgroundLogger.debug('Icon updated', { tabId, domain, isPaused: isPausedForDomain });
        
    } catch (error) {
        if (!error.message.includes('No tab with id')) {
            backgroundLogger.error('Failed to update icon', { tabId, error: error.message });
        }
    } finally {
        state.activeOperations.delete(operationId);
    }
}, ICON_DEBOUNCE_MS);

/**
 * Handles incoming messages with improved error handling.
 */
class MessageHandler {
    /**
     * Handles the 'getPopupData' command.
     * @returns {Promise<object>} A promise that resolves to the popup data.
     */
    static async handleGetPopupData() {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const domain = blockerEngine.getDomainFromUrl(activeTab?.url);
        const isPaused = domain ? await blockerEngine.isDomainDisabled(domain) : false;
        
        const stats = await blockerEngine.getStats();
        
        return {
            isPaused,
            domain,
            filterCount: state.precompiledFilterCount,
            stats
        };
    }

    /**
     * Handles the 'getState' command.
     * @param {object} sender - The sender of the message.
     * @returns {Promise<object>} A promise that resolves to the state data.
     */
    static async handleGetState(sender) {
        const domain = blockerEngine.getDomainFromUrl(sender.tab?.url);
        if (!domain) {
            return { isPaused: false };
        }
        
        const isPaused = await blockerEngine.isDomainDisabled(domain);
        return { isPaused, domain };
    }

    /**
     * Handles the 'toggleDomainState' command.
     * @param {object} options - The options for toggling the domain state.
     * @param {string} options.domain - The domain to toggle.
     * @param {boolean} options.isPaused - The new paused state.
     * @returns {Promise<object>} A promise that resolves to an object indicating success.
     */
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
                        // Tab may no longer exist or is still loading.
                    }
                });

            await Promise.allSettled(notificationPromises);

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

            if (!ALLOWED_COMMANDS.has(message?.command) || !isTrustedSender(sender)) {
                throw new Error('Untrusted or unknown message');
            }

            switch (message.command) {
                case 'getPopupData':
                    result = await MessageHandler.handleGetPopupData();
                    break;
                case 'getState':
                    result = await MessageHandler.handleGetState(sender);
                    break;
                case 'toggleDomainState':
                    const safeMessage = {
                        domain: String(message.domain || ''),
                        isPaused: Boolean(message.isPaused)
                    };
                    validateTogglePayload(safeMessage);
                    result = await MessageHandler.handleToggleDomainState(safeMessage);
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

chrome.tabs.onActivated.addListener((activeInfo) => {
    updateIcon(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
        updateIcon(tabId);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    state.tabIconCache.delete(tabId);
});

(async () => {
    try {
        await state.initialize();
    } catch (error) {
        backgroundLogger.error('Initial state initialization failed', { error: error.message });
    }
})();
