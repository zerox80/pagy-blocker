/**
 * @file telemetry.js
 * @description Performance monitoring and telemetry system for Pagy Blocker
 * Provides lightweight, privacy-focused performance metrics collection
 * 
 * @version 1.0.0
 * @author Pagy Team
 */

/**
 * PRIVACY-FIRST: Lightweight telemetry system with local-only metrics
 * No external data transmission - all metrics stored locally for performance optimization
 */
class TelemetryManager {
    constructor() {
        // FIXED: Only enable telemetry in development to prevent production memory issues
        this.isDevelopment = typeof chrome !== 'undefined' && chrome.runtime && !('update_url' in chrome.runtime.getManifest?.() || {});
        this.isEnabled = this.isDevelopment; // Only enabled in development mode
        this.metrics = new Map();
        this.sessionId = this.generateSessionId();
        this.startTime = Date.now();
        this.warningCount = new Map(); // Track warnings to prevent spam
        
        // FIXED: Realistic performance thresholds for modern websites
        this.thresholds = {
            ruleProcessingTime: 100, // ms
            domScanTime: 50, // ms
            memoryUsage: 200 * 1024 * 1024, // 200MB - realistic for modern websites
            selectorComplexity: 10
        };
        
        // FIXED: Reduced sampling to prevent memory overflow
        this.sampleRates = {
            domScans: 0.05, // Sample 5% of DOM scans (reduced from 10%)
            ruleProcessing: 0.5, // Sample 50% of rule processing (reduced from 100%)
            memoryChecks: 0.01 // Sample 1% of memory checks (reduced from 5%)
        };
    }
    
    /**
     * Generates a session-local identifier (no tracking)
     * @returns {string} Session identifier
     */
    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Records a performance metric
     * @param {string} category - Metric category
     * @param {string} name - Metric name
     * @param {number} value - Metric value
     * @param {Object} metadata - Additional metadata
     */
    recordMetric(category, name, value, metadata = {}) {
        if (!this.isEnabled) return;
        
        const key = `${category}.${name}`;
        
        if (!this.metrics.has(key)) {
            this.metrics.set(key, {
                category,
                name,
                values: [],
                count: 0,
                sum: 0,
                min: Infinity,
                max: -Infinity,
                metadata: new Set()
            });
        }
        
        const metric = this.metrics.get(key);
        metric.values.push({ value, timestamp: Date.now(), metadata });
        metric.count++;
        metric.sum += value;
        metric.min = Math.min(metric.min, value);
        metric.max = Math.max(metric.max, value);
        
        // Store unique metadata
        if (Object.keys(metadata).length > 0) {
            metric.metadata.add(JSON.stringify(metadata));
        }
        
        // Trim old values to prevent memory buildup (keep last 100)
        if (metric.values.length > 100) {
            metric.values = metric.values.slice(-100);
        }
        
        // Check for performance issues
        this.checkPerformanceThresholds(category, name, value, metadata);
    }
    
    /**
     * Records execution time for a function
     * @param {string} category - Metric category
     * @param {string} name - Function name
     * @param {Function} fn - Function to measure
     * @returns {*} Function result
     */
    async measureAsync(category, name, fn) {
        const startTime = performance.now();
        try {
            const result = await fn();
            const duration = performance.now() - startTime;
            this.recordMetric(category, name, duration, { success: true });
            return result;
        } catch (error) {
            const duration = performance.now() - startTime;
            this.recordMetric(category, name, duration, { success: false, error: error.name });
            throw error;
        }
    }
    
    /**
     * Records execution time for a synchronous function
     * @param {string} category - Metric category
     * @param {string} name - Function name
     * @param {Function} fn - Function to measure
     * @returns {*} Function result
     */
    measureSync(category, name, fn) {
        const startTime = performance.now();
        try {
            const result = fn();
            const duration = performance.now() - startTime;
            this.recordMetric(category, name, duration, { success: true });
            return result;
        } catch (error) {
            const duration = performance.now() - startTime;
            this.recordMetric(category, name, duration, { success: false, error: error.name });
            throw error;
        }
    }
    
    /**
     * Checks if metric values exceed performance thresholds
     * @param {string} category - Metric category
     * @param {string} name - Metric name
     * @param {number} value - Metric value
     * @param {Object} metadata - Metric metadata
     */
    checkPerformanceThresholds(category, name, value, metadata) {
        let threshold = null;
        
        if (category === 'rules' && name.includes('processing')) {
            threshold = this.thresholds.ruleProcessingTime;
        } else if (category === 'dom' && name.includes('scan')) {
            threshold = this.thresholds.domScanTime;
        } else if (category === 'memory') {
            threshold = this.thresholds.memoryUsage;
        } else if (category === 'selector' && name.includes('complexity')) {
            threshold = this.thresholds.selectorComplexity;
        }
        
        if (threshold && value > threshold) {
            // FIXED: Prevent warning spam by limiting warnings per category
            const warningKey = `${category}.${name}`;
            const currentWarnings = this.warningCount.get(warningKey) || 0;
            
            if (currentWarnings < 3) { // Maximum 3 warnings per category
                console.warn(`Pagy-Blocker Performance: ${category}.${name} exceeded threshold (${value} > ${threshold})`, metadata);
                this.warningCount.set(warningKey, currentWarnings + 1);
                
                this.recordMetric('performance', 'threshold_exceeded', 1, { 
                    category, 
                    name, 
                    value, 
                    threshold 
                });
            } else if (currentWarnings === 3) {
                console.warn(`Pagy-Blocker Performance: ${category}.${name} - further warnings suppressed`);
                this.warningCount.set(warningKey, currentWarnings + 1);
            }
        }
    }
    
    /**
     * Records memory usage metrics
     */
    recordMemoryUsage() {
        if (!this.shouldSample('memoryChecks')) return;
        
        try {
            if (performance.memory) {
                this.recordMetric('memory', 'used_heap', performance.memory.usedJSHeapSize);
                this.recordMetric('memory', 'total_heap', performance.memory.totalJSHeapSize);
                this.recordMetric('memory', 'heap_limit', performance.memory.jsHeapSizeLimit);
            }
        } catch (error) {
            // Memory API might not be available
        }
    }
    
    /**
     * Determines if a metric should be sampled based on sampling rate
     * @param {string} type - Sampling type
     * @returns {boolean} Whether to sample
     */
    shouldSample(type) {
        const rate = this.sampleRates[type] || 1.0;
        return Math.random() < rate;
    }
    
    /**
     * Gets performance summary for a category
     * @param {string} category - Metric category
     * @returns {Object} Performance summary
     */
    getPerformanceSummary(category) {
        const summary = {
            category,
            metrics: {},
            sessionId: this.sessionId,
            sessionDuration: Date.now() - this.startTime
        };
        
        for (const [key, metric] of this.metrics) {
            if (metric.category === category) {
                summary.metrics[metric.name] = {
                    count: metric.count,
                    average: metric.count > 0 ? metric.sum / metric.count : 0,
                    min: metric.min === Infinity ? 0 : metric.min,
                    max: metric.max === -Infinity ? 0 : metric.max,
                    total: metric.sum
                };
            }
        }
        
        return summary;
    }
    
    /**
     * Gets all performance metrics
     * @returns {Object} All metrics summary
     */
    getAllMetrics() {
        const categories = new Set();
        for (const metric of this.metrics.values()) {
            categories.add(metric.category);
        }
        
        const summary = {
            sessionId: this.sessionId,
            sessionDuration: Date.now() - this.startTime,
            categories: {}
        };
        
        for (const category of categories) {
            summary.categories[category] = this.getPerformanceSummary(category);
        }
        
        return summary;
    }
    
    /**
     * Logs performance summary to console
     * @param {string} category - Optional category filter
     */
    logPerformanceSummary(category = null) {
        if (category) {
            const summary = this.getPerformanceSummary(category);
            console.log(`Pagy-Blocker Performance Summary (${category}):`, summary);
        } else {
            const summary = this.getAllMetrics();
            console.log('Pagy-Blocker Performance Summary (All):', summary);
        }
    }
    
    /**
     * Resets all metrics
     */
    reset() {
        this.metrics.clear();
        this.sessionId = this.generateSessionId();
        this.startTime = Date.now();
    }
    
    /**
     * Enables or disables telemetry
     * @param {boolean} enabled - Whether telemetry should be enabled
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        if (!enabled) {
            this.metrics.clear();
        }
    }
}

// Global telemetry instance
const telemetry = new TelemetryManager();

// FIXED: Only monitor memory in development mode to prevent production issues
if (typeof setInterval !== 'undefined' && telemetry.isDevelopment) {
    setInterval(() => {
        telemetry.recordMemoryUsage();
    }, 300000); // Every 5 minutes (reduced from 30 seconds)
}

// Export for both CommonJS and ES modules
const exports = {
    TelemetryManager,
    telemetry
};

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
}

// ES module export (for modern environments)
if (typeof window !== 'undefined') {
    window.Telemetry = exports;
}