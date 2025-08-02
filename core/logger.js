/**
 * @file core/logger.js
 * @description Centralized logging system for Pagy Blocker
 * @version 7.1.0
 */

import { LOG_CONFIG } from './config.js';

class Logger {
    constructor(context = 'General') {
        this.context = context;
        this.level = this.getLogLevel();
    }

    getLogLevel() {
        // In production, use WARN level by default
        // Can be overridden by storage settings
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
            // Always use only the formatted message - never pass details object to avoid "[object Object]"
            console.error(formatted.formatted);
            this.logToStorage('error', formatted);
        }
    }

    warn(message, details = {}) {
        if (this.level >= LOG_CONFIG.LEVELS.WARN) {
            const formatted = this.formatMessage(LOG_CONFIG.LEVELS.WARN, message, details);
            // Only pass details if it has content
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

    // Store critical errors for debugging
    async logToStorage(level, logEntry) {
        if (level === 'error') {
            try {
                const { errorLogs = [] } = await chrome.storage.local.get('errorLogs');
                const updatedLogs = [logEntry, ...errorLogs.slice(0, 49)]; // Keep last 50 errors
                await chrome.storage.local.set({ errorLogs: updatedLogs });
            } catch (e) {
                // Silently fail if storage is not available
            }
        }
    }

    // Performance timing utility
    time(label) {
        console.time(`${LOG_CONFIG.PREFIX} [${this.context}] ${label}`);
    }

    timeEnd(label) {
        console.timeEnd(`${LOG_CONFIG.PREFIX} [${this.context}] ${label}`);
    }

    // Batch logging for performance
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

// Create logger instances for different modules
export const createLogger = (context) => new Logger(context);

// Default loggers for common modules
export const backgroundLogger = createLogger('Background');
export const popupLogger = createLogger('Popup');
export const contentLogger = createLogger('Content');

export default Logger;
