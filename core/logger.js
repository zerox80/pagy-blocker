/**
 * @file Centralized logging system for Pagy Blocker.
 * @version 11.1
 */

import { LOG_CONFIG as IMPORTED_LOG_CONFIG } from './config.js';

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

/**
 * Logger class for handling application logs.
 */
class Logger {
    /**
     * Constructs a new Logger instance.
     * @param {string} [context='General'] - The context for the logger.
     */
    constructor(context = 'General') {
        this.context = context;
        this.level = this.getLogLevel();
    }

    /**
     * Retrieves the log level.
     * @returns {number} The current log level.
     */
    getLogLevel() {
        return LOG_CONFIG.DEFAULT_LEVEL;
    }

    /**
     * Formats a log message.
     * @param {number} level - The log level.
     * @param {string} message - The log message.
     * @param {object} [details={}] - Additional details for the log.
     * @returns {object} The formatted log object.
     */
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

    /**
     * Logs an error message.
     * @param {string} message - The error message.
     * @param {object} [details={}] - Additional details.
     */
    error(message, details = {}) {
        if (this.level >= LOG_CONFIG.LEVELS.ERROR) {
            const formatted = this.formatMessage(LOG_CONFIG.LEVELS.ERROR, message, details);
            console.error(formatted.formatted);
            this.logToStorage('error', formatted);
        }
    }

    /**
     * Logs a warning message.
     * @param {string} message - The warning message.
     * @param {object} [details={}] - Additional details.
     */
    warn(message, details = {}) {
        if (this.level >= LOG_CONFIG.LEVELS.WARN) {
            const formatted = this.formatMessage(LOG_CONFIG.LEVELS.WARN, message, details);
            if (details && Object.keys(details).length > 0) {
                console.warn(formatted.formatted, details);
            } else {
                console.warn(formatted.formatted);
            }
            this.logToStorage('warn', formatted);
        }
    }

    /**
     * Logs an info message.
     * @param {string} message - The info message.
     * @param {object} [details={}] - Additional details.
     */
    info(message, details = {}) {
        if (this.level >= LOG_CONFIG.LEVELS.INFO) {
            const formatted = this.formatMessage(LOG_CONFIG.LEVELS.INFO, message, details);
            console.log(formatted.formatted);
        }
    }

    /**
     * Logs a debug message.
     * @param {string} message - The debug message.
     * @param {object} [details={}] - Additional details.
     */
    debug(message, details = {}) {
        if (this.level >= LOG_CONFIG.LEVELS.DEBUG) {
            const formatted = this.formatMessage(LOG_CONFIG.LEVELS.DEBUG, message, details);
            console.debug(formatted.formatted);
        }
    }

    /**
     * Logs critical errors to storage for later analysis.
     * @param {string} level - The log level.
     * @param {object} logEntry - The log entry to store.
     * @returns {Promise<void>}
     */
    async logToStorage(level, logEntry) {
        if (level === 'error') {
            try {
                const { errorLogs = [] } = await chrome.storage.local.get('errorLogs');
                const updatedLogs = [logEntry, ...errorLogs.slice(0, 49)]; // Keep last 50 errors
                await chrome.storage.local.set({ errorLogs: updatedLogs });
            } catch (e) {
                // Fail silently if storage is not available.
            }
        }
    }

    /**
     * Starts a timer.
     * @param {string} label - The label for the timer.
     */
    time(label) {
        console.time(`${LOG_CONFIG.PREFIX} [${this.context}] ${label}`);
    }

    /**
     * Ends a timer and logs the elapsed time.
     * @param {string} label - The label for the timer.
     */
    timeEnd(label) {
        console.timeEnd(`${LOG_CONFIG.PREFIX} [${this.context}] ${label}`);
    }

    /**
     * Logs a batch of messages.
     * @param {object[]} logs - An array of log objects.
     */
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

/**
 * Creates a new logger instance.
 * @param {string} context - The context for the logger.
 * @returns {Logger} A new logger instance.
 */
export const createLogger = (context) => new Logger(context);

/** Logger for background scripts. */
export const backgroundLogger = createLogger('Background');
/** Logger for popup scripts. */
export const popupLogger = createLogger('Popup');
/** Logger for content scripts. */
export const contentLogger = createLogger('Content');

export default Logger;
