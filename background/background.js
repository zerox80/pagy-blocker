// background/background.js

// Import modules using ES module syntax
import { updateRules } from '../js/rule_parser.js';
import createFilterParserModule from '../wasm/filter_parser.js';

// === Konstanten ===
const LOG_PREFIX = "[PagyBlocker]";
const FILTER_LIST_URL = 'filter_lists/filter.txt';
const BADGE_ERROR_COLOR = '#FF0000';

// Optimized caching with longer duration for performance
let filterListCache = null;
let lastFilterFetch = 0;
const FILTER_CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Optimized WASM handling - only for very large lists
const WASM_THRESHOLD = 3000; // Only use WASM for lists > 3000 rules
let wasmModule = null;

// Robust initialization lock with Promise-based coordination
let initializationPromise = null;

// === Hilfsfunktionen ===

/**
 * Simplified badge management
 */
async function clearBadge() {
  try {
    if (chrome.action?.setBadgeText) {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} Could not clear badge:`, e.message);
  }
}

async function setErrorBadge(text = 'ERR') {
  try {
    if (chrome.action?.setBadgeText && chrome.action?.setBadgeBackgroundColor) {
      await Promise.all([
        chrome.action.setBadgeText({ text }),
        chrome.action.setBadgeBackgroundColor({ color: BADGE_ERROR_COLOR })
      ]);
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} Could not set error badge:`, e.message);
  }
}

/**
 * Optimized WASM loading with proper cleanup
 */
async function loadWasmIfNeeded(lineCount) {
  if (lineCount <= WASM_THRESHOLD) {
    return null; // Use JS parser for smaller lists
  }
  
  if (!wasmModule) {
    console.log(`${LOG_PREFIX} Loading WASM for ${lineCount} lines...`);
    try {
      wasmModule = await createFilterParserModule();
      if (typeof wasmModule.parseFilterListWasm !== 'function') {
        throw new Error("WASM function not found");
      }
    } catch (error) {
      console.warn(`${LOG_PREFIX} WASM load failed, using JS parser:`, error);
      wasmModule = null;
      return null;
    }
  }
  
  return wasmModule;
}

/**
 * Cleanup WASM module to prevent memory leaks
 */
function cleanupWasm() {
  if (wasmModule) {
    try {
      console.log(`${LOG_PREFIX} Cleaning up WASM module`);
      // If WASM module has cleanup methods, call them
      if (typeof wasmModule._free === 'function') {
        // Module-specific cleanup if available
      }
      wasmModule = null;
    } catch (error) {
      console.warn(`${LOG_PREFIX} WASM cleanup warning:`, error);
      wasmModule = null;
    }
  }
}

/**
 * Simple filter list fetching with basic caching
 */
async function fetchFilterList() {
  const now = Date.now();
  
  // Use cache if recent
  if (filterListCache && (now - lastFilterFetch) < FILTER_CACHE_DURATION) {
    console.log(`${LOG_PREFIX} Using cached filter list`);
    return filterListCache;
  }
  
  try {
    const url = chrome.runtime.getURL(FILTER_LIST_URL);
    const resp = await fetch(url);
    
    if (!resp.ok) {
      throw new Error(`Fetch failed: ${resp.status}`);
    }
    
    const text = await resp.text();
    
    // Update cache
    filterListCache = text;
    lastFilterFetch = now;
    
    const lineCount = text.split('\n').length;
    console.log(`${LOG_PREFIX} Fetched ${lineCount} lines`);
    return text;
  } catch (error) {
    console.error(`${LOG_PREFIX} Fetch error:`, error);
    
    if (filterListCache) {
      console.warn(`${LOG_PREFIX} Using cached fallback`);
      return filterListCache;
    }
    
    throw new Error(`Fetch Error: ${error.message}`);
  }
}

/**
 * Optimized JS Parser with error boundaries
 */
async function parseListWithJS(filterListText) {
  if (!filterListText || typeof filterListText !== 'string') {
    throw new Error('Invalid filter list text provided');
  }

  console.log(`${LOG_PREFIX} Starting JS parsing...`);
  console.time(`${LOG_PREFIX} JS Parsing`);
  
  try {
    const lines = filterListText.split(/\r?\n/);
    const rules = [];
    let ruleId = 1;
    const stats = { totalLines: lines.length, processedRules: 0, skippedLines: 0, errors: 0 };
    
    // Optimized parsing with error boundaries
    for (let i = 0; i < lines.length; i++) {
      try {
        const line = lines[i];
        const trimmed = line.trim();
        
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!') || trimmed.startsWith('[')) {
          stats.skippedLines++;
          continue;
        }
        
        // Parse ||domain^ format
        if (trimmed.startsWith('||') && trimmed.endsWith('^')) {
          const domain = trimmed.slice(2, -1);
          
          // Enhanced domain validation
          if (domain.length > 0 && domain.length < 100 && 
              !domain.includes('*') && !domain.includes(' ') && 
              /^[a-zA-Z0-9.-_]+$/.test(domain)) {
            
            rules.push({
              id: ruleId++,
              priority: 1,
              action: { type: 'block' },
              condition: {
                urlFilter: trimmed,
                resourceTypes: ["script", "image", "xmlhttprequest", "other", "stylesheet", "font"]
              }
            });
            stats.processedRules++;
          } else {
            stats.skippedLines++;
          }
        } else {
          stats.skippedLines++;
        }
      } catch (lineError) {
        console.warn(`${LOG_PREFIX} Error parsing line ${i + 1}:`, lineError);
        stats.errors++;
        stats.skippedLines++;
      }
    }
    
    console.timeEnd(`${LOG_PREFIX} JS Parsing`);
    console.log(`${LOG_PREFIX} Parsed ${rules.length} rules from ${lines.length} lines (${stats.errors} errors)`);
    
    if (rules.length === 0) {
      throw new Error('No valid rules found in filter list');
    }
    
    return { rules, stats };
  } catch (error) {
    console.timeEnd(`${LOG_PREFIX} JS Parsing`);
    console.error(`${LOG_PREFIX} JS parsing failed:`, error);
    throw error;
  }
}

/**
 * Simple WASM parsing with basic error handling
 */
function parseListWithWasm(module, filterListText) {
  console.log(`${LOG_PREFIX} Starting WASM parsing...`);
  console.time(`${LOG_PREFIX} WASM Parsing`);
  
  try {
    const jsonString = module.parseFilterListWasm(filterListText);
    console.timeEnd(`${LOG_PREFIX} WASM Parsing`);
    
    if (!jsonString) {
      return { rules: [], stats: { totalLines: 0, processedRules: 0, skippedLines: 0 } };
    }
    
    const result = JSON.parse(jsonString);
    console.log(`${LOG_PREFIX} WASM parsed ${result.rules.length} rules`);
    return result;
  } catch (error) {
    console.timeEnd(`${LOG_PREFIX} WASM Parsing`);
    console.error(`${LOG_PREFIX} WASM parsing failed:`, error);
    throw new Error(`WASM parsing failed: ${error.message}`);
  }
}

// === Kernlogik ===

/**
 * Optimized extension initialization with race condition protection
 */
async function initialize() {
  // If already initializing, return the existing promise
  if (initializationPromise) {
    console.log(`${LOG_PREFIX} Initialization already in progress, waiting...`);
    return initializationPromise;
  }
  
  // Create new initialization promise
  initializationPromise = (async () => {
    try {
      console.log(`${LOG_PREFIX} Starting initialization...`);
      await clearBadge();

      // 1. Fetch filter list
      const listText = await fetchFilterList();
      const lineCount = listText.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!') && !trimmed.startsWith('[');
      }).length;

      console.log(`${LOG_PREFIX} Processing ${lineCount} rules (threshold: ${WASM_THRESHOLD})`);

      // 2. Choose parser based on size - prefer JS for better performance on small lists
      let parseResult;
      const shouldUseWasm = lineCount > WASM_THRESHOLD;
      
      if (shouldUseWasm) {
        console.log(`${LOG_PREFIX} Using WASM parser for large list`);
        const wasmModule = await loadWasmIfNeeded(lineCount);
        if (wasmModule) {
          parseResult = parseListWithWasm(wasmModule, listText);
        } else {
          console.log(`${LOG_PREFIX} WASM failed, falling back to JS`);
          parseResult = await parseListWithJS(listText);
        }
      } else {
        console.log(`${LOG_PREFIX} Using optimized JS parser for small list`);
        parseResult = await parseListWithJS(listText);
      }

      // 3. Apply rules with error recovery
      await updateRules(parseResult.rules);
      await chrome.storage.local.set({ 
        ruleCount: parseResult.rules.length, 
        ruleStats: parseResult.stats,
        lastUpdate: Date.now()
      });

      // 4. Success
      await clearBadge();
      console.log(`${LOG_PREFIX} Initialization complete - ${parseResult.rules.length} rules loaded`);
      return parseResult;

    } catch (error) {
      console.error(`${LOG_PREFIX} Initialization failed:`, error);
      await setErrorBadge('ERR');
      throw error;
    }
  })();
  
  // Clean up promise when done
  try {
    const result = await initializationPromise;
    return result;
  } finally {
    initializationPromise = null;
  }
}

// === Event-Listener ===

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`${LOG_PREFIX} Extension ${details.reason}`);
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  console.log(`${LOG_PREFIX} Browser startup detected`);
  initialize();
});

// Simple message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(`${LOG_PREFIX} Received message:`, request);

  if (request.action === "getStats") {
    // Simple async storage access
    (async () => {
      try {
        const data = await chrome.storage.local.get(['ruleCount', 'ruleStats']);
        sendResponse({
          ruleCount: data.ruleCount ?? 'N/A',
          ruleStats: data.ruleStats ?? {}
        });
      } catch (err) {
        console.error(`${LOG_PREFIX} Error getting stats:`, err);
        sendResponse({ ruleCount: 'Fehler', ruleStats: {} });
      }
    })();
    return true;
  }

  if (request.action === "reloadRules") {
    console.log(`${LOG_PREFIX} Reloading rules...`);
    initialize()
      .then(async () => {
        const data = await chrome.storage.local.get(['ruleCount', 'ruleStats']);
        sendResponse({
          success: true,
          message: "Rules reloaded successfully",
          ruleCount: data.ruleCount ?? 'N/A',
          ruleStats: data.ruleStats ?? {}
        });
      })
      .catch(err => {
        console.error(`${LOG_PREFIX} Reload failed:`, err);
        sendResponse({
          success: false,
          message: `Failed to reload: ${err.message}`,
          ruleCount: 'Fehler'
        });
      });
    return true;
  }

  return false;
});

// === Cleanup on extension shutdown ===
chrome.runtime.onSuspend?.addListener(() => {
  console.log(`${LOG_PREFIX} Extension suspending, cleaning up...`);
  cleanupWasm();
  filterListCache = null;
  initializationPromise = null;
});

// === Start ===
console.log(`${LOG_PREFIX} Background script loaded`);
initialize();
