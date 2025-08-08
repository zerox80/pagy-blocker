/**
 * @file popup.js
 * @description Popup interface for Pagy Blocker
 * @version 9.0.0
 */

import { EXTENSION_CONFIG } from '../core/config.js';
import { popupLogger } from '../core/logger.js';
import { debounce, sanitizeInput, isValidDomain, isExtensionContextValid } from '../core/utilities.js';
import { blockerEngine } from '../core/blocker-engine.js';

class PagyPopup {
    constructor() {
        this.elements = {
            enableSwitch: document.getElementById('enable-switch'),
            statusText: document.getElementById('status-text'),
            domainText: document.getElementById('domain-text'),
            filterCountEl: document.getElementById('filter-count'),
            statsEl: document.getElementById('stats'),
            blockedCountEl: document.getElementById('blocked-count'),
            runtimeDisplayEl: document.getElementById('runtime-display')
        };
        
        this.state = {
            currentDomain: null,
            isUpdating: false,
            retryCount: 0
        };
        
        this.debouncedToggle = debounce(this.handleToggle.bind(this), 300);
        this.init();
    }

    init() {
        try {
            this.validateElements();
            this.setupEventListeners();
            this.updateUI();
        } catch (error) {
            popupLogger.error('Failed to initialize popup', { error: error.message });
            this.showError('Initialisierungsfehler');
        }
    }

    validateElements() {
        for (const [name, element] of Object.entries(this.elements)) {
            if (!element) {
                throw new Error(`Required element not found: ${name}`);
            }
        }
    }

    setupEventListeners() {
        this.elements.enableSwitch.addEventListener('change', this.debouncedToggle);
        
        // Add error recovery on focus
        window.addEventListener('focus', () => {
            if (!this.state.isUpdating) {
                this.updateUI();
            }
        });
    }

    async updateUI() {
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (!isExtensionContextValid()) {
                    throw new Error('Extension context invalid');
                }

                const data = await chrome.runtime.sendMessage({ command: 'getPopupData' });
                
                if (!data) {
                    throw new Error('No data received from background script');
                }

                if (data.error) {
                    throw new Error(data.error);
                }

                this.renderUI(data);
                this.state.retryCount = 0; // Reset retry count on success
                popupLogger.debug('UI updated successfully', { domain: data.domain });
                return;
                
            } catch (error) {
                popupLogger.warn(`UI update attempt ${attempt} failed`, { error: error.message });
                
                if (attempt === maxRetries) {
                    this.showError('Fehler beim Laden der Daten');
                    popupLogger.error('All UI update attempts failed', { error: error.message });
                } else {
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                }
            }
        }
    }

    renderUI(data) {
        const { isPaused, domain, filterCount } = data;
        this.state.currentDomain = domain;

        if (domain && this.isValidDomain(domain)) {
            this.updateForValidDomain(domain, isPaused);
        } else {
            this.updateForInvalidDomain();
        }

        this.updateFilterCount(filterCount);
        
        // Show blocker statistics if available
        if (data.stats) {
            this.updateStats(data.stats);
        }
    }

    updateForValidDomain(domain, isPaused) {
        this.elements.enableSwitch.disabled = false;
        this.elements.enableSwitch.checked = !isPaused;
        this.elements.statusText.textContent = isPaused ? 'Deaktiviert' : 'Aktiv';
        this.elements.domainText.textContent = sanitizeInput(domain);
        
        // Update status badge styling
        const statusBadge = this.elements.statusText.closest('.status-badge');
        if (statusBadge) {
            statusBadge.className = 'status-badge ' + (isPaused ? 'status-disabled' : 'status-active');
        }
    }

    updateForInvalidDomain() {
        this.elements.enableSwitch.disabled = true;
        this.elements.enableSwitch.checked = false;
        this.elements.statusText.textContent = 'Keine gültige Webseite';
        this.elements.domainText.textContent = 'Nicht verfügbar';
        
        // Update status badge styling
        const statusBadge = this.elements.statusText.closest('.status-badge');
        if (statusBadge) {
            statusBadge.className = 'status-badge status-neutral';
        }
    }

    updateFilterCount(filterCount) {
        const displayCount = typeof filterCount === 'number' 
            ? filterCount.toLocaleString() 
            : 'N/A';
        this.elements.filterCountEl.textContent = displayCount;
    }

    updateStats(stats) {
        const { initialized, runtime, blockedRequests } = stats;
        
        if (initialized) {
            // Update blocked count
            if (this.elements.blockedCountEl) {
                const blockedCount = blockedRequests || 0;
                this.elements.blockedCountEl.textContent = blockedCount.toLocaleString();
                
                // Add animation effect for count changes
                this.elements.blockedCountEl.style.transform = 'scale(1.1)';
                setTimeout(() => {
                    this.elements.blockedCountEl.style.transform = 'scale(1)';
                }, 200);
            }
            
            // Update runtime display
            if (this.elements.runtimeDisplayEl) {
                const runtimeSeconds = Math.floor(runtime / 1000);
                const runtimeDisplay = runtimeSeconds < 60 ? 
                    `${runtimeSeconds}s` : 
                    runtimeSeconds < 3600 ?
                    `${Math.floor(runtimeSeconds / 60)}m` :
                    `${Math.floor(runtimeSeconds / 3600)}h`;
                
                this.elements.runtimeDisplayEl.textContent = runtimeDisplay;
            }
            
            // Show detailed stats if available
            if (this.elements.statsEl && blockedRequests > 0) {
                this.elements.statsEl.innerHTML = `
                    <div class="detailed-info">
                        <small style="color: rgba(255,255,255,0.8); font-size: 11px;">
                            ⚡ Session aktiv seit ${Math.floor(runtime / 60000)}min
                        </small>
                    </div>
                `;
                this.elements.statsEl.style.display = 'block';
            }
        }
    }

    async handleToggle() {
        if (!this.state.currentDomain || this.state.isUpdating) {
            popupLogger.debug('Toggle ignored', { 
                domain: this.state.currentDomain, 
                isUpdating: this.state.isUpdating 
            });
            return;
        }

        if (!this.isValidDomain(this.state.currentDomain)) {
            popupLogger.error('Invalid domain for toggle', { domain: this.state.currentDomain });
            return;
        }

        this.state.isUpdating = true;
        const originalState = this.captureCurrentState();
        
        try {
            this.setLoadingState();

            const response = await chrome.runtime.sendMessage({
                command: 'toggleDomainState',
                domain: this.state.currentDomain,
                isPaused: !this.elements.enableSwitch.checked
            });

            if (response?.error) {
                throw new Error(response.error);
            }

            popupLogger.info('Domain state toggled successfully', { 
                domain: this.state.currentDomain,
                newState: !this.elements.enableSwitch.checked ? 'disabled' : 'enabled'
            });

            // Close the popup to avoid UI keeping focus while the active tab reloads
            try {
                window.close();
            } catch (_) {}
            
        } catch (error) {
            popupLogger.error('Failed to toggle domain state', { 
                domain: this.state.currentDomain,
                error: error.message 
            });
            
            this.restoreState(originalState);
            this.showError('Fehler beim Ändern des Status');
            
            // Reset UI after delay
            setTimeout(() => {
                if (!this.state.isUpdating) {
                    this.updateUI();
                }
            }, 2000);
        }
    }

    captureCurrentState() {
        return {
            statusText: this.elements.statusText.textContent,
            statusClass: this.elements.statusText.className,
            switchEnabled: !this.elements.enableSwitch.disabled,
            switchChecked: this.elements.enableSwitch.checked
        };
    }

    setLoadingState() {
        this.elements.statusText.textContent = 'Wird geändert...';
        this.elements.statusText.className = 'status-updating';
        this.elements.enableSwitch.disabled = true;
    }

    restoreState(state) {
        this.elements.statusText.textContent = state.statusText;
        this.elements.statusText.className = state.statusClass;
        this.elements.enableSwitch.disabled = !state.switchEnabled;
        this.elements.enableSwitch.checked = state.switchChecked;
        this.state.isUpdating = false;
    }

    showError(message) {
        this.elements.statusText.textContent = sanitizeInput(message);
        this.elements.statusText.className = 'status-error';
        this.elements.domainText.textContent = '';
        this.elements.filterCountEl.textContent = 'N/A';
        this.elements.enableSwitch.disabled = true;
        this.elements.enableSwitch.checked = false;
        this.state.isUpdating = false;
    }

    isValidDomain(domain) {
        if (!domain || typeof domain !== 'string') return false;
        
        // Basic domain validation - exclude chrome:// and extension:// URLs
        const invalidPrefixes = ['chrome', 'extension', 'moz-extension', 'about'];
        return !invalidPrefixes.some(prefix => domain.startsWith(prefix)) && 
               domain.includes('.') && 
               domain.length <= EXTENSION_CONFIG.LIMITS.MAX_DOMAIN_LENGTH;
    }

    // Cleanup method for proper resource management
    destroy() {
        if (this.debouncedToggle) {
            this.debouncedToggle.cancel?.();
        }
        
        // Remove event listeners
        this.elements.enableSwitch?.removeEventListener('change', this.debouncedToggle);
        window.removeEventListener('focus', this.updateUI);
        
        popupLogger.debug('Popup destroyed');
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    try {
        // keep a reference for beforeunload cleanup
        window.pagyPopup = new PagyPopup();
    } catch (error) {
        console.error('[Pagy Popup] Failed to initialize:', error);
    }
});

// Handle unload for cleanup
window.addEventListener('beforeunload', () => {
    if (window.pagyPopup) {
        window.pagyPopup.destroy();
    }
});
