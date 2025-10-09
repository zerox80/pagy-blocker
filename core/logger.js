/**
 * @file core/logger.js
 * @description Zentrales Loggingsystem für Pagy Blocker
 * @version 11.1
 */

import { LOG_CONFIG as IMPORTED_LOG_CONFIG } from './config.js';

// Fallback, falls LOG_CONFIG in Tests gemockt oder nicht verfügbar ist
const LOG_CONFIG = IMPORTED_LOG_CONFIG ?? {
    LEVELS: {
        ERROR: 0,
        WARN: 1,
        INFO: 2,
        DEBUG: 3,
    },
    DEFAULT_LEVEL: 1, // WARN
    PREFIX: '[Pagy Blocker]'
};

class Logger {
    constructor(context = 'General') {
        this.context = context;
        this.level = this.getLogLevel();
    }

    getLogLevel() {
        // In Produktion standardmäßig WARN-Level verwenden
        // Kann über Speichereinstellungen überschrieben werden
        return LOG_CONFIG.DEFAULT_LEVEL;
    }

    formatMessage(level, message, details = {}) {
        const timestamp = new Date().toISOString();
        const levelStr = Object.keys(LOG_CONFIG.LEVELS)[level];
        const contextStr = this.context ? `[${this.context}]` : '';
        
        return {
            formatted: `${LOG_CONFIG.PREFIX} ${contextStr} ${levelStr}: ${message}`,
            timestamp,
            level: levelStr,
            context: this.context,
            message,
            details
        };
    }

    error(message, details = {}) {
        if (this.level >= LOG_CONFIG.LEVELS.ERROR) {
            const formatted = this.formatMessage(LOG_CONFIG.LEVELS.ERROR, message, details);
            // Immer nur die formatierte Nachricht ausgeben – niemals das Details-Objekt direkt (vermeidet "[object Object]")
            console.error(formatted.formatted);
            this.logToStorage('error', formatted);
        }
    }

    warn(message, details = {}) {
        if (this.level >= LOG_CONFIG.LEVELS.WARN) {
            const formatted = this.formatMessage(LOG_CONFIG.LEVELS.WARN, message, details);
            // Details nur ausgeben, wenn Inhalte vorhanden sind
            if (details && Object.keys(details).length > 0) {
                console.warn(formatted.formatted, details);
            } else {
                console.warn(formatted.formatted);
            }
            this.logToStorage('warn', formatted);
        }
    }

    info(message, details = {}) {
        if (this.level >= LOG_CONFIG.LEVELS.INFO) {
            const formatted = this.formatMessage(LOG_CONFIG.LEVELS.INFO, message, details);
            console.log(formatted.formatted);
        }
    }

    debug(message, details = {}) {
        if (this.level >= LOG_CONFIG.LEVELS.DEBUG) {
            const formatted = this.formatMessage(LOG_CONFIG.LEVELS.DEBUG, message, details);
            console.debug(formatted.formatted);
        }
    }

    // Kritische Fehler für spätere Analyse im Speicher ablegen
    async logToStorage(level, logEntry) {
        if (level === 'error') {
            try {
                const { errorLogs = [] } = await chrome.storage.local.get('errorLogs');
                const updatedLogs = [logEntry, ...errorLogs.slice(0, 49)]; // Keep last 50 errors
                await chrome.storage.local.set({ errorLogs: updatedLogs });
            } catch (e) {
                // Leise scheitern, falls Speicher nicht verfügbar ist
            }
        }
    }

    // Hilfsfunktionen zur Zeitmessung
    time(label) {
        console.time(`${LOG_CONFIG.PREFIX} [${this.context}] ${label}`);
    }

    timeEnd(label) {
        console.timeEnd(`${LOG_CONFIG.PREFIX} [${this.context}] ${label}`);
    }

    // Batch-Logging für bessere Übersicht/Performance
    batch(logs) {
        if (this.level >= LOG_CONFIG.LEVELS.DEBUG) {
            console.group(`${LOG_CONFIG.PREFIX} [${this.context}] Batch Logs`);
            logs.forEach(log => {
                const { level, message, details } = log;
                this[level]?.(message, details);
            });
            console.groupEnd();
        }
    }
}

// Logger-Instanzen für verschiedene Module erzeugen
export const createLogger = (context) => new Logger(context);

// Standard-Logger für gängige Module
export const backgroundLogger = createLogger('Background');
export const popupLogger = createLogger('Popup');
export const contentLogger = createLogger('Content');

export default Logger;
