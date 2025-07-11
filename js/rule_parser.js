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

// Enhanced cache management with coordination
class ValidationCache {
  constructor() {
    this.cache = new Map();
    this.accessOrder = new Map();
    this.maxSize = getOptimalCacheSize(10000, 1000, 5000);
    this.hitCount = 0;
    this.missCount = 0;
    this.lastOptimization = Date.now();
  }
  
  get(key) {
    if (this.cache.has(key)) {
      this.hitCount++;
      // Update LRU order
      this.accessOrder.delete(key);
      this.accessOrder.set(key, Date.now());
      return this.cache.get(key);
    }
    this.missCount++;
    return null;
  }
  
  set(key, value) {
    // Periodic optimization
    this.maybeOptimize();
    
    // LRU cleanup before adding
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.accessOrder.keys().next().value;
      this.cache.delete(oldestKey);
      this.accessOrder.delete(oldestKey);
    }
    
    this.cache.set(key, value);
    this.accessOrder.set(key, Date.now());
  }
  
  clear() {
    this.cache.clear();
    this.accessOrder.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }
  
  maybeOptimize() {
    const now = Date.now();
    if (now - this.lastOptimization > 60000) { // Every minute
      this.optimize();
      this.lastOptimization = now;
    }
  }
  
  optimize() {
    // Adjust cache size based on hit rate
    const totalRequests = this.hitCount + this.missCount;
    if (totalRequests > 100) {
      const hitRate = this.hitCount / totalRequests;
      if (hitRate > 0.9) {
        this.maxSize = Math.min(this.maxSize * 1.2, 10000);
      } else if (hitRate < 0.5) {
        this.maxSize = Math.max(this.maxSize * 0.8, 500);
      }
      
      // Reset stats periodically
      if (totalRequests > 10000) {
        this.hitCount = Math.floor(this.hitCount * 0.5);
        this.missCount = Math.floor(this.missCount * 0.5);
      }
    }
  }
  
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.hitCount / (this.hitCount + this.missCount) || 0,
      hitCount: this.hitCount,
      missCount: this.missCount
    };
  }
}

const validationCache = new ValidationCache();

// Register with global cache coordinator
globalCacheCoordinator.register(validationCache);

// Add cleanup function for extension shutdown
function clearValidationCache() {
  validationCache.clear();
}

// Make function globally available for importScripts
async function updateRules(rules) {
const DNR_MAX_RULES = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES || 5000;

// Performance: Optimized filtering with dynamic chunking
console.time('Rule Filtering');
let toAdd;
if (rules.length > 1000) {
  // Dynamic chunk size based on CPU cores (estimated)
  const optimalChunkSize = Math.max(250, Math.ceil(rules.length / (navigator.hardwareConcurrency || 4)));
  const chunks = [];
  for (let i = 0; i < rules.length; i += optimalChunkSize) {
    chunks.push(rules.slice(i, i + optimalChunkSize));
  }
  
  // Direct filtering without unnecessary Promise.resolve
  const filteredChunks = chunks.map(chunk => chunk.filter(cachedValidateRule));
  toAdd = filteredChunks.flat();
} else {
  toAdd = rules.filter(cachedValidateRule);
}
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
          // Minimal delay only for very large updates using fast yielding
          batches.length > 20 ? fastYield() : Promise.resolve()
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
