// popup/popup.js
// Performance: DOM-Caching und Fast-Access
const DOM = {
  ruleCount: null,
  refreshButton: null,
  init() {
    this.ruleCount = document.getElementById('rule-count');
    this.refreshButton = document.getElementById('refresh-button');
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
            
            // Performance: Visual feedback für Cache-Status
            if (stats.cached) {
                DOM.ruleCount.style.opacity = '0.9';
            } else {
                DOM.ruleCount.style.opacity = '1';
            }
            
            lastDisplayedStats = { ...stats };
            updateInProgress = false;
            console.log("Popup updated with stats:", stats);
        });
    }
}

// Performance: Advanced throttling und Promise-based requests
let fetchStatsPromise = null;
let lastFetchTime = 0;

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
    DOM.ruleCount.style.opacity = '0.7';
    
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
                    DOM.ruleCount.style.opacity = '1';
                    reject(err);
                });
            }
        });
    });
    
    return fetchStatsPromise;
}

// Performance: Optimized event handling and initialization
function initializePopup() {
    DOM.init();
    
    // Performance: Event delegation und optimierte Listeners
    DOM.refreshButton.addEventListener('click', (e) => {
        e.preventDefault();
        fetchStats().catch(console.error);
    }, { passive: false });
    
    // Performance: Immediate load ohne DOMContentLoaded delay
    fetchStats().catch(console.error);
    
    // Performance: Preload auf Hover für bessere UX
    DOM.refreshButton.addEventListener('mouseenter', () => {
        // Prefetch im Hintergrund
        if (Date.now() - lastFetchTime > UPDATE_THROTTLE) {
            setTimeout(() => fetchStats().catch(() => {}), 50);
        }
    }, { passive: true, once: false });
}

// Start immediately
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePopup, { once: true });
} else {
    initializePopup();
}