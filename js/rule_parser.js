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

export async function updateRules(rules) {
const DNR_MAX_RULES = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES || 5000;
let toAdd = rules.filter(validateRule);

if (toAdd.length !== rules.length) {
  console.log(`Filtered out ${rules.length - toAdd.length} rules with non-ASCII characters`);
}

if (toAdd.length > DNR_MAX_RULES) {
  console.warn(`Truncating from ${toAdd.length} to ${DNR_MAX_RULES} rules`);
  toAdd = toAdd.slice(0, DNR_MAX_RULES);
}

try {
  // Performance: Nur existierende Regeln abfragen und löschen
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  if (existingRules.length > 0) {
    const existingIds = existingRules.map(rule => rule.id);
    console.log(`Removing ${existingIds.length} existing rules...`);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds, addRules: [] });
  }

  // Performance: Verringerte Wartezeit
  if (existingRules.length > 0) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Performance: Optimierte Batch-Größe
  const BATCH = 200;
  console.log(`Preparing to add ${toAdd.length} new rules.`);
  if (toAdd.length > 0) {
      // Sequenzielle Verarbeitung für bessere Performance
      for (let i = 0; i < toAdd.length; i += BATCH) {
        const batch = toAdd.slice(i, i + BATCH);
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: batch, removeRuleIds: [] });
        // Kurze Pause zwischen Batches für bessere Browser-Performance
        if (i + BATCH < toAdd.length) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      console.log("Finished adding rules.");
  } else {
      console.log("No new rules to add.");
  }

  const finalRuleCount = toAdd.length;
  await chrome.storage.local.set({ ruleCount: finalRuleCount });
  console.log(`Stored rule count: ${finalRuleCount}`);

  console.log("Clearing badge (updateRules successful).");
  if (chrome.action?.setBadgeText) {
      await chrome.action.setBadgeText({ text: '' });
  }

} catch (err) {
  console.error('Error updating rules:', err);
  if (chrome.action?.setBadgeText && chrome.action.setBadgeBackgroundColor) {
     const badgeText = 'UPD ERR'; // Oder dein 'PD ER'
    console.log(`Setting error badge: ${badgeText}`);
    await chrome.action.setBadgeText({ text: badgeText });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
  }
  console.log("Rule update failed, ruleCount not stored/updated.");
  // Fehler weiterwerfen, damit initialize() ihn abfangen kann
  throw new Error(`Rule application failed: ${err.message}`);
}
}
