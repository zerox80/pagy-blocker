/**
 * @file filter_precompiler.js
 * @description Kompiliert Filterlisten und generiert eine CSS-Datei (ES-Module-Version).
 * @version 4.0.0
 * @author Gemini
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE = path.join(__dirname, 'filter_lists', 'filter_optimized.txt');
const OUTPUT_NETWORK_RULES = path.join(__dirname, 'filter_lists', 'filter_precompiled.json');
const OUTPUT_COSMETIC_CSS = path.join(__dirname, 'filter_lists', 'cosmetic_filters.css');

function precompileFilters() {
    console.log('Starte Filter-Präkompilierung...');

    try {
        if (!fs.existsSync(INPUT_FILE)) {
            console.error(`FEHLER: Eingabedatei nicht gefunden: ${INPUT_FILE}`);
            fs.writeFileSync(INPUT_FILE, `! Beispiel-Filterliste\n||doubleclick.net^\n##.ad-banner`, 'utf-8');
            console.log(`Eine Beispieldatei wurde unter ${INPUT_FILE} erstellt.`);
            return;
        }

        const lines = fs.readFileSync(INPUT_FILE, 'utf-8').split(/\r?\n/);
        const networkRules = [];
        const cosmeticSelectors = new Set();
        let ruleId = 1;

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith('!')) continue;

            if (trimmedLine.includes('##')) {
                const selector = trimmedLine.split('##')[1];
                if (selector) cosmeticSelectors.add(selector);
            } else {
                networkRules.push({
                    id: ruleId++,
                    priority: 1,
                    action: { type: 'block' },
                    condition: {
                        urlFilter: trimmedLine.replace(/\^$/, ''),
                        resourceTypes: ['main_frame', 'sub_frame', 'script', 'image', 'stylesheet', 'object', 'xmlhttprequest', 'ping', 'media', 'websocket', 'other']
                    }
                });
            }
        }

        fs.writeFileSync(OUTPUT_NETWORK_RULES, JSON.stringify(networkRules, null, 2), 'utf-8');
        console.log(`${networkRules.length} Netzwerkregeln geschrieben in ${OUTPUT_NETWORK_RULES}`);

        if (cosmeticSelectors.size > 0) {
            const cssContent = Array.from(cosmeticSelectors).join(',\n') + ' {\n  display: none !important;\n  visibility: hidden !important;\n}';
            fs.writeFileSync(OUTPUT_COSMETIC_CSS, cssContent, 'utf-8');
            console.log(`${cosmeticSelectors.size} kosmetische Selektoren geschrieben in ${OUTPUT_COSMETIC_CSS}`);
        } else {
             fs.writeFileSync(OUTPUT_COSMETIC_CSS, '/* Keine kosmetischen Regeln definiert */', 'utf-8');
             console.log('Keine kosmetischen Regeln gefunden, leere CSS-Datei erstellt.');
        }
        console.log('Filter-Präkompilierung erfolgreich abgeschlossen.');
    } catch (error) {
        console.error('FEHLER während der Filter-Präkompilierung:', error);
        process.exit(1);
    }
}

precompileFilters();