/**
 * @file background.js
 * @description Haupt-Hintergrundskript für die Pagy-Blocker-Erweiterung.
 * Verwaltet den Zustand, die Filterlisten und die Kommunikation mit anderen Teilen der Erweiterung.
 *
 * @version 3.0.0
 * @author Gemini (Final Version)
 */

// =================================================================================
// Konstanten und globale Variablen
// =================================================================================

const STORAGE_KEYS = {
  IS_PAUSED: 'is_paused',
  BLOCKED_COUNT_TOTAL: 'blocked_count_total'
};

const IS_DEVELOPMENT = !('update_url' in chrome.runtime.getManifest());

// Robuste Zählung pro Tab mit einer Map
const blockedAdsPerTab = new Map();
let activeTabId = null;

// =================================================================================
// Initialisierung und Regel-Management
// =================================================================================

/**
 * Initialisiert die Erweiterung bei der Installation oder dem Update.
 */
async function onInstallOrUpdate(details) {
  console.log(`Pagy-Blocker: Event '${details.reason}' wurde ausgelöst.`);
  await initializeDefaultState();
  await updateRules();
  console.log('Pagy-Blocker: Initialisierung erfolgreich abgeschlossen.');
}

/**
 * Setzt die Standardwerte im Speicher.
 */
async function initializeDefaultState() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.IS_PAUSED]: false,
    [STORAGE_KEYS.BLOCKED_COUNT_TOTAL]: 0
  });
  const { [STORAGE_KEYS.IS_PAUSED]: isPaused } = await chrome.storage.local.get(STORAGE_KEYS.IS_PAUSED);
  updateIcon(isPaused || false);
}

/**
 * Lädt die Filterregeln aus der vorkompilierten Datei und fügt sie als dynamische Regeln hinzu.
 * Stellt sicher, dass alte Regeln zuerst entfernt werden.
 */
async function updateRules() {
  try {
    // 1. Bestehende dynamische Regeln entfernen
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIds = existingRules.map(rule => rule.id);
    if (ruleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ruleIds });
      console.log('Pagy-Blocker: Alte dynamische Regeln entfernt.');
    }

    // 2. Neue Regeln aus der Datei laden
    const response = await fetch(chrome.runtime.getURL('filter_lists/filter_precompiled_min.json'));
    if (!response.ok) {
        throw new Error(`Fehler beim Laden der Filterliste: ${response.statusText}`);
    }
    const rules = await response.json();

    // 3. Neue Regeln hinzufügen
    if (rules && rules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });
        console.log(`Pagy-Blocker: ${rules.length} neue Regeln erfolgreich geladen.`);
    }
  } catch (error) {
    console.error('Pagy-Blocker: Fehler beim Aktualisieren der Regeln.', error);
  }
}

// =================================================================================
// Zähllogik für blockierte Anzeigen (pro Tab)
// =================================================================================

/**
 * Setzt den Zähler für einen bestimmten Tab zurück.
 * @param {number} tabId - Die ID des Tabs.
 */
function resetTabCounter(tabId) {
    if (tabId) {
        blockedAdsPerTab.set(tabId, 0);
    }
}

/**
 * Erhöht den Zähler für einen bestimmten Tab.
 * @param {number} tabId - Die ID des Tabs.
 */
function incrementTabCounter(tabId) {
    if (tabId > 0) {
        const currentCount = blockedAdsPerTab.get(tabId) || 0;
        blockedAdsPerTab.set(tabId, currentCount + 1);
    }
}

// =================================================================================
// Event-Listener
// =================================================================================

// Erweiterung wird installiert oder aktualisiert
chrome.runtime.onInstalled.addListener(onInstallOrUpdate);

// Tab wird gewechselt -> activeTabId aktualisieren
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
});

// Navigation beginnt -> Zähler für diesen Tab zurücksetzen
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId === 0) { // Nur für den Hauptframe
    resetTabCounter(details.tabId);
  }
});

// Eine Regel hat eine Anzeige blockiert -> Zähler erhöhen
if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.onRuleMatchedDebug) {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((details) => {
        incrementTabCounter(details.request.tabId);
    });
}

// Tab wird geschlossen -> Zähler aus der Map entfernen
chrome.tabs.onRemoved.addListener((tabId) => {
  blockedAdsPerTab.delete(tabId);
});

// Navigation hat begonnen -> Zähler für den Tab zurücksetzen
chrome.webNavigation.onCommitted.addListener((details) => {
    // Wir interessieren uns nur für den Hauptframe, um iFrames zu ignorieren
    if (details.frameId === 0) {
        resetTabCounter(details.tabId);
    }
});

// Nachrichten von anderen Teilen der Erweiterung (z.B. Popup)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.command) {
        case 'getState': {
          const { [STORAGE_KEYS.IS_PAUSED]: isPaused = false } = await chrome.storage.local.get(STORAGE_KEYS.IS_PAUSED);
          sendResponse({ isPaused });
          break;
        }
        case 'togglePause':
          await togglePauseState(message.isPaused);
          sendResponse({ success: true, isPaused: message.isPaused });
          break;
        case 'getStats': {
          const [filterStats, tabs] = await Promise.all([
              getFilterStats(),
              chrome.tabs.query({ active: true, currentWindow: true })
          ]);
          
          let currentTabId = null;
          if (tabs.length > 0) {
              currentTabId = tabs[0].id;
          }
          
          const blockedCount = blockedAdsPerTab.get(currentTabId) || 0;
          
          sendResponse({
            blocked: blockedCount,
            filterCount: filterStats
          });
          break;
        }
                case 'updateBlockedCount': {
          if (sender.tab && sender.tab.id) {
            const tab = await chrome.tabs.get(sender.tab.id).catch(() => null);

            // FINAL FIX: Ignore messages from a previous script if the tab is reloading.
            // If the tab status is 'loading' and the current count is 0, it's the first message for a new page.
            // Any other message while 'loading' is from a stale script.
            if (tab && tab.status === 'loading' && (blockedAdsPerTab.get(sender.tab.id) || 0) > 0) {
                sendResponse({ success: false, reason: 'Stale message ignored' });
                break;
            }

            const currentCount = blockedAdsPerTab.get(sender.tab.id) || 0;
            const newCount = currentCount + message.count;
            blockedAdsPerTab.set(sender.tab.id, newCount);

            // Update total count correctly
            const { [STORAGE_KEYS.BLOCKED_COUNT_TOTAL]: totalBlocked = 0 } = await chrome.storage.local.get(STORAGE_KEYS.BLOCKED_COUNT_TOTAL);
            await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKED_COUNT_TOTAL]: totalBlocked + message.count });
          }
          sendResponse({ success: true });
          break;
        }
        default:
          sendResponse({ error: 'Unbekannter Befehl' });
          break;
      }
    } catch (error) {
      console.error(`Pagy-Blocker: Fehler bei der Nachrichtenbehandlung:`, error);
      sendResponse({ success: false, error: 'Operation fehlgeschlagen' });
    }
  })();
  return true; // Für asynchrone sendResponse
});


// =================================================================================
// Hilfsfunktionen
// =================================================================================

/**
 * Schaltet den globalen Pausenzustand der Erweiterung um.
 * @param {boolean} isPaused - Der neue Pausenzustand.
 */
async function togglePauseState(isPaused) {
  await chrome.storage.local.set({ [STORAGE_KEYS.IS_PAUSED]: isPaused });
  updateIcon(isPaused);
}

/**
 * Aktualisiert das Icon der Erweiterung basierend auf dem Pausenzustand.
 * @param {boolean} isPaused - Gibt an, ob die Erweiterung pausiert ist.
 */
function updateIcon(isPaused) {
    const ICON_PATHS = {
        DEFAULT: { "16": "/icons/icon16.png", "48": "/icons/icon48.png", "128": "/icons/icon128.png" },
        DISABLED: { "16": "/icons/deaktivieren.png", "48": "/icons/deaktivieren.png", "128": "/icons/deaktivieren.png" }
    };
    const pathSet = isPaused ? ICON_PATHS.DISABLED : ICON_PATHS.DEFAULT;
    chrome.action.setIcon({ path: pathSet });
}

/**
 * Ruft die aktuelle Filterstatistik ab.
 * @returns {Promise<object>} Ein Objekt mit der Anzahl der kosmetischen, Netzwerk- und Gesamtregeln.
 */
async function getFilterStats() {
  try {
    let cssCount = 0;
    let networkCount = 0;

    // 1. Kosmetische Regeln zählen
    const cosmeticResponse = await fetch(chrome.runtime.getURL('filter_lists/cosmetic_filters.json')).catch(() => null);
    if (cosmeticResponse && cosmeticResponse.ok) {
      const cosmeticData = await cosmeticResponse.json();
      for (const domain in cosmeticData) {
        if (cosmeticData[domain] && Array.isArray(cosmeticData[domain].selectors)) {
          cssCount += cosmeticData[domain].selectors.length;
        }
      }
    }

    // 2. Aktive Netzwerkregeln über die API abrufen
    const activeRules = await chrome.declarativeNetRequest.getDynamicRules();
    networkCount = activeRules.length;

    return {
      css: cssCount,
      network: networkCount,
      total: cssCount + networkCount
    };
  } catch (error) {
    console.error('Pagy-Blocker: Fehler beim Abrufen der Filterstatistiken.', error);
    return { css: 0, network: 0, total: 0 }; // Fehlerzustand
  }
}

// Initialen Icon-Status beim Start des Browsers setzen
(async () => {
    try {
        const { [STORAGE_KEYS.IS_PAUSED]: isPaused } = await chrome.storage.local.get(STORAGE_KEYS.IS_PAUSED);
        updateIcon(isPaused || false);
    } catch (error) {
        console.error("Fehler beim initialen Setzen des Icons:", error);
    }
})();