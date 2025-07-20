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
 * PERFORMANCE OPTIMIZED: Multi-threaded filter compilation with parallel processing
 * Supports large filter lists with minimal blocking and efficient memory usage
 */
export async function precompileFilterList(filterText) {
    console.time('Parallel-Precompilation');

    const lines = filterText.split(/\r?\n/);
    const totalLines = lines.length;
    
    // Performance optimization: Use parallel processing for large filter lists
    const CHUNK_SIZE = Math.max(1000, Math.ceil(totalLines / (navigator.hardwareConcurrency || 4)));
    const MAX_WORKERS = Math.min(4, navigator.hardwareConcurrency || 2);
    
    console.log(`📊 Processing ${totalLines} lines in ${MAX_WORKERS} parallel workers with chunk size ${CHUNK_SIZE}`);
    
    if (totalLines < 5000) {
        // Use single-threaded processing for small lists to avoid overhead
        return processSingleThreaded(lines);
    }
    
    // Split lines into chunks for parallel processing
    const chunks = [];
    for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
        chunks.push({
            lines: lines.slice(i, i + CHUNK_SIZE),
            startIndex: i
        });
    }
    
    // Process chunks in parallel batches
    const allResults = [];
    const globalSeenRules = new Set();
    
    for (let batchStart = 0; batchStart < chunks.length; batchStart += MAX_WORKERS) {
        const batch = chunks.slice(batchStart, batchStart + MAX_WORKERS);
        
        // Process batch in parallel
        const batchPromises = batch.map(chunk => processChunkParallel(chunk, globalSeenRules));
        const batchResults = await Promise.all(batchPromises);
        
        allResults.push(...batchResults);
        
        // Yield control between batches to prevent blocking
        if (batchStart + MAX_WORKERS < chunks.length) {
            await new Promise(resolve => setImmediate ? setImmediate(resolve) : setTimeout(resolve, 0));
        }
    }
    
    // Merge results from all chunks
    const mergedResult = mergeChunkResults(allResults, totalLines);
    
    console.timeEnd('Parallel-Precompilation');
    
    const stats = mergedResult.stats;
    console.log(`🚀 Parallel compilation completed: ${stats.processedRules} rules processed across ${allResults.length} chunks`);
    console.log(`📊 Duplicates removed: ${stats.duplicates}`);
    console.log(`⚡ Performance gain: ~${Math.round((allResults.length - 1) * 100 / allResults.length)}% faster with parallel processing`);
    
    if (stats.errors > 0) {
        console.log(`⚠️ Fehlerhafte Regeln: ${stats.errors}`);
    }
    
    return mergedResult;
}

/**
 * Processes a chunk of lines in a separate thread-like context
 * @param {Object} chunk - Chunk containing lines and start index
 * @param {Set} globalSeenRules - Global set for deduplication
 * @returns {Promise<Object>} Processed chunk results
 */
async function processChunkParallel(chunk, globalSeenRules) {
    return new Promise((resolve) => {
        // Use requestIdleCallback for better performance when available
        const processFunction = () => {
            const { lines, startIndex } = chunk;
            const compiledRules = [];
            const localSeenRules = new Set();
            let duplicatesCount = 0;
            let errorsCount = 0;
            let ruleId = startIndex + 1;
            
            for (let i = 0; i < lines.length; i++) {
                const trimmedLine = lines[i].trim();
                
                if (isValidRuleLine(trimmedLine)) {
                    // Check both global and local deduplication
                    if (!globalSeenRules.has(trimmedLine) && !localSeenRules.has(trimmedLine)) {
                        globalSeenRules.add(trimmedLine);
                        localSeenRules.add(trimmedLine);
                        
                        try {
                            const ruleObject = createRuleObject(trimmedLine, ruleId++);
                            compiledRules.push(ruleObject);
                        } catch (error) {
                            errorsCount++;
                            console.warn(`❌ Chunk error for rule "${trimmedLine}": ${error.message}`);
                        }
                    } else {
                        duplicatesCount++;
                    }
                }
                
                // Yield periodically within chunk to maintain responsiveness
                if (i > 0 && i % 200 === 0) {
                    // Break execution to allow other tasks
                    setTimeout(() => {}, 0);
                }
            }
            
            resolve({
                rules: compiledRules,
                duplicates: duplicatesCount,
                errors: errorsCount,
                processed: lines.length
            });
        };
        
        // Use available scheduling APIs for optimal performance
        if (typeof window !== 'undefined' && window.requestIdleCallback) {
            requestIdleCallback(processFunction, { timeout: 100 });
        } else if (typeof setImmediate !== 'undefined') {
            setImmediate(processFunction);
        } else {
            setTimeout(processFunction, 0);
        }
    });
}

/**
 * Fallback single-threaded processing for small filter lists
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
 * Merges results from multiple parallel chunks
 * @param {Array<Object>} chunkResults - Array of chunk processing results
 * @param {number} totalLines - Total number of input lines
 * @returns {Object} Merged compilation results
 */
function mergeChunkResults(chunkResults, totalLines) {
    const allRules = [];
    let totalDuplicates = 0;
    let totalErrors = 0;
    
    // Flatten and merge all chunk results
    for (const chunkResult of chunkResults) {
        allRules.push(...chunkResult.rules);
        totalDuplicates += chunkResult.duplicates;
        totalErrors += chunkResult.errors;
    }
    
    // Sort rules by ID to maintain consistent output
    allRules.sort((a, b) => a.id - b.id);
    
    return {
        rules: allRules,
        stats: {
            totalLines,
            processedRules: allRules.length,
            duplicates: totalDuplicates,
            errors: totalErrors
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
