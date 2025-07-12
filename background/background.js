import { updateRules } from '../js/rule_parser.js';
import createFilterParserModule from '../wasm/filter_parser.js';

const LOG_PREFIX = "[PagyBlocker]";
const FILTER_LIST_URL = 'filter_lists/filter.txt';
const BADGE_ERROR_COLOR = '#FF0000';

let filterListCache = null;
let lastFilterFetch = 0;
let cachedFilterHash = null;
const FILTER_CACHE_DURATION = 60 * 60 * 1000;

const WASM_THRESHOLD = 1200;
let wasmModule = null;

let initializationPromise = null;

function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch (error) {
    console.warn(`${LOG_PREFIX} Invalid URL:`, url);
    return null;
  }
}

async function getDisabledWebsites() {
  try {
    const result = await chrome.storage.local.get(['disabledWebsites']);
    return result.disabledWebsites || [];
  } catch (error) {
    console.warn(`${LOG_PREFIX} Failed to get disabled websites:`, error);
    return [];
  }
}

async function addDisabledWebsite(domain) {
  try {
    const disabledWebsites = await getDisabledWebsites();
    if (!disabledWebsites.includes(domain)) {
      disabledWebsites.push(domain);
      await chrome.storage.local.set({ disabledWebsites });
      console.log(`${LOG_PREFIX} Added ${domain} to disabled websites`);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to add disabled website:`, error);
    throw error;
  }
}

async function removeDisabledWebsite(domain) {
  try {
    const disabledWebsites = await getDisabledWebsites();
    const filteredWebsites = disabledWebsites.filter(site => site !== domain);
    await chrome.storage.local.set({ disabledWebsites: filteredWebsites });
    console.log(`${LOG_PREFIX} Removed ${domain} from disabled websites`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to remove disabled website:`, error);
    throw error;
  }
}

async function isWebsiteDisabled(domain) {
  const disabledWebsites = await getDisabledWebsites();
  return disabledWebsites.includes(domain);
}

async function applyWebsiteExclusions(rules) {
  const disabledWebsites = await getDisabledWebsites();
  
  if (disabledWebsites.length === 0) {
    return rules;
  }
  
  console.log(`${LOG_PREFIX} Applying exclusions for ${disabledWebsites.length} disabled websites:`, disabledWebsites);
  
  return rules.map(rule => {
    const modifiedRule = { ...rule };
    if (modifiedRule.condition) {
      modifiedRule.condition = { 
        ...modifiedRule.condition,
        excludedInitiatorDomains: disabledWebsites
      };
    }
    return modifiedRule;
  });
}

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

async function loadWasmIfNeeded(lineCount) {
  if (lineCount <= WASM_THRESHOLD) {
    return null;
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

function cleanupWasm() {
  if (wasmModule) {
    try {
      console.log(`${LOG_PREFIX} Cleaning up WASM module`);
      if (typeof wasmModule._free === 'function') {
      }
      wasmModule = null;
    } catch (error) {
      console.warn(`${LOG_PREFIX} WASM cleanup warning:`, error);
      wasmModule = null;
    }
  }
}

async function toggleWebsiteBlocking(domain) {
  try {
    const isCurrentlyDisabled = await isWebsiteDisabled(domain);
    
    if (isCurrentlyDisabled) {
      console.log(`${LOG_PREFIX} Enabling blocker for ${domain}...`);
      await removeDisabledWebsite(domain);
    } else {
      console.log(`${LOG_PREFIX} Disabling blocker for ${domain}...`);
      await addDisabledWebsite(domain);
    }
    
    await initialize();
    
    const newStatus = !isCurrentlyDisabled;
    console.log(`${LOG_PREFIX} Blocker ${newStatus ? 'enabled' : 'disabled'} for ${domain}`);
    return newStatus;
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to toggle blocker for ${domain}:`, error);
    await setErrorBadge('ERR');
    throw error;
  }
}

async function getBlockerStatus(domain = null) {
  try {
    if (domain) {
      const isDisabled = await isWebsiteDisabled(domain);
      return !isDisabled;
    } else {
      return true;
    }
  } catch (error) {
    console.warn(`${LOG_PREFIX} Failed to get blocker status:`, error);
    return true;
  }
}

async function fetchFilterList() {
  const now = Date.now();
  
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
    
    for (let i = 0; i < lines.length; i++) {
      try {
        const line = lines[i];
        const trimmed = line.trim();
        
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!') || trimmed.startsWith('[')) {
          stats.skippedLines++;
          continue;
        }
        
        if (trimmed.startsWith('||') && trimmed.endsWith('^')) {
          const domain = trimmed.slice(2, -1);
          
          const whitelist = ['fonts.gstatic.com', 'fonts.googleapis.com', 'cdnjs.cloudflare.com', 'code.jquery.com', 'maxcdn.bootstrapcdn.com'];
          if (whitelist.includes(domain)) {
            stats.skippedLines++;
            continue;
          }
          
          if (domain.length > 0 && domain.length < 200 && 
              !domain.includes('*') && !domain.includes(' ') && 
              /^[a-zA-Z0-9._/-]+(\?[a-zA-Z0-9=&_-]*)?$/.test(domain)) {
            
            const rule = {
              id: ruleId++,
              priority: 1,
              action: { type: 'block' },
              condition: {
                urlFilter: trimmed,
                resourceTypes: ["script", "image", "xmlhttprequest", "other"]
              }
            };
            
            rules.push(rule);
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

async function initialize() {
  if (initializationPromise) {
    console.log(`${LOG_PREFIX} Initialization already in progress, waiting...`);
    return initializationPromise;
  }
  
  initializationPromise = (async () => {
    try {
      console.log(`${LOG_PREFIX} Starting initialization...`);
      
      await clearBadge();

      const listText = await fetchFilterList();
      const lineCount = listText.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!') && !trimmed.startsWith('[');
      }).length;

      console.log(`${LOG_PREFIX} Processing ${lineCount} rules (threshold: ${WASM_THRESHOLD})`);

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

      const rulesWithExclusions = await applyWebsiteExclusions(parseResult.rules);
      await updateRules(rulesWithExclusions);
      await chrome.storage.local.set({ 
        ruleCount: parseResult.rules.length, 
        ruleStats: parseResult.stats,
        lastUpdate: Date.now()
      });

      await clearBadge();
      console.log(`${LOG_PREFIX} Initialization complete - ${parseResult.rules.length} rules loaded`);
      return parseResult;

    } catch (error) {
      console.error(`${LOG_PREFIX} Initialization failed:`, error);
      await setErrorBadge('ERR');
      throw error;
    }
  })();
  
  try {
    const result = await initializationPromise;
    return result;
  } finally {
    initializationPromise = null;
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`${LOG_PREFIX} Extension ${details.reason}`);
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  console.log(`${LOG_PREFIX} Browser startup detected`);
  initialize();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log(`${LOG_PREFIX} Received message:`, request);

  if (request.action === "getStats") {
    (async () => {
      try {
        const data = await chrome.storage.local.get(['ruleCount', 'ruleStats']);
        const domain = request.domain;
        const enabled = domain ? await getBlockerStatus(domain) : true;
        
        sendResponse({
          ruleCount: data.ruleCount ?? 'N/A',
          ruleStats: data.ruleStats ?? {},
          enabled: enabled,
          domain: domain
        });
      } catch (err) {
        console.error(`${LOG_PREFIX} Error getting stats:`, err);
        sendResponse({ ruleCount: 'Fehler', ruleStats: {}, enabled: false });
      }
    })();
    return true;
  }

  if (request.action === "reloadRules") {
    console.log(`${LOG_PREFIX} Reloading rules...`);
    initialize()
      .then(async () => {
        const data = await chrome.storage.local.get(['ruleCount', 'ruleStats']);
        const domain = request.domain;
        const enabled = domain ? await getBlockerStatus(domain) : true;
        
        sendResponse({
          success: true,
          message: "Rules reloaded successfully",
          ruleCount: data.ruleCount ?? 'N/A',
          ruleStats: data.ruleStats ?? {},
          enabled: enabled,
          domain: domain
        });
      })
      .catch(err => {
        console.error(`${LOG_PREFIX} Reload failed:`, err);
        sendResponse({
          success: false,
          message: `Failed to reload: ${err.message}`,
          ruleCount: 'Fehler',
          enabled: false
        });
      });
    return true;
  }

  if (request.action === "toggleBlocker") {
    console.log(`${LOG_PREFIX} Toggling blocker...`);
    (async () => {
      try {
        const domain = request.domain;
        if (!domain) {
          throw new Error("Domain is required for toggling blocker");
        }
        
        const newStatus = await toggleWebsiteBlocking(domain);
        
        try {
          const tabs = await chrome.tabs.query({active: true, currentWindow: true});
          if (tabs.length > 0) {
            const activeTab = tabs[0];
            if (activeTab.url && (activeTab.url.startsWith('http://') || activeTab.url.startsWith('https://'))) {
              await chrome.tabs.reload(activeTab.id);
              console.log(`${LOG_PREFIX} Reloaded active tab: ${activeTab.id}`);
            }
          }
        } catch (err) {
          console.warn(`${LOG_PREFIX} Tab reload error:`, err);
        }
        
        sendResponse({
          success: true,
          enabled: newStatus,
          domain: domain,
          message: newStatus ? `Blocker enabled for ${domain}` : `Blocker disabled for ${domain}`
        });
      } catch (err) {
        console.error(`${LOG_PREFIX} Toggle failed:`, err);
        sendResponse({
          success: false,
          enabled: false,
          message: `Failed to toggle: ${err.message}`
        });
      }
    })();
    return true;
  }

  return false;
});

chrome.runtime.onSuspend?.addListener(() => {
  console.log(`${LOG_PREFIX} Extension suspending, cleaning up...`);
  cleanupWasm();
  filterListCache = null;
  initializationPromise = null;
});

console.log(`${LOG_PREFIX} Background script loaded`);
initialize();