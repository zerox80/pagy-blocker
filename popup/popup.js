/**
 * @file Popup UI for Pagy Blocker.
 * @version 11.2
 */

import { EXTENSION_CONFIG } from '../core/config.js';
import { popupLogger } from '../core/logger.js';
import { debounce, sanitizeInput, isValidDomain, isExtensionContextValid } from '../core/utilities.js';

/**
 * Manages the popup UI and its interactions.
 */
class PagyPopup {
    /**
     * Constructs a new PagyPopup instance.
     */
    constructor() {
        this.elements = {
            enableSwitch: document.getElementById('enable-switch'),
            statusText: document.getElementById('status-text'),
            domainText: document.getElementById('domain-text'),
            filterCountEl: document.getElementById('filter-count'),
            statsEl: document.getElementById('stats'),
            blockedCountEl: document.getElementById('blocked-count'),
            runtimeDisplayEl: document.getElementById('runtime-display'),
            versionTextEl: document.getElementById('version-text')
        };

        this.state = {
            currentDomain: null,
            isUpdating: false,
            retryCount: 0
        };

        this.debouncedToggle = debounce(this.handleToggle.bind(this), 300);
        this.init();
    }

    /**
     * Initializes the popup.
     */
    init() {
        try {
            if (this.elements.versionTextEl) {
                this.elements.versionTextEl.textContent = `v${EXTENSION_CONFIG.VERSION}`;
            }
            this.validateElements();
            this.setupEventListeners();
            this.updateUI();
        } catch (error) {
            popupLogger.error('Failed to initialize popup', { error: error.message });
            this.showError('Initialization Error');
        }
    }

    /**
     * Validates that all required DOM elements are present.
     * @throws {Error} If a required element is not found.
     */
    validateElements() {
        for (const [name, element] of Object.entries(this.elements)) {
            if (!element) {
                throw new Error(`Required element not found: ${name}`);
            }
        }
    }

    /**
     * Sets up event listeners for the popup.
     */
    setupEventListeners() {
        this.elements.enableSwitch.addEventListener('change', this.debouncedToggle);

        this._onWindowFocus = () => {
            if (!this.state.isUpdating) {
                this.updateUI();
            }
        };
        window.addEventListener('focus', this._onWindowFocus);
    }

    /**
     * Updates the UI with data from the background script.
     * @returns {Promise<void>}
     */
    async updateUI() {
        const maxRetries = 3;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (!isExtensionContextValid()) {
                    throw new Error('Extension context invalid');
                }

                const data = await Promise.race([
                    chrome.runtime.sendMessage({ command: 'getPopupData' }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
                ]);

                if (!data) {
                    throw new Error('No data received from background script');
                }

                if (data.error) {
                    throw new Error(data.error);
                }

                this.renderUI(data);
                this.state.retryCount = 0;
                popupLogger.debug('UI updated successfully', { domain: data.domain });
                return;

            } catch (error) {
                popupLogger.warn(`UI update attempt ${attempt} failed`, { error: error.message });

                if (attempt === maxRetries) {
                    this.showError('Error loading data');
                    popupLogger.error('All UI update attempts failed', { error: error.message });
                } else {
                    await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                }
            }
        }
    }

    /**
     * Renders the UI with the provided data.
     * @param {object} data - The data to render.
     */
    renderUI(data) {
        const { isPaused, domain, filterCount } = data;
        this.state.currentDomain = domain;

        if (domain && isValidDomain(domain)) {
            this.updateForValidDomain(domain, isPaused);
        } else {
            this.updateForInvalidDomain();
        }

        this.updateFilterCount(filterCount);

        if (data.stats) {
            this.updateStats(data.stats);
        }
    }

    /**
     * Updates the UI for a valid domain.
     * @param {string} domain - The domain to update for.
     * @param {boolean} isPaused - Whether the blocker is paused for the domain.
     */
    updateForValidDomain(domain, isPaused) {
        this.elements.enableSwitch.disabled = false;
        this.elements.enableSwitch.checked = !isPaused;
        this.elements.statusText.textContent = isPaused ? 'Disabled' : 'Active';
        this.elements.domainText.textContent = sanitizeInput(domain);

        const statusBadge = this.elements.statusText.closest('.status-badge');
        if (statusBadge) {
            statusBadge.className = 'status-badge ' + (isPaused ? 'status-disabled' : 'status-active');
        }
    }

    /**
     * Updates the UI for an invalid domain.
     */
    updateForInvalidDomain() {
        this.elements.enableSwitch.disabled = true;
        this.elements.enableSwitch.checked = false;
        this.elements.statusText.textContent = 'No valid website';
        this.elements.domainText.textContent = 'Not available';

        const statusBadge = this.elements.statusText.closest('.status-badge');
        if (statusBadge) {
            statusBadge.className = 'status-badge status-neutral';
        }
    }

    /**
     * Updates the filter count in the UI.
     * @param {number} filterCount - The number of filters.
     */
    updateFilterCount(filterCount) {
        const displayCount = typeof filterCount === 'number'
            ? filterCount.toLocaleString()
            : 'N/A';
        this.elements.filterCountEl.textContent = displayCount;
    }

    /**
     * Updates the stats in the UI.
     * @param {object} stats - The stats to display.
     */
    updateStats(stats) {
        const { initialized, runtime, blockedRequests } = stats;

        if (initialized) {
            if (this.elements.blockedCountEl) {
                const blockedCount = blockedRequests || 0;
                this.elements.blockedCountEl.textContent = blockedCount.toLocaleString();

                this.elements.blockedCountEl.classList.remove('bump');
                void this.elements.blockedCountEl.offsetWidth;
                this.elements.blockedCountEl.classList.add('bump');
            }

            if (this.elements.runtimeDisplayEl) {
                const runtimeSeconds = Math.floor(runtime / 1000);
                const runtimeDisplay = runtimeSeconds < 60 ?
                    `${runtimeSeconds}s` :
                    runtimeSeconds < 3600 ?
                        `${Math.floor(runtimeSeconds / 60)}m` :
                        `${Math.floor(runtimeSeconds / 3600)}h`;

                this.elements.runtimeDisplayEl.textContent = runtimeDisplay;
            }

            if (this.elements.statsEl && blockedRequests > 0) {
                this.elements.statsEl.innerHTML = `
                    <div class="detailed-info">
                        <small class="detail-muted">⚡ Session active for ${Math.floor(runtime / 60000)}min</small>
                    </div>
                `;
                this.elements.statsEl.classList.add('is-visible');
            }
        }
    }

    /**
     * Handles the toggle switch change event.
     * @returns {Promise<void>}
     */
    async handleToggle() {
        if (!this.state.currentDomain || this.state.isUpdating) {
            popupLogger.debug('Toggle ignored', {
                domain: this.state.currentDomain,
                isUpdating: this.state.isUpdating
            });
            return;
        }

        if (!isValidDomain(this.state.currentDomain)) {
            popupLogger.error('Invalid domain for toggle', { domain: this.state.currentDomain });
            return;
        }

        this.state.isUpdating = true;
        const originalState = this.captureCurrentState();

        try {
            this.setLoadingState();

            const response = await Promise.race([
                chrome.runtime.sendMessage({
                    command: 'toggleDomainState',
                    domain: this.state.currentDomain,
                    isPaused: !this.elements.enableSwitch.checked
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000))
            ]);

            if (response?.error) {
                throw new Error(response.error);
            }

            popupLogger.info('Domain state toggled successfully', {
                domain: this.state.currentDomain,
                newState: !this.elements.enableSwitch.checked ? 'disabled' : 'enabled'
            });

            try {
                window.close();
            } catch (_) { }

        } catch (error) {
            popupLogger.error('Failed to toggle domain state', {
                domain: this.state.currentDomain,
                error: error.message
            });

            this.restoreState(originalState);
            this.showError('Error changing status');

            setTimeout(() => {
                if (!this.state.isUpdating) {
                    this.updateUI();
                }
            }, 2000);
        } finally {
            this.state.isUpdating = false;
            this.elements.enableSwitch.disabled = false;
        }
    }

    /**
     * Captures the current state of the UI.
     * @returns {object} The current UI state.
     */
    captureCurrentState() {
        return {
            statusText: this.elements.statusText.textContent,
            statusClass: this.elements.statusText.className,
            switchEnabled: !this.elements.enableSwitch.disabled,
            switchChecked: this.elements.enableSwitch.checked
        };
    }

    /**
     * Sets the UI to a loading state.
     */
    setLoadingState() {
        this.elements.statusText.textContent = 'Changing...';
        this.elements.statusText.className = 'status-label status-updating';
        this.elements.enableSwitch.disabled = true;
    }

    /**
     * Restores the UI to a previous state.
     * @param {object} state - The state to restore to.
     */
    restoreState(state) {
        this.elements.statusText.textContent = state.statusText;
        this.elements.statusText.className = state.statusClass;
        this.elements.enableSwitch.disabled = !state.switchEnabled;
        this.elements.enableSwitch.checked = state.switchChecked;
        this.state.isUpdating = false;
    }

    /**
     * Displays an error message in the UI.
     * @param {string} message - The error message to display.
     */
    showError(message) {
        this.elements.statusText.textContent = sanitizeInput(message);
        this.elements.statusText.className = 'status-label status-error';
        this.elements.domainText.textContent = '';
        this.elements.filterCountEl.textContent = 'N/A';
        this.elements.enableSwitch.disabled = true;
        this.elements.enableSwitch.checked = false;
        this.state.isUpdating = false;
    }

    /**
     * Cleans up resources to prevent memory leaks.
     */
    destroy() {
        if (this.debouncedToggle) {
            this.debouncedToggle.cancel?.();
        }

        this.elements.enableSwitch?.removeEventListener('change', this.debouncedToggle);
        if (this._onWindowFocus) {
            window.removeEventListener('focus', this._onWindowFocus);
        }

        popupLogger.debug('Popup destroyed');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        window.pagyPopup = new PagyPopup();
    } catch (error) {
        console.error('[Pagy Popup] Failed to initialize:', error);
    }
});

window.addEventListener('beforeunload', () => {
    if (window.pagyPopup) {
        window.pagyPopup.destroy();
    }
});
