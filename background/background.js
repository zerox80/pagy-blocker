/**
 * @file background.js
 * @description Haupt-Hintergrundskript für die Pagy-Blocker-Erweiterung.
 * @version 3.0.0
 * @author Gemini
 */

const STORAGE_KEY_IS_PAUSED = 'is_paused';

// --- Initialisierung und Regel-Management ---

async function onInstallOrUpdate(details) {
  console.log(`Pagy-Blocker: Event '${details.reason}' wurde ausgelöst.`);
  await chrome.storage.local.set({ [STORAGE_KEY_IS_PAUSED]: false });
  updateIcon(false);
  reloadDynamicRules(); // Lädt die Regeln bei der Installation
}

async function reloadDynamicRules() {
  const allRules = await chrome.declarativeNetRequest.getDynamicRules();
  const ruleIdsToRemove = allRules.map(rule => rule.id);

  const newRules = await getRulesFromPath('filter_lists/filter_precompiled.json');

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: ruleIdsToRemove,
    addRules: newRules
  });
  console.log(`Pagy-Blocker: ${newRules.length} Netzwerkregeln geladen.`);
}

async function getRulesFromPath(path) {
    try {
        const rulesURL = chrome.runtime.getURL(path);
        const response = await fetch(rulesURL);
        if (!response.ok) {
            throw new Error(`Fehler beim Laden der Regeldatei: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Pagy-Blocker: Konnte Regeldatei nicht laden.", error);
        return [];
    }
}


// --- Zustand und UI ---

async function togglePauseState(shouldBePaused) {
  await chrome.storage.local.set({ [STORAGE_KEY_IS_PAUSED]: shouldBePaused });
  updateIcon(shouldBePaused);

  // Deaktiviert oder aktiviert die CSS-Injektion durch Neuladen
  await chrome.declarativeNetRequest.updateEnabledRulesets(shouldBePaused ? {
    disableRulesetIds: ['pagy_ruleset_1']
  } : {
    enableRulesetIds: ['pagy_ruleset_1']
  });

  // Informiere die Tabs und lade sie neu, um die Änderung zu übernehmen
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const tab of tabs) {
    try {
      if (tab.id) {
        chrome.tabs.reload(tab.id, { bypassCache: true });
      }
    } catch (e) {
      console.warn(`Konnte Tab ${tab.id} nicht neu laden:`, e.message);
    }
  }
}

function updateIcon(isPaused) {
    const iconPath = isPaused ? "/icons/deaktivieren.png" : "/icons/icon48.png";
    chrome.action.setIcon({ path: { "48": iconPath } });
}


// --- Event-Listener ---

chrome.runtime.onInstalled.addListener(onInstallOrUpdate);

chrome.runtime.onStartup.async = async () => {
    const { [STORAGE_KEY_IS_PAUSED]: isPaused } = await chrome.storage.local.get(STORAGE_KEY_IS_PAUSED);
    updateIcon(isPaused || false);
};


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (message.command === 'getState') {
            const { [STORAGE_KEY_IS_PAUSED]: isPaused = false } = await chrome.storage.local.get(STORAGE_KEY_IS_PAUSED);
            const rules = await chrome.declarativeNetRequest.getDynamicRules();
            sendResponse({
              isPaused,
              stats: {
                network: rules.length
              }
            });
        } else if (message.command === 'togglePause') {
            await togglePauseState(message.isPaused);
            sendResponse({ success: true });
        }
    })();
    return true; // Hält den Message-Channel für asynchrone Antworten offen
});

// Initialen Icon-Status setzen
(async () => {
    const { [STORAGE_KEY_IS_PAUSED]: isPaused } = await chrome.storage.local.get(STORAGE_KEY_IS_PAUSED);
    updateIcon(isPaused || false);
})();