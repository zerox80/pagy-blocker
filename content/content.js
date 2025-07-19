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
            // Wenn der Kontext ungültig wird (z.B. beim Schließen des Popups), kann das einen Fehler werfen.
            // Das ist oft erwartet und sollte nicht als kritischer Fehler protokolliert werden.
            if (error.message.includes("The message port closed before a response was received.")) {
                console.log("Pagy-Blocker: Nachrichtenport geschlossen, wahrscheinlich wurde die Seite neu geladen.");
            } else {
                console.error('Pagy-Blocker: Fehler bei der Initialisierung des Content-Skripts.', error);
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
     */
    async function loadRules() {
        try {
            const url = chrome.runtime.getURL('filter_lists/filter_precompiled_min.json');
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP-Fehler: ${response.status}`);
            rules = await response.json();
        } catch (error) {
            console.error('Pagy-Blocker: Fehler beim Laden der kosmetischen Filterregeln.', error);
        }
    }

    /**
     * Durchsucht ein gegebenes Element und seine Kinder nach übereinstimmenden Regeln und versteckt sie.
     * @param {HTMLElement} element - Das zu durchsuchende Wurzelelement.
     */
    function scanAndHideElements(element) {
        const siteRules = rules[hostname];
        if (!siteRules || !siteRules.selectors) {
            return;
        }

        // Robuste Verarbeitung: Führt jeden Selektor einzeln aus, um Fehler zu isolieren.
        siteRules.selectors.forEach(selector => {
            try {
                const elementsToHide = element.querySelectorAll(selector);
                elementsToHide.forEach(el => {
                    if (el.style.display !== 'none') {
                        el.style.display = 'none';
                        console.log('Pagy-Blocker: Element versteckt:', el);
                    }
                });
            } catch (e) {
                // Loggt einen fehlerhaften Selektor, ohne die gesamte Funktion abzubrechen.
                console.warn(`Pagy-Blocker: Ungültiger Selektor '${selector}' für ${hostname}.`, e);
            }
        });
    }

    // Startet die Initialisierung.
    initialize();

})();
