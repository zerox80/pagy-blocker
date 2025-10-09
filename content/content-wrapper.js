/**
 * @file content-wrapper.js
 * @description Content Script Wrapper für ES Module Support
 * @version 11.1
 */

// Dynamic import of the ES module content script
(async () => {
    try {
        const module = await import(chrome.runtime.getURL('content/content.js'));
        // Module is automatically executed when imported
    } catch (error) {
        console.error('[Pagy Blocker] Failed to load content script module:', error);
    }
})();
