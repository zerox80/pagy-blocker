// popup/popup.js
// Performance: DOM-Caching und Fast-Access
const DOM = {
  ruleCount: null,
  refreshButton: null,
  init() {
    this.ruleCount = document.getElementById('rule-count');
    this.refreshButton = document.getElementById('refresh-button');
    
    // Validate DOM elements exist
    if (!this.ruleCount) {
      console.error('Required DOM element "rule-count" not found');
      throw new Error('Critical DOM element missing: rule-count');
    }
    if (!this.refreshButton) {
      console.error('Required DOM element "refresh-button" not found');
      throw new Error('Critical DOM element missing: refresh-button');
    }
  }
};

// Performance: Advanced UI state management
let lastDisplayedStats = null;
let updateInProgress = false;
const UPDATE_THROTTLE = 100; // ms

// Performance: Optimized DOM updates mit virtueller diff
function updateStatsDisplay(stats) {
    if (updateInProgress) return;
    
    // Performance: Deep comparison vermeiden durch spezifische Checks
    const shouldUpdate = !lastDisplayedStats || 
                        lastDisplayedStats.ruleCount !== stats.ruleCount ||
                        lastDisplayedStats.cached !== stats.cached;
    
    if (shouldUpdate) {
        updateInProgress = true;
        
        // Performance: Batch DOM operations
        requestAnimationFrame(() => {
            const displayValue = (stats.ruleCount !== undefined && typeof stats.ruleCount === 'number') 
                ? stats.ruleCount.toLocaleString() 
                : (stats.ruleCount || 'N/A');
            
            // Performance: Nur bei Änderung aktualisieren
            if (DOM.ruleCount.textContent !== displayValue) {
                DOM.ruleCount.textContent = displayValue;
            }
            
            // Performance: Visual feedback für Cache-Status using CSS classes
            DOM.ruleCount.className = stats.cached ? 'loading' : 'loaded';
            
            lastDisplayedStats = { ...stats };
            updateInProgress = false;
            console.log("Popup updated with stats:", stats);
        });
    }
}

// Performance: Advanced throttling und Promise-based requests
let fetchStatsPromise = null;
let reloadRulesPromise = null;
let lastFetchTime = 0;

function reloadRules() {
    if (reloadRulesPromise) {
        return reloadRulesPromise;
    }
    
    DOM.ruleCount.textContent = 'Lädt...';
    DOM.ruleCount.className = 'loading';
    
    reloadRulesPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Reload timeout'));
        }, 10000);
        
        chrome.runtime.sendMessage({ action: "reloadRules" }, (response) => {
            clearTimeout(timeout);
            reloadRulesPromise = null;
            
            if (chrome.runtime.lastError) {
                console.error("Error reloading rules:", chrome.runtime.lastError.message);
                // Robuste UI-Wiederherstellung
                try {
                    DOM.ruleCount.textContent = 'Fehler';
                    DOM.ruleCount.className = 'error';
                } catch (uiError) {
                    console.error("Failed to update UI during error handling:", uiError);
                }
                reject(chrome.runtime.lastError);
                return;
            }
            
            if (response && response.success) {
                updateStatsDisplay({
                    ruleCount: response.ruleCount,
                    ruleStats: response.ruleStats,
                    cached: false
                });
                resolve(response);
            } else {
                console.error("Reload failed:", response?.message || 'Unknown error');
                DOM.ruleCount.textContent = 'Fehler';
                DOM.ruleCount.style.opacity = '1';
                reject(new Error(response?.message || 'Reload failed'));
            }
        });
    });
    
    return reloadRulesPromise;
}

function fetchStats() {
    const now = Date.now();
    
    // Performance: Throttle requests
    if (now - lastFetchTime < UPDATE_THROTTLE) {
        return fetchStatsPromise || Promise.resolve();
    }
    
    // Performance: Reuse in-flight request
    if (fetchStatsPromise) {
        return fetchStatsPromise;
    }
    
    lastFetchTime = now;
    DOM.ruleCount.textContent = 'Lädt...';
    DOM.ruleCount.className = 'loading';
    
    fetchStatsPromise = new Promise((resolve, reject) => {
        // Performance: Timeout für hängende Requests
        const timeout = setTimeout(() => {
            reject(new Error('Request timeout'));
        }, 2000);
        
        chrome.runtime.sendMessage({ action: "getStats" }, (response) => {
            clearTimeout(timeout);
            fetchStatsPromise = null;
            
            if (chrome.runtime.lastError) {
                console.error("Error fetching stats:", chrome.runtime.lastError.message);
                DOM.ruleCount.textContent = 'Fehler';
                DOM.ruleCount.style.opacity = '1';
                reject(chrome.runtime.lastError);
                return;
            }
            
            if (response) {
                updateStatsDisplay(response);
                resolve(response);
            } else {
                console.warn("No response from background script, trying storage fallback");
                // Performance: Fast storage fallback
                chrome.storage.local.get(['ruleCount']).then(stats => {
                    updateStatsDisplay(stats);
                    resolve(stats);
                }).catch(err => {
                    console.error("Storage fallback failed:", err);
                    DOM.ruleCount.textContent = 'Fehler';
                    DOM.ruleCount.className = 'error';
                    reject(err);
                });
            }
        });
    });
    
    return fetchStatsPromise;
}

// Performance: Optimized event handling and initialization
function initializePopup() {
    try {
        DOM.init();
        
        // Performance: Event delegation und optimierte Listeners
        DOM.refreshButton.addEventListener('click', (e) => {
            e.preventDefault();
            reloadRules().catch(error => {
                console.error("Failed to reload rules:", error);
                // Fallback UI state
                try {
                    DOM.ruleCount.textContent = 'Fehler';
                    DOM.ruleCount.className = 'error';
                } catch (uiError) {
                    console.error("Critical UI error:", uiError);
                }
            });
        }, { passive: false });
        
        // Performance: Immediate load ohne DOMContentLoaded delay
        fetchStats().catch(error => {
            console.error("Failed to fetch initial stats:", error);
            // Set fallback state
            try {
                DOM.ruleCount.textContent = 'N/A';
                DOM.ruleCount.style.opacity = '1';
            } catch (uiError) {
                console.error("Critical UI error during initialization:", uiError);
            }
        });
        
        // Performance: Preload auf Hover für bessere UX
        DOM.refreshButton.addEventListener('mouseenter', () => {
            // Prefetch im Hintergrund
            if (Date.now() - lastFetchTime > UPDATE_THROTTLE) {
                setTimeout(() => fetchStats().catch(() => {}), 50);
            }
        }, { passive: true, once: false });
        
    } catch (initError) {
        console.error("Failed to initialize popup:", initError);
        // Critical error - display basic error message
        document.body.innerHTML = '<div style="padding: 10px; color: red;">Initialization Error</div>';
    }
}

// Start immediately
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePopup, { once: true });
} else {
    initializePopup();
}