// pagy-blocker-main/popup/popup.js

document.addEventListener('DOMContentLoaded', function() {
    const pageBlockedCountEl = document.getElementById('page-blocked-count');
    const totalBlockedCountEl = document.getElementById('total-blocked-count');
    const domainNameEl = document.getElementById('domain-name');
    const toggleBtn = document.getElementById('toggle-blocker-btn');

    let currentTab;
    let currentDomain;

    // Funktion zum Aktualisieren des UI-Zustands des Toggle-Buttons
    function updateToggleButton(isBlockingEnabled) {
        if (isBlockingEnabled) {
            toggleBtn.textContent = 'Blocker für diese Seite deaktivieren';
            toggleBtn.classList.remove('enabled');
            toggleBtn.classList.add('disabled'); // Rote Farbe für "deaktivieren"
        } else {
            toggleBtn.textContent = 'Blocker für diese Seite aktivieren';
            toggleBtn.classList.remove('disabled');
            toggleBtn.classList.add('enabled'); // Grüne Farbe für "aktivieren"
        }
        toggleBtn.disabled = false;
    }

    // Hauptfunktion zum Initialisieren des Popups
    function initializePopup(tabs) {
        if (!tabs || tabs.length === 0 || !tabs[0]) {
            domainNameEl.textContent = "Kein aktiver Tab";
            pageBlockedCountEl.textContent = 'N/A';
            toggleBtn.textContent = 'Nicht verfügbar';
            toggleBtn.disabled = true;
            return;
        }
        currentTab = tabs[0];

        // Überprüfen, ob der Tab eine gültige URL für die Verarbeitung hat
        if (currentTab.url && (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://'))) {
            try {
                const url = new URL(currentTab.url);
                currentDomain = url.hostname;
                domainNameEl.textContent = currentDomain;

                // Status vom Hintergrundskript abfragen (ist die Seite auf der Whitelist?)
                chrome.runtime.sendMessage({type: "getDomainStatus", domain: currentDomain}, function(response) {
                    if (chrome.runtime.lastError) {
                        console.error("Pagy Blocker Fehler:", chrome.runtime.lastError.message);
                        toggleBtn.textContent = 'Fehler';
                        return;
                    }
                    if (response) {
                        updateToggleButton(response.enabled);
                    }
                });

            } catch (e) {
                domainNameEl.textContent = 'Spezialseite';
                toggleBtn.textContent = 'Nicht verfügbar';
                toggleBtn.disabled = true;
            }
        } else {
            domainNameEl.textContent = currentTab.url ? 'Spezialseite' : 'Leerer Tab';
            toggleBtn.textContent = 'Nicht verfügbar';
            toggleBtn.disabled = true;
        }

        // Anzahl der blockierten Elemente für diese Seite abrufen
        chrome.runtime.sendMessage({type: "getStats", tabId: currentTab.id}, function(response) {
            if (chrome.runtime.lastError) {
                pageBlockedCountEl.textContent = 'N/A';
                console.error("Pagy Blocker Fehler:", chrome.runtime.lastError.message);
                return;
            }
            if (response && typeof response.blockedCount === 'number') {
                pageBlockedCountEl.textContent = response.blockedCount;
            } else {
                pageBlockedCountEl.textContent = '0'; // Standardwert 0, wenn nichts zurückkommt
            }
        });
    }

    // Fragt den aktuell aktiven Tab ab und startet die Initialisierung
    chrome.tabs.query({active: true, currentWindow: true}, initializePopup);

    // Gesamtzahl der blockierten Elemente aus dem Speicher abrufen
    chrome.storage.local.get('totalBlocked', function(data) {
        totalBlockedCountEl.textContent = data.totalBlocked || 0;
    });

    // Event-Listener für den Toggle-Button
    toggleBtn.addEventListener('click', function() {
        if (!currentDomain || toggleBtn.disabled) {
            return;
        }
        
        // Den aktuellen Zustand aus dem Text des Buttons ableiten
        const shouldEnableBlocking = toggleBtn.textContent.includes('aktivieren');

        // Nachricht an das Hintergrundskript senden, um den Status zu ändern
        chrome.runtime.sendMessage({type: "toggleDomain", domain: currentDomain, enable: shouldEnableBlocking}, function(response) {
             if (response && response.success) {
                updateToggleButton(shouldEnableBlocking);
                // Seite neu laden, damit die Änderungen sofort sichtbar werden
                chrome.tabs.reload(currentTab.id);
                // Popup schließen für eine bessere User Experience
                window.close();
             }
        });
    });
});
