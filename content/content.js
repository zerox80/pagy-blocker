/**
 * @file content.js
 * @description Content Script für Pagy Blocker - Status-Updates und Monitoring
 * @version 11.1
 */

import { contentLogger } from '../core/logger.js';
import { isExtensionContextValid, debounce } from '../core/utilities.js';

class PagyContentScript {
    constructor() {
        this.state = {
            isPaused: false,
            domain: null,
            isInitialized: false
        };
        
        this.debouncedInitialize = debounce(this.initialize.bind(this), 100);
        this.setupEventListeners();
        this.init();
    }

    init() {
        // Initialize based on document ready state
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', this.debouncedInitialize, { once: true });
        } else {
            this.debouncedInitialize();
        }
    }

    setupEventListeners() {
        // Listen for messages from background script
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true; // Keep message channel open for async response
        });

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !this.state.isInitialized) {
                this.debouncedInitialize();
            }
        });
    }

    async initialize() {
        try {
            if (!isExtensionContextValid()) {
                contentLogger.debug('Extension context invalid, skipping initialization');
                return;
            }

            // Try to get state from background with timeout
            const state = await Promise.race([
                chrome.runtime.sendMessage({ command: 'getState' }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 2000)
                )
            ]);
            
            if (state?.error) {
                throw new Error(state.error);
            }

            this.updateState(state || { isPaused: false, domain: null });
            this.state.isInitialized = true;
            
            contentLogger.debug('Content script initialized', { 
                domain: this.state.domain,
                isPaused: this.state.isPaused 
            });

        } catch (error) {
            // Extension context might be lost during page reload - this is normal
            if (error.message.includes('Extension context invalid') || 
                error.message.includes('Timeout') ||
                error.message.includes('message port closed')) {
                contentLogger.debug('Extension context lost or timeout during initialization');
                // Set safe defaults
                this.updateState({ isPaused: false, domain: null });
            } else {
                contentLogger.warn('Failed to initialize content script', { error: error.message });
                // Set safe defaults on any error
                this.updateState({ isPaused: false, domain: null });
            }
        }
    }

    updateState(newState) {
        const wasChanged = this.state.isPaused !== newState.isPaused;
        
        this.state.isPaused = Boolean(newState.isPaused);
        this.state.domain = newState.domain || null;

        if (wasChanged) {
            this.onStateChange();
        }
    }

    onStateChange() {
        const status = this.state.isPaused ? 'deaktiviert' : 'aktiviert';
        contentLogger.info(`Pagy Blocker ${status} für diese Domain`, { 
            domain: this.state.domain 
        });

        // Dispatch custom event for potential integrations
        this.dispatchStatusEvent();
    }

    dispatchStatusEvent() {
        try {
            const event = new CustomEvent('pagyBlockerStateChange', {
                detail: {
                    isPaused: this.state.isPaused,
                    domain: this.state.domain
                }
            });
            
            document.dispatchEvent(event);
        } catch (error) {
            contentLogger.warn('Failed to dispatch status event', { error: error.message });
        }
    }

    handleMessage(message, sender, sendResponse) {
        try {
            if (!isExtensionContextValid()) {
                contentLogger.debug('Extension context invalid, ignoring message');
                sendResponse({ error: 'Extension context invalid' });
                return;
            }

            switch (message.command) {
                case 'updatePauseState':
                    this.handleUpdatePauseState(message, sendResponse);
                    break;
                    
                case 'getContentState':
                    this.handleGetContentState(sendResponse);
                    break;
                    
                default:
                    contentLogger.debug('Unknown message command', { command: message.command });
                    sendResponse({ error: 'Unknown command' });
            }
        } catch (error) {
            contentLogger.warn('Error handling message', { 
                command: message.command, 
                error: error.message 
            });
            sendResponse({ error: error.message });
        }
    }

    handleUpdatePauseState(message, sendResponse) {
        const newState = {
            isPaused: Boolean(message.isPaused),
            domain: this.state.domain
        };
        
        this.updateState(newState);
        sendResponse({ success: true });
    }

    handleGetContentState(sendResponse) {
        sendResponse({
            isPaused: this.state.isPaused,
            domain: this.state.domain,
            isInitialized: this.state.isInitialized
        });
    }

    // Performance monitoring (optional)
    reportPerformance() {
        if (typeof performance !== 'undefined' && performance.memory) {
            const memory = {
                used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
                total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)
            };
            
            contentLogger.debug('Memory usage', memory);
        }
    }

    // Cleanup method
    destroy() {
        this.state.isInitialized = false;
        
        // Cancel any pending debounced calls
        if (this.debouncedInitialize?.cancel) {
            this.debouncedInitialize.cancel();
        }
        
        contentLogger.debug('Content script destroyed');
    }
}

// Initialize content script
const pagyContent = new PagyContentScript();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    pagyContent.destroy();
});

// Export for testing/debugging
window.pagyContent = pagyContent;
