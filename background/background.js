// pagy-blocker-main/background/background.js

let blockedRequests = {};
let totalBlocked = 0;
let whitelistedDomains = new Set();
let isEnabled = true; // Global toggle for the entire extension

// Lade den Status aus dem Speicher beim Start
chrome.storage.local.get(['totalBlocked', 'whitelistedDomains', 'isEnabled'], function(data) {
    totalBlocked = data.totalBlocked || 0;
    if (data.whitelistedDomains && Array.isArray(data.whitelistedDomains)) {
        whitelistedDomains = new Set(data.whitelistedDomains);
    }
    if (typeof data.isEnabled === 'boolean') {
        isEnabled = data.isEnabled;
    }
});

function getDomainFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch (e) {
        return null;
    }
}

chrome.webRequest.onBeforeRequest.addListener(
    function(details) {
        if (!isEnabled) {
            return {cancel: false}; // Blocker ist global deaktiviert
        }

        // Die Domain des TABS (Initiator) verwenden, nicht die der Anfrage-URL
        const initiatorDomain = details.initiator ? getDomainFromUrl(details.initiator) : null;
        if (initiatorDomain && whitelistedDomains.has(initiatorDomain)) {
            return {cancel: false}; // Domain ist auf der Whitelist
        }

        if (details.tabId === -1) {
            return {cancel: false}; // Ignoriere Anfragen, die nicht von einem Tab stammen
        }
        
        if (!blockedRequests[details.tabId]) {
            blockedRequests[details.tabId] = 0;
        }
        blockedRequests[details.tabId]++;
        totalBlocked++;
        
        chrome.storage.local.set({totalBlocked: totalBlocked});
        
        chrome.action.setBadgeText({
            text: blockedRequests[details.tabId].toString(),
            tabId: details.tabId
        });
        chrome.action.setBadgeBackgroundColor({color: '#dc3545'});

        return {cancel: true};
    },
    {urls: ["<all_urls>"]},
    ["blocking"]
);

chrome.runtime.onMessage.addListener(
    function(request, sender, sendResponse) {
        if (request.type === "getStats") {
            const tabId = request.tabId;
            sendResponse({
                blockedCount: blockedRequests[tabId] || 0
            });
        } else if (request.type === "getDomainStatus") {
            sendResponse({ enabled: !whitelistedDomains.has(request.domain) });
        } else if (request.type === "toggleDomain") {
            if (request.enable) {
                whitelistedDomains.delete(request.domain);
            } else {
                whitelistedDomains.add(request.domain);
            }
            // Speichere die Whitelist als Array, da Set nicht direkt in JSON umgewandelt werden kann
            chrome.storage.local.set({whitelistedDomains: [...whitelistedDomains]}, function() {
                sendResponse({success: true});
            });
            return true; // Wichtig für asynchrone Antwort
        }
        return true;
    }
);

chrome.tabs.onRemoved.addListener(function(tabId) {
    delete blockedRequests[tabId];
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.status === 'loading') {
        blockedRequests[tabId] = 0;
        const domain = getDomainFromUrl(tab.url);
        
        if (domain && whitelistedDomains.has(domain)) {
            // Wenn die Domain auf der Whitelist steht, zeige ein Häkchen
            chrome.action.setBadgeText({text: '✓', tabId: tabId});
            chrome.action.setBadgeBackgroundColor({color: '#28a745'});
        } else {
            // Ansonsten Badge leeren
             chrome.action.setBadgeText({text: '', tabId: tabId});
        }
    }
});
