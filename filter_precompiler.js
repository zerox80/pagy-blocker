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
 * SIMPLIFIED: Efficient single-threaded filter compilation
 * Optimized for Node.js environment with fast processing
 */
export async function precompileFilterList(filterText) {
    console.time('Filter-Precompilation');

    const lines = filterText.split(/\r?\n/);
    const totalLines = lines.length;
    
    console.log(`📊 Processing ${totalLines} lines with optimized single-threaded approach`);
    
    const result = processSingleThreaded(lines);
    
    console.timeEnd('Filter-Precompilation');
    
    const stats = result.stats;
    console.log(`🚀 Compilation completed: ${stats.processedRules} rules processed`);
    console.log(`📊 Duplicates removed: ${stats.duplicates}`);
    
    if (stats.errors > 0) {
        console.log(`⚠️ Fehlerhafte Regeln: ${stats.errors}`);
    }
    
    return result;
}


/**
 * Optimized single-threaded processing for all filter lists
 * @param {string[]} lines - Array of filter lines
 * @returns {Object} Processing results
 */
function processSingleThreaded(lines) {
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
                    console.warn(`❌ Single-thread error for rule "${trimmedLine}": ${error.message}`);
                }
            } else {
                duplicatesCount++;
            }
        }
    }
    
    return {
        rules: compiledRules,
        stats: {
            totalLines: lines.length,
            processedRules: compiledRules.length,
            duplicates: duplicatesCount,
            errors: errorsCount
        }
    };
}



/**
 * SECURITY: Validates and sanitizes file paths to prevent path traversal attacks
 * @param {string} filePath - The file path to validate
 * @param {string} basePath - The base directory path that files must be within
 * @returns {Object} Validation result with sanitized path
 */
function validateFilePath(filePath, basePath) {
    if (!filePath || typeof filePath !== 'string') {
        return { isValid: false, error: 'File path must be a non-empty string' };
    }
    
    // SECURITY: Check for path traversal patterns
    const dangerousPatterns = [
        '..', './', '..\\', '.\\', '~/', '~\\',
        '/etc/', '/var/', '/bin/', '/usr/',
        'C:\\', 'c:\\', '\\Windows\\', '\\System32\\',
        '\\Program Files\\', '/home/', '/root/',
        'file://', 'ftp://', 'http://', 'https://',
        '\0', '\x00' // Null byte injection
    ];
    
    const lowerPath = filePath.toLowerCase();
    for (const pattern of dangerousPatterns) {
        if (lowerPath.includes(pattern.toLowerCase())) {
            return { isValid: false, error: `File path contains dangerous pattern: ${pattern}` };
        }
    }
    
    // SECURITY: Sanitize filename - only allow alphanumeric, dots, hyphens, underscores
    const fileNamePattern = /^[a-zA-Z0-9._-]+$/;
    const fileName = path.basename(filePath);
    if (!fileNamePattern.test(fileName)) {
        return { isValid: false, error: 'File name contains invalid characters' };
    }
    
    // SECURITY: Ensure path is within the allowed base directory
    const resolvedPath = path.resolve(basePath, filePath);
    const resolvedBase = path.resolve(basePath);
    
    if (!resolvedPath.startsWith(resolvedBase)) {
        return { isValid: false, error: 'File path attempts to escape base directory' };
    }
    
    // SECURITY: Additional length and format checks
    if (filePath.length > 255) {
        return { isValid: false, error: 'File path exceeds maximum length (255 characters)' };
    }
    
    if (fileName.startsWith('.') && fileName !== '.htaccess') {
        return { isValid: false, error: 'Hidden files are not allowed' };
    }
    
    return { isValid: true, sanitizedPath: resolvedPath };
}

/**
 * Hauptfunktion zum Ausführen des Skripts.
 */
async function main() {
    try {
        const inputFile = process.argv[2] || CONFIG.DEFAULT_INPUT_FILE;
        const outputFile = process.argv[3] || CONFIG.DEFAULT_OUTPUT_FILE;
        
        // SECURITY: Validate input and output file paths
        const basePath = path.join(__dirname, CONFIG.FILTER_LISTS_DIR);
        
        const inputValidation = validateFilePath(inputFile, basePath);
        if (!inputValidation.isValid) {
            throw new Error(`Invalid input file path: ${inputValidation.error}`);
        }
        
        const outputValidation = validateFilePath(outputFile, basePath);
        if (!outputValidation.isValid) {
            throw new Error(`Invalid output file path: ${outputValidation.error}`);
        }
        
        const filterPath = inputValidation.sanitizedPath;
        const outputPath = outputValidation.sanitizedPath;
        
        // SECURITY: Validate the minified output path as well
        const minOutputFile = outputFile.replace('.json', '_min.json');
        const minOutputValidation = validateFilePath(minOutputFile, basePath);
        if (!minOutputValidation.isValid) {
            throw new Error(`Invalid minified output file path: ${minOutputValidation.error}`);
        }
        const minOutputPath = minOutputValidation.sanitizedPath;

        console.log(`Lese Input von: ${filterPath}`);
        const filterText = await fs.readFile(filterPath, 'utf8');

        console.log('Kompiliere und dedupliziere Filterliste (parallel processing)...');
        const { rules, stats } = await precompileFilterList(filterText);

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
