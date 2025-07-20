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

    async function scanAndHideElements(element) {
        if (isPaused || isCleanedUp || !element) return;
        const selectors = [...new Set([...(rules[hostname]?.selectors || []), ...(rules['generic']?.selectors || [])])];
        if (selectors.length === 0) return;

        try {
            const matched = await querySelectorsAll(element, selectors);
            const newlyHidden = matched.filter(el => el.style.display !== 'none');

            if (newlyHidden.length > 0) {
                requestAnimationFrame(() => newlyHidden.forEach(el => el.style.display = 'none'));
                chrome.runtime.sendMessage({
                    command: 'updateBlockedCount',
                    count: newlyHidden.length
                }).catch(() => {});
            }
        } catch (error) {
            console.error('Pagy-Blocker: Scan failed:', error);
        }
    }

    function querySelectorsAll(element, selectors) {
        return new Promise(resolve => {
            const matched = new Set();
            for (const selector of selectors) {
                try {
                    element.querySelectorAll(selector).forEach(el => matched.add(el));
                } catch (e) {}
            }
            resolve(Array.from(matched));
        });
    }

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
        if (observer) observer.disconnect();
        clearTimeout(debounceTimer);
        window.removeEventListener('beforeunload', performCleanup);
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

    window.addEventListener('beforeunload', performCleanup, { passive: true });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();
