/**
 * @file Content script wrapper for ES module support.
 * @version 11.2
 */

(async () => {
    try {
        // Dynamically import the ES module content script.
        // The module is automatically executed upon import.
        await import(chrome.runtime.getURL('content/content.js'));
    } catch (error) {
        console.error('[Pagy Blocker] Failed to load content script module:', error);
    }
})();
