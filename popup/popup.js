let ruleCountElement;
let refreshButton;
let toggleButton;
let statusElement;
let domainElement;
let isUpdating = false;

let cachedStats = null;
let cacheTimestamp = 0;
let currentDomain = null;
const POPUP_CACHE_DURATION = 5000;
const MESSAGE_TIMEOUT = 3000;

function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.toLowerCase();
    } catch (error) {
        console.warn("Invalid URL:", url);
        return null;
    }
}

async function getCurrentTabDomain() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) {
            const activeTab = tabs[0];
            if (activeTab.url && (activeTab.url.startsWith('http://') || activeTab.url.startsWith('https://'))) {
                return extractDomain(activeTab.url);
            }
        }
        return null;
    } catch (error) {
        console.error("Failed to get current tab domain:", error);
        return null;
    }
}

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

function updateStatusDisplay(enabled) {
    if (statusElement) {
        const domainText = currentDomain ? ` für ${currentDomain}` : '';
        statusElement.textContent = (enabled ? 'Aktiviert' : 'Deaktiviert') + domainText;
        statusElement.className = enabled ? 'enabled' : 'disabled';
    }
    
    if (toggleButton) {
        const actionText = enabled ? 'Deaktivieren' : 'Aktivieren';
        const domainText = currentDomain ? ` für ${currentDomain}` : '';
        toggleButton.textContent = actionText + domainText;
        toggleButton.className = enabled ? 'enabled' : 'disabled';
    }
    
    if (domainElement && currentDomain) {
        domainElement.textContent = currentDomain;
        domainElement.style.display = 'block';
    } else if (domainElement) {
        domainElement.style.display = 'none';
    }
}

function toggleBlocker() {
    if (isUpdating) {
        console.log("Update in progress, skipping toggle");
        return;
    }
    
    if (!currentDomain) {
        console.error("No domain available for toggle");
        statusElement.textContent = 'Fehler: Keine Domain';
        statusElement.className = 'error';
        return;
    }
    
    console.log("Starting toggle for domain:", currentDomain);
    isUpdating = true;
    toggleButton.disabled = true;
    statusElement.textContent = 'Wird geändert...';
    
    chrome.runtime.sendMessage({ action: "toggleBlocker", domain: currentDomain }, (response) => {
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

function reloadRules() {
    if (isUpdating) {
        console.log("Reload already in progress, skipping");
        return;
    }
    
    isUpdating = true;
    ruleCountElement.textContent = 'Lädt...';
    ruleCountElement.className = 'loading';
    
    cachedStats = null;
    cacheTimestamp = 0;
    
    const timeoutId = setTimeout(() => {
        if (isUpdating) {
            isUpdating = false;
            ruleCountElement.textContent = 'Timeout';
            ruleCountElement.className = 'error';
        }
    }, MESSAGE_TIMEOUT);
    
    chrome.runtime.sendMessage({ action: "reloadRules", domain: currentDomain }, (response) => {
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

function fetchStats() {
    if (isUpdating) {
        console.log("Update already in progress, skipping stats fetch");
        return;
    }
    
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
            tryStorageFallback();
        }
    }, MESSAGE_TIMEOUT);
    
    chrome.runtime.sendMessage({ action: "getStats", domain: currentDomain }, (response) => {
        clearTimeout(timeoutId);
        isUpdating = false;
        
        if (chrome.runtime.lastError) {
            console.error("Error fetching stats:", chrome.runtime.lastError.message);
            tryStorageFallback();
            return;
        }
        
        if (response) {
            cachedStats = response;
            cacheTimestamp = now;
            updateStatsDisplay(response);
            updateStatusDisplay(response.enabled !== false);
        } else {
            tryStorageFallback();
        }
    });
}

function tryStorageFallback() {
    chrome.storage.local.get(['ruleCount', 'ruleStats', 'disabledWebsites']).then(stats => {
        if (stats.ruleCount !== undefined) {
            const disabledWebsites = stats.disabledWebsites || [];
            const enabled = currentDomain ? !disabledWebsites.includes(currentDomain) : true;
            
            const fallbackStats = {
                ruleCount: stats.ruleCount,
                ruleStats: stats.ruleStats || {},
                enabled: enabled
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

async function initializePopup() {
    try {
        ruleCountElement = document.getElementById('rule-count');
        refreshButton = document.getElementById('refresh-button');
        toggleButton = document.getElementById('toggle-button');
        statusElement = document.getElementById('blocker-status');
        domainElement = document.getElementById('current-domain'); // Optional element
        
        if (!ruleCountElement || !refreshButton || !toggleButton || !statusElement) {
            throw new Error('Required DOM elements not found');
        }
        
        currentDomain = await getCurrentTabDomain();
        console.log("Current domain:", currentDomain);
        
        if (!currentDomain) {
            statusElement.textContent = 'Nicht auf einer Website';
            statusElement.className = 'disabled';
            toggleButton.textContent = 'Nicht verfügbar';
            toggleButton.disabled = true;
            ruleCountElement.textContent = 'N/A';
            return;
        }
        
        refreshButton.addEventListener('click', (e) => {
            e.preventDefault();
            reloadRules();
        });
        
        toggleButton.addEventListener('click', (e) => {
            e.preventDefault();
            toggleBlocker();
        });
        
        fetchStats();
        
    } catch (error) {
        console.error("Failed to initialize popup:", error);
        document.body.innerHTML = '<div style="padding: 10px; color: red;">Initialization Error</div>';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePopup);
} else {
    initializePopup();
}