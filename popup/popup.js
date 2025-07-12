// popup/popup.js
// Optimized popup management with caching

let ruleCountElement;
let refreshButton;
let toggleButton;
let statusElement;
let isUpdating = false;

// Local cache for faster popup loading
let cachedStats = null;
let cacheTimestamp = 0;
const POPUP_CACHE_DURATION = 5000; // 5 seconds
const MESSAGE_TIMEOUT = 3000; // 3 seconds

// Simple stats display update
function updateStatsDisplay(stats) {
    if (isUpdating) return;
    
    isUpdating = true;
    
    const displayValue = (typeof stats.ruleCount === 'number') 
        ? stats.ruleCount.toLocaleString() 
        : (stats.ruleCount || 'N/A');
    
    ruleCountElement.textContent = displayValue;
    ruleCountElement.className = 'loaded';
    
    isUpdating = false;
    console.log("Popup updated:", stats);
}

// Update blocker status display
function updateStatusDisplay(enabled) {
    if (statusElement) {
        statusElement.textContent = enabled ? 'Aktiviert' : 'Deaktiviert';
        statusElement.className = enabled ? 'enabled' : 'disabled';
    }
    
    if (toggleButton) {
        toggleButton.textContent = enabled ? 'Deaktivieren' : 'Aktivieren';
        toggleButton.className = enabled ? 'enabled' : 'disabled';
    }
}

// Toggle blocker on/off
function toggleBlocker() {
    if (isUpdating) {
        console.log("Update in progress, skipping toggle");
        return;
    }
    
    console.log("Starting toggle...");
    isUpdating = true;
    toggleButton.disabled = true;
    statusElement.textContent = 'Wird geändert...';
    
    chrome.runtime.sendMessage({ action: "toggleBlocker" }, (response) => {
        console.log("Toggle response:", response);
        isUpdating = false;
        toggleButton.disabled = false;
        
        if (chrome.runtime.lastError) {
            console.error("Error toggling blocker:", chrome.runtime.lastError.message);
            statusElement.textContent = 'Fehler';
            statusElement.className = 'error';
            return;
        }
        
        if (response && response.success) {
            console.log("Toggle successful, enabled:", response.enabled);
            updateStatusDisplay(response.enabled);
        } else {
            console.error("Toggle failed or invalid response:", response);
            statusElement.textContent = 'Fehler';
            statusElement.className = 'error';
        }
    });
}

// Optimized reload function with timeout
function reloadRules() {
    if (isUpdating) {
        console.log("Reload already in progress, skipping");
        return;
    }
    
    isUpdating = true;
    ruleCountElement.textContent = 'Lädt...';
    ruleCountElement.className = 'loading';
    
    // Clear cache on reload
    cachedStats = null;
    cacheTimestamp = 0;
    
    const timeoutId = setTimeout(() => {
        if (isUpdating) {
            isUpdating = false;
            ruleCountElement.textContent = 'Timeout';
            ruleCountElement.className = 'error';
        }
    }, MESSAGE_TIMEOUT);
    
    chrome.runtime.sendMessage({ action: "reloadRules" }, (response) => {
        clearTimeout(timeoutId);
        isUpdating = false;
        
        if (chrome.runtime.lastError) {
            console.error("Error reloading rules:", chrome.runtime.lastError.message);
            ruleCountElement.textContent = 'Fehler';
            ruleCountElement.className = 'error';
            return;
        }
        
        if (response && response.success) {
            const stats = {
                ruleCount: response.ruleCount,
                ruleStats: response.ruleStats,
                enabled: response.enabled !== false
            };
            
            // Update cache
            cachedStats = stats;
            cacheTimestamp = Date.now();
            
            updateStatsDisplay(stats);
            updateStatusDisplay(stats.enabled);
        } else {
            console.error("Reload failed:", response?.message || 'Unknown error');
            ruleCountElement.textContent = 'Fehler';
            ruleCountElement.className = 'error';
            statusElement.textContent = 'Fehler';
            statusElement.className = 'error';
        }
    });
}

// Optimized stats fetching with caching
function fetchStats() {
    if (isUpdating) {
        console.log("Update already in progress, skipping stats fetch");
        return;
    }
    
    // Check cache first
    const now = Date.now();
    if (cachedStats && (now - cacheTimestamp) < POPUP_CACHE_DURATION) {
        console.log("Using cached stats");
        updateStatsDisplay(cachedStats);
        return;
    }
    
    isUpdating = true;
    ruleCountElement.textContent = 'Lädt...';
    ruleCountElement.className = 'loading';
    
    const timeoutId = setTimeout(() => {
        if (isUpdating) {
            isUpdating = false;
            // Try storage fallback on timeout
            tryStorageFallback();
        }
    }, MESSAGE_TIMEOUT);
    
    chrome.runtime.sendMessage({ action: "getStats" }, (response) => {
        clearTimeout(timeoutId);
        isUpdating = false;
        
        if (chrome.runtime.lastError) {
            console.error("Error fetching stats:", chrome.runtime.lastError.message);
            tryStorageFallback();
            return;
        }
        
        if (response) {
            // Update cache
            cachedStats = response;
            cacheTimestamp = now;
            updateStatsDisplay(response);
            updateStatusDisplay(response.enabled !== false); // Default to enabled
        } else {
            tryStorageFallback();
        }
    });
}

// Optimized storage fallback
function tryStorageFallback() {
    chrome.storage.local.get(['ruleCount', 'ruleStats', 'blockerEnabled']).then(stats => {
        if (stats.ruleCount !== undefined) {
            const fallbackStats = {
                ruleCount: stats.ruleCount,
                ruleStats: stats.ruleStats || {},
                enabled: stats.blockerEnabled !== false // Default to enabled
            };
            updateStatsDisplay(fallbackStats);
            updateStatusDisplay(fallbackStats.enabled);
        } else {
            ruleCountElement.textContent = 'N/A';
            ruleCountElement.className = 'error';
            statusElement.textContent = 'Unbekannt';
            console.warn("No rule count found in storage fallback");
        }
    }).catch(err => {
        console.error("Storage fallback failed:", err);
        ruleCountElement.textContent = 'Fehler';
        ruleCountElement.className = 'error';
        statusElement.textContent = 'Fehler';
    });
}

// Simple popup initialization
function initializePopup() {
    try {
        // Get DOM elements
        ruleCountElement = document.getElementById('rule-count');
        refreshButton = document.getElementById('refresh-button');
        toggleButton = document.getElementById('toggle-button');
        statusElement = document.getElementById('blocker-status');
        
        if (!ruleCountElement || !refreshButton || !toggleButton || !statusElement) {
            throw new Error('Required DOM elements not found');
        }
        
        // Add click handlers
        refreshButton.addEventListener('click', (e) => {
            e.preventDefault();
            reloadRules();
        });
        
        toggleButton.addEventListener('click', (e) => {
            e.preventDefault();
            toggleBlocker();
        });
        
        // Load initial stats
        fetchStats();
        
    } catch (error) {
        console.error("Failed to initialize popup:", error);
        document.body.innerHTML = '<div style="padding: 10px; color: red;">Initialization Error</div>';
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePopup);
} else {
    initializePopup();
}