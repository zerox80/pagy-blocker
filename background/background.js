/**
 * @file background.js
 * @description Haupt-Hintergrundskript für die Pagy-Blocker-Erweiterung.
 * Verwaltet den Zustand, die Filterlisten und die Kommunikation mit anderen Teilen der Erweiterung.
 *
 * @version 2.6.3
 * @author zerox80 (Original), Gemini (Überarbeitung & Bugfix)
 */

// Konstanten für die Speicherung und Standardwerte
const STORAGE_KEYS = {
  IS_PAUSED: 'is_paused',
  BLOCKED_COUNT: 'blocked_count',
  WHITELISTED_SITES: 'whitelisted_sites' // Behalten für mögliche zukünftige Verwendung
};

// BUGFIX: Die Pfade müssen absolut vom Root-Verzeichnis der Erweiterung sein (beginnend mit /).
// Relative Pfade wie ../icons/ funktionieren in Service Workern nicht zuverlässig und führen zum Absturz.
const ICON_PATHS = {
  DEFAULT: {
    "16": "/icons/icon16.png",
    "48": "/icons/icon48.png",
    "128": "/icons/icon128.png"
  },
  DISABLED: {
    "16": "/icons/icon16_disabled.png",
    "48": "/icons/icon48_disabled.png",
    "128": "/icons/icon128_disabled.png"
  }
};

/**
 * Initialisiert die Erweiterung bei der Installation oder dem Update.
 * Lädt die Filterregeln und setzt den Anfangszustand.
 * @param {object} details - Details über das Installations- oder Update-Ereignis.
 */
async function onInstallOrUpdate(details) {
  console.log(`Pagy-Blocker: Event '${details.reason}' wurde ausgelöst.`);
  try {
    await initializeDefaultState();
    console.log('Pagy-Blocker: Initialisierung erfolgreich.');
  } catch (error) {
    console.error('Pagy-Blocker: Fehler bei der Initialisierung.', error);
  }
}



/**
 * Setzt die Standardwerte im Speicher, falls sie noch nicht vorhanden sind.
 */
async function initializeDefaultState() {
  const defaults = {
    [STORAGE_KEYS.IS_PAUSED]: false,
    [STORAGE_KEYS.WHITELISTED_SITES]: [],
    [STORAGE_KEYS.BLOCKED_COUNT]: 0
  };
  await chrome.storage.local.set(defaults);
  const { [STORAGE_KEYS.IS_PAUSED]: isPaused } = await chrome.storage.local.get(STORAGE_KEYS.IS_PAUSED);
  updateIcon(isPaused || false);
}

/**
 * Aktualisiert das Icon der Erweiterung, indem ein Dictionary von Pfaden übergeben wird.
 * @param {boolean} isPaused - Gibt an, ob die Erweiterung pausiert ist.
 */
function updateIcon(isPaused) {
  const pathSet = isPaused ? ICON_PATHS.DISABLED : ICON_PATHS.DEFAULT;
  chrome.action.setIcon({ path: pathSet }, () => {
    if (chrome.runtime.lastError) {
      console.error('Fehler beim Setzen des Icons mit Pfad-Dictionary:', chrome.runtime.lastError.message);
    }
  });
}

/**
 * Behandelt eingehende Nachrichten von anderen Teilen der Erweiterung.
 * @param {object} message - Die empfangene Nachricht.
 * @param {object} sender - Informationen über den Absender.
 * @param {function} sendResponse - Funktion zum Senden einer Antwort.
 * @returns {boolean} - Gibt `true` zurück, um anzuzeigen, dass die Antwort asynchron gesendet wird.
 */
function handleMessages(message, sender, sendResponse) {
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
            const { [STORAGE_KEYS.BLOCKED_COUNT]: blocked = 0 } = await chrome.storage.local.get(STORAGE_KEYS.BLOCKED_COUNT);
            const { sessionBlockedCount = 0 } = await chrome.storage.session.get('sessionBlockedCount');
            sendResponse({ blocked: blocked + sessionBlockedCount });
            break;
        }

        default:
          sendResponse({ error: 'Unbekannter Befehl' });
          break;
      }
    } catch (error) {
      console.error('Pagy-Blocker: Fehler bei der Nachrichtenverarbeitung.', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true; // Wichtig für asynchrone sendResponse
}

/**
 * Schaltet den globalen Pausenzustand der Erweiterung um.
 * @param {boolean} isPaused - Der neue Pausenzustand.
 */
async function togglePauseState(isPaused) {
  await chrome.storage.local.set({ [STORAGE_KEYS.IS_PAUSED]: isPaused });
  updateIcon(isPaused);
}




// Listener: Zähler für geblockte Anfragen erhöhen
// Performance-Optimierung: Zähler im schnellen Session-Speicher erhöhen
chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async () => {
  try {
    const { sessionBlockedCount = 0 } = await chrome.storage.session.get('sessionBlockedCount');
    await chrome.storage.session.set({ sessionBlockedCount: sessionBlockedCount + 1 });
  } catch (err) {
    console.error('Pagy-Blocker: Fehler beim Aktualisieren des Session-Blockier-Zählers:', err);
  }
});

// Alarm einrichten, um den Zähler periodisch zu speichern
chrome.alarms.create('persistBlockerCount', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'persistBlockerCount') {
    const { sessionBlockedCount = 0 } = await chrome.storage.session.get('sessionBlockedCount');
    if (sessionBlockedCount > 0) {
      const { [STORAGE_KEYS.BLOCKED_COUNT]: totalCount = 0 } = await chrome.storage.local.get(STORAGE_KEYS.BLOCKED_COUNT);
      await chrome.storage.local.set({ [STORAGE_KEYS.BLOCKED_COUNT]: totalCount + sessionBlockedCount });
      await chrome.storage.session.set({ sessionBlockedCount: 0 }); // Zähler zurücksetzen
      console.log(`Pagy-Blocker: ${sessionBlockedCount} geblockte Anfragen persistent gespeichert.`);
    }
  }
});

// Event-Listener registrieren
chrome.runtime.onInstalled.addListener(onInstallOrUpdate);
chrome.runtime.onMessage.addListener(handleMessages);

// Initialen Icon-Status beim Start des Browsers setzen
(async () => {
    try {
        const { [STORAGE_KEYS.IS_PAUSED]: isPaused } = await chrome.storage.local.get(STORAGE_KEYS.IS_PAUSED);
        updateIcon(isPaused || false);
    } catch (error) {
        console.error("Fehler beim initialen Setzen des Icons:", error);
    }
})();
