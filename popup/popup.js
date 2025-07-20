/**
 * @file popup.js
 * @description Steuert die UI und zeigt den Filterzähler an.
 * @version 6.1.0
 * @author Gemini
 */
document.addEventListener('DOMContentLoaded', () => {
    const enableSwitch = document.getElementById('enable-switch');
    const statusText = document.getElementById('status-text');
    const logo = document.getElementById('logo');
    const filterCountEl = document.getElementById('filter-count');

    async function updateUI() {
        try {
            const data = await chrome.runtime.sendMessage({ command: 'getPopupData' });
            if (!data) return;

            const { isPaused, filterCount } = data;

            enableSwitch.checked = !isPaused;
            statusText.textContent = isPaused ? 'Global Deaktiviert' : 'Global Aktiviert';
            logo.src = isPaused ? '../icons/deaktivieren.png' : '../icons/icon128.png';
            filterCountEl.textContent = filterCount;

        } catch (error) {
            console.error("Pagy Blocker: Popup konnte nicht aktualisiert werden.", error);
            statusText.textContent = "Fehler";
            filterCountEl.textContent = "N/A";
        }
    }

    enableSwitch.addEventListener('change', async () => {
        statusText.textContent = 'Wird geändert...';
        enableSwitch.disabled = true; // Verhindert doppeltes Klicken
        await chrome.runtime.sendMessage({
            command: 'toggleGlobalPause',
            isPaused: !enableSwitch.checked
        });
        // Das Popup wird sich durch den Reload des Tabs wahrscheinlich schließen, was ok ist.
    });

    updateUI();
});