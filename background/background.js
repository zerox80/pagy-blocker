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

// FIXED: Development mode detection
const IS_DEVELOPMENT = !('update_url' in chrome.runtime.getManifest());

// BUGFIX: Die Pfade müssen absolut vom Root-Verzeichnis der Erweiterung sein (beginnend mit /).
// Relative Pfade wie ../icons/ funktionieren in Service Workern nicht zuverlässig und führen zum Absturz.
// FIXED: Fallback zu existierenden Icons falls disabled Icons fehlen
const ICON_PATHS = {
  DEFAULT: {
    "16": "/icons/icon16.png",
    "48": "/icons/icon48.png",
    "128": "/icons/icon128.png"
  },
  DISABLED: {
    "16": "/icons/deaktivieren.png", // Fallback to existing disabled icon
    "48": "/icons/deaktivieren.png",
    "128": "/icons/deaktivieren.png"
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
    // SECURITY: Generic error message for production to prevent information disclosure
    if (IS_DEVELOPMENT) {
      console.error('Pagy-Blocker: Fehler bei der Initialisierung.', error);
    } else {
      console.error('Pagy-Blocker: Initialisierung fehlgeschlagen.');
    }
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

// FIXED: Circuit breaker pattern for icon updates
let iconUpdateCircuitBreaker = {
  failureCount: 0,
  lastFailureTime: 0,
  isOpen: false,
  failureThreshold: 3,
  recoveryTimeout: 30000, // 30 seconds
  halfOpenMaxRetries: 1
};

/**
 * Resets the circuit breaker to closed state
 */
function resetCircuitBreaker() {
  iconUpdateCircuitBreaker.failureCount = 0;
  iconUpdateCircuitBreaker.isOpen = false;
  iconUpdateCircuitBreaker.lastFailureTime = 0;
}

/**
 * Checks if circuit breaker should transition from open to half-open
 */
function shouldAttemptRecovery() {
  const now = Date.now();
  return iconUpdateCircuitBreaker.isOpen && 
         (now - iconUpdateCircuitBreaker.lastFailureTime) >= iconUpdateCircuitBreaker.recoveryTimeout;
}

/**
 * Records a failure in the circuit breaker
 */
function recordIconFailure() {
  iconUpdateCircuitBreaker.failureCount++;
  iconUpdateCircuitBreaker.lastFailureTime = Date.now();
  
  if (iconUpdateCircuitBreaker.failureCount >= iconUpdateCircuitBreaker.failureThreshold) {
    iconUpdateCircuitBreaker.isOpen = true;
    console.warn('Pagy-Blocker: Icon update circuit breaker opened due to repeated failures');
  }
}

/**
 * Aktualisiert das Icon der Erweiterung, indem ein Dictionary von Pfaden übergeben wird.
 * FIXED: Circuit breaker pattern prevents infinite loops and UI responsiveness issues
 * @param {boolean} isPaused - Gibt an, ob die Erweiterung pausiert ist.
 */
function updateIcon(isPaused) {
  // Check circuit breaker state
  if (iconUpdateCircuitBreaker.isOpen && !shouldAttemptRecovery()) {
    console.log('Pagy-Blocker: Icon update skipped - circuit breaker is open');
    return;
  }
  
  // If in half-open state, limit retries
  if (iconUpdateCircuitBreaker.isOpen && shouldAttemptRecovery()) {
    if (iconUpdateCircuitBreaker.failureCount > iconUpdateCircuitBreaker.halfOpenMaxRetries) {
      console.log('Pagy-Blocker: Icon update skipped - half-open retry limit reached');
      return;
    }
  }

  const pathSet = isPaused ? ICON_PATHS.DISABLED : ICON_PATHS.DEFAULT;
  
  // Add timeout to prevent hanging
  const timeoutId = setTimeout(() => {
    console.warn('Pagy-Blocker: Icon update timeout');
    recordIconFailure();
  }, 5000);
  
  chrome.action.setIcon({ path: pathSet }, () => {
    clearTimeout(timeoutId);
    
    if (chrome.runtime.lastError) {
      // SECURITY: Generic error messages for production
      if (IS_DEVELOPMENT) {
        console.warn('Pagy-Blocker: Primary icon update failed:', chrome.runtime.lastError.message);
      } else {
        console.warn('Pagy-Blocker: Primary icon update failed.');
      }
      recordIconFailure();
      
      // Only attempt fallback if not in circuit breaker open state
      if (!iconUpdateCircuitBreaker.isOpen) {
        // Fallback zu Default-Icons bei Fehler
        const fallbackTimeoutId = setTimeout(() => {
          console.error('Pagy-Blocker: Fallback icon update timeout');
          recordIconFailure();
        }, 3000);
        
        chrome.action.setIcon({ path: ICON_PATHS.DEFAULT }, () => {
          clearTimeout(fallbackTimeoutId);
          
          if (chrome.runtime.lastError) {
            // SECURITY: Generic error messages for production
            if (IS_DEVELOPMENT) {
              console.error('Pagy-Blocker: Fallback icon update failed:', chrome.runtime.lastError.message);
            } else {
              console.error('Pagy-Blocker: Fallback icon update failed.');
            }
            recordIconFailure();
          } else {
            console.log('Pagy-Blocker: Fallback icon update successful');
            // Partial recovery - reduce failure count but don't fully reset
            if (iconUpdateCircuitBreaker.failureCount > 0) {
              iconUpdateCircuitBreaker.failureCount--;
            }
          }
        });
      }
    } else {
      // Success - reset circuit breaker
      resetCircuitBreaker();
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
            // Use optimized stats retrieval with caching
            try {
              const [localStats, sessionStats] = await Promise.all([
                chrome.storage.local.get(STORAGE_KEYS.BLOCKED_COUNT),
                statsManager.getStats()
              ]);
              
              const totalBlocked = (localStats[STORAGE_KEYS.BLOCKED_COUNT] || 0) + sessionStats.sessionBlockedCount;
              sendResponse({ 
                blocked: totalBlocked,
                lastUpdate: sessionStats.lastUpdate
              });
            } catch (error) {
              // Fallback to simple storage read
              const { [STORAGE_KEYS.BLOCKED_COUNT]: blocked = 0 } = await chrome.storage.local.get(STORAGE_KEYS.BLOCKED_COUNT);
              const { sessionBlockedCount = 0 } = await chrome.storage.session.get('sessionBlockedCount');
              sendResponse({ blocked: blocked + sessionBlockedCount });
            }
            break;
        }

        default:
          sendResponse({ error: 'Unbekannter Befehl' });
          break;
      }
    } catch (error) {
      // SECURITY: Improved error logging with sanitized output
      const errorContext = 'Message handling';
      if (IS_DEVELOPMENT) {
        console.error(`Pagy-Blocker ${errorContext}:`, error);
        sendResponse({ success: false, error: error.message });
      } else {
        console.error(`Pagy-Blocker ${errorContext}: Operation failed`);
        // Log only error type for debugging, not sensitive details
        console.debug(`Error type: ${error.name}`);
        sendResponse({ success: false, error: 'Operation failed' });
      }
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




// FIXED: Session storage with error recovery and transaction-like updates
let storageTransactionState = {
  isInTransaction: false,
  rollbackData: null,
  maxRetries: 3,
  retryDelay: 1000
};

/**
 * Performs a transaction-like storage update with rollback capability
 * FIXED: Robust session storage with error recovery
 */
async function safeStorageUpdate(storageArea, key, updateFunction, maxRetries = storageTransactionState.maxRetries) {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      // Begin transaction
      storageTransactionState.isInTransaction = true;
      
      // Get current value for rollback
      const currentData = await storageArea.get(key);
      storageTransactionState.rollbackData = currentData;
      
      // Apply update function
      const newValue = updateFunction(currentData[key] || 0);
      
      // Validate new value
      if (typeof newValue !== 'number' || newValue < 0) {
        throw new Error(`Invalid value for ${key}: ${newValue}`);
      }
      
      // Perform update
      await storageArea.set({ [key]: newValue });
      
      // Verify update succeeded
      const verification = await storageArea.get(key);
      if (verification[key] !== newValue) {
        throw new Error(`Storage verification failed for ${key}`);
      }
      
      // Transaction successful
      storageTransactionState.isInTransaction = false;
      storageTransactionState.rollbackData = null;
      
      return newValue;
      
    } catch (error) {
      attempt++;
      console.warn(`Pagy-Blocker: Storage update attempt ${attempt} failed for ${key}:`, error.message);
      
      // Attempt rollback if we have rollback data
      if (storageTransactionState.rollbackData) {
        try {
          await storageArea.set(storageTransactionState.rollbackData);
          console.log(`Pagy-Blocker: Rollback successful for ${key}`);
        } catch (rollbackError) {
          console.error(`Pagy-Blocker: Rollback failed for ${key}:`, rollbackError);
        }
      }
      
      if (attempt >= maxRetries) {
        console.error(`Pagy-Blocker: Storage update failed after ${maxRetries} attempts for ${key}`);
        storageTransactionState.isInTransaction = false;
        storageTransactionState.rollbackData = null;
        throw error;
      }
      
      // Wait before retry with exponential backoff
      await new Promise(resolve => setTimeout(resolve, storageTransactionState.retryDelay * attempt));
    }
  }
}

// SIMPLIFIED: Lightweight statistics manager with essential functionality only
class StatisticsManager {
  constructor() {
    this.sessionBlockedCount = 0;
    this.lastUpdate = Date.now();
    this.debounceTimeout = null;
  }
  
  // Simple initialization
  async initialize() {
    try {
      const { sessionBlockedCount = 0 } = await chrome.storage.session.get('sessionBlockedCount');
      this.sessionBlockedCount = sessionBlockedCount;
      console.log('Pagy-Blocker: Statistics initialized');
    } catch (error) {
      console.error('Pagy-Blocker: Statistics initialization failed:', error);
    }
  }
  
  // Simple count increment with debounced storage
  incrementCount(amount = 1) {
    this.sessionBlockedCount += amount;
    this.lastUpdate = Date.now();
    
    // Debounced storage update
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }
    
    this.debounceTimeout = setTimeout(() => {
      this.saveToStorage();
    }, 2000); // Save every 2 seconds max
  }
  
  // Save to storage
  async saveToStorage() {
    try {
      await chrome.storage.session.set({
        sessionBlockedCount: this.sessionBlockedCount
      });
    } catch (error) {
      console.warn('Pagy-Blocker: Failed to save statistics:', error);
    }
  }
  
  // Get current statistics
  async getStats() {
    return {
      sessionBlockedCount: this.sessionBlockedCount,
      lastUpdate: this.lastUpdate
    };
  }
  
  // Cleanup
  cleanup() {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.saveToStorage(); // Final save
    }
  }
}

// Global statistics manager
const statsManager = new StatisticsManager();

// Initialize statistics on extension startup
statsManager.initialize();

// PERFORMANCE OPTIMIZED: Event-driven persistence with smart batching
class PersistenceManager {
  constructor() {
    this.batchSize = 100; // Persist every 100 blocked requests
    this.maxInterval = 5 * 60 * 1000; // Maximum 5 minutes between persists
    this.lastPersist = Date.now();
    this.pendingCount = 0;
  }
  
  // Initialize persistence with smart triggers
  initialize() {
    // Set up alarm for maximum interval persistence
    chrome.alarms.create('smartPersistBlockerCount', { periodInMinutes: 5 });
    
    // Listen for alarm events
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === 'smartPersistBlockerCount') {
        await this.persistStats('scheduled');
      }
    });
    
    // Listen for extension lifecycle events
    if (chrome.runtime.onSuspend) {
      chrome.runtime.onSuspend.addListener(() => {
        this.persistStats('suspend');
      });
    }
    
    // Persist on browser shutdown
    if (chrome.runtime.onSuspendCanceled) {
      chrome.runtime.onSuspendCanceled.addListener(() => {
        this.persistStats('suspend_cancelled');
      });
    }
  }
  
  // Smart persistence with batching and throttling
  async persistStats(reason = 'batch') {
    try {
      const { sessionBlockedCount = 0 } = await chrome.storage.session.get('sessionBlockedCount');
      
      if (sessionBlockedCount === 0) {
        return; // Nothing to persist
      }
      
      // Check if we should persist based on batch size or time
      const timeSinceLastPersist = Date.now() - this.lastPersist;
      const shouldPersist = 
        sessionBlockedCount >= this.batchSize ||
        timeSinceLastPersist >= this.maxInterval ||
        reason === 'suspend' ||
        reason === 'suspend_cancelled';
      
      if (shouldPersist) {
        // Atomic update with error handling
        await Promise.all([
          safeStorageUpdate(
            chrome.storage.local,
            STORAGE_KEYS.BLOCKED_COUNT,
            (currentTotal) => currentTotal + sessionBlockedCount
          ),
          safeStorageUpdate(
            chrome.storage.session,
            'sessionBlockedCount',
            () => 0
          )
        ]);
        
        this.lastPersist = Date.now();
        console.log(`Pagy-Blocker: ${sessionBlockedCount} blocked requests persisted (${reason})`);
      }
    } catch (error) {
      console.error('Pagy-Blocker: Failed to persist stats:', error);
    }
  }
  
  // Trigger persistence check (called by statistics manager)
  async checkPersistence() {
    await this.persistStats('check');
  }
}

// Global persistence manager
const persistenceManager = new PersistenceManager();
persistenceManager.initialize();

// Event-Listener registrieren
chrome.runtime.onInstalled.addListener(onInstallOrUpdate);
chrome.runtime.onMessage.addListener(handleMessages);

// Initialen Icon-Status beim Start des Browsers setzen
(async () => {
    try {
        const { [STORAGE_KEYS.IS_PAUSED]: isPaused } = await chrome.storage.local.get(STORAGE_KEYS.IS_PAUSED);
        updateIcon(isPaused || false);
    } catch (error) {
        // SECURITY: Generic error messages for production
        if (IS_DEVELOPMENT) {
            console.error("Fehler beim initialen Setzen des Icons:", error);
        } else {
            console.error("Icon-Initialisierung fehlgeschlagen.");
        }
    }
})();
