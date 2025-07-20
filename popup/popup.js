/**
 * @file popup.js
 * @description UI-Logik für das Popup-Fenster der Pagy-Blocker-Erweiterung.
 * Zeigt den Status an, ermöglicht das Aktivieren/Deaktivieren und zeigt Statistiken an.
 *
 * @version 2.6.4
 * @author Gemini
 */

document.addEventListener('DOMContentLoaded', () => {
    // ENHANCED: Global error boundary for popup
    window.addEventListener('error', (event) => {
        console.error('Pagy-Blocker Popup: Unhandled error:', event.error);
        showErrorState('Ein unerwarteter Fehler ist aufgetreten');
        return true; // Prevent default error handling
    });

    window.addEventListener('unhandledrejection', (event) => {
        console.error('Pagy-Blocker Popup: Unhandled promise rejection:', event.reason);
        showErrorState('Ein unerwarteter Fehler ist aufgetreten');
        event.preventDefault(); // Prevent default handling
    });

    const enableSwitch = document.getElementById('enable-switch');
    const statusText = document.getElementById('status-text');
    const blockedDisplay = document.getElementById('blocked-display');
    const statsDisplay = document.getElementById('stats-display');
    const refreshButton = document.getElementById('refresh-button');
    const logo = document.querySelector('.logo');

    // ENHANCED: Validate critical DOM elements
    if (!enableSwitch || !statusText || !blockedDisplay || !statsDisplay || !refreshButton || !logo) {
        console.error('Pagy-Blocker Popup: Critical DOM elements missing');
        showErrorState('Popup konnte nicht geladen werden');
        return;
    }

    /**
     * Sendet eine Nachricht an das Hintergrundskript und gibt eine Promise zurück.
     * FIXED: Robuste Input-Validierung und Timeout-Schutz
     * @param {object} message - Die zu sendende Nachricht.
     * @returns {Promise<object>} Eine Promise, die mit der Antwort des Hintergrundskripts aufgelöst wird.
     */
    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            // Input-Validierung
            if (!message || typeof message !== 'object' || !message.command) {
                return reject(new Error('Ungültige Nachricht: command erforderlich'));
            }
            
            // Timeout-Schutz
            const timeout = setTimeout(() => {
                reject(new Error('Message timeout - Background script antwortet nicht'));
            }, 5000);
            
            chrome.runtime.sendMessage(message, (response) => {
                clearTimeout(timeout);
                
                if (chrome.runtime.lastError) {
                    return reject(new Error(`Runtime error: ${chrome.runtime.lastError.message}`));
                }
                if (response && response.error) {
                    return reject(new Error(`Background error: ${response.error}`));
                }
                resolve(response || {});
            });
        });
    }

    /**
     * Aktualisiert die Benutzeroberfläche mit den neuesten Daten vom Hintergrundskript.
     * ENHANCED: Improved error handling and state management
     */
    async function updateUI() {
        try {
            // Clear any previous error state
            clearErrorState();
            
            // Status (pausiert/aktiviert) abrufen und UI aktualisieren
            const state = await sendMessage({ command: 'getState' });
            const isPaused = state.isPaused;
            enableSwitch.checked = !isPaused;
            statusText.textContent = isPaused ? 'Deaktiviert' : 'Aktiviert';
            document.body.classList.toggle('disabled', isPaused);
            // FIXED: Konsistente absolute Pfade und Fallback-Logik mit Error-Handling
            const iconPath = isPaused ? '/icons/deaktivieren.png' : '/icons/icon48.png';
            logo.src = iconPath;
            logo.onerror = () => {
                console.warn('Pagy-Blocker: Icon failed to load, using fallback');
                logo.src = '/icons/icon48.png'; // Fallback zum Standard-Icon
            };

            // Statistiken abrufen und anzeigen
            statsDisplay.textContent = 'Lade Statistiken...';
            const stats = await sendMessage({ command: 'getStats' });
            
            const blockedCount = stats.blocked || 0;

            blockedDisplay.innerHTML = `Blockierte Ads: <span class="blocked-count">${blockedCount}</span>`;
            statsDisplay.textContent = `Filterliste: Pagy Standard`;

        } catch (error) {
            console.error('Pagy-Blocker: Fehler beim Aktualisieren der Popup-UI.', error);
            showErrorState('Fehler beim Laden der Daten');
        }
    }

    // Event-Listener für den Umschalter
    enableSwitch.addEventListener('change', async () => {
        const isPaused = !enableSwitch.checked;
        try {
            await sendMessage({ command: 'togglePause', isPaused });
            updateUI();
        } catch (error) {
            console.error('Pagy-Blocker: Fehler beim Umschalten des Status.', error);
            updateUI(); // Zustand zurücksetzen
        }
    });

    // Event-Listener für den Aktualisieren-Button
    refreshButton.addEventListener('click', () => {
        const icon = refreshButton.querySelector('svg');
        icon.style.transition = 'transform 0.5s';
        icon.style.transform = 'rotate(360deg)';
        
        updateUI().finally(() => {
            setTimeout(() => {
                icon.style.transition = 'none';
                icon.style.transform = 'none';
            }, 500);
        });
    });

    /**
     * ENHANCED: Shows error state in the popup UI
     * @param {string} message - Error message to display
     */
    function showErrorState(message) {
        try {
            if (statsDisplay) {
                statsDisplay.textContent = message;
                statsDisplay.classList.add('error-text');
            }
            if (blockedDisplay) {
                blockedDisplay.innerHTML = 'Blockierte Ads: <span class="blocked-count error-text">-</span>';
            }
            if (document.body) {
                document.body.classList.add('error-state');
            }
        } catch (error) {
            console.error('Pagy-Blocker Popup: Failed to show error state:', error);
        }
    }

    /**
     * ENHANCED: Clears error state from the popup UI
     */
    function clearErrorState() {
        try {
            if (statsDisplay) {
                statsDisplay.classList.remove('error-text');
            }
            if (document.body) {
                document.body.classList.remove('error-state');
            }
        } catch (error) {
            console.error('Pagy-Blocker Popup: Failed to clear error state:', error);
        }
    }

    // Initiales Laden der UI-Daten
    updateUI().catch(error => {
        console.error('Pagy-Blocker Popup: Initial UI load failed:', error);
        showErrorState('Fehler beim Laden der Daten');
    });
});
