#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const INPUT_FILE = path.join(projectRoot, 'filter_lists', 'filter_optimized.txt');
const OUTPUT_FILE = path.join(projectRoot, 'filter_lists', 'filter_optimized.cleaned.txt');

// Flags
const IN_PLACE = process.argv.includes('--in-place') || process.argv.includes('--inplace');
const SHOW_STATS = process.argv.includes('--stats');

function parseDomainOnlyFromDoublePipe(rule) {
  if (!rule || !rule.startsWith('||')) return null;
  let rest = rule.slice(2);
  // Domain-only must not include a path
  if (rest.includes('/')) return null;
  // Drop trailing separators like ^ and stray ^ inside
  rest = rest.replace(/\^+$/, '');
  const host = rest.replace(/\^/g, '').replace(/^\.+/, '').trim();
  if (!host) return null;
  return host.toLowerCase();
}

async function main() {
  const start = Date.now();
  const raw = await fs.readFile(INPUT_FILE, 'utf8');
  // Preserve original line endings (assume CRLF if present)
  const hasCRLF = /\r\n/.test(raw);
  const EOL = hasCRLF ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);

  const seenDomains = new Set();
  const domainCounts = new Map();

  const outLines = [];
  const stats = {
    totalLines: lines.length,
    empty: 0,
    comments: 0,
    metadata: 0,
    exceptions: 0,
    cosmetic: 0,
    domainOnlyTotal: 0,
    domainOnlyDuplicates: 0,
    kept: 0,
    removed: 0,
  };

  for (const rawLine of lines) {
    const line = (rawLine ?? '');
    const trimmed = line.trim();

    if (!trimmed) { stats.empty++; outLines.push(line); continue; }
    if (trimmed.startsWith('!')) { stats.comments++; outLines.push(line); continue; }
    if (trimmed.startsWith('[')) { stats.metadata++; outLines.push(line); continue; }
    if (trimmed.startsWith('@@')) { stats.exceptions++; outLines.push(line); continue; }
    if (trimmed.includes('##') || trimmed.includes('#@#') || trimmed.includes('#?#')) { stats.cosmetic++; outLines.push(line); continue; }

    const domainOnly = parseDomainOnlyFromDoublePipe(trimmed);
    if (domainOnly) {
      stats.domainOnlyTotal++;
      const prev = domainCounts.get(domainOnly) || 0;
      domainCounts.set(domainOnly, prev + 1);
      if (seenDomains.has(domainOnly)) {
        stats.domainOnlyDuplicates++;
        stats.removed++;
        // skip duplicate domain-only entries
        continue;
      }
      seenDomains.add(domainOnly);
      outLines.push(line); // keep original formatting
      stats.kept++;
      continue;
    }

    // Non-domain-only lines are kept as-is
    outLines.push(line);
    stats.kept++;
  }

  const outContent = outLines.join(EOL);
  const target = IN_PLACE ? INPUT_FILE : OUTPUT_FILE;
  await fs.writeFile(target, outContent, 'utf8');

  const ms = (Date.now() - start).toFixed(0);
  const duplicates = [...domainCounts.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);

  console.log(`[dedupe-filters] Wrote cleaned file to ${path.relative(projectRoot, target)} in ${ms}ms`);
  if (SHOW_STATS) {
    const header = '[dedupe-filters][stats]';
    console.log(`${header} totalLines=${stats.totalLines} kept=${stats.kept} removed=${stats.removed}`);
    console.log(`${header} empty=${stats.empty} comments=${stats.comments} metadata=${stats.metadata} exceptions=${stats.exceptions} cosmetic=${stats.cosmetic}`);
    console.log(`${header} domainOnly: total=${stats.domainOnlyTotal} duplicates=${stats.domainOnlyDuplicates} unique=${seenDomains.size}`);
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
  console.error('[dedupe-filters] Failed:', err?.message || err);
  process.exitCode = 1;
});
