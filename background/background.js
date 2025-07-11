// background/background.js

// Import modules using ES module syntax
import { updateRules } from '../js/rule_parser.js';
import createFilterParserModule from '../wasm/filter_parser.js';
import { fastYield, getOptimalCacheSize, globalCacheCoordinator } from '../js/utils.js';

// === Konstanten ===
const LOG_PREFIX = "[PagyBlocker]";
const FILTER_LIST_URL = 'filter_lists/filter.txt';
const BADGE_ERROR_COLOR = '#FF0000';
const BADGE_TEXT_INIT_ERROR = 'INIT';
const BADGE_TEXT_WASM_ERROR = 'WASM';
const BADGE_TEXT_FETCH_ERROR = 'FETCH';
const BADGE_TEXT_PARSE_ERROR = 'PARSE';
const BADGE_TEXT_RULES_ERROR = 'RULES';
const BADGE_TEXT_EMPTY_LIST = 'EMPTY';

// Performance Optimierung: Cache für Badge-Operationen
let lastBadgeText = null;
let lastBadgeColor = null;

// Performance: WASM Lazy Loading für kleine Listen  
const WASM_THRESHOLD = 500; // Lowered threshold for better performance on medium lists
let shouldUseWasm = false;

// Performance: WASM Preloading mit Worker-like Pattern
let wasmPreloadPromise = null;
const PRELOAD_DELAY = 1000; // 1s nach Extension-Start

// === Globale Zustandsvariablen mit verbesserter Concurrency ===
let wasmInitPromise = null;
let isInitializing = false; // Lock, um parallele Initialisierungen zu verhindern
let initializationPromise = null; // Promise für wartende Aufrufer

// === Hilfsfunktionen ===


/**
 * Preloads WASM module in background for faster access
 */
function preloadWasmModule() {
  if (!wasmPreloadPromise) {
    console.log(`${LOG_PREFIX} Preloading WASM module...`);
    wasmPreloadPromise = createFilterParserModule()
      .then(module => {
        console.log(`${LOG_PREFIX} WASM module preloaded successfully.`);
        return module;
      })
      .catch(error => {
        console.warn(`${LOG_PREFIX} WASM preload failed:`, error.message);
        wasmPreloadPromise = null;
        return null;
      });
  }
  return wasmPreloadPromise;
}

/**
 * Stellt sicher, dass das WASM-Modul geladen und initialisiert ist.
 * Nutzt Preloading für bessere Performance.
 */
function ensureWasmModuleLoaded() {
  // Versuche zuerst preloaded module zu verwenden
  if (wasmPreloadPromise) {
    console.log(`${LOG_PREFIX} Using preloaded WASM module.`);
    return wasmPreloadPromise.then(module => {
      if (module && typeof module.parseFilterListWasm === 'function') {
        return module;
      }
      throw new Error('Preloaded WASM module invalid');
    }).catch(() => {
      // Fallback zu normalem Loading
      wasmPreloadPromise = null;
      return ensureWasmModuleLoaded();
    });
  }

  if (!wasmInitPromise) {
    console.log(`${LOG_PREFIX} Initializing WASM module instance...`);
    console.time(`${LOG_PREFIX} WASM Module Init`);

    wasmInitPromise = createFilterParserModule()
      .then(module => {
        console.timeEnd(`${LOG_PREFIX} WASM Module Init`);
        console.log(`${LOG_PREFIX} WASM module instance initialized.`);
        if (typeof module.parseFilterListWasm !== 'function') {
          throw new Error("WASM module loaded, but 'parseFilterListWasm' function not found.");
        }
        return module;
      })
      .catch(error => {
        console.error(`${LOG_PREFIX} Failed to load or initialize WASM module:`, error);
        wasmInitPromise = null;
        throw new Error(`WASM Init failed: ${error.message}`);
      });
  }
  
  return wasmInitPromise.catch(error => {
    wasmInitPromise = null;
    throw error;
  });
}

/**
 * Löscht den Text und die Hintergrundfarbe des Browser-Action-Badges.
 * Optimierung: Verhindert redundante Badge-Updates.
 */
async function clearBadge() {
  try {
    if (chrome.action?.setBadgeText && chrome.action?.setBadgeBackgroundColor) {
      // Performance: Nur Badge aktualisieren wenn sich der Status geändert hat
      if (lastBadgeText !== '') {
        await chrome.action.setBadgeText({ text: '' });
        lastBadgeText = '';
        lastBadgeColor = null;
      }
    } else {
        console.warn(`${LOG_PREFIX} chrome.action API not fully available for badge manipulation.`);
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} Could not clear badge:`, e.message);
  }
}

/**
 * Setzt einen Fehlertext und eine rote Hintergrundfarbe für das Browser-Action-Badge.
 * Optimierung: Verhindert redundante Badge-Updates.
 * @param {string} text - Der Text, der im Badge angezeigt werden soll (kurz halten!).
 */
async function setErrorBadge(text = BADGE_TEXT_INIT_ERROR) {
  try {
    if (chrome.action?.setBadgeText && chrome.action?.setBadgeBackgroundColor) {
      // Performance: Nur Badge aktualisieren wenn sich der Status geändert hat
      if (lastBadgeText !== text || lastBadgeColor !== BADGE_ERROR_COLOR) {
        await Promise.all([
          chrome.action.setBadgeText({ text }),
          chrome.action.setBadgeBackgroundColor({ color: BADGE_ERROR_COLOR })
        ]);
        lastBadgeText = text;
        lastBadgeColor = BADGE_ERROR_COLOR;
      }
    } else {
        console.warn(`${LOG_PREFIX} chrome.action API not fully available for badge manipulation.`);
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} Could not set error badge:`, e.message);
  }
}

// Performance: Intelligent filter list caching with memory management
let filterListCache = null;
let filterListETag = null;
let lastFilterFetch = 0;
const FILTER_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes - improved caching for better performance
const MAX_CACHE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit

// Add cache cleanup function
function clearFilterCache() {
  filterListCache = null;
  filterListETag = null;
  lastFilterFetch = 0;
  console.log(`${LOG_PREFIX} Filter cache cleared.`);
}

/**
 * High-performance filter list fetching with smart caching
 * @returns {Promise<string>} Der Inhalt der Filterliste als Text.
 */
async function fetchFilterList() {
  const now = Date.now();
  
  // Performance: Return cached version if recent
  if (filterListCache && (now - lastFilterFetch) < FILTER_CACHE_DURATION) {
    console.log(`${LOG_PREFIX} Using cached filter list (${filterListCache.length} chars)`);
    return filterListCache;
  }
  
  const url = chrome.runtime.getURL(FILTER_LIST_URL);
  console.log(`${LOG_PREFIX} Fetching filter list from ${url}`);
  
  try {
    // Performance: Use streaming for large files
    const resp = await fetch(url, {
      cache: 'no-cache',
      ...(filterListETag && { headers: { 'If-None-Match': filterListETag } })
    });
    
    if (!resp.ok) {
      throw new Error(`Fetch failed with status: ${resp.status} ${resp.statusText}`);
    }
    
    // Performance: Check for 304 Not Modified
    if (resp.status === 304 && filterListCache) {
      console.log(`${LOG_PREFIX} Filter list not modified, using cache`);
      lastFilterFetch = now;
      return filterListCache;
    }
    
    const text = await resp.text();
    
    // Performance: Optimized line counting using regex
    const lineCount = (text.match(/\n/g) || []).length + 1;
    
    shouldUseWasm = lineCount > WASM_THRESHOLD;
    
    // Update cache
    filterListCache = text;
    filterListETag = resp.headers.get('etag');
    lastFilterFetch = now;
    
    console.log(`${LOG_PREFIX} Fetched filter list (${text.length} chars, ${lineCount} lines). Using ${shouldUseWasm ? 'WASM' : 'Ultra-JS'} parser.`);
    return text;
  } catch (error) {
    console.error(`${LOG_PREFIX} Error during fetch:`, error);
    
    // Performance: Fallback to cache on error
    if (filterListCache) {
      console.warn(`${LOG_PREFIX} Using stale cache due to fetch error`);
      return filterListCache;
    }
    
    throw new Error(`Fetch Error: ${error.message}`);
  }
}

// Performance: Enhanced Object pools for Memory-Efficiency
class ObjectPool {
  constructor(createFn, resetFn, initialSize = 10) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.pool = [];
    this.maxSize = initialSize * 2; // Dynamic max size
    this.hitCount = 0;
    this.missCount = 0;
    
    // Pre-allocate objects efficiently
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.createFn());
    }
  }
  
  get() {
    if (this.pool.length > 0) {
      this.hitCount++;
      return this.pool.pop();
    } else {
      this.missCount++;
      return this.createFn();
    }
  }
  
  release(obj) {
    if (!obj) return; // Guard against null/undefined
    
    // Dynamic max pool size based on memory pressure and usage patterns
    const memoryBasedSize = getOptimalCacheSize(500000, 50, 200);
    const usageBasedSize = this.getUsageBasedSize();
    this.maxSize = Math.min(memoryBasedSize, usageBasedSize);
    
    if (this.pool.length < this.maxSize) {
      try {
        this.resetFn(obj);
        this.pool.push(obj);
      } catch (error) {
        // If reset fails, don't add to pool
        console.warn('Object reset failed, skipping pool return:', error.message);
      }
    }
  }
  
  getUsageBasedSize() {
    // Adjust pool size based on hit/miss ratio
    const totalRequests = this.hitCount + this.missCount;
    if (totalRequests === 0) return 100;
    
    const hitRatio = this.hitCount / totalRequests;
    if (hitRatio > 0.8) return Math.min(300, this.maxSize * 1.2); // High hit rate, increase pool
    if (hitRatio < 0.3) return Math.max(25, this.maxSize * 0.8);   // Low hit rate, decrease pool
    return this.maxSize; // Keep current size
  }
  
  // Cleanup method for memory management
  cleanup() {
    const targetSize = Math.floor(this.maxSize * 0.5);
    while (this.pool.length > targetSize) {
      this.pool.pop();
    }
  }
}

// Memory pools with enhanced object reset and cleanup
const rulePool = new ObjectPool(
  () => ({ id: 0, priority: 1, action: { type: 'block' }, condition: {} }),
  (rule) => {
    // Enhanced object reset to prevent memory leaks
    rule.id = 0;
    rule.priority = 1;
    
    // Reuse action object instead of creating new one
    if (rule.action) {
      rule.action.type = 'block';
      // Clear any other action properties
      Object.keys(rule.action).forEach(key => {
        if (key !== 'type') delete rule.action[key];
      });
    } else {
      rule.action = { type: 'block' };
    }
    
    // Clear condition object properties efficiently
    if (rule.condition) {
      Object.keys(rule.condition).forEach(key => delete rule.condition[key]);
    } else {
      rule.condition = {};
    }
    
    // Clear any other dynamic properties at the root level
    Object.keys(rule).forEach(key => {
      if (!['id', 'priority', 'action', 'condition'].includes(key)) {
        delete rule[key];
      }
    });
  },
  getOptimalCacheSize(100000, 25, 100) // Use shared utility for pool sizing
);

// Performance-optimized: Only block tracking-relevant resource types
const resourceTypesCache = ["script", "image", "xmlhttprequest", "other"];

/**
 * Ultra-fast JS-Parser mit Memory-Optimierungen
 * @param {string} filterListText - Der Text der Filterliste
 * @returns {Object} Parsed result mit rules und stats
 */
async function parseListWithJS(filterListText) {
  console.log(`${LOG_PREFIX} Starting ultra-fast JS parsing...`);
  console.time(`${LOG_PREFIX} JS Parsing`);
  
  // Performance: Optimierte String-Verarbeitung
  const lines = filterListText.split(/\r?\n/);
  const rules = [];
  let ruleId = 1;
  const stats = { totalLines: lines.length, processedRules: 0, skippedLines: 0 };
  
  // Pre-allocate array size hint
  rules.length = 0;
  
  // Performance: Optimized batch processing for better domain parsing
  const BATCH_SIZE = 50; // Smaller batches for better yielding
  for (let i = 0; i < lines.length; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, lines.length);
    
    for (let j = i; j < batchEnd; j++) {
      const line = lines[j];
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.charCodeAt(0) === 33 || trimmed.charCodeAt(0) === 91 || trimmed.charCodeAt(0) === 35) { // '!', '[', or '#'
        stats.skippedLines++;
        continue;
      }
      
      if (trimmed.startsWith('||') && trimmed.endsWith('^')) {
        const domain = trimmed.slice(2, -1);
        
        // Improved domain validation - allow more valid patterns
        if (domain.length > 0 && domain.indexOf('*') === -1 && domain.indexOf(' ') === -1) {
          // Get pooled object
          const rule = rulePool.get();
          rule.id = ruleId++;
          // Fix: Only block specific tracking subdomains, not entire domains
          rule.condition.urlFilter = `||${domain}^`;
          // Fix: Use cached resourceTypes for better performance
          rule.condition.resourceTypes = resourceTypesCache;
          
          rules.push(rule);
          stats.processedRules++;
        } else {
          stats.skippedLines++;
        }
      } else {
        stats.skippedLines++;
      }
    }
    
    // Optimized adaptive yielding for better responsiveness
    if (i > 0 && i % 250 === 0) { // More frequent yielding
      const now = performance.now();
      // Store start time for proper timing calculation - use module variable instead of window
      if (!globalThis.batchStartTime) globalThis.batchStartTime = now;
      if (now - globalThis.batchStartTime > 10) { // Lower threshold for faster UI
        await fastYield();
        globalThis.batchStartTime = performance.now();
      }
    }
  }
  
  console.timeEnd(`${LOG_PREFIX} JS Parsing`);
  console.log(`${LOG_PREFIX} Ultra-fast JS parsed ${rules.length} rules from ${lines.length} lines`);
  console.log(`${LOG_PREFIX} Parsing stats: Total lines: ${stats.totalLines}, Processed: ${stats.processedRules}, Skipped: ${stats.skippedLines}`);
  return { rules, stats };
}

/**
 * Parst den Filterlistentext mit dem WASM-Modul.
 * @param {object} module - Das initialisierte WASM-Modul.
 * @param {string} filterListText - Der Text der Filterliste.
 * @returns {Array} Ein Array von Regelobjekten.
 * @throws {Error} Wenn das Parsen fehlschlägt oder die Struktur ungültig ist.
 */
function parseListWithWasm(module, filterListText) {
  console.log(`${LOG_PREFIX} Starting WASM parsing...`);
  console.time(`${LOG_PREFIX} WASM Parsing`);
  
  // Validate WASM module and function
  if (!module) {
    throw new Error('WASM module is null or undefined');
  }
  if (typeof module.parseFilterListWasm !== 'function') {
    throw new Error('WASM module missing parseFilterListWasm function');
  }
  if (!filterListText || typeof filterListText !== 'string') {
    throw new Error('Invalid filter list text provided to WASM parser');
  }
  
  let jsonString;
  try {
      jsonString = module.parseFilterListWasm(filterListText);
  } catch (wasmError) {
      console.error(`${LOG_PREFIX} Error calling WASM function:`, wasmError);
      throw new Error(`WASM Execution Error: ${wasmError.message}`);
  } finally {
      console.timeEnd(`${LOG_PREFIX} WASM Parsing`);
  }

  if (!jsonString) {
    console.warn(`${LOG_PREFIX} WASM parser returned empty or null string. Assuming empty rule set.`);
    return { rules: [], stats: { totalLines: 0, processedRules: 0, skippedLines: 0 } };
  }

  let result;
  try {
    result = JSON.parse(jsonString);
  } catch (e) {
    console.error(`${LOG_PREFIX} Invalid JSON received from WASM:`, jsonString);
    throw new Error(`JSON Parse Error: ${e.message}`);
  }

  if (!result || typeof result !== 'object' || !Array.isArray(result.rules) || typeof result.stats !== 'object') {
    console.error(`${LOG_PREFIX} Unexpected structure received from WASM:`, result);
    throw new Error("Invalid data structure from WASM parser.");
  }

  console.log(
    `${LOG_PREFIX} Parsed ${result.rules.length} rules. Stats: ` +
    `totalLines=${result.stats.totalLines}, ` +
    `processed=${result.stats.processedRules}, ` +
    `skipped=${result.stats.skippedLines}`
  );
  return result;
}

// === Kernlogik ===

/**
 * Initialisiert die Erweiterung: Lädt WASM, holt Filterliste, parst sie und wendet Regeln an.
 * Verwendet Promises für korrekte Concurrency-Behandlung.
 */
async function initialize() {
  // Prüfen, ob bereits eine Initialisierung läuft
  if (isInitializing && initializationPromise) {
    console.log(`${LOG_PREFIX} Initialization already in progress. Waiting for completion.`);
    return initializationPromise;
  }
  
  if (isInitializing) {
    console.log(`${LOG_PREFIX} Initialization in progress but no promise. Skipping.`);
    return;
  }
  
  isInitializing = true; // Lock setzen
  
  // Erstelle Promise für wartende Aufrufer
  initializationPromise = (async () => {
    console.log(`${LOG_PREFIX} Starting initialization...`);
    await clearBadge(); // Badge zu Beginn löschen

    try {
    // 1. Filterliste abrufen (bestimmt Parser-Typ)
    const listText = await fetchFilterList();

    // 2. Parser basierend auf Listengröße wählen
    let parseResult;
    if (shouldUseWasm) {
      // Große Listen: WASM-Parser
      const wasmModule = await ensureWasmModuleLoaded();
      parseResult = parseListWithWasm(wasmModule, listText);
    } else {
      // Kleine Listen: Ultra-fast JS-Parser
      parseResult = await parseListWithJS(listText);
    }
    
    const rules = parseResult.rules;
    const stats = parseResult.stats;

    // 4. Regeln anwenden (via declarativeNetRequest)
    if (rules.length === 0) {
        // Spezieller Fall: Leere Liste oder nur Kommentare/ungültige Regeln
        console.warn(`${LOG_PREFIX} Filter list resulted in 0 rules. Applying empty ruleset.`);
        // Wichtig: updateRules muss mit einem leeren Array umgehen können,
        // um ggf. alte Regeln zu löschen.
        await updateRules([]); // Explizit leeres Array übergeben
        // Optional: Badge setzen, um leere Liste anzuzeigen?
        // await setErrorBadge(BADGE_TEXT_EMPTY_LIST); // Oder nur loggen
        // Speichere 0 als Regelanzahl
        await chrome.storage.local.set({ ruleCount: 0, ruleStats: stats });
        // Performance: Cache invalidieren
        performanceCache.clear();
    } else {
        console.log(`${LOG_PREFIX} Applying ${rules.length} rules...`);
        // updateRules sollte die Anzahl der erfolgreich angewendeten Regeln zurückgeben oder speichern
        // Wir nehmen an, dass updateRules bei Erfolg die 'ruleCount' im Storage setzt.
        await updateRules(rules); // Fehler hier werden vom äußeren catch gefangen
        // Speichere Statistiken (Anzahl wird von updateRules gesetzt)
        await chrome.storage.local.set({ ruleStats: stats });
        // Performance: Cache invalidieren
        performanceCache.clear();
    }

    // 5. Erfolg signalisieren (Badge löschen)
    await clearBadge();
    console.log(`${LOG_PREFIX} Initialization complete.`);

  } catch (error) {
    console.error(`${LOG_PREFIX} Initialization failed:`, error);
    // Spezifischeren Fehler-Badge setzen
    let badgeText = BADGE_TEXT_INIT_ERROR;
    if (error.message.includes("WASM")) {
        badgeText = BADGE_TEXT_WASM_ERROR;
    } else if (error.message.includes("Fetch")) {
        badgeText = BADGE_TEXT_FETCH_ERROR;
    } else if (error.message.includes("Parse") || error.message.includes("JSON") || error.message.includes("structure")) {
        badgeText = BADGE_TEXT_PARSE_ERROR;
    } else if (error.message.includes("updateRules") || error.message.includes("Rule application")) { // Annahme: updateRules wirft Fehler mit Kennung
        badgeText = BADGE_TEXT_RULES_ERROR;
    }
    try {
      await setErrorBadge(badgeText);
    } catch (badgeError) {
      console.error(`${LOG_PREFIX} Failed to set error badge:`, badgeError);
    }
    // Optional: Fehler im Storage speichern für Debugging?
    // await chrome.storage.local.set({ lastError: error.message });

    } finally {
      isInitializing = false; // Lock freigeben, egal ob Erfolg oder Fehler
      initializationPromise = null; // Promise cleanup
    }
  })();
  
  return initializationPromise;
}

// === Event-Listener ===

// Wird bei der Installation oder einem Update der Erweiterung ausgelöst.
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`${LOG_PREFIX} Extension ${details.reason}.`);
  initialize(); // Starte die Initialisierung
});

// Wird ausgelöst, wenn der Browser startet (und die Erweiterung aktiviert ist).
chrome.runtime.onStartup.addListener(() => {
  console.log(`${LOG_PREFIX} Browser startup detected.`);
  initialize(); // Starte die Initialisierung
});

// Performance: Advanced Multi-Level Caching with adaptive sizing
class PerformanceCache {
  constructor() {
    this.memoryCache = new Map();
    this.storageCache = null;
    this.cacheTimestamp = 0;
    this.CACHE_DURATION = 2000;
    this.MAX_MEMORY_ENTRIES = this.getOptimalCacheSize();
    this.accessOrder = new Map(); // For LRU
    this.hitRate = 0;
    this.totalRequests = 0;
    this.hits = 0;
  }

  getOptimalCacheSize() {
    // Use shared utility for consistent cache sizing
    return getOptimalCacheSize(1000000, 50, 200); // 1 entry per MB, min 50, max 200
  }

  // LRU eviction
  evictOldest() {
    if (this.memoryCache.size >= this.MAX_MEMORY_ENTRIES) {
      const oldestKey = this.accessOrder.keys().next().value;
      this.memoryCache.delete(oldestKey);
      this.accessOrder.delete(oldestKey);
    }
  }

  set(key, value) {
    this.evictOldest();
    this.memoryCache.set(key, value);
    this.accessOrder.delete(key);
    this.accessOrder.set(key, Date.now());
  }

  get(key) {
    this.totalRequests++;
    if (this.memoryCache.has(key)) {
      this.hits++;
      this.hitRate = this.hits / this.totalRequests;
      // Update LRU order
      this.accessOrder.delete(key);
      this.accessOrder.set(key, Date.now());
      return this.memoryCache.get(key);
    }
    return null;
  }

  clear() {
    this.memoryCache.clear();
    this.accessOrder.clear();
    this.storageCache = null;
    this.hits = 0;
    this.totalRequests = 0;
    this.hitRate = 0;
  }

  // Periodic optimization based on hit rate
  optimize() {
    if (this.totalRequests > 100) {
      // If hit rate is very low, reduce cache size
      if (this.hitRate < 0.1) {
        this.MAX_MEMORY_ENTRIES = Math.max(25, Math.floor(this.MAX_MEMORY_ENTRIES * 0.8));
      }
      // If hit rate is very high, increase cache size (within limits)
      else if (this.hitRate > 0.9) {
        this.MAX_MEMORY_ENTRIES = Math.min(300, Math.floor(this.MAX_MEMORY_ENTRIES * 1.2));
      }
      
      // Reset stats periodically
      if (this.totalRequests > 1000) {
        this.hits = Math.floor(this.hits * 0.5);
        this.totalRequests = Math.floor(this.totalRequests * 0.5);
      }
    }
  }

  isStorageCacheValid() {
    return this.storageCache && (Date.now() - this.cacheTimestamp) < this.CACHE_DURATION;
  }
}

const performanceCache = new PerformanceCache();

// Register caches with coordinator
globalCacheCoordinator.register(performanceCache);
globalCacheCoordinator.register(rulePool);

// Enhanced periodic optimization with coordination
setInterval(() => {
  // Use global coordinator for comprehensive optimization
  globalCacheCoordinator.optimizeAll();
}, 60000); // Every minute

// Additional emergency cleanup on high memory pressure
setInterval(() => {
  const memInfo = (performance.memory && performance.memory.usedJSHeapSize) ? 
    performance.memory : { usedJSHeapSize: 50000000, totalJSHeapSize: 100000000 };
  
  // Emergency cleanup if memory usage is very high (>90%)
  if (memInfo.usedJSHeapSize > (memInfo.totalJSHeapSize || 100000000) * 0.9) {
    console.warn(`${LOG_PREFIX} High memory pressure detected, performing emergency cleanup`);
    globalCacheCoordinator.emergencyCleanup();
    
    // Force garbage collection if available
    if (globalThis.gc) globalThis.gc();
  }
}, 30000); // Every 30 seconds

// Lauscht auf Nachrichten von anderen Teilen der Erweiterung (z.B. Popup).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(`${LOG_PREFIX} Received message:`, request);

  if (request.action === "getStats") {
    // Performance: Multi-Level Caching
    const cacheKey = 'stats';
    const cachedStats = performanceCache.get(cacheKey);
    
    if (cachedStats) {
      sendResponse({ ...cachedStats, cached: true });
      return true;
    }

    if (performanceCache.isStorageCacheValid()) {
      const response = {
        ruleCount: performanceCache.storageCache.ruleCount ?? 'N/A',
        ruleStats: performanceCache.storageCache.ruleStats ?? {},
        lastError: performanceCache.storageCache.lastError,
        cached: true
      };
      performanceCache.set(cacheKey, response);
      sendResponse(response);
      return true;
    }

    // Asynchroner Storage-Zugriff mit verbessertem Caching
    (async () => {
      try {
        const data = await chrome.storage.local.get(['ruleCount', 'ruleStats', 'lastError']);
        performanceCache.storageCache = data;
        performanceCache.cacheTimestamp = Date.now();
        
        const response = {
          ruleCount: data.ruleCount ?? 'N/A',
          ruleStats: data.ruleStats ?? {},
          lastError: data.lastError,
          cached: false
        };
        
        performanceCache.set(cacheKey, response);
        sendResponse(response);
      } catch (err) {
        console.error(`${LOG_PREFIX} Error getting stats from storage:`, err);
        sendResponse({ ruleCount: 'Fehler', ruleStats: {}, error: err.message });
      }
    })();
    return true;
  }

  if (request.action === "reloadRules") {
    // Asynchrone Antwort erforderlich -> true zurückgeben
    console.log(`${LOG_PREFIX} Reloading rules requested via popup...`);
    initialize() // Ruft die (jetzt gesicherte) Initialisierungsfunktion auf
      .then(async () => {
        // Warten, bis initialize() abgeschlossen ist (inkl. Storage-Update)
        // Der setTimeout ist hier wahrscheinlich nicht mehr nötig, da wir auf
        // das Promise von initialize() warten, welches wiederum auf das Promise
        // von updateRules() (und dem darin enthaltenen storage.set) warten sollte.
        // GRÜNDLICH TESTEN, ob der ruleCount sofort korrekt ist!
        // await new Promise(r => setTimeout(r, 200)); // Entfernt - testen!

        // Performance: Cache invalidieren und aktualisieren
        performanceCache.clear();
        const data = await chrome.storage.local.get(['ruleCount', 'ruleStats']);
        performanceCache.storageCache = data;
        performanceCache.cacheTimestamp = Date.now();
        
        // Warme Cache-Einträge für häufige Zugriffe
        performanceCache.set('stats', {
          ruleCount: data.ruleCount ?? 'N/A',
          ruleStats: data.ruleStats ?? {},
          cached: false
        });
        
        sendResponse({
          success: true,
          message: "Rules reloaded successfully.",
          ruleCount: data.ruleCount ?? 'N/A',
          ruleStats: data.ruleStats ?? {}
        });
      })
      .catch(err => {
        // Fehler während des Reloads (wurde schon in initialize geloggt und Badge gesetzt)
        console.error(`${LOG_PREFIX} reloadRules failed:`, err);
        // Sende trotzdem eine Antwort an das Popup
        sendResponse({
            success: false,
            message: `Failed to reload rules: ${err.message}`,
            ruleCount: 'Fehler',
            ruleStats: {}
         });
      });
    return true; // Signalisiert asynchrone Antwort
  }

  // Wenn die Nachricht nicht behandelt wurde
  console.log(`${LOG_PREFIX} Unhandled message action:`, request.action);
  return false; // Keine asynchrone Antwort geplant
});

// === Initialer Start ===
// Performance: Sofort starten + WASM preloading
console.log(`${LOG_PREFIX} Background script loaded. Triggering initial load.`);
initialize();

// Performance: WASM Preloading nach kurzer Verzögerung
setTimeout(() => {
  if (!shouldUseWasm) {
    console.log(`${LOG_PREFIX} Starting WASM preload for future use...`);
    preloadWasmModule();
  }
}, PRELOAD_DELAY);
