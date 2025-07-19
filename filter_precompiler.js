#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Konfiguration
const CONFIG = {
    // Die neue, optimierte Eingabedatei
    DEFAULT_INPUT_FILE: 'filter_optimized.txt',
    // Die Zieldatei für die kompilierten Regeln
    DEFAULT_OUTPUT_FILE: 'filter_precompiled.json',
    FILTER_LISTS_DIR: 'filter_lists',
    MAX_FILTER_LENGTH: 1000,
    MAX_URL_FILTER_LENGTH: 8192, // Standard-Limit von Chrome
};

// KORREKTUR: Die Ressourcentypen werden als feste Liste definiert,
// da das 'chrome'-Objekt in Node.js nicht verfügbar ist.
const VALID_RESOURCE_TYPES = [
    "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
    "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"
];

console.log('🚀 Pagy Blocker - Filter Precompiler');
console.log('====================================');

/**
 * Prüft, ob eine Zeile eine gültige und zu verarbeitende Regel ist.
 */
function isValidRuleLine(line) {
    const trimmedLine = line.trim();
    // Kommentare, leere Zeilen und Header ignorieren
    if (!trimmedLine || trimmedLine.startsWith('!') || trimmedLine.startsWith('[') || trimmedLine.startsWith('#')) {
        return false;
    }
    if (trimmedLine.length > CONFIG.MAX_FILTER_LENGTH) {
        console.warn(`Regel übersprungen (zu lang): ${trimmedLine.substring(0, 80)}...`);
        return false;
    }
    // Kosmetische Filter ignorieren, da nur Netzwerkregeln unterstützt werden
    if (trimmedLine.includes('##') || trimmedLine.includes('#@#') || trimmedLine.includes('#?#')) {
        return false;
    }
    return true;
}

/**
 * Wandelt eine Filterregel-Zeichenkette in ein Chrome DNR-Regelobjekt um.
 */
function createRuleObject(line, id) {
    const trimmedLine = line.trim();
    
    // Ausnahme-Regeln (Whitelist) behandeln
    const isException = trimmedLine.startsWith('@@');
    const urlFilter = isException ? trimmedLine.slice(2) : trimmedLine;

    if (!urlFilter) {
        throw new Error('Leere Regel nach Entfernen des @@-Präfixes.');
    }

    // Zusätzliche Sicherheits- und Kompatibilitätsprüfungen
    if (urlFilter.length > CONFIG.MAX_URL_FILTER_LENGTH) {
        throw new Error(`urlFilter überschreitet das Limit von ${CONFIG.MAX_URL_FILTER_LENGTH} Zeichen.`);
    }
    if (/[\u0000-\u001F\u007F]/u.test(urlFilter)) {
        throw new Error('urlFilter enthält ungültige Steuerzeichen.');
    }

    return {
        id: id,
        priority: isException ? 2 : 1, // Ausnahmen erhalten höhere Priorität
        action: { type: isException ? 'allow' : 'block' },
        condition: {
            urlFilter: urlFilter,
            resourceTypes: VALID_RESOURCE_TYPES
        }
    };
}


/**
 * Kompiliert eine Filterliste, entfernt Duplikate und konvertiert sie ins JSON-Format.
 */
export function precompileFilterList(filterText) {
    console.time('Precompilation');

    const lines = filterText.split(/\r?\n/);
    const seenRules = new Set();
    const compiledRules = [];
    let ruleId = 1;
    let duplicatesCount = 0;
    let errorsCount = 0;

    for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (isValidRuleLine(trimmedLine)) {
            if (!seenRules.has(trimmedLine)) {
                seenRules.add(trimmedLine);
                try {
                    const ruleObject = createRuleObject(trimmedLine, ruleId++);
                    compiledRules.push(ruleObject);
                } catch (error) {
                    errorsCount++;
                    console.warn(`❌ Fehler beim Erstellen der Regel für "${trimmedLine}": ${error.message}`);
                }
            } else {
                duplicatesCount++;
            }
        }
    }

    console.timeEnd('Precompilation');
    
    const stats = {
        totalLines: lines.length,
        processedRules: compiledRules.length,
        duplicates: duplicatesCount,
        errors: errorsCount,
    };

    console.log(`✅ Kompilierung abgeschlossen: ${stats.processedRules} eindeutige Regeln verarbeitet.`);
    console.log(`📊 Duplikate entfernt: ${stats.duplicates}`);
    if (stats.errors > 0) {
        console.log(`⚠️ Fehlerhafte Regeln: ${stats.errors}`);
    }
    
    return { rules: compiledRules, stats };
}


/**
 * Hauptfunktion zum Ausführen des Skripts.
 */
async function main() {
    try {
        const inputFile = process.argv[2] || CONFIG.DEFAULT_INPUT_FILE;
        const outputFile = process.argv[3] || CONFIG.DEFAULT_OUTPUT_FILE;
        
        const filterPath = path.join(__dirname, CONFIG.FILTER_LISTS_DIR, inputFile);
        const outputPath = path.join(__dirname, CONFIG.FILTER_LISTS_DIR, outputFile);
        const minOutputPath = outputPath.replace('.json', '_min.json');

        console.log(`Lese Input von: ${filterPath}`);
        const filterText = await fs.readFile(filterPath, 'utf8');

        console.log('Kompiliere und dedupliziere Filterliste...');
        const { rules, stats } = precompileFilterList(filterText);

        // Schreibe formatierte und minifizierte JSON-Dateien
        console.log(`Schreibe ${stats.processedRules} Regeln nach: ${outputPath}`);
        await fs.writeFile(outputPath, JSON.stringify(rules, null, 2));
        
        console.log(`Schreibe minifizierte Regeln nach: ${minOutputPath}`);
        await fs.writeFile(minOutputPath, JSON.stringify(rules));

        console.log('\n🎯 ERFOLG!');
        console.log(`Die neue Regelanzahl ist: ${stats.processedRules}. Bitte aktualisieren Sie STATIC_RULE_COUNT in background.js.`);

    } catch (error) {
        console.error('❌ Fehler bei der Präkompilierung:', error);
        process.exit(1);
    }
}

// Führt das Skript aus, wenn es direkt aufgerufen wird
if (import.meta.url.startsWith('file://') && process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
