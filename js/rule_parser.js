// js/rule_parser.js

/*export async function parseFilterList(filterListText) {
  const lines = filterListText.split(/\r?\n/);
  const rules = [];
  let ruleId = 1;
  const defaultResourceTypes = [
    "main_frame", "sub_frame", "stylesheet", "script", "image",
    "font", "object", "xmlhttprequest", "ping", "csp_report",
    "media", "websocket", "webtransport", "webbundle", "other"
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[')) continue;
    const parts = trimmed.split('$');
    const filterPart = parts[0];
    const optionsPart = parts[1] || '';
    let condition = { resourceTypes: [...defaultResourceTypes] };
    let valid = false;

    if (filterPart.startsWith('||') && filterPart.endsWith('^')) {
      const domain = filterPart.slice(2, -1);
      if (domain && !domain.includes('*')) {
        condition.urlFilter = `||${domain}/`;
        valid = true;
      }
    }

    if (valid && optionsPart) {
      for (const opt of optionsPart.split(',')) {
        if (opt.startsWith('domain=')) {
          const domains = opt.slice(7).split('|');
          const inc = [], exc = [];
          for (const d of domains) {
            const dm = d.trim();
            if (!dm) continue;
            if (dm.startsWith('~')) exc.push(dm.slice(1)); else inc.push(dm);
          }
          if (exc.length) {
            delete condition.initiatorDomains;
            condition.excludedInitiatorDomains = exc;
          } else if (inc.length) {
            condition.initiatorDomains = inc;
          }
        }
      }
    }

    if (valid && Object.keys(condition).length > 1) {
      rules.push({ id: ruleId++, priority: 1, action: { type: 'block' }, condition });
    }
  }

  return rules;
}
*/

function isASCII(str) {
  return /^[\x00-\x7F]*$/.test(str);
}

function validateRule(rule) {
  if (rule.condition && rule.condition.urlFilter && !isASCII(rule.condition.urlFilter)) {
    console.warn(`Skipping rule with id ${rule.id}: urlFilter contains non-ASCII characters: ${rule.condition.urlFilter}`);
    return false;
  }
  return true;
}

// Performance: Rule validation cache
const validationCache = new Map();
function cachedValidateRule(rule) {
  const key = rule.condition?.urlFilter;
  if (!key) return false;
  
  if (validationCache.has(key)) {
    return validationCache.get(key);
  }
  
  const isValid = validateRule(rule);
  validationCache.set(key, isValid);
  
  // LRU cleanup
  if (validationCache.size > 1000) {
    const firstKey = validationCache.keys().next().value;
    validationCache.delete(firstKey);
  }
  
  return isValid;
}

// Make function globally available for importScripts
async function updateRules(rules) {
const DNR_MAX_RULES = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES || 5000;

// Performance: Parallel filtering mit Web Workers Pattern
console.time('Rule Filtering');
let toAdd;
if (rules.length > 1000) {
  // Chunked parallel processing für große Listen
  const chunkSize = Math.ceil(rules.length / 4);
  const chunks = [];
  for (let i = 0; i < rules.length; i += chunkSize) {
    chunks.push(rules.slice(i, i + chunkSize));
  }
  
  const filterPromises = chunks.map(chunk => 
    Promise.resolve(chunk.filter(cachedValidateRule))
  );
  
  const filteredChunks = await Promise.all(filterPromises);
  toAdd = filteredChunks.flat();
} else {
  toAdd = rules.filter(cachedValidateRule);
}
console.timeEnd('Rule Filtering');

if (toAdd.length !== rules.length) {
  console.log(`Filtered out ${rules.length - toAdd.length} rules with non-ASCII characters`);
}

if (toAdd.length > DNR_MAX_RULES) {
  console.warn(`Truncating from ${toAdd.length} to ${DNR_MAX_RULES} rules`);
  toAdd = toAdd.slice(0, DNR_MAX_RULES);
}

try {
  console.time('Rule Update Process');
  
  // Performance: Parallel rule fetching und processing
  const [existingRules] = await Promise.all([
    chrome.declarativeNetRequest.getDynamicRules(),
    // Preload next operations while fetching
    Promise.resolve().then(() => console.log('Preparing rule updates...'))
  ]);
  
  const existingIds = existingRules.map(rule => rule.id);
  
  // Performance: Dynamische Batch-Größe basierend auf Regel-Anzahl
  const OPTIMAL_BATCH_SIZE = Math.min(
    Math.max(100, Math.floor(toAdd.length / 10)), // Min 100, max 10% der Regeln
    1000 // Absolute max für Stabilität
  );
  
  console.log(`Updating ${existingIds.length} -> ${toAdd.length} rules with optimal batch size ${OPTIMAL_BATCH_SIZE}`);
  
  if (toAdd.length === 0) {
    // Optimierter leerer Update
    if (existingIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ 
        removeRuleIds: existingIds, 
        addRules: [] 
      });
    }
    console.log("All rules removed.");
  } else if (toAdd.length <= OPTIMAL_BATCH_SIZE) {
    // Single atomic transaction - fastest path
    await chrome.declarativeNetRequest.updateDynamicRules({ 
      removeRuleIds: existingIds, 
      addRules: toAdd 
    });
    console.log(`Atomically updated to ${toAdd.length} rules.`);
  } else {
    // High-performance chunked processing
    console.time('Chunked Rule Updates');
    
    // Step 1: Clear existing rules
    if (existingIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({ 
        removeRuleIds: existingIds, 
        addRules: [] 
      });
    }
    
    // Step 2: Parallel batch preparation
    const batches = [];
    for (let i = 0; i < toAdd.length; i += OPTIMAL_BATCH_SIZE) {
      batches.push(toAdd.slice(i, i + OPTIMAL_BATCH_SIZE));
    }
    
    // Step 3: Pipeline processing with minimal delays
    for (let i = 0; i < batches.length; i++) {
      const batchPromise = chrome.declarativeNetRequest.updateDynamicRules({ 
        addRules: batches[i], 
        removeRuleIds: [] 
      });
      
      // Pipeline: Start next batch prep while current processes
      if (i < batches.length - 1) {
        await Promise.all([
          batchPromise,
          // Minimal delay only for very large updates
          batches.length > 20 ? new Promise(r => setTimeout(r, 1)) : Promise.resolve()
        ]);
      } else {
        await batchPromise;
      }
    }
    
    console.timeEnd('Chunked Rule Updates');
    console.log(`Added ${toAdd.length} rules in ${batches.length} optimized batches.`);
  }
  
  console.timeEnd('Rule Update Process');

  const finalRuleCount = toAdd.length;
  await chrome.storage.local.set({ ruleCount: finalRuleCount });
  console.log(`Stored rule count: ${finalRuleCount}`);

  // Badge wird in background.js durch clearBadge() verwaltet

} catch (err) {
  console.error('Error updating rules:', err);
  if (chrome.action?.setBadgeText && chrome.action?.setBadgeBackgroundColor) {
     const badgeText = 'UPD ERR';
    console.log(`Setting error badge: ${badgeText}`);
    await Promise.all([
      chrome.action.setBadgeText({ text: badgeText }),
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })
    ]);
  }
  console.log("Rule update failed, ruleCount not stored/updated.");
  // Fehler weiterwerfen, damit initialize() ihn abfangen kann
  throw new Error(`Rule application failed: ${err.message}`);
}
}

// Export function for ES modules
export { updateRules };
