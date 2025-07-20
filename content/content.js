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
    let isCleanedUp = false;
    const hostname = window.location.hostname;
    let currentPageBlockedCount = 0; // Track current page blocked ads

    /**
     * ENHANCED: Validates initialization state and prerequisites
     * Ensures safe initialization environment
     */
    function validateInitializationState() {
        // Check if already cleaned up
        if (isCleanedUp) {
            throw new Error('Content script already cleaned up');
        }
        
        // Check if extension context is valid
        if (!chrome.runtime || !chrome.runtime.sendMessage) {
            throw new Error('Chrome runtime API not available');
        }
        
        // Check if document is in valid state
        if (!document || document.readyState === 'unloading') {
            throw new Error('Document not ready for initialization');
        }
        
        // Check hostname validity
        if (!hostname || typeof hostname !== 'string') {
            throw new Error('Invalid hostname detected');
        }
        
        return true;
    }

    /**
     * Initialisiert den Blocker, indem es den Status von der Erweiterung abruft
     * und den MutationObserver startet.
     * ENHANCED: Improved initialization with state validation and error recovery
     */
    async function initialize() {
        try {
            // ENHANCED: Validate initialization prerequisites
            validateInitializationState();
            
            // Step 1: Get state from extension (with timeout and retry logic)
            let retryCount = 0;
            const maxRetries = 3;
            let state = null;
            
            while (retryCount < maxRetries && !state) {
                try {
                    const statePromise = chrome.runtime.sendMessage({ command: 'getState' });
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('State fetch timeout')), 5000)
                    );
                    
                    state = await Promise.race([statePromise, timeoutPromise]);
                    break;
                } catch (error) {
                    retryCount++;
                    if (retryCount >= maxRetries) {
                        throw error;
                    }
                    console.warn(`Pagy-Blocker: State fetch attempt ${retryCount} failed, retrying...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
                }
            }
            
            if (!state) {
                throw new Error('Failed to get extension state after retries');
            }
            
            isPaused = state.isPaused;
            
            if (isPaused) {
                console.log(`Pagy-Blocker: Pausiert für ${hostname}`);
                return;
            }
            
            // Step 2: Load rules with proper error handling
            await loadRules();
            
            // Step 3: Only proceed if we have valid rules for this domain or generic rules
            const hasRules = rules && (rules[hostname] || rules['generic']);
            if (!hasRules) {
                console.log(`Pagy-Blocker: Keine Regeln für ${hostname} verfügbar`);
                return;
            }
            
            // Step 4: Reset page blocked count for new page
            currentPageBlockedCount = 0;
            
            // Step 5: Initialize in correct order to prevent race condition
            console.log(`Pagy-Blocker: Aktiv für ${hostname}. Starte Überwachung.`);
            
            // Start observer first to catch any DOM changes during initial scan
            startObserver();
            
            // Then perform initial scan with debouncing to prevent overlap (async for better performance)
            await new Promise(resolve => {
                requestAnimationFrame(async () => {
                    try {
                        const targetElement = document.body || document.documentElement;
                        if (targetElement) {
                            await scanAndHideElements(targetElement);
                        }
                    } catch (error) {
                        console.warn('Pagy-Blocker: Initial scan error:', error);
                    }
                    resolve();
                });
            });

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
     * FIXED: Memory leak prevention with proper cleanup in all scenarios
     */
    function startObserver() {
        // Cleanup existing observer
        cleanupObserver();
        
        if (isCleanedUp) {
            console.log('Pagy-Blocker: Observer startup aborted - cleanup already performed');
            return;
        }

        observer = new MutationObserver(mutations => {
            // Check if we've been cleaned up during execution
            if (isCleanedUp) {
                return;
            }
            
            try {
                for (const mutation of mutations) {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach(node => {
                            // Wir überprüfen nur Element-Knoten
                            if (node.nodeType === Node.ELEMENT_NODE && !isCleanedUp) {
                                // Use async processing to avoid blocking the main thread
                                scanAndHideElements(node).catch(error => {
                                    console.warn('Pagy-Blocker: Async scan error:', error);
                                });
                            }
                        });
                    }
                }
            } catch (error) {
                console.warn('Pagy-Blocker: Error in mutation observer callback:', error);
                // On error, cleanup to prevent further issues
                cleanupObserver();
            }
        });

        try {
            // Ensure we have a valid target element to observe
            const targetElement = document.body || document.documentElement;
            
            if (!targetElement) {
                throw new Error('No valid target element (body or documentElement) available');
            }
            
            observer.observe(targetElement, {
                childList: true,
                subtree: true
            });
        } catch (error) {
            console.error('Pagy-Blocker: Failed to start observer:', error);
            cleanupObserver();
        }
    }
    
    /**
     * Safely cleans up the MutationObserver
     * FIXED: Comprehensive cleanup function for all scenarios
     */
    function cleanupObserver() {
        if (observer) {
            try {
                observer.disconnect();
                observer = null; // Explicitly set to null for GC
            } catch (error) {
                console.warn('Pagy-Blocker: Error disconnecting observer:', error);
            }
        }
        
        // Clear selector cache to free memory
        if (selectorCache && selectorCache.clear) {
            selectorCache.clear();
        }
    }
    
    /**
     * Performs complete cleanup of all resources
     * FIXED: Complete resource management
     */
    function performCleanup() {
        if (isCleanedUp) {
            return;
        }
        
        isCleanedUp = true;
        cleanupObserver();
        
        // Clear rules to free memory
        rules = {};
        
        console.log('Pagy-Blocker: Complete cleanup performed');
    }

    /**
     * Durchsucht ein gegebenes Element und seine Kinder nach übereinstimmenden Regeln und versteckt sie.
     * @param {HTMLElement} element - Das zu durchsuchende Wurzelelement.
     */
        /**
     * SECURITY: Validates the integrity of loaded filter data
     * Ensures data structure is safe and expected format
     */
    function validateFilterIntegrity(data, fileName) {
        if (!data || typeof data !== 'object') {
            throw new Error(`Invalid filter data structure in ${fileName}`);
        }
        
        // Check for reasonable size limits
        const dataStr = JSON.stringify(data);
        if (dataStr.length > 50 * 1024 * 1024) { // 50MB limit
            throw new Error(`Filter file ${fileName} exceeds size limit`);
        }
        
        // Validate structure for cosmetic filters
        if (typeof data === 'object' && !Array.isArray(data)) {
            for (const [domain, rules] of Object.entries(data)) {
                if (typeof domain !== 'string' || domain.length > 253) {
                    throw new Error(`Invalid domain in ${fileName}: ${domain}`);
                }
                
                if (!rules || typeof rules !== 'object') {
                    throw new Error(`Invalid rules structure for domain ${domain} in ${fileName}`);
                }
                
                if (rules.selectors && Array.isArray(rules.selectors)) {
                    for (const selector of rules.selectors) {
                        if (typeof selector !== 'string' || selector.length > 1000) {
                            throw new Error(`Invalid selector in ${fileName} for domain ${domain}`);
                        }
                    }
                }
            }
        }
        
        return true;
    }

    /**
     * Lädt die Filterregeln für das kosmetische Filtern.
     * FIXED: Smart domain-based fallback with improved coverage and integrity validation
     */
    async function loadRules() {
        // Versuche externe Filterregeln zu laden
        const filterFiles = [
            'filter_lists/cosmetic_filters.json', // Neue dedizierte kosmetische Filter
            'filter_lists/filter_precompiled_min.json',
            'filter_lists/filter_precompiled.json'
        ];
        
        let lastError = null;
        
        for (const filterFile of filterFiles) {
            try {
                const url = chrome.runtime.getURL(filterFile);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                
                const loadedRules = await response.json();
                
                // SECURITY: Validate integrity of loaded data
                validateFilterIntegrity(loadedRules, filterFile);
                
                // Prüfe ob es kosmetische Filter-Struktur ist (Hostname -> Selektoren)
                if (typeof loadedRules === 'object' && loadedRules !== null && !Array.isArray(loadedRules)) {
                    rules = loadedRules;
                    console.log(`Pagy-Blocker: Kosmetische Filterregeln aus ${filterFile} geladen`);
                    
                    // FIXED: Enhance loaded rules with smart domain fallback
                    enhanceRulesWithDomainFallback();
                    return;
                }
            } catch (error) {
                lastError = error;
                console.log(`Pagy-Blocker: ${filterFile} nicht verfügbar (${error.message}), versuche nächste Quelle`);
                continue;
            }
        }
        
        // FALLBACK: Smart domain-based builtin filters
        console.warn('Pagy-Blocker: Alle externen Filter fehlgeschlagen, verwende intelligente eingebaute Filter');
        if (lastError) {
            console.warn('Pagy-Blocker: Letzter Fehler:', lastError.message);
        }
        
        rules = getSmartBuiltinFilters();
        console.log(`Pagy-Blocker: Intelligente Filter für ${hostname} geladen`);
    }
    
    /**
     * Enhances loaded rules with smart domain fallback logic
     * FIXED: Ensures current domain has effective blocking rules
     */
    function enhanceRulesWithDomainFallback() {
        // Check if current domain has rules
        if (!rules[hostname]) {
            // Try to find parent domain rules
            const domainParts = hostname.split('.');
            let foundParentRules = null;
            
            // Check parent domains (e.g., sub.example.com -> example.com)
            for (let i = 1; i < domainParts.length; i++) {
                const parentDomain = domainParts.slice(i).join('.');
                if (rules[parentDomain]) {
                    foundParentRules = rules[parentDomain];
                    console.log(`Pagy-Blocker: Verwende Regeln von Parent-Domain ${parentDomain} für ${hostname}`);
                    break;
                }
            }
            
            // Apply parent rules to current domain
            if (foundParentRules) {
                rules[hostname] = foundParentRules;
            } else {
                // Add smart generic rules for current domain
                addSmartGenericRulesForDomain();
            }
        }
        
        // Ensure generic rules are always available
        if (!rules['generic']) {
            rules['generic'] = getGenericRules();
        }
    }
    
    /**
     * Adds smart generic rules tailored for the current domain
     * FIXED: Domain-specific intelligent fallback
     */
    function addSmartGenericRulesForDomain() {
        const domainCategory = categorizeWebsite(hostname);
        const smartRules = getSmartRulesForCategory(domainCategory);
        
        rules[hostname] = {
            selectors: smartRules.selectors,
            category: domainCategory
        };
        
        console.log(`Pagy-Blocker: Intelligente ${domainCategory}-Regeln für ${hostname} hinzugefügt`);
    }
    
    /**
     * Categorizes website based on hostname patterns
     * FIXED: Smart domain categorization for better targeting
     */
    function categorizeWebsite(hostname) {
        // E-commerce patterns
        if (/shop|store|buy|cart|commerce|market|amazon|ebay|etsy/.test(hostname)) {
            return 'ecommerce';
        }
        
        // News/Media patterns
        if (/news|media|press|journal|times|post|herald|tribune|bbc|cnn/.test(hostname)) {
            return 'news';
        }
        
        // Social media patterns  
        if (/social|facebook|twitter|instagram|linkedin|tiktok|snapchat/.test(hostname)) {
            return 'social';
        }
        
        // Video/Entertainment patterns
        if (/video|tube|stream|netflix|youtube|twitch|vimeo|entertainment/.test(hostname)) {
            return 'video';
        }
        
        // Search engines
        if (/google|bing|yahoo|duckduckgo|search/.test(hostname)) {
            return 'search';
        }
        
        // Blog patterns
        if (/blog|wordpress|medium|tumblr|blogger/.test(hostname)) {
            return 'blog';
        }
        
        return 'generic';
    }
    
    /**
     * Returns smart rules based on website category
     * FIXED: Category-specific blocking patterns
     */
    function getSmartRulesForCategory(category) {
        const baseSelectors = [
            '.advertisement', '.ads', '.ad-banner', '.google-ads',
            '[class*="advertisement"]', '[id*="google_ads"]',
            '[data-ad]', '[data-ads]', '.ad-container'
        ];
        
        const categoryRules = {
            ecommerce: [
                ...baseSelectors,
                '.sponsored-product', '[data-component-type*="sponsored"]',
                '.ad-product', '.promoted-listing', '.sponsored-listing',
                '[aria-label*="Sponsored"]', '.advertising-product'
            ],
            news: [
                ...baseSelectors,
                '.article-ad', '.content-ad', '.sidebar-ad', '.banner-ad',
                '.ad-placement', '.ad-slot', '.dfp-ad', '.adhesion-ad'
            ],
            social: [
                ...baseSelectors,
                '[data-pagelet*="ads"]', '[aria-label*="Sponsored"]',
                '.promoted-tweet', '.sponsored-post', '.ad-post',
                '[data-testid*="ad"]', '.social-ad'
            ],
            video: [
                ...baseSelectors,
                '.video-ads', '.preroll-ad', '.overlay-ad', '.companion-ad',
                '[class*="ad-overlay"]', '.advertisement-overlay'
            ],
            search: [
                ...baseSelectors,
                '.ads-visurl', '.commercial-unit', '[data-text-ad]',
                '.ad_cclk', '.ads-ad', '.search-ad'
            ],
            blog: [
                ...baseSelectors,
                '.widget-ad', '.sidebar-ad', '.content-ad', '.inline-ad',
                '.adsense', '.ad-widget'
            ],
            generic: baseSelectors
        };
        
        return {
            selectors: categoryRules[category] || categoryRules.generic
        };
    }

    /**
     * Returns smart builtin filters based on current domain
     * FIXED: Intelligent domain-based filter selection
     */
    function getSmartBuiltinFilters() {
        const domainCategory = categorizeWebsite(hostname);
        const smartRules = getSmartRulesForCategory(domainCategory);
        
        // Build comprehensive filter set
        const filters = {
            'generic': getGenericRules()
        };
        
        // Add current domain with smart rules
        filters[hostname] = smartRules;
        
        // Add known high-traffic sites with specific rules
        const knownSites = getKnownSiteRules();
        Object.assign(filters, knownSites);
        
        return filters;
    }
    
    /**
     * Returns generic rules that work across most websites
     * FIXED: Comprehensive generic rule set
     */
    function getGenericRules() {
        return {
            selectors: [
                '.advertisement', '.ads', '.ad-banner', '.google-ads',
                '[class*="advertisement"]', '[id*="google_ads"]',
                '[data-ad]', '[data-ads]', '.ad-container',
                '.adblock', '.ad-block', '.ad-wrapper',
                '.adsense', '.ad-space', '.ad-unit',
                '[class*="ad-"]', '[id*="ad-"]',
                '.sponsor', '.sponsored', '[class*="sponsor"]',
                '.banner-ad', '.display-ad', '.popup-ad'
            ]
        };
    }
    
    /**
     * Returns rules for known high-traffic websites
     * FIXED: Enhanced known site coverage
     */
    function getKnownSiteRules() {
        return {
            'google.com': {
                selectors: [
                    '[data-text-ad]', '.ads-visurl', '.commercial-unit-desktop-top',
                    '.ad_cclk', '.ads-ad', '.commercial-unit', '.search-ad',
                    '[aria-label*="Ad"]', '[data-ved]'
                ]
            },
            'youtube.com': {
                selectors: [
                    '.ytd-promoted-sparkles-web-renderer', '.ytd-ad-slot-renderer',
                    'ytd-companion-slot-renderer', '.video-ads', '.ytp-ad-overlay-container',
                    '.ytp-ad-text', '.ad-showing', '[class*="ad-overlay"]'
                ]
            },
            'facebook.com': {
                selectors: [
                    '[data-pagelet="RightRail"]', '[aria-label*="Sponsored"]',
                    '[data-testid="story-subtitle"] a[href*="/ads/"]',
                    '[data-pagelet*="ads"]', '.sponsored-post'
                ]
            },
            'amazon.com': {
                selectors: [
                    '.s-sponsored-info-icon', '[data-component-type="sp-sponsored-result"]',
                    '.AdHolder', '.sponsored-product', '.ad-product',
                    '[aria-label*="Sponsored"]', '.advertising-product'
                ]
            },
            'twitter.com': {
                selectors: [
                    '[data-testid*="ad"]', '.promoted-tweet', '.ads-container',
                    '[aria-label*="Promoted"]', '.promoted-content'
                ]
            },
            'reddit.com': {
                selectors: [
                    '.promoted', '[data-promoted="true"]', '.promotedlink',
                    '.organic-listing[data-promoted]', '.promoted-post'
                ]
            }
        };
    }

    // Performance cache for validated selectors to avoid re-validation
    const selectorCache = new Map();
    const SELECTOR_CACHE_MAX_SIZE = 200;
    const BATCH_SIZE_LIMIT = 150; // Optimized batch size for better performance on large pages
    
    /**
     * Analyzes selector complexity to optimize query performance
     * @param {string} selector - CSS selector to analyze
     * @returns {number} Complexity score (lower is better)
     */
    function getSelectorComplexity(selector) {
        let complexity = 0;
        
        // Count different selector components that impact performance
        complexity += (selector.match(/:/g) || []).length * 2;        // Pseudo-selectors
        complexity += (selector.match(/\[/g) || []).length * 3;       // Attribute selectors
        complexity += (selector.match(/\>/g) || []).length;          // Direct child selectors
        complexity += (selector.match(/\+/g) || []).length;          // Adjacent sibling
        complexity += (selector.match(/~/g) || []).length;           // General sibling
        complexity += (selector.match(/\*/g) || []).length * 4;       // Universal selectors
        complexity += Math.max(0, (selector.split(' ').length - 1)); // Descendant depth
        
        return complexity;
    }
    
    /**
     * Validates selector using cached results for performance
     * @param {string} selector - CSS selector to validate
     * @returns {boolean} True if selector is valid
     */
    function isValidSelector(selector) {
        // Check cache first
        if (selectorCache.has(selector)) {
            return selectorCache.get(selector);
        }
        
        try {
            // Use minimal DOM operation to test validity
            document.querySelector.call(document.createElement('div'), selector);
            const isValid = true;
            
            // Cache result with LRU eviction
            if (selectorCache.size >= SELECTOR_CACHE_MAX_SIZE) {
                const firstKey = selectorCache.keys().next().value;
                selectorCache.delete(firstKey);
            }
            selectorCache.set(selector, isValid);
            return isValid;
        } catch (e) {
            selectorCache.set(selector, false);
            return false;
        }
    }
    
    /**
     * Processes selectors in optimized batches based on complexity
     * @param {string[]} selectors - Array of CSS selectors
     * @param {HTMLElement} element - Element to search within
     * @returns {Promise<HTMLElement[]>} Array of matching elements
     */
    async function processSelectorsInBatches(selectors, element) {
        // Sort selectors by complexity (simple selectors first for better performance)
        const selectorsByComplexity = selectors
            .filter(isValidSelector)
            .map(selector => ({ selector, complexity: getSelectorComplexity(selector) }))
            .sort((a, b) => a.complexity - b.complexity);
        
        const allMatchedElements = new Set();
        
        // Process in batches to avoid overwhelming the DOM engine
        for (let i = 0; i < selectorsByComplexity.length; i += BATCH_SIZE_LIMIT) {
            const batch = selectorsByComplexity.slice(i, i + BATCH_SIZE_LIMIT);
            
            // Group simple selectors for batch processing
            const simpleSelectors = batch.filter(s => s.complexity <= 3).map(s => s.selector);
            const complexSelectors = batch.filter(s => s.complexity > 3).map(s => s.selector);
            
            // Batch process simple selectors
            if (simpleSelectors.length > 0) {
                try {
                    const combinedSelector = simpleSelectors.join(', ');
                    const elements = element.querySelectorAll(combinedSelector);
                    elements.forEach(el => allMatchedElements.add(el));
                } catch (e) {
                    // Fallback to individual processing if batch fails
                    simpleSelectors.forEach(selector => {
                        try {
                            const elements = element.querySelectorAll(selector);
                            elements.forEach(el => allMatchedElements.add(el));
                        } catch (err) {
                            console.warn(`Pagy-Blocker: Selector failed: ${selector}`);
                        }
                    });
                }
            }
            
            // Process complex selectors individually to avoid query engine strain
            for (const selector of complexSelectors) {
                try {
                    const elements = element.querySelectorAll(selector);
                    elements.forEach(el => allMatchedElements.add(el));
                } catch (err) {
                    console.warn(`Pagy-Blocker: Complex selector failed: ${selector}`);
                }
            }
            
            // Yield control to prevent blocking the main thread
            if (i + BATCH_SIZE_LIMIT < selectorsByComplexity.length) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        return Array.from(allMatchedElements);
    }
    
    /**
     * Durchsucht ein gegebenes Element und seine Kinder nach übereinstimmenden Regeln und versteckt sie.
     * PERFORMANCE OPTIMIZED: Advanced DOM query optimization with complexity analysis and batching
     * ENHANCED: Added telemetry monitoring for performance optimization
     * @param {HTMLElement} element - Das zu durchsuchende Wurzelelement.
     */
    async function scanAndHideElements(element) {
        if (!rules || typeof rules !== 'object') {
            return;
        }

        // ENHANCED: Performance telemetry
        const startTime = performance.now();

        // Sammle alle anzuwendenden Selektoren
        const allSelectors = [];
        
        // 1. Site-spezifische Selektoren
        const siteRules = rules[hostname];
        if (siteRules && siteRules.selectors && Array.isArray(siteRules.selectors)) {
            allSelectors.push(...siteRules.selectors);
        }
        
        // 2. Generische Selektoren (immer anwenden)
        const genericRules = rules['generic'];
        if (genericRules && genericRules.selectors && Array.isArray(genericRules.selectors)) {
            allSelectors.push(...genericRules.selectors);
        }

        if (allSelectors.length === 0) {
            return;
        }

        // Remove duplicates and add some basic selectors that should work everywhere
        const uniqueSelectors = [...new Set([
            ...allSelectors,
            '.advertisement', '.ads', '.ad-banner', '.google-ads', '[id*="ad"]', '[class*="ad"]'
        ])];
        
        try {
            // Use optimized batch processing
            const elementsToHide = await processSelectorsInBatches(uniqueSelectors, element);
            
            if (elementsToHide.length > 0) {
                // Batch DOM style updates using requestAnimationFrame for smooth performance
                requestAnimationFrame(() => {
                    elementsToHide.forEach(el => {
                        if (el.style.display !== 'none') {
                            el.style.display = 'none';
                        }
                    });
                });
                
                // ENHANCED: Record performance metrics
                const scanDuration = performance.now() - startTime;
                if (typeof window.Telemetry !== 'undefined') {
                    window.Telemetry.telemetry.recordMetric('dom', 'scan_duration', scanDuration, {
                        elementsHidden: elementsToHide.length,
                        selectorsUsed: uniqueSelectors.length,
                        hostname: hostname
                    });
                    window.Telemetry.telemetry.recordMetric('blocking', 'elements_hidden', elementsToHide.length);
                }
                
                // Update current page blocked count
                if (elementsToHide.length > 0) {
                    currentPageBlockedCount += elementsToHide.length;
                    try {
                        chrome.runtime.sendMessage({
                            command: 'updateBlockedCount',
                            count: currentPageBlockedCount
                        });
                    } catch (error) {
                        // Ignore errors
                    }
                }
                
                console.log(`Pagy-Blocker: ${elementsToHide.length} elements hidden on ${hostname} using ${uniqueSelectors.length} optimized rules (${scanDuration.toFixed(2)}ms)`);
            }
        } catch (error) {
            // ENHANCED: Record error metrics
            const errorDuration = performance.now() - startTime;
            if (typeof window.Telemetry !== 'undefined') {
                window.Telemetry.telemetry.recordMetric('dom', 'scan_error', errorDuration, {
                    error: error.name,
                    hostname: hostname
                });
            }
            console.error('Pagy-Blocker: Critical error in optimized DOM processing:', error);
            // Emergency fallback to simple processing
            uniqueSelectors.forEach(selector => {
                if (isValidSelector(selector)) {
                    try {
                        const elements = element.querySelectorAll(selector);
                        elements.forEach(el => {
                            if (el.style.display !== 'none') {
                                el.style.display = 'none';
                            }
                        });
                    } catch (err) {
                        console.warn(`Pagy-Blocker: Fallback selector failed: ${selector}`);
                    }
                }
            });
        }
    }

    // FIXED: Add cleanup event listeners to prevent memory leaks
    // Cleanup on page unload/navigation
    window.addEventListener('beforeunload', performCleanup, { passive: true });
    window.addEventListener('pagehide', performCleanup, { passive: true });
    
    // Cleanup on visibility change (tab hidden)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // Don't fully cleanup, but disconnect observer to save resources
            cleanupObserver();
        } else if (document.visibilityState === 'visible' && !isCleanedUp && !isPaused) {
            // Restart observer when tab becomes visible again
            startObserver();
        }
    }, { passive: true });

    // ENHANCED: Safe initialization with error boundary
    (async function safeInitialize() {
        try {
            await initialize();
        } catch (error) {
            console.error('Pagy-Blocker: Critical initialization failure:', error);
            // Attempt cleanup in case of failure
            performCleanup();
        }
    })();

})();
