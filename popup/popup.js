/**
 * @file popup.js
 * @description UI-Logik für das Popup-Fenster der Pagy-Blocker-Erweiterung.
 * Zeigt den Status an, ermöglicht das Aktivieren/Deaktivieren und zeigt Statistiken an.
 *
 * @version 2.6.4
 * @author Gemini
 */

document.addEventListener('DOMContentLoaded', () => {
    const enableSwitch = document.getElementById('enable-switch');
    const statusText = document.getElementById('status-text');
    const blockedDisplay = document.getElementById('blocked-display');
    const statsDisplay = document.getElementById('stats-display');
    const refreshButton = document.getElementById('refresh-button');
    const logo = document.querySelector('.logo');

    /**
     * Sendet eine Nachricht an das Hintergrundskript und gibt eine Promise zurück.
     * @param {object} message - Die zu sendende Nachricht.
     * @returns {Promise<object>} Eine Promise, die mit der Antwort des Hintergrundskripts aufgelöst wird.
     */
    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                if (response && response.error) {
                    return reject(new Error(response.error));
                }
                resolve(response);
            });
        });
    }

    /**
     * Aktualisiert die Benutzeroberfläche mit den neuesten Daten vom Hintergrundskript.
     */
    async function updateUI() {
        try {
            // Status (pausiert/aktiviert) abrufen und UI aktualisieren
            const state = await sendMessage({ command: 'getState' });
            const isPaused = state.isPaused;
            enableSwitch.checked = !isPaused;
            statusText.textContent = isPaused ? 'Deaktiviert' : 'Aktiviert';
            document.body.classList.toggle('disabled', isPaused);
            logo.src = isPaused ? '../icons/icon48_disabled.png' : '../icons/icon48.png';

            // Statistiken abrufen und anzeigen
            statsDisplay.textContent = 'Lade Statistiken...';
            const stats = await sendMessage({ command: 'getStats' });
            
            const blockedCount = stats.blocked || 0;

            blockedDisplay.innerHTML = `Blockierte Ads: <span class="blocked-count">${blockedCount}</span>`;
            statsDisplay.textContent = `Filterliste: Pagy Standard`;

        } catch (error) {
            console.error('Pagy-Blocker: Fehler beim Aktualisieren der Popup-UI.', error);
            statsDisplay.textContent = 'Fehler beim Laden.';
            blockedDisplay.innerHTML = 'Blockierte Ads: <span class="blocked-count">-</span>';
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

    // Initiales Laden der UI-Daten
    updateUI();
});
