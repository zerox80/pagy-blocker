function isValidDomainFilter(str) {
  if (!str || str.length === 0) return false;
  const hasProblematicChars = /[\x00-\x1F\x7F-\x9F"'<>\\]/.test(str);
  return !hasProblematicChars;
}

function validateRule(rule) {
  if (rule.condition && rule.condition.urlFilter && !isValidDomainFilter(rule.condition.urlFilter)) {
    return false;
  }
  return true;
}

async function updateRules(rules) {
  if (!rules || !Array.isArray(rules)) {
    throw new Error("Invalid rules array provided");
  }

  const DNR_MAX_RULES = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES || 5000;

  try {
    const validRules = [];
    const batchSize = 100;
    
    for (let i = 0; i < rules.length; i += batchSize) {
      const batch = rules.slice(i, i + batchSize);
      for (const rule of batch) {
        try {
          if (validateRule(rule)) {
            validRules.push(rule);
          }
        } catch (error) {
          console.warn('Rule validation error:', error, rule);
        }
      }
      
      if (i + batchSize < rules.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    if (validRules.length !== rules.length) {
      console.log(`Filtered out ${rules.length - validRules.length} invalid rules`);
    }

    const toAdd = validRules.slice(0, DNR_MAX_RULES);
    
    if (toAdd.length < validRules.length) {
      console.warn(`Truncated from ${validRules.length} to ${toAdd.length} rules`);
    }

    if (toAdd.length === 0) {
      console.warn('No valid rules to add');
      return;
    }

    let existingRules = [];
    let existingIds = [];
    
    try {
      existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      existingIds = existingRules.map(rule => rule.id);
    } catch (error) {
      console.warn('Failed to get existing rules, continuing with update:', error);
    }
    
    console.log(`Updating ${existingIds.length} -> ${toAdd.length} rules`);
    
    const BATCH_SIZE = 1000;
    
    if (toAdd.length <= BATCH_SIZE) {
      await retryOperation(async () => {
        await chrome.declarativeNetRequest.updateDynamicRules({ 
          removeRuleIds: existingIds, 
          addRules: toAdd 
        });
      }, 3, 'single rule update');
      
      console.log(`Updated to ${toAdd.length} rules`);
    } else {
      if (existingIds.length > 0) {
        await retryOperation(async () => {
          await chrome.declarativeNetRequest.updateDynamicRules({ 
            removeRuleIds: existingIds, 
            addRules: [] 
          });
        }, 3, 'clear existing rules');
      }
      
      for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
        const batch = toAdd.slice(i, i + BATCH_SIZE);
        
        await retryOperation(async () => {
          await chrome.declarativeNetRequest.updateDynamicRules({ 
            addRules: batch, 
            removeRuleIds: [] 
          });
        }, 3, `batch ${Math.floor(i/BATCH_SIZE) + 1}`);
      }
      
      console.log(`Added ${toAdd.length} rules in batches`);
    }

    try {
      await chrome.storage.local.set({ ruleCount: toAdd.length });
      console.log(`Stored rule count: ${toAdd.length}`);
    } catch (storageError) {
      console.warn('Failed to store rule count:', storageError);
    }

  } catch (err) {
    console.error('Error updating rules:', err);
    
    try {
      if (chrome.action?.setBadgeText && chrome.action?.setBadgeBackgroundColor) {
        await Promise.all([
          chrome.action.setBadgeText({ text: 'ERR' }),
          chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })
        ]);
      }
    } catch (badgeError) {
      console.warn('Failed to set error badge:', badgeError);
    }
    
    throw new Error(`Rule update failed: ${err.message}`);
  }
}

async function retryOperation(operation, maxRetries, operationName) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await operation();
      if (attempt > 1) {
        console.log(`${operationName} succeeded on attempt ${attempt}`);
      }
      return;
    } catch (error) {
      lastError = error;
      console.warn(`${operationName} failed on attempt ${attempt}:`, error);
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error(`${operationName} failed after ${maxRetries} attempts: ${lastError.message}`);
}

export { updateRules };