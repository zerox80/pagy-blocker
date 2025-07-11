// popup/popup.js
// Simple popup management

let ruleCountElement;
let refreshButton;
let isUpdating = false;

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

// Simple reload function
function reloadRules() {
    if (isUpdating) return;
    
    isUpdating = true;
    ruleCountElement.textContent = 'Lädt...';
    ruleCountElement.className = 'loading';
    
    chrome.runtime.sendMessage({ action: "reloadRules" }, (response) => {
        isUpdating = false;
        
        if (chrome.runtime.lastError) {
            console.error("Error reloading rules:", chrome.runtime.lastError.message);
            ruleCountElement.textContent = 'Fehler';
            ruleCountElement.className = 'error';
            return;
        }
        
        if (response && response.success) {
            updateStatsDisplay({
                ruleCount: response.ruleCount,
                ruleStats: response.ruleStats
            });
        } else {
            console.error("Reload failed:", response?.message || 'Unknown error');
            ruleCountElement.textContent = 'Fehler';
            ruleCountElement.className = 'error';
        }
    });
}

// Simple stats fetching
function fetchStats() {
    if (isUpdating) return;
    
    isUpdating = true;
    ruleCountElement.textContent = 'Lädt...';
    ruleCountElement.className = 'loading';
    
    chrome.runtime.sendMessage({ action: "getStats" }, (response) => {
        isUpdating = false;
        
        if (chrome.runtime.lastError) {
            console.error("Error fetching stats:", chrome.runtime.lastError.message);
            ruleCountElement.textContent = 'Fehler';
            ruleCountElement.className = 'error';
            return;
        }
        
        if (response) {
            updateStatsDisplay(response);
        } else {
            // Fallback to storage
            chrome.storage.local.get(['ruleCount']).then(stats => {
                updateStatsDisplay(stats);
            }).catch(err => {
                console.error("Storage fallback failed:", err);
                ruleCountElement.textContent = 'Fehler';
                ruleCountElement.className = 'error';
            });
        }
    });
}

// Simple popup initialization
function initializePopup() {
    try {
        // Get DOM elements
        ruleCountElement = document.getElementById('rule-count');
        refreshButton = document.getElementById('refresh-button');
        
        if (!ruleCountElement || !refreshButton) {
            throw new Error('Required DOM elements not found');
        }
        
        // Add click handler
        refreshButton.addEventListener('click', (e) => {
            e.preventDefault();
            reloadRules();
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