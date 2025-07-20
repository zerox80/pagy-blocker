document.addEventListener('DOMContentLoaded', async () => {
    const enableSwitch = document.getElementById('enable-switch');
    const statusText = document.getElementById('status-text');
    const statsDisplay = document.getElementById('stats-display');

    async function updateUI() {
        try {
            const { isPaused, stats } = await chrome.runtime.sendMessage({ command: 'getState' });

            enableSwitch.checked = !isPaused;
            statusText.textContent = isPaused ? 'Deaktiviert' : 'Aktiviert';
            document.body.style.backgroundColor = isPaused ? '#ffebee' : '#f9f9f9';

            const networkCount = stats.network || 0;
            statsDisplay.textContent = `${networkCount} Netzwerkregeln aktiv.`;

        } catch (error) {
            console.error("Pagy-Blocker: Fehler beim Aktualisieren des Popups.", error);
            statusText.textContent = 'Fehler';
            statsDisplay.textContent = 'Konnte Status nicht laden.';
        }
    }

    enableSwitch.addEventListener('change', async () => {
        const isPaused = !enableSwitch.checked;
        statusText.textContent = 'Wird geändert...';
        await chrome.runtime.sendMessage({ command: 'togglePause', isPaused });
        // UI wird durch das Neuladen nach der Statusänderung aktualisiert.
        // Das Popup schließt sich, aber bei der nächsten Öffnung ist der Status korrekt.
    });

    // Initiales Laden der UI
    updateUI();
});