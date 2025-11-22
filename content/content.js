/**
 * @file Content script for Pagy Blocker - status updates and monitoring.
 * @version 11.2
 */

import { contentLogger } from '../core/logger.js';
import { isExtensionContextValid, debounce } from '../core/utilities.js';

/**
 * Manages the content script's state and interactions.
 */
class PagyContentScript {
    /**
     * Constructs a new PagyContentScript instance.
     */
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

    /**
     * Initializes the content script.
     */
    init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', this.debouncedInitialize, { once: true });
        } else {
            this.debouncedInitialize();
        }
    }

    /**
     * Sets up event listeners for messages and visibility changes.
     */
    setupEventListeners() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true;
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && !this.state.isInitialized) {
                this.debouncedInitialize();
            }
        });
    }

    /**
     * Initializes the content script by getting the state from the background script.
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            if (!isExtensionContextValid()) {
                contentLogger.debug('Extension context invalid, skipping initialization');
                return;
            }

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
            if (error.message.includes('Extension context invalid') ||
                error.message.includes('Timeout') ||
                error.message.includes('message port closed')) {
                contentLogger.debug('Extension context lost or timeout during initialization');
                this.updateState({ isPaused: false, domain: null });
            } else {
                contentLogger.warn('Failed to initialize content script', { error: error.message });
                this.updateState({ isPaused: false, domain: null });
            }
        }
    }

    /**
     * Updates the state of the content script.
     * @param {object} newState - The new state to apply.
     */
    updateState(newState) {
        const wasChanged = this.state.isPaused !== newState.isPaused;

        this.state.isPaused = Boolean(newState.isPaused);
        this.state.domain = newState.domain || null;

        if (wasChanged) {
            this.onStateChange();
        }
    }

    /**
     * Handles state changes.
     */
    onStateChange() {
        const status = this.state.isPaused ? 'disabled' : 'enabled';
        contentLogger.info(`Pagy Blocker ${status} for this domain`, {
            domain: this.state.domain
        });

        this.dispatchStatusEvent();
    }

    /**
     * Dispatches a custom event with the current state.
     */
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

    /**
     * Handles incoming messages from the background script.
     * @param {object} message - The message object.
     * @param {object} sender - The sender of the message.
     * @param {Function} sendResponse - The function to call to send a response.
     */
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

    /**
     * Handles the 'updatePauseState' command.
     * @param {object} message - The message object.
     * @param {Function} sendResponse - The function to call to send a response.
     */
    handleUpdatePauseState(message, sendResponse) {
        const newState = {
            isPaused: Boolean(message.isPaused),
            domain: this.state.domain
        };

        this.updateState(newState);
        sendResponse({ success: true });
    }

    /**
     * Handles the 'getContentState' command.
     * @param {Function} sendResponse - The function to call to send a response.
     */
    handleGetContentState(sendResponse) {
        sendResponse({
            isPaused: this.state.isPaused,
            domain: this.state.domain,
            isInitialized: this.state.isInitialized
        });
    }

    /**
     * Reports performance metrics.
     */
    reportPerformance() {
        if (typeof performance !== 'undefined' && performance.memory) {
            const memory = {
                used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
                total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)
            };

            contentLogger.debug('Memory usage', memory);
        }
    }

    /**
     * Cleans up the content script.
     */
    destroy() {
        this.state.isInitialized = false;

        if (this.debouncedInitialize?.cancel) {
            this.debouncedInitialize.cancel();
        }

        contentLogger.debug('Content script destroyed');
    }
}

const pagyContent = new PagyContentScript();

window.addEventListener('beforeunload', () => {
    pagyContent.destroy();
});

window.pagyContent = pagyContent;
