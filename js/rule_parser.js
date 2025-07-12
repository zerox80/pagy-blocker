function isValidDomainFilter(str) {
  if (!str || str.length === 0) return false;
  // Schnelle Zeichen-Validierung mit for-Schleife statt Regex
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    if ((char >= 0 && char <= 31) || (char >= 127 && char <= 159) ||
        char === 34 || char === 39 || char === 60 || char === 62 || char === 92) {
      return false;
    }
  }
  return true;
}

function validateRule(rule) {
  // Schnelle Validierung mit minimalen Prüfungen
  return rule && rule.condition && rule.condition.urlFilter && isValidDomainFilter(rule.condition.urlFilter);
}

async function updateRules(rules) {
  if (!rules || !Array.isArray(rules)) {
    throw new Error("Ungültiges Regeln-Array bereitgestellt");
  }

  const DNR_MAX_RULES = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES || 5000;

  try {
    // Schnelle Validierung ohne Batch-Overhead
    const validRules = [];
    validRules.length = 0; // Vorab initialisieren für bessere Speicher-Allokierung
    
    for (let i = 0; i < rules.length; i++) {
      if (validateRule(rules[i])) {
        validRules.push(rules[i]);
      }
    }
    
    if (validRules.length !== rules.length) {
      console.log(`${rules.length - validRules.length} ungültige Regeln herausgefiltert`);
    }

    const toAdd = validRules.slice(0, DNR_MAX_RULES);
    
    if (toAdd.length < validRules.length) {
      console.warn(`Von ${validRules.length} auf ${toAdd.length} Regeln gekürzt`);
    }

    if (toAdd.length === 0) {
      console.warn('Keine gültigen Regeln hinzuzufügen');
      return;
    }

    // Optimized rule replacement strategy
    let existingRules = [];
    let existingIds = [];
    
    try {
      existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      existingIds = existingRules.map(rule => rule.id);
    } catch (error) {
      console.warn('Fehler beim Abrufen existierender Regeln, fahre mit Update fort:', error);
    }
    
    console.log(`Aktualisiere ${existingIds.length} -> ${toAdd.length} Regeln`);
    
    // Einfache Regel-Aktualisierung ohne komplexes Batching
    if (toAdd.length <= 1000 && existingIds.length <= 1000) {
      // Direkte Aktualisierung für kleine Regel-Sets
      await retryOperation(async () => {
        await chrome.declarativeNetRequest.updateDynamicRules({ 
          removeRuleIds: existingIds, 
          addRules: toAdd 
        });
      }, 3, 'Regel-Aktualisierung');
      
      console.log(`${toAdd.length} Regeln direkt aktualisiert`);
    } else {
      // Einfaches Batching nur bei wirklich großen Regel-Sets
      const BATCH_SIZE = 500;
      
      if (existingIds.length > 0) {
        await retryOperation(async () => {
          await chrome.declarativeNetRequest.updateDynamicRules({ 
            removeRuleIds: existingIds, 
            addRules: [] 
          });
        }, 3, 'Regeln löschen');
      }
      
      for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
        const batch = toAdd.slice(i, i + BATCH_SIZE);
        
        await retryOperation(async () => {
          await chrome.declarativeNetRequest.updateDynamicRules({ 
            addRules: batch, 
            removeRuleIds: [] 
          });
        }, 3, `Batch ${Math.floor(i/BATCH_SIZE) + 1}`);
      }
      
      console.log(`${toAdd.length} Regeln in ${Math.ceil(toAdd.length/BATCH_SIZE)} Batches hinzugefügt`);
    }

    // Asynchrone Speicher-Aktualisierung um Blockierung zu vermeiden
    chrome.storage.local.set({ 
      ruleCount: toAdd.length,
      lastRuleUpdate: Date.now()
    }).catch(storageError => {
      console.warn('Fehler beim Speichern der Regel-Anzahl:', storageError);
    });

  } catch (err) {
    console.error('Fehler beim Aktualisieren der Regeln:', err);
    
    // Nicht-blockierende Badge-Aktualisierung
    if (chrome.action?.setBadgeText && chrome.action?.setBadgeBackgroundColor) {
      Promise.all([
        chrome.action.setBadgeText({ text: 'ERR' }),
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })
      ]).catch(badgeError => {
        console.warn('Fehler beim Setzen des Fehler-Badges:', badgeError);
      });
    }
    
    throw new Error(`Regel-Aktualisierung fehlgeschlagen: ${err.message}`);
  }
}

async function retryOperation(operation, maxRetries, operationName) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await operation();
      if (attempt > 1) {
        console.log(`${operationName} erfolgreich bei Versuch ${attempt}`);
      }
      return;
    } catch (error) {
      lastError = error;
      console.warn(`${operationName} fehlgeschlagen bei Versuch ${attempt}:`, error);
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error(`${operationName} fehlgeschlagen nach ${maxRetries} Versuchen: ${lastError.message}`);
}

export { updateRules };