// js/rule_parser.js

// Import shared utilities
import { fastYield, getOptimalCacheSize, globalCacheCoordinator } from './utils.js';

function isValidDomainFilter(str) {
  // More permissive validation - allow basic domain characters and common patterns
  // Block only truly problematic characters while allowing international domains
  if (!str || str.length === 0) return false;
  
  // Allow: letters, numbers, dots, hyphens, pipes, carets (AdBlock syntax)
  // Allow Unicode characters for international domains
  const hasProblematicChars = /[\x00-\x1F\x7F-\x9F"'<>\\]/.test(str);
  return !hasProblematicChars;
}

function validateRule(rule) {
  if (rule.condition && rule.condition.urlFilter && !isValidDomainFilter(rule.condition.urlFilter)) {
    console.warn(`Skipping rule with id ${rule.id}: urlFilter contains invalid characters: ${rule.condition.urlFilter}`);
    return false;
  }
  return true;
}

function cachedValidateRule(rule) {
  const key = rule.condition?.urlFilter;
  if (!key) return false;
  
  const cached = validationCache.get(key);
  if (cached !== null) {
    return cached;
  }
  
  const isValid = validateRule(rule);
  validationCache.set(key, isValid);
  return isValid;
}

// Simplified validation cache for faster startup
class FastValidationCache {
  constructor() {
    this.cache = new Map();
    this.maxSize = 1000; // Fixed size for simplicity
  }
  
  get(key) {
    return this.cache.get(key) || null;
  }
  
  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  
  clear() {
    this.cache.clear();
  }
}

const validationCache = new FastValidationCache();

// Add cleanup function for extension shutdown
function clearValidationCache() {
  validationCache.clear();
}

// Make function globally available for importScripts
async function updateRules(rules) {
const DNR_MAX_RULES = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES || 5000;

// Performance: Fast direct filtering
console.time('Rule Filtering');
const toAdd = rules.filter(cachedValidateRule);
console.timeEnd('Rule Filtering');

if (toAdd.length !== rules.length) {
  console.log(`Filtered out ${rules.length - toAdd.length} rules with invalid characters. Valid rules: ${toAdd.length}`);
}

if (toAdd.length > DNR_MAX_RULES) {
  console.warn(`Truncating from ${toAdd.length} to ${DNR_MAX_RULES} rules`);
  toAdd = toAdd.slice(0, DNR_MAX_RULES);
}

try {
  console.time('Rule Update Process');
  
  // Performance: Direct rule fetching
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  
  const existingIds = existingRules.map(rule => rule.id);
  
  // Performance: Fixed optimal batch size for speed
  const OPTIMAL_BATCH_SIZE = 500;
  
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
    
    // Step 3: Sequential processing for stability and speed
    for (let i = 0; i < batches.length; i++) {
      await chrome.declarativeNetRequest.updateDynamicRules({ 
        addRules: batches[i], 
        removeRuleIds: [] 
      });
      
      // Minimal yielding only for very large updates
      if (batches.length > 10 && i % 5 === 0) {
        await fastYield();
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
