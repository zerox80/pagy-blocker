/**
 * @file background.js
 * @description Stabile Version mit Filterzähler und korrektem Tab-Reload.
 * @version 6.2.0
 * @author Gemini
 */

const STORAGE_KEY_IS_PAUSED = 'is_globally_paused';
const RULESET_ID = 'pagy_ruleset_static';
const CSS_FILE = 'filter_lists/cosmetic_filters.css';
const NETWORK_RULES_FILE = 'filter_lists/filter_precompiled.json';

// Funktion zum Zählen der Filterregeln
async function getFilterCounts() {
    let networkCount = 0;
    let cosmeticCount = 0;

    try {
        // Zähle Netzwerkregeln
        const networkRulesUrl = chrome.runtime.getURL(NETWORK_RULES_FILE);
        const networkResponse = await fetch(networkRulesUrl);
        const networkData = await networkResponse.json();
        networkCount = Array.isArray(networkData) ? networkData.length : 0;

        // Zähle kosmetische Regeln
        const cosmeticRulesUrl = chrome.runtime.getURL(CSS_FILE);
        const cosmeticResponse = await fetch(cosmeticRulesUrl);
        const cosmeticData = await cosmeticResponse.text();
        // Eine einfache Zählmethode, die die Anzahl der CSS-Selektoren zählt
        if (cosmeticData && !cosmeticData.includes("/*")) {
            cosmeticCount = (cosmeticData.match(/,/g) || []).length + 1;
        }

    } catch (error) {
        console.error("Pagy Blocker: Fehler beim Zählen der Filter.", error);
    }
    
    return { networkCount, cosmeticCount };
}


// Schaltet den Blocker global an oder aus
async function setPauseState(isPaused) {
    // 1. Schalte den statischen Netzwerk-Regelsatz an/aus
    await chrome.declarativeNetRequest.updateEnabledRulesets(isPaused ?
        { disableRulesetIds: [RULESET_ID] } :
        { enableRulesetIds: [RULESET_ID] }
    );

    // 2. Zustand speichern und Icon aktualisieren
    await chrome.storage.local.set({ [STORAGE_KEY_IS_PAUSED]: isPaused });
    updateIcon(isPaused);
    console.log(`Pagy-Blocker ist jetzt global ${isPaused ? 'DEAKTIVIERT' : 'AKTIVIERT'}.`);


    // 3. Führe Aktionen auf dem aktiven Tab aus (CSS und Reload)
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Nur fortfahren, wenn es einen aktiven Tab mit einer normalen URL gibt
    if (activeTab && activeTab.id && activeTab.url?.startsWith('http')) {
        try {
            if (isPaused) {
                // Deaktivieren: CSS entfernen
                await chrome.scripting.removeCSS({ target: { tabId: activeTab.id }, files: [CSS_FILE] });
            } else {
                // Aktivieren: CSS einfügen - HIER WAR DER FEHLER
                await chrome.scripting.insertCSS({ target: { tabId: activeTab.id }, files: [CSS_FILE] });
            }
            // Lade den aktiven Tab neu, nachdem die CSS-Aktion erfolgreich war
            chrome.tabs.reload(activeTab.id);
        } catch (e) {
            console.warn(`Konnte Skript nicht auf Tab ${activeTab.id} anwenden oder Tab neu laden.`, e.message);
        }
    }
}

function updateIcon(isPaused) {
    const iconPath = isPaused ? "/icons/deaktivieren.png" : "/icons/icon128.png";
    chrome.action.setIcon({ path: iconPath });
}

// Event-Listener für das Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (message.command === 'getPopupData') {
            const { [STORAGE_KEY_IS_PAUSED]: isPaused = false } = await chrome.storage.local.get(STORAGE_KEY_IS_PAUSED);
            const counts = await getFilterCounts();
            sendResponse({ 
                isPaused,
                filterCount: counts.networkCount + counts.cosmeticCount
            });
        } else if (message.command === 'toggleGlobalPause') {
            await setPauseState(message.isPaused);
            sendResponse({ success: true });
        }
    })();
    return true;
});

// Initialen Zustand beim Start festlegen
chrome.runtime.onInstalled.addListener(() => {
    // Beim ersten Mal sicherstellen, dass der Blocker aktiv ist
    setPauseState(false);
});
chrome.runtime.onStartup.addListener(async () => {
    const { [STORAGE_KEY_IS_PAUSED]: isPaused = false } = await chrome.storage.local.get(STORAGE_KEY_IS_PAUSED);
    updateIcon(isPaused);
});