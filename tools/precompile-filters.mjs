#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { EXTENSION_CONFIG } from '../core/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const INPUT_FILE = path.join(projectRoot, 'filter_lists', 'filter_optimized.txt');
const OUTPUT_FILE = path.join(projectRoot, 'filter_lists', 'filter_precompiled.json');
const SHOW_STATS = process.argv.includes('--stats');

// RE2-safe escape for regex (used by Chrome DNR)
function escapeRegex(str) {
  // Escape characters that have special meaning in RE2/JS regex
  // Canonical pattern from MDN: /[.*+?^${}()|[^\\]\\]/g
  return str.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

// Resource types to consider (exclude main_frame for safety/perf)
const DEFAULT_RESOURCE_TYPES = [
  'script',
  'image',
  'stylesheet',
  'xmlhttprequest',
  'font',
  'media',
  'sub_frame',
  'websocket',
  'ping',
  'other',
];

// Returns a domain (string) if rule is a pure domain-only ABP pattern: "||domain.tld^"
function parseDomainOnlyFromDoublePipe(rule) {
  if (!rule.startsWith('||')) return null;
  let rest = rule.slice(2);
  // Drop trailing separators like ^
  rest = rest.replace(/\^+$/, '');
  // Domain-only must not include a path
  if (rest.includes('/')) return null;
  const host = rest.replace(/\^/g, '').replace(/^\.+/, '').trim();
  if (!host) return null;
  return host.toLowerCase();
}

function buildRegexForDomainRule(rule) {
  // Handle patterns like: ||domain.com^ or ||domain.com/path^ or ||sub.domain.tld^
  // ABP semantics: || matches beginning of domain name, including subdomains
  // We'll translate to RE2 regex for DNR: ^https?://([a-z0-9-]+\.)*domain\.tld(:\d+)?(/|$)

  // Strip leading '||'
  let rest = rule.slice(2);

  // Split into host and optional path based on first '/' occurrence
  let hostPart = rest;
  let pathPart = '';

  const slashIdx = rest.indexOf('/');
  if (slashIdx !== -1) {
    hostPart = rest.slice(0, slashIdx);
    pathPart = rest.slice(slashIdx); // includes '/'
  }

  // Remove trailing '^' from host or path if present (separator in ABP)
  hostPart = hostPart.replace(/\^+$/, '');
  pathPart = pathPart.replace(/\^+$/, '');

  // Host part may still contain a '^' separator; drop it
  hostPart = hostPart.replace(/\^/g, '');

  // Safety: trim any leading dots
  hostPart = hostPart.replace(/^\.+/, '').trim();
  if (!hostPart) return null;

  // Escape host for regex dots
  const escapedHost = escapeRegex(hostPart);

  // Build host regex to allow subdomains: ([a-z0-9-]+\.)*host
  const hostRegex = `([a-z0-9-]+\\.)*${escapedHost}`;

  // Path part handling
  let pathRegex = '';
  if (pathPart) {
    // Convert ABP wildcards '*' to '.*'
    let p = pathPart
      .replace(/\^/g, '')
      .replace(/\*/g, '.*');
    // Escape remaining regex chars except the '.*' we just produced
    // Do a two-step: temporarily protect '.*'
    p = p.replace(/\.\*/g, '__WILDCARD__');
    p = escapeRegex(p);
    p = p.replace(/__WILDCARD__/g, '.*');
    // Ensure it starts with '/'
    if (!p.startsWith('/')) p = '/' + p;
    pathRegex = p;
  } else {
    pathRegex = '(/|$)'; // end or path start
  }

  // Schemes restriction: http and https only
  const regex = `^https?:\\/\\/${hostRegex}(?::\\d+)?${pathRegex}`;
  return regex;
}

function abpToRegex(rule) {
  rule = rule.trim();
  if (!rule || rule.startsWith('!') || rule.startsWith('[')) return null; // comments and metadata
  if (rule.includes('##') || rule.includes('#@#') || rule.includes('#?#')) return null; // cosmetic filters unsupported in DNR

  // Exception rules ("@@") are allow rules; we skip them here because our baseline is blocking rules only.
  if (rule.startsWith('@@')) return null;

  // Domain-style rule
  if (rule.startsWith('||')) {
    return buildRegexForDomainRule(rule);
  }

  // Exact scheme-anchor like |http:// or |https://
  if (rule.startsWith('|http://') || rule.startsWith('|https://')) {
    let r = rule.slice(1); // drop leading '|'
    // Basic ABP translations
    r = r.replace(/\^/g, '');
    r = r.replace(/\*/g, '.*');
    // Escape other regex characters while preserving wildcards
    r = r.replace(/\.\*/g, '__WILDCARD__');
    r = escapeRegex(r);
    r = r.replace(/__WILDCARD__/g, '.*');
    // Anchor at start
    return `^${r}`;
  }

  // Fallback: convert basic wildcards; allow matching anywhere in URL
  let r = rule
    .replace(/\^/g, '')
    .replace(/\*/g, '.*');
  r = r.replace(/\.\*/g, '__WILDCARD__');
  r = escapeRegex(r);
  r = r.replace(/__WILDCARD__/g, '.*');
  return r ? r : null;
}

async function main() {
  const start = Date.now();
  const txt = await fs.readFile(INPUT_FILE, 'utf8');
  const lines = txt.split(/\r?\n/);

  const domainSet = new Set();
  const domainCounts = new Map();
  const regexRules = [];
  const stats = {
    totalLines: lines.length,
    empty: 0,
    comments: 0,
    metadata: 0,
    exceptions: 0,
    cosmetic: 0,
    domainOnlyTotal: 0,
    domainOnlyUnique: 0,
    domainOnlyDuplicates: 0,
    regexCount: 0,
  };
  let id = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { stats.empty++; continue; }

    // Skip comments, metadata, cosmetic filters and exception rules early
    if (line.startsWith('!')) { stats.comments++; continue; }
    if (line.startsWith('[')) { stats.metadata++; continue; }
    if (line.startsWith('@@')) { stats.exceptions++; continue; }
    if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) { stats.cosmetic++; continue; }

    // If it's a pure domain-only rule (e.g., ||example.com^), use requestDomains
    const domainOnly = parseDomainOnlyFromDoublePipe(line);
    if (domainOnly) {
      stats.domainOnlyTotal++;
      domainSet.add(domainOnly);
      domainCounts.set(domainOnly, (domainCounts.get(domainOnly) || 0) + 1);
      continue;
    }

    // Fallback to regex conversion for all other patterns
    const regex = abpToRegex(line);
    if (!regex) continue;

    regexRules.push({
      id: 0, // assigned later
      priority: 1,
      action: { type: 'block' },
      condition: {
        regexFilter: regex,
        isUrlFilterCaseSensitive: false,
        resourceTypes: DEFAULT_RESOURCE_TYPES,
        domainType: 'thirdParty',
      }
    });
    stats.regexCount++;
  }

  const rules = [];

  // Domain-only rules (fast path): block third-party requests to these domains
  for (const domain of domainSet) {
    rules.push({
      id: id++,
      priority: 1,
      action: { type: 'block' },
      condition: {
        requestDomains: [domain],
        resourceTypes: DEFAULT_RESOURCE_TYPES,
        domainType: 'thirdParty',
      }
    });
  }
  stats.domainOnlyUnique = domainSet.size;
  stats.domainOnlyDuplicates = stats.domainOnlyTotal - stats.domainOnlyUnique;

  // Regex rules (path-specific or other patterns)
  for (const r of regexRules) {
    r.id = id++;
    rules.push(r);
  }

  // Cap rules to limit defined in config (default ~30k)
  const MAX_RULES = EXTENSION_CONFIG.LIMITS.MAX_RULES_COUNT;
  const finalRules = rules.slice(0, MAX_RULES);

  const PRETTY = process.argv.includes('--pretty');
  const json = PRETTY ? JSON.stringify(finalRules, null, 2) + '\n' : JSON.stringify(finalRules);
  await fs.writeFile(OUTPUT_FILE, json, 'utf8');

  const ms = (Date.now() - start).toFixed(0);
  console.log(`[precompile-filters] Wrote ${finalRules.length} rules to ${path.relative(projectRoot, OUTPUT_FILE)} in ${ms}ms (domains: ${domainSet.size}, regex: ${regexRules.length})`);

  if (SHOW_STATS) {
    const duplicates = [...domainCounts.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
    const header = '[precompile-filters][stats]';
    console.log(`${header} totalLines=${stats.totalLines} empty=${stats.empty} comments=${stats.comments} metadata=${stats.metadata} exceptions=${stats.exceptions} cosmetic=${stats.cosmetic}`);
    console.log(`${header} domainOnly: total=${stats.domainOnlyTotal} unique=${stats.domainOnlyUnique} duplicates=${stats.domainOnlyDuplicates}`);
    console.log(`${header} regexCount=${stats.regexCount}`);
    if (duplicates.length) {
      console.log(`${header} duplicate domain-only entries:`);
      for (const [name, count] of duplicates) {
        console.log(`  ${name} x${count}`);
      }
    } else {
      console.log(`${header} no duplicate domain-only entries.`);
    }
  }
}

main().catch((err) => {
  console.error('[precompile-filters] Failed:', err?.message || err);
  process.exitCode = 1;
});
