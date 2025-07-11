// js/rule_parser.js

// Simple rule validation
function isValidDomainFilter(str) {
  if (!str || str.length === 0) return false;
  // Block problematic characters
  const hasProblematicChars = /[\x00-\x1F\x7F-\x9F"'<>\\]/.test(str);
  return !hasProblematicChars;
}

function validateRule(rule) {
  if (rule.condition && rule.condition.urlFilter && !isValidDomainFilter(rule.condition.urlFilter)) {
    return false;
  }
  return true;
}

// Simple rule updating function
async function updateRules(rules) {
  const DNR_MAX_RULES = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES || 5000;

  // Filter valid rules
  const validRules = rules.filter(validateRule);
  
  if (validRules.length !== rules.length) {
    console.log(`Filtered out ${rules.length - validRules.length} invalid rules`);
  }

  // Limit to max rules
  const toAdd = validRules.slice(0, DNR_MAX_RULES);
  
  if (toAdd.length < validRules.length) {
    console.warn(`Truncated from ${validRules.length} to ${toAdd.length} rules`);
  }

  try {
    // Get existing rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existingRules.map(rule => rule.id);
    
    console.log(`Updating ${existingIds.length} -> ${toAdd.length} rules`);
    
    // Simple batch size for reliable updates
    const BATCH_SIZE = 1000;
    
    if (toAdd.length <= BATCH_SIZE) {
      // Single update for small rule sets
      await chrome.declarativeNetRequest.updateDynamicRules({ 
        removeRuleIds: existingIds, 
        addRules: toAdd 
      });
      console.log(`Updated to ${toAdd.length} rules`);
    } else {
      // Clear existing rules first
      if (existingIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ 
          removeRuleIds: existingIds, 
          addRules: [] 
        });
      }
      
      // Add rules in batches
      for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
        const batch = toAdd.slice(i, i + BATCH_SIZE);
        await chrome.declarativeNetRequest.updateDynamicRules({ 
          addRules: batch, 
          removeRuleIds: [] 
        });
      }
      
      console.log(`Added ${toAdd.length} rules in batches`);
    }

    // Store rule count
    await chrome.storage.local.set({ ruleCount: toAdd.length });
    console.log(`Stored rule count: ${toAdd.length}`);

  } catch (err) {
    console.error('Error updating rules:', err);
    
    // Set error badge
    if (chrome.action?.setBadgeText && chrome.action?.setBadgeBackgroundColor) {
      await Promise.all([
        chrome.action.setBadgeText({ text: 'ERR' }),
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })
      ]);
    }
    
    throw new Error(`Rule update failed: ${err.message}`);
  }
}

// Export function for ES modules
export { updateRules };
