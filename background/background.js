import { updateRules } from '../js/rule_parser.js';
import createFilterParserModule from '../wasm/filter_parser.js';

const LOG_PREFIX = "[PagyBlocker]";
const FILTER_LIST_URL = 'filter_lists/filter.txt';
const BADGE_ERROR_COLOR = '#FF0000';

let filterListCache = null;
let lastFilterFetch = 0;
const FILTER_CACHE_DURATION = 5 * 60 * 1000; // 5 Minuten Cache - reduziert für bessere Reaktivität

const WASM_THRESHOLD = 10000; // Schwellenwert für WASM-Aktivierung - optimiert für kleine Listen
let wasmModule = null;

let initializationPromise = null;

function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch (error) {
    console.warn(`${LOG_PREFIX} Ungültige URL:`, url);
    return null;
  }
}

async function getDisabledWebsites() {
  try {
    const result = await chrome.storage.local.get(['disabledWebsites']);
    return result.disabledWebsites || [];
  } catch (error) {
    console.warn(`${LOG_PREFIX} Fehler beim Laden deaktivierter Websites:`, error);
    return [];
  }
}

async function addDisabledWebsite(domain) {
  try {
    const disabledWebsites = await getDisabledWebsites();
    if (!disabledWebsites.includes(domain)) {
      disabledWebsites.push(domain);
      await chrome.storage.local.set({ disabledWebsites });
      console.log(`${LOG_PREFIX} ${domain} zu deaktivierten Websites hinzugefügt`);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Fehler beim Hinzufügen deaktivierter Website:`, error);
    throw error;
  }
}

async function removeDisabledWebsite(domain) {
  try {
    const disabledWebsites = await getDisabledWebsites();
    const filteredWebsites = disabledWebsites.filter(site => site !== domain);
    await chrome.storage.local.set({ disabledWebsites: filteredWebsites });
    console.log(`${LOG_PREFIX} ${domain} von deaktivierten Websites entfernt`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Fehler beim Entfernen deaktivierter Website:`, error);
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
  
  console.log(`${LOG_PREFIX} Wende Ausschlüsse für ${disabledWebsites.length} deaktivierte Websites an:`, disabledWebsites);
  
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
    console.warn(`${LOG_PREFIX} Badge konnte nicht gelöscht werden:`, e.message);
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
    console.warn(`${LOG_PREFIX} Fehler-Badge konnte nicht gesetzt werden:`, e.message);
  }
}

async function loadWasmIfNeeded(lineCount) {
  if (lineCount <= WASM_THRESHOLD) {
    return null;
  }
  
  if (!wasmModule) {
    console.log(`${LOG_PREFIX} Lade WASM für ${lineCount} Zeilen...`);
    
    // Timeout für WASM-Laden
    const loadTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('WASM Timeout')), 3000)
    );
    
    try {
      // Paralleles Vorladen mit schnellem Timeout
      wasmModule = await Promise.race([
        createFilterParserModule(),
        loadTimeout
      ]);
      
      // Schnelle Validierung
      if (!wasmModule || typeof wasmModule.parseFilterListWasm !== 'function') {
        throw new Error("WASM Funktionsvalidierung fehlgeschlagen");
      }
      
      console.log(`${LOG_PREFIX} WASM erfolgreich geladen`);
    } catch (error) {
      console.warn(`${LOG_PREFIX} WASM-Laden fehlgeschlagen, verwende JS:`, error);
      wasmModule = null;
      return null;
    }
  }
  
  return wasmModule;
}

function cleanupWasm() {
  if (wasmModule) {
    try {
      console.log(`${LOG_PREFIX} Bereinige WASM-Modul`);
      if (typeof wasmModule._free === 'function') {
        wasmModule._free();
      }
      wasmModule = null;
    } catch (error) {
      console.warn(`${LOG_PREFIX} WASM-Bereinigung Warnung:`, error);
      wasmModule = null;
    }
  }
}

async function toggleWebsiteBlocking(domain) {
  try {
    const isCurrentlyDisabled = await isWebsiteDisabled(domain);
    
    if (isCurrentlyDisabled) {
      console.log(`${LOG_PREFIX} Aktiviere Blocker für ${domain}...`);
      await removeDisabledWebsite(domain);
    } else {
      console.log(`${LOG_PREFIX} Deaktiviere Blocker für ${domain}...`);
      await addDisabledWebsite(domain);
    }
    
    // Website-Ausschlüsse auf bestehende Regeln anwenden statt komplett neu laden
    try {
      const data = await chrome.storage.local.get(['ruleCount']);
      if (data.ruleCount > 0) {
        // Aktuelle Regeln holen und Ausschlüsse erneut anwenden
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        if (existingRules.length > 0) {
          // Aktuelle Ausschlüsse entfernen und neu anwenden
          const baseRules = existingRules.map(rule => {
            const modifiedRule = { ...rule };
            if (modifiedRule.condition && modifiedRule.condition.excludedInitiatorDomains) {
              delete modifiedRule.condition.excludedInitiatorDomains;
            }
            return modifiedRule;
          });
          const rulesWithExclusions = await applyWebsiteExclusions(baseRules);
          await updateRules(rulesWithExclusions);
        } else {
          await initialize();
        }
      } else {
        await initialize();
      }
    } catch (error) {
      console.warn(`${LOG_PREFIX} Schnelle Ausschluss-Aktualisierung fehlgeschlagen, vollständiger Neustart:`, error);
      await initialize();
    }
    
    const newStatus = !isCurrentlyDisabled;
    console.log(`${LOG_PREFIX} Blocker ${newStatus ? 'aktiviert' : 'deaktiviert'} für ${domain}`);
    return newStatus;
  } catch (error) {
    console.error(`${LOG_PREFIX} Fehler beim Umschalten des Blockers für ${domain}:`, error);
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
    console.warn(`${LOG_PREFIX} Fehler beim Abrufen des Blocker-Status:`, error);
    return true;
  }
}

async function fetchFilterList() {
  const now = Date.now();
  
  if (filterListCache && (now - lastFilterFetch) < FILTER_CACHE_DURATION) {
    console.log(`${LOG_PREFIX} Verwende Cache-Filterliste`);
    return filterListCache;
  }
  
  try {
    const url = chrome.runtime.getURL(FILTER_LIST_URL);
    const resp = await fetch(url);
    
    if (!resp.ok) {
      throw new Error(`Abruf fehlgeschlagen: ${resp.status}`);
    }
    
    const text = await resp.text();
    
    // Cache-Aktualisierung
    filterListCache = text;
    lastFilterFetch = now;
    
    // Zeilen schätzen ohne vollständige Aufteilung für besseren Speicherverbrauch
    let lineCount = 1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') lineCount++;
    }
    
    console.log(`${LOG_PREFIX} ~${lineCount} Zeilen abgerufen`);
    return text;
  } catch (error) {
    console.error(`${LOG_PREFIX} Abruf-Fehler:`, error);
    
    if (filterListCache) {
      console.warn(`${LOG_PREFIX} Verwende Cache-Fallback`);
      return filterListCache;
    }
    
    throw new Error(`Abruf-Fehler: ${error.message}`);
  }
}

async function parseListWithJS(filterListText) {
  if (!filterListText || typeof filterListText !== 'string') {
    throw new Error('Invalid filter list text provided');
  }

  console.log(`${LOG_PREFIX} Starte vereinfachtes JS-Parsing...`);
  console.time(`${LOG_PREFIX} JS Parsing`);
  
  try {
    // Einfache und schnelle Zeilen-Verarbeitung
    const lines = filterListText.split('\n');
    const rules = [];
    let ruleId = 1;
    const stats = { totalLines: lines.length, processedRules: 0, skippedLines: 0, errors: 0 };
    
    // Einfache Whitelist für wichtige CDNs
    const whitelist = new Set([
      'fonts.gstatic.com', 'fonts.googleapis.com', 'cdnjs.cloudflare.com', 
      'code.jquery.com', 'maxcdn.bootstrapcdn.com'
    ]);
    
    const resourceTypes = ["script", "image", "xmlhttprequest"];
    
    // Schnelle direkte Verarbeitung ohne Batching-Overhead
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Einfache Filterung
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!') || trimmed.startsWith('[')) {
        stats.skippedLines++;
        continue;
      }
      
      // Einfache Domain-Filter-Prüfung
      if (trimmed.startsWith('||') && trimmed.endsWith('^')) {
        const domain = trimmed.slice(2, -1);
        
        // Whitelist-Prüfung
        if (whitelist.has(domain)) {
          stats.skippedLines++;
          continue;
        }
        
        // Einfache Validierung - nur Länge und gefährliche Zeichen prüfen
        if (domain.length > 0 && domain.length < 200 && !domain.includes('*') && !domain.includes(' ')) {
          rules.push({
            id: ruleId++,
            priority: 1,
            action: { type: 'block' },
            condition: {
              urlFilter: trimmed,
              resourceTypes: resourceTypes
            }
          });
          stats.processedRules++;
        } else {
          stats.skippedLines++;
        }
      } else {
        stats.skippedLines++;
      }
    }
    
    console.timeEnd(`${LOG_PREFIX} JS Parsing`);
    console.log(`${LOG_PREFIX} ${rules.length} Regeln aus ${lines.length} Zeilen geparst`);
    
    if (rules.length === 0) {
      throw new Error('Keine gültigen Regeln in Filterliste gefunden');
    }
    
    return { rules, stats };
  } catch (error) {
    console.timeEnd(`${LOG_PREFIX} JS Parsing`);
    console.error(`${LOG_PREFIX} Parsing fehlgeschlagen:`, error);
    throw error;
  }
}

function parseListWithWasm(module, filterListText) {
  console.log(`${LOG_PREFIX} Starte WASM-Parsing...`);
  console.time(`${LOG_PREFIX} Ultra-WASM Parsing`);
  
  try {
    // Schnelle WASM-Ausführung mit minimalem Overhead
    const jsonString = module.parseFilterListWasm(filterListText);
    console.timeEnd(`${LOG_PREFIX} Ultra-WASM Parsing`);
    
    if (!jsonString) {
      return { rules: [], stats: { totalLines: 0, processedRules: 0, skippedLines: 0 } };
    }
    
    // Schnelle JSON-Verarbeitung
    const result = JSON.parse(jsonString);
    console.log(`${LOG_PREFIX} WASM hat ${result.rules.length} Regeln geparst`);
    return result;
  } catch (error) {
    console.timeEnd(`${LOG_PREFIX} Ultra-WASM Parsing`);
    console.error(`${LOG_PREFIX} WASM-Parsing fehlgeschlagen:`, error);
    throw new Error(`WASM-Parsing fehlgeschlagen: ${error.message}`);
  }
}

async function initialize() {
  if (initializationPromise) {
    console.log(`${LOG_PREFIX} Initialisierung bereits im Gange...`);
    return initializationPromise;
  }
  
  initializationPromise = (async () => {
    try {
      console.log(`${LOG_PREFIX} Starte Initialisierung...`);
      
      // Schnelle parallele Operationen
      const [, listText] = await Promise.all([
        clearBadge(),
        fetchFilterList()
      ]);

      // Schnelle Zeilen-Zählung ohne vollständige Array-Erstellung
      let validLineCount = 0;
      let inComment = false;
      let start = 0;
      
      for (let i = 0; i < listText.length; i++) {
        if (listText[i] === '\n' || i === listText.length - 1) {
          const lineEnd = i === listText.length - 1 ? i + 1 : i;
          const line = listText.slice(start, lineEnd).trim();
          
          if (line && !inComment) {
            const firstChar = line[0];
            if (firstChar !== '#' && firstChar !== '!' && firstChar !== '[') {
              if (line.length > 4 && line[0] === '|' && line[1] === '|' && line[line.length-1] === '^') {
                validLineCount++;
              }
            }
          }
          start = i + 1;
        }
      }

      console.log(`${LOG_PREFIX} Verarbeite ${validLineCount} Regeln (Schwellenwert: ${WASM_THRESHOLD})`);

      let parseResult;
      const shouldUseWasm = validLineCount > WASM_THRESHOLD;
      
      if (shouldUseWasm) {
        console.log(`${LOG_PREFIX} Verwende WASM-Parser für große Liste`);
        const wasmModule = await loadWasmIfNeeded(validLineCount);
        if (wasmModule) {
          parseResult = parseListWithWasm(wasmModule, listText);
        } else {
          console.log(`${LOG_PREFIX} WASM fehlgeschlagen, verwende JS`);
          parseResult = await parseListWithJS(listText);
        }
      } else {
        console.log(`${LOG_PREFIX} Verwende JS-Parser für kleine Liste`);
        parseResult = await parseListWithJS(listText);
      }

      // Schneller paralleler Abschluss
      const [rulesWithExclusions] = await Promise.all([
        applyWebsiteExclusions(parseResult.rules),
        chrome.storage.local.set({ 
          ruleCount: parseResult.rules.length, 
          ruleStats: parseResult.stats,
          lastUpdate: Date.now()
        }).catch(() => {}) // Nicht-blockierender Speicher
      ]);
      
      await updateRules(rulesWithExclusions);
      await clearBadge();
      
      console.log(`${LOG_PREFIX} Initialisierung abgeschlossen - ${parseResult.rules.length} Regeln geladen`);
      return parseResult;

    } catch (error) {
      console.error(`${LOG_PREFIX} Initialisierung fehlgeschlagen:`, error);
      setErrorBadge('ERR').catch(() => {}); // Nicht-blockierendes Fehler-Badge
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
  console.log(`${LOG_PREFIX} Browser-Start erkannt`);
  initialize();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Schnelle Nachrichten-Verarbeitung
  console.log(`${LOG_PREFIX} Nachricht:`, request.action);

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
        console.error(`${LOG_PREFIX} Fehler beim Abrufen der Statistiken:`, err);
        sendResponse({ ruleCount: 'Error', ruleStats: {}, enabled: false });
      }
    })();
    return true;
  }

  if (request.action === "reloadRules") {
    console.log(`${LOG_PREFIX} Lade Regeln neu...`);
    initialize()
      .then(async () => {
        const data = await chrome.storage.local.get(['ruleCount', 'ruleStats']);
        const domain = request.domain;
        const enabled = domain ? await getBlockerStatus(domain) : true;
        
        sendResponse({
          success: true,
          message: "Regeln erfolgreich neu geladen",
          ruleCount: data.ruleCount ?? 'N/A',
          ruleStats: data.ruleStats ?? {},
          enabled: enabled,
          domain: domain
        });
      })
      .catch(err => {
        console.error(`${LOG_PREFIX} Neuladen fehlgeschlagen:`, err);
        sendResponse({
          success: false,
          message: `Neuladen fehlgeschlagen: ${err.message}`,
          ruleCount: 'Error',
          enabled: false
        });
      });
    return true;
  }

  if (request.action === "toggleBlocker") {
    console.log(`${LOG_PREFIX} Schalte Blocker um...`);
    (async () => {
      try {
        const domain = request.domain;
        if (!domain) {
          throw new Error("Domain für Blocker-Umschaltung erforderlich");
        }
        
        const newStatus = await toggleWebsiteBlocking(domain);
        
        // Tab-Neuladen entfernt - verursacht Performance-Probleme
        // Benutzer kann manuell neu laden wenn nötig
        
        sendResponse({
          success: true,
          enabled: newStatus,
          domain: domain,
          message: newStatus ? `Blocker aktiviert für ${domain}` : `Blocker deaktiviert für ${domain}`
        });
      } catch (err) {
        console.error(`${LOG_PREFIX} Umschaltung fehlgeschlagen:`, err);
        sendResponse({
          success: false,
          enabled: false,
          message: `Umschaltung fehlgeschlagen: ${err.message}`
        });
      }
    })();
    return true;
  }

  return false;
});

chrome.runtime.onSuspend?.addListener(() => {
  console.log(`${LOG_PREFIX} Extension wird suspendiert, bereinige...`);
  cleanupWasm();
  filterListCache = null;
  initializationPromise = null;
});

console.log(`${LOG_PREFIX} Background-Script geladen`);
initialize();