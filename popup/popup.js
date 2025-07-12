let ruleCountElement;
let refreshButton;
let toggleButton;
let statusElement;
let domainElement;
let isUpdating = false;

let cachedStats = null;
let cacheTimestamp = 0;
let currentDomain = null;
const POPUP_CACHE_DURATION = 1500; // Reduziert für maximale Reaktionsfähigkeit
const MESSAGE_TIMEOUT = 1500; // Schneller Timeout für sofortigen Fallback

function extractDomain(url) {
    try {
        // Schnelle Domain-Extraktion ohne URL-Konstruktor-Overhead
        const protocolEnd = url.indexOf('://');
        if (protocolEnd === -1) return null;
        
        const afterProtocol = url.substring(protocolEnd + 3);
        const pathStart = afterProtocol.indexOf('/');
        const domain = pathStart === -1 ? afterProtocol : afterProtocol.substring(0, pathStart);
        
        return domain.toLowerCase();
    } catch (error) {
        console.warn("Ungültige URL:", url);
        return null;
    }
}

async function getCurrentTabDomain() {
    try {
        if (!chrome.tabs?.query) {
            console.warn("chrome.tabs.query nicht verfügbar");
            return null;
        }
        
        // Schnelle Tab-Abfrage mit minimalen Optionen
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.url) {
            const url = tabs[0].url;
            // Schnelle Protokoll-Prüfung
            if (url[0] === 'h' && (url.startsWith('http://') || url.startsWith('https://'))) {
                return extractDomain(url);
            }
        }
        return null;
    } catch (error) {
        console.error("Fehler beim Abrufen der aktuellen Tab-Domain:", error);
        return null;
    }
}

function updateStatsDisplay(stats) {
    if (isUpdating) return;
    
    isUpdating = true;
    
    // Schnelle Zahlen-Formatierung ohne Locale-Overhead
    const displayValue = (typeof stats.ruleCount === 'number') 
        ? (stats.ruleCount >= 1000 ? `${Math.floor(stats.ruleCount/1000)}k` : stats.ruleCount.toString())
        : (stats.ruleCount || 'N/A');
    
    // Direkte Eigenschaftszuweisung für schnelle DOM-Aktualisierungen
    ruleCountElement.textContent = displayValue;
    ruleCountElement.className = 'loaded';
    
    isUpdating = false;
    console.log("Popup aktualisiert:", stats);
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
        console.log("Aktualisierung läuft, überspringe Umschaltung");
        return;
    }
    
    if (!currentDomain) {
        console.error("Keine Domain für Umschaltung verfügbar");
        statusElement.textContent = 'Fehler: Keine Domain';
        statusElement.className = 'error';
        return;
    }
    
    console.log("Starte Umschaltung für Domain:", currentDomain);
    isUpdating = true;
    toggleButton.disabled = true;
    statusElement.textContent = 'Wird geändert...';
    
    chrome.runtime.sendMessage({ action: "toggleBlocker", domain: currentDomain }, (response) => {
        console.log("Umschalt-Antwort:", response);
        isUpdating = false;
        toggleButton.disabled = false;
        
        if (chrome.runtime.lastError) {
            console.error("Fehler beim Umschalten des Blockers:", chrome.runtime.lastError.message);
            statusElement.textContent = 'Fehler';
            statusElement.className = 'error';
            return;
        }
        
        if (response && response.success) {
            console.log("Umschaltung erfolgreich, aktiviert:", response.enabled);
            updateStatusDisplay(response.enabled);
        } else {
            console.error("Umschaltung fehlgeschlagen oder ungültige Antwort:", response);
            statusElement.textContent = 'Fehler';
            statusElement.className = 'error';
        }
    });
}

function reloadRules() {
    if (isUpdating) {
        console.log("Neuladen bereits im Gange, überspringe");
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
            console.error("Fehler beim Neuladen der Regeln:", chrome.runtime.lastError.message);
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
            console.error("Neuladen fehlgeschlagen:", response?.message || 'Unbekannter Fehler');
            ruleCountElement.textContent = 'Fehler';
            ruleCountElement.className = 'error';
            statusElement.textContent = 'Fehler';
            statusElement.className = 'error';
        }
    });
}

function fetchStats() {
    if (isUpdating) {
        console.log("Aktualisierung bereits im Gange, überspringe Statistik-Abruf");
        return;
    }
    
    const now = Date.now();
    if (cachedStats && (now - cacheTimestamp) < POPUP_CACHE_DURATION) {
        console.log("Verwende gecachte Statistiken");
        updateStatsDisplay(cachedStats);
        updateStatusDisplay(cachedStats.enabled !== false);
        return;
    }
    
    isUpdating = true;
    ruleCountElement.textContent = 'Loading...';
    ruleCountElement.className = 'loading';
    
    // Schnellerer Fallback mit reduziertem Timeout
    const timeoutId = setTimeout(() => {
        if (isUpdating) {
            isUpdating = false;
            tryStorageFallback();
        }
    }, MESSAGE_TIMEOUT);
    
    // Prüfe ob Runtime verfügbar ist bevor Nachricht gesendet wird
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
        clearTimeout(timeoutId);
        isUpdating = false;
        tryStorageFallback();
        return;
    }
    
    chrome.runtime.sendMessage({ action: "getStats", domain: currentDomain }, (response) => {
        clearTimeout(timeoutId);
        isUpdating = false;
        
        if (chrome.runtime.lastError) {
            console.error("Fehler beim Abrufen der Statistiken:", chrome.runtime.lastError.message);
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
    if (!chrome.storage || !chrome.storage.local) {
        console.warn("chrome.storage.local nicht verfügbar");
        ruleCountElement.textContent = 'Error';
        ruleCountElement.className = 'error';
        statusElement.textContent = 'Error';
        return;
    }
    
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
            statusElement.textContent = 'Unknown';
            console.warn("Keine Regel-Anzahl im Speicher-Fallback gefunden");
        }
    }).catch(err => {
        console.error("Speicher-Fallback fehlgeschlagen:", err);
        ruleCountElement.textContent = 'Error';
        ruleCountElement.className = 'error';
        statusElement.textContent = 'Error';
    });
}

async function initializePopup() {
    try {
        // Schnelle DOM-Element-Abfrage
        const elements = {
            ruleCount: document.getElementById('rule-count'),
            refresh: document.getElementById('refresh-button'),
            toggle: document.getElementById('toggle-button'),
            status: document.getElementById('blocker-status'),
            domain: document.getElementById('current-domain')
        };
        
        ruleCountElement = elements.ruleCount;
        refreshButton = elements.refresh;
        toggleButton = elements.toggle;
        statusElement = elements.status;
        domainElement = elements.domain;
        
        if (!ruleCountElement || !refreshButton || !toggleButton || !statusElement) {
            throw new Error('Erforderliche DOM-Elemente nicht gefunden');
        }
        
        // Schnelle parallele Domain-Abfrage und Event-Setup
        currentDomain = await getCurrentTabDomain();
        console.log("Domain:", currentDomain);
        
        if (!currentDomain) {
            statusElement.textContent = 'Nicht auf einer Website';
            statusElement.className = 'disabled';
            toggleButton.textContent = 'Nicht verfügbar';
            toggleButton.disabled = true;
            ruleCountElement.textContent = 'N/A';
            return;
        }
        
        // Schnelle Event-Listener mit passiver Option wo möglich
        refreshButton.addEventListener('click', (e) => {
            e.preventDefault();
            reloadRules();
        }, { passive: false });
        
        toggleButton.addEventListener('click', (e) => {
            e.preventDefault();
            toggleBlocker();
        }, { passive: false });
        
        // Sofortige Statistik-Abfrage
        fetchStats();
        
    } catch (error) {
        console.error("Fehler beim Initialisieren des Popups:", error);
        document.body.innerHTML = '<div style="padding: 10px; color: red;">Initialisierungs-Fehler</div>';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePopup);
} else {
    initializePopup();
}