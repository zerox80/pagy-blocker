/**
 * @file content.js
 * @description Wird in Webseiten injiziert, um Werbeelemente mit einem leistungsfähigen MutationObserver zu blockieren.
 * @version 5.0.0 Final & Verifiziert
 * @author zerox80 (Original)
 */
(async function() {
    'use strict';

    let rules = {};
    let isPaused = false;
    let observer = null;
    let isCleanedUp = false;
    const hostname = window.location.hostname;
    let debounceTimer = null;

    async function initialize() {
        if (isCleanedUp) return;
        try {
            const state = await chrome.runtime.sendMessage({ command: 'getState' });
            if (state?.isPaused) {
                isPaused = true;
                return;
            }
            await loadRules();
            await scanAndHideElements(document.body || document.documentElement);
            startObserver();
        } catch (error) {
            if (!error.message.includes('Receiving end does not exist')) {
                console.error('Pagy-Blocker: Initialisierung fehlgeschlagen:', error);
            }
            performCleanup();
        }
    }

    function applyStylesToElements(elements) {
        if (!elements.length) return;
        
        // Erstelle ein Style-Element für alle Selektoren auf einmal
        const style = document.createElement('style');
        style.id = 'pagy-blocker-styles';
        const selectorText = elements.map(el => {
            const id = 'pagy-blocker-' + Math.random().toString(36).substr(2, 9);
            el.dataset.pagyBlocked = id;
            return `[data-pagy-blocked="${id}"]`;
        }).join(',');
        
        style.textContent = `${selectorText} { display: none !important; }`;
        document.head.appendChild(style);
        
        // Melde die blockierte Anzahl
        chrome.runtime.sendMessage({
            command: 'updateBlockedCount',
            count: elements.length
        }).catch(() => {});
    }

    async function scanAndHideElements(element) {
        if (isPaused || isCleanedUp || !element) return;
        const selectors = [...new Set([...(rules[hostname]?.selectors || []), ...(rules['generic']?.selectors || [])])];
        if (selectors.length === 0) return;

        try {
            // Verwende einen einzigen Abfrage-Selektor für alle Selektoren
            const selectorString = selectors.join(',');
            const matched = Array.from(element.querySelectorAll(selectorString))
                .filter(el => !el.dataset.pagyBlocked); // Überspringe bereits blockierte Elemente

            if (matched.length > 0) {
                requestAnimationFrame(() => applyStylesToElements(matched));
            }
        } catch (error) {
            console.error('Pagy-Blocker: Scan fehlgeschlagen:', error);
        }
    }

    // querySelectorsAll entfernt, da es nicht mehr benötigt wird

    function startObserver() {
        if (observer || isCleanedUp) return;
        observer = new MutationObserver(mutations => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (isCleanedUp || isPaused) return;
                if (mutations.some(m => m.addedNodes.length > 0)) {
                    scanAndHideElements(document.body || document.documentElement);
                }
            }, 150);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function performCleanup() {
        if (isCleanedUp) return;
        isCleanedUp = true;
        
        try {
            if (observer) {
                observer.disconnect();
                observer = null;
            }
            
            // Entferne alle hinzugefügten Styles
            const style = document.getElementById('pagy-blocker-styles');
            if (style) style.remove();
            
            // Bereinige die Datenattribute
            document.querySelectorAll('[data-pagy-blocked]').forEach(el => {
                delete el.dataset.pagyBlocked;
            });
            
            clearTimeout(debounceTimer);
            window.removeEventListener('beforeunload', performCleanup);
            window.removeEventListener('pagehide', performCleanup);
        } catch (e) {
            console.error('Fehler bei der Bereinigung:', e);
        }
    }

    async function loadRules() {
        try {
                                    const rulesURL = chrome.runtime.getURL('filter_lists/cosmetic_filters.json');
            console.log('Pagy-Blocker: Versuche Regeln zu laden von:', rulesURL);
            const response = await fetch(rulesURL);
            if (!response.ok) throw new Error('Fetch fehlgeschlagen');
            rules = await response.json();
        } catch (error) {
            console.error('Pagy-Blocker: Regeln konnten nicht geladen werden. Fallback wird verwendet.', error);
            rules = { 'generic': { 'selectors': ['.ad', '.ads', '.advert', '.advertisement'] } };
        }
    }

    // Lauscht auf Statusänderungen vom Hintergrundskript
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.command === 'updatePauseState') {
            isPaused = message.isPaused;
            if (isPaused) {
                // Wenn der Adblocker deaktiviert ist, versteckte Elemente bereinigen
                performCleanup();
            } else {
                // Wenn der Adblocker wieder aktiviert wird, neu initialisieren
                initialize();
            }
        }
    });

    // Lauscht sowohl auf beforeunload als auch auf pagehide für besseres BFCache-Handling
    window.addEventListener('beforeunload', performCleanup, { passive: true });
    window.addEventListener('pagehide', performCleanup, { passive: true });
    
    // Behandelt die Wiederherstellung der Seite aus dem BFCache
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            // Die Seite wurde aus dem BFCache wiederhergestellt, neu initialisieren
            isCleanedUp = false;
            initialize();
        }
    });
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();
