/**
 * @file content.js
 * @description Dieses Skript wird in Webseiten injiziert, um Paginierungs- und "Mehr laden"-Elemente zu blockieren.
 * Es verwendet einen MutationObserver für eine performante DOM-Überwachung.
 *
 * @version 2.0.0
 * @author zerox80 (Original), Gemini (Überarbeitung)
 */

(async function() {
    'use strict';

    let rules = {};
    let isPaused = false;
    let isWhitelisted = false;
    let observer = null;
    const hostname = window.location.hostname;

    /**
     * Initialisiert den Blocker, indem es den Status von der Erweiterung abruft
     * und den MutationObserver startet.
     */
    async function initialize() {
        try {
            const state = await chrome.runtime.sendMessage({ command: 'getState' });
            isPaused = state.isPaused;
            // isWhitelisted Logik kann hier bei Bedarf wieder hinzugefügt werden

            if (isPaused) {
                console.log(`Pagy-Blocker: Pausiert für ${hostname}`);
                return;
            }
            
            await loadRules();

            if (rules && rules[hostname]) {
                console.log(`Pagy-Blocker: Aktiv für ${hostname}. Starte Überwachung.`);
                startObserver();
                // Erste Überprüfung beim Laden der Seite
                scanAndHideElements(document.body);
            }

        } catch (error) {
            // FIXED: Robuste Fehlerklassifizierung ohne fragiles String-Matching
            if (error instanceof TypeError && error.message.includes('message port')) {
                console.log("Pagy-Blocker: Extension context invalidated - page navigation detected");
            } else if (chrome.runtime.lastError) {
                console.log("Pagy-Blocker: Extension context unavailable:", chrome.runtime.lastError.message);
            } else if (error.name === 'InvalidStateError') {
                console.log("Pagy-Blocker: Extension reloaded or disabled");
            } else {
                console.error('Pagy-Blocker: Unerwarteter Initialisierungsfehler:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack?.split('\n')[0] // Nur erste Stack-Zeile für Debugging
                });
            }
        }
    }

    /**
     * Startet den MutationObserver, um auf DOM-Änderungen zu reagieren.
     */
    function startObserver() {
        if (observer) {
            observer.disconnect();
        }

        observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(node => {
                        // Wir überprüfen nur Element-Knoten
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            scanAndHideElements(node);
                        }
                    });
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /**
     * Durchsucht ein gegebenes Element und seine Kinder nach übereinstimmenden Regeln und versteckt sie.
     * @param {HTMLElement} element - Das zu durchsuchende Wurzelelement.
     */
        /**
     * Lädt die Filterregeln für das kosmetische Filtern.
     * FIXED: Verwendet eingebaute kosmetische Filter-Regeln als Fallback
     */
    async function loadRules() {
        // Versuche externe Filterregeln zu laden
        const filterFiles = [
            'filter_lists/cosmetic_filters.json', // Neue dedizierte kosmetische Filter
            'filter_lists/filter_precompiled_min.json',
            'filter_lists/filter_precompiled.json'
        ];
        
        for (const filterFile of filterFiles) {
            try {
                const url = chrome.runtime.getURL(filterFile);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                
                const loadedRules = await response.json();
                
                // Prüfe ob es kosmetische Filter-Struktur ist (Hostname -> Selektoren)
                if (typeof loadedRules === 'object' && loadedRules !== null && !Array.isArray(loadedRules)) {
                    rules = loadedRules;
                    console.log(`Pagy-Blocker: Kosmetische Filterregeln aus ${filterFile} geladen`);
                    return;
                }
            } catch (error) {
                console.log(`Pagy-Blocker: ${filterFile} nicht verfügbar, versuche nächste Quelle`);
                continue;
            }
        }
        
        // FALLBACK: Integrierte kosmetische Filter für häufige Ad-Domains
        rules = getBuiltinCosmeticFilters();
        console.log('Pagy-Blocker: Verwende eingebaute kosmetische Filter');
    }

    /**
     * Gibt eingebaute kosmetische Filter für häufige Werbe-Websites zurück
     */
    function getBuiltinCosmeticFilters() {
        return {
            'google.com': {
                selectors: [
                    '[data-text-ad]',
                    '.ads-visurl',
                    '.commercial-unit-desktop-top',
                    '.ad_cclk'
                ]
            },
            'youtube.com': {
                selectors: [
                    '.ytd-promoted-sparkles-web-renderer',
                    '.ytd-ad-slot-renderer',
                    'ytd-companion-slot-renderer'
                ]
            },
            'facebook.com': {
                selectors: [
                    '[data-pagelet="RightRail"]',
                    '[aria-label*="Sponsored"]',
                    '[data-testid="story-subtitle"] a[href*="/ads/"]'
                ]
            },
            'amazon.com': {
                selectors: [
                    '.s-sponsored-info-icon',
                    '[data-component-type="sp-sponsored-result"]',
                    '.AdHolder'
                ]
            },
            'generic': {
                selectors: [
                    '.advertisement',
                    '.ads',
                    '.ad-banner',
                    '.google-ads',
                    '[class*="advertisement"]',
                    '[id*="google_ads"]'
                ]
            }
        };
    }

    /**
     * Durchsucht ein gegebenes Element und seine Kinder nach übereinstimmenden Regeln und versteckt sie.
     * FIXED: Optimierte DOM-Queries mit Batch-Processing und generic + site-specific Filter
     * @param {HTMLElement} element - Das zu durchsuchende Wurzelelement.
     */
    function scanAndHideElements(element) {
        if (!rules || typeof rules !== 'object') {
            return;
        }

        // Sammle alle anzuwendenden Selektoren
        let allSelectors = [];
        
        // 1. Site-spezifische Selektoren
        const siteRules = rules[hostname];
        if (siteRules && siteRules.selectors && Array.isArray(siteRules.selectors)) {
            allSelectors = allSelectors.concat(siteRules.selectors);
        }
        
        // 2. Generische Selektoren (immer anwenden)
        const genericRules = rules['generic'];
        if (genericRules && genericRules.selectors && Array.isArray(genericRules.selectors)) {
            allSelectors = allSelectors.concat(genericRules.selectors);
        }

        if (allSelectors.length === 0) {
            return;
        }

        // Performance-Optimierung: Validiere und kombiniere Selektoren
        const validSelectors = [];
        const invalidSelectors = [];
        
        // Entferne Duplikate
        const uniqueSelectors = [...new Set(allSelectors)];
        
        uniqueSelectors.forEach(selector => {
            try {
                // Teste Selektor-Gültigkeit ohne DOM-Query
                document.querySelector.call(document.createElement('div'), selector);
                validSelectors.push(selector);
            } catch (e) {
                invalidSelectors.push(selector);
            }
        });

        // Batch-Processing: Ein Query für alle gültigen Selektoren
        if (validSelectors.length > 0) {
            try {
                const combinedSelector = validSelectors.join(', ');
                const elementsToHide = element.querySelectorAll(combinedSelector);
                
                // Batch-DOM-Updates für bessere Performance
                const elementsArray = Array.from(elementsToHide);
                elementsArray.forEach(el => {
                    if (el.style.display !== 'none') {
                        el.style.display = 'none';
                    }
                });
                
                if (elementsArray.length > 0) {
                    console.log(`Pagy-Blocker: ${elementsArray.length} Elemente versteckt auf ${hostname} (${validSelectors.length} Regeln)`);
                }
            } catch (e) {
                // Fallback: Einzelne Selektoren verarbeiten
                console.warn('Pagy-Blocker: Batch-Query fehlgeschlagen, Fallback zu einzelnen Queries');
                validSelectors.forEach(selector => {
                    try {
                        const elements = element.querySelectorAll(selector);
                        elements.forEach(el => {
                            if (el.style.display !== 'none') {
                                el.style.display = 'none';
                            }
                        });
                    } catch (err) {
                        console.warn(`Pagy-Blocker: Selektor '${selector}' fehlgeschlagen:`, err);
                    }
                });
            }
        }

        // Logge ungültige Selektoren nur einmal (und nur wenn es welche gibt)
        if (invalidSelectors.length > 0 && validSelectors.length === 0) {
            console.warn(`Pagy-Blocker: Alle ${invalidSelectors.length} Selektoren ungültig für ${hostname}`);
        }
    }

    // Startet die Initialisierung.
    initialize();

})();
