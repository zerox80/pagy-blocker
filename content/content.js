/**
 * @file content.js
 * @description Injects into web pages to block ad elements using a performant MutationObserver.
 * @version 5.0.0 Final & Verified
 * @author zerox80 (Original), Gemini (Overhaul)
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
                console.error('Pagy-Blocker: Init failed:', error);
            }
            performCleanup();
        }
    }

    function applyStylesToElements(elements) {
        if (!elements.length) return;
        
        // Create a style element for all selectors at once
        const style = document.createElement('style');
        style.id = 'pagy-blocker-styles';
        const selectorText = elements.map(el => {
            const id = 'pagy-blocker-' + Math.random().toString(36).substr(2, 9);
            el.dataset.pagyBlocked = id;
            return `[data-pagy-blocked="${id}"]`;
        }).join(',');
        
        style.textContent = `${selectorText} { display: none !important; }`;
        document.head.appendChild(style);
        
        // Report blocked count
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
            // Use a single query selector for all selectors
            const selectorString = selectors.join(',');
            const matched = Array.from(element.querySelectorAll(selectorString))
                .filter(el => !el.dataset.pagyBlocked); // Skip already blocked elements

            if (matched.length > 0) {
                requestAnimationFrame(() => applyStylesToElements(matched));
            }
        } catch (error) {
            console.error('Pagy-Blocker: Scan failed:', error);
        }
    }

    // Removed querySelectorsAll as it's no longer needed

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
            
            // Remove any styles we added
            const style = document.getElementById('pagy-blocker-styles');
            if (style) style.remove();
            
            // Clean up data attributes
            document.querySelectorAll('[data-pagy-blocked]').forEach(el => {
                delete el.dataset.pagyBlocked;
            });
            
            clearTimeout(debounceTimer);
            window.removeEventListener('beforeunload', performCleanup);
            window.removeEventListener('pagehide', performCleanup);
        } catch (e) {
            console.error('Error during cleanup:', e);
        }
    }

    async function loadRules() {
        try {
                                    const rulesURL = chrome.runtime.getURL('filter_lists/cosmetic_filters.json');
            console.log('Pagy-Blocker: Attempting to load rules from:', rulesURL);
            const response = await fetch(rulesURL);
            if (!response.ok) throw new Error('Fetch failed');
            rules = await response.json();
        } catch (error) {
            console.error('Pagy-Blocker: Rules load failed. Using fallback.', error);
            rules = { 'generic': { 'selectors': ['.ad', '.ads', '.advert', '.advertisement'] } };
        }
    }

    // Listen for both beforeunload and pagehide for better BFCache handling
    window.addEventListener('beforeunload', performCleanup, { passive: true });
    window.addEventListener('pagehide', performCleanup, { passive: true });
    
    // Handle page restoration from BFCache
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            // Page was restored from BFCache, reinitialize
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
