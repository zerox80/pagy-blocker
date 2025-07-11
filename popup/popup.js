// popup/popup.js
const ruleCountEl = document.getElementById('rule-count');
const refreshButton = document.getElementById('refresh-button');

// Performance: Cache für UI-Updates
let lastDisplayedStats = null;

function updateStatsDisplay(stats) {
    // Performance: Nur DOM aktualisieren wenn sich Werte geändert haben
    if (!lastDisplayedStats || lastDisplayedStats.ruleCount !== stats.ruleCount) {
        ruleCountEl.textContent = stats.ruleCount !== undefined ? stats.ruleCount.toLocaleString() : 'N/A';
        lastDisplayedStats = { ...stats };
        console.log("Popup updated with stats:", stats);
    }
}

// Performance: Debouncing für häufige Aufrufe
let fetchStatsTimeout = null;

function fetchStats() {
    // Performance: Verhindere mehrfache gleichzeitige Aufrufe
    if (fetchStatsTimeout) {
        clearTimeout(fetchStatsTimeout);
    }
    
    fetchStatsTimeout = setTimeout(() => {
        ruleCountEl.textContent = 'Lädt...';

        // Frage den Background-Script nach aktuellen Statistiken
        chrome.runtime.sendMessage({ action: "getStats" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Error fetching stats:", chrome.runtime.lastError.message);
                ruleCountEl.textContent = 'Fehler';
                return;
            }
            if (response) {
                updateStatsDisplay(response);
            } else {
                 console.warn("Did not receive a response from background script.");
                 // Performance: Direkter Storage-Zugriff als Fallback
                 chrome.storage.local.get(['ruleCount']).then(stats => {
                     updateStatsDisplay(stats);
                 }).catch(err => console.error("Error getting stats from storage:", err));
            }
        });
        fetchStatsTimeout = null;
    }, 100);
}

// Performance: Passive Event Listeners
refreshButton.addEventListener('click', fetchStats, { passive: true });

// Lade Statistiken, wenn das Popup geöffnet wird
document.addEventListener('DOMContentLoaded', fetchStats, { passive: true });