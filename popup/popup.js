/**
 * @file popup.js
 * @description Popup-Oberfläche für Pagy Blocker
 * @version 11.1
 */

import { EXTENSION_CONFIG } from '../core/config.js';
import { popupLogger } from '../core/logger.js';
import { debounce, sanitizeInput, isValidDomain, isExtensionContextValid } from '../core/utilities.js';

class PagyPopup {
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

    init() {
        try {
            // Version im Header synchronisieren
            if (this.elements.versionTextEl) {
                this.elements.versionTextEl.textContent = `v${EXTENSION_CONFIG.VERSION}`;
            }
            this.validateElements();
            this.setupEventListeners();
            this.updateUI();
        } catch (error) {
            // Initialisierung fehlgeschlagen – Fehlermeldung protokollieren
            popupLogger.error('Failed to initialize popup', { error: error.message });
            this.showError('Initialisierungsfehler');
        }
    }

    validateElements() {
        for (const [name, element] of Object.entries(this.elements)) {
            if (!element) {
                // Pflicht-Element wurde im DOM nicht gefunden
                throw new Error(`Required element not found: ${name}`);
            }
        }
    }

    setupEventListeners() {
        this.elements.enableSwitch.addEventListener('change', this.debouncedToggle);

        // Auf Fokus erneut versuchen, falls vorher ein Fehler vorlag
        // Speichere den Listener, damit er beim Aufräumen korrekt entfernt werden kann
        this._onWindowFocus = () => {
            if (!this.state.isUpdating) {
                this.updateUI();
            }
        };
        window.addEventListener('focus', this._onWindowFocus);
    }

    async updateUI() {
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (!isExtensionContextValid()) {
                    // Erweiterungs-Kontext ungültig (z. B. beim schnellen Schließen)
                    throw new Error('Extension context invalid');
                }

                // Antwort vom Background-Script mit Timeout anfordern
                const data = await Promise.race([
                    chrome.runtime.sendMessage({ command: 'getPopupData' }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
                ]);
                
                if (!data) {
                    // Unerwartet: keine Daten vom Hintergrundskript
                    throw new Error('No data received from background script');
                }

                if (data.error) {
                    throw new Error(data.error);
                }

                this.renderUI(data);
                this.state.retryCount = 0; // Zähler nach erfolgreichem Laden zurücksetzen
                popupLogger.debug('UI updated successfully', { domain: data.domain });
                return;
                
            } catch (error) {
                popupLogger.warn(`UI update attempt ${attempt} failed`, { error: error.message });
                
                if (attempt === maxRetries) {
                    this.showError('Fehler beim Laden der Daten');
                    popupLogger.error('All UI update attempts failed', { error: error.message });
                } else {
                    // Kurz warten, dann erneut versuchen
                    await new Promise(resolve => setTimeout(resolve, 100 * attempt));
                }
            }
        }
    }

    renderUI(data) {
        const { isPaused, domain, filterCount } = data;
        this.state.currentDomain = domain;

        if (domain && isValidDomain(domain)) {
            this.updateForValidDomain(domain, isPaused);
        } else {
            this.updateForInvalidDomain();
        }

        this.updateFilterCount(filterCount);
        
        // Blocker-Statistiken anzeigen (falls vorhanden)
        if (data.stats) {
            this.updateStats(data.stats);
        }
    }

    updateForValidDomain(domain, isPaused) {
        this.elements.enableSwitch.disabled = false;
        this.elements.enableSwitch.checked = !isPaused;
        this.elements.statusText.textContent = isPaused ? 'Deaktiviert' : 'Aktiv';
        this.elements.domainText.textContent = sanitizeInput(domain);
        
        // Status-Badge optisch anpassen
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
        
        // Status-Badge optisch anpassen
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
                
                // Add animation effect for count changes using CSS class
                this.elements.blockedCountEl.classList.remove('bump');
                // Force reflow to restart animation
                void this.elements.blockedCountEl.offsetWidth;
                this.elements.blockedCountEl.classList.add('bump');
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
            
            // Detail-Infos anzeigen, wenn Werte vorliegen
            if (this.elements.statsEl && blockedRequests > 0) {
                this.elements.statsEl.innerHTML = `
                    <div class="detailed-info">
                        <small class="detail-muted">⚡ Session aktiv seit ${Math.floor(runtime / 60000)}min</small>
                    </div>
                `;
                this.elements.statsEl.classList.add('is-visible');
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

        if (!isValidDomain(this.state.currentDomain)) {
            popupLogger.error('Invalid domain for toggle', { domain: this.state.currentDomain });
            return;
        }

        this.state.isUpdating = true;
        const originalState = this.captureCurrentState();
        
        try {
            this.setLoadingState();

            // Toggle-Request mit Timeout absichern
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

            // Erfolgreich zwischen aktiviert/deaktiviert umgeschaltet
            popupLogger.info('Domain state toggled successfully', { 
                domain: this.state.currentDomain,
                newState: !this.elements.enableSwitch.checked ? 'disabled' : 'enabled'
            });

            // Popup schließen, damit der aktive Tab ggf. neu laden kann, ohne Fokusprobleme
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
            
            // UI nach kurzer Zeit zurücksetzen
            setTimeout(() => {
                if (!this.state.isUpdating) {
                    this.updateUI();
                }
            }, 2000);
        } finally {
            // Sicherstellen, dass die UI nicht hängen bleibt, falls das Popup offen bleibt
            this.state.isUpdating = false;
            this.elements.enableSwitch.disabled = false;
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
        this.elements.statusText.className = 'status-label status-updating';
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
        this.elements.statusText.className = 'status-label status-error';
        this.elements.domainText.textContent = '';
        this.elements.filterCountEl.textContent = 'N/A';
        this.elements.enableSwitch.disabled = true;
        this.elements.enableSwitch.checked = false;
        this.state.isUpdating = false;
    }

    

    // Aufräumen zur sauberen Ressourcenfreigabe
    destroy() {
        if (this.debouncedToggle) {
            this.debouncedToggle.cancel?.();
        }
        
        // Event-Listener entfernen
        this.elements.enableSwitch?.removeEventListener('change', this.debouncedToggle);
        if (this._onWindowFocus) {
            window.removeEventListener('focus', this._onWindowFocus);
        }
        
        popupLogger.debug('Popup destroyed');
    }
}

// Popup initialisieren, sobald der DOM geladen ist
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Referenz behalten, um vor dem Unload aufzuräumen
        window.pagyPopup = new PagyPopup();
    } catch (error) {
        console.error('[Pagy Popup] Failed to initialize:', error);
    }
});

// Beim Unload aufräumen
window.addEventListener('beforeunload', () => {
    if (window.pagyPopup) {
        window.pagyPopup.destroy();
    }
});
