/**
 * @file telemetry.js
 * @description Leistungsüberwachungs- und Telemetriesystem für Pagy Blocker
 * Bietet eine leichte, datenschutzorientierte Sammlung von Leistungsmetriken
 * 
 * @version 1.0.0
 * @author Pagy Team
 */

/**
 * DATENSCHUTZ-PRIORITÄT: Leichtgewichtiges Telemetriesystem mit nur lokal gespeicherten Metriken
 * Keine externe Datenübertragung - alle Metriken werden lokal zur Leistungsoptimierung gespeichert
 */
class TelemetryManager {
    constructor() {
        // FIXIERT: Telemetrie nur in der Entwicklung aktivieren, um Speicherprobleme in der Produktion zu vermeiden
        this.isDevelopment = typeof chrome !== 'undefined' && chrome.runtime && !('update_url' in chrome.runtime.getManifest?.() || {});
        this.isEnabled = this.isDevelopment; // Nur im Entwicklungsmodus aktiviert
        this.metrics = new Map();
        this.sessionId = this.generateSessionId();
        this.startTime = Date.now();
        this.warningCount = new Map(); // Warnungen verfolgen, um Spam zu vermeiden
        
        // FIXIERT: Realistische Leistungsgrenzen für moderne Websites
        this.thresholds = {
            ruleProcessingTime: 100, // ms
            domScanTime: 50, // ms
            memoryUsage: 200 * 1024 * 1024, // 200MB - realistisch für moderne Websites
            selectorComplexity: 10
        };
        
        // FIXIERT: Reduziertes Sampling, um Speicherüberlauf zu verhindern
        this.sampleRates = {
            domScans: 0.05, // 5% der DOM-Scans sampeln (von 10% reduziert)
            ruleProcessing: 0.5, // 50% der Regelverarbeitung sampeln (von 100% reduziert)
            memoryChecks: 0.01 // 1% der Speicherüberprüfungen sampeln (von 5% reduziert)
        };
    }
    
    /**
     * Generiert eine sitzungslokale Kennung (kein Tracking)
     * @returns {string} Sitzungskennung
     */
    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Protokolliert eine Leistungsmetrik
     * @param {string} category - Metrik-Kategorie
     * @param {string} name - Metrik-Name
     * @param {number} value - Metrik-Wert
     * @param {Object} metadata - Zusätzliche Metadaten
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
        
        // Einzigartige Metadaten speichern
        if (Object.keys(metadata).length > 0) {
            metric.metadata.add(JSON.stringify(metadata));
        }
        
        // Alte Werte trimmen, um Speicheraufbau zu verhindern (letzte 100 behalten)
        if (metric.values.length > 100) {
            metric.values = metric.values.slice(-100);
        }
        
        // Leistungsprobleme überprüfen
        this.checkPerformanceThresholds(category, name, value, metadata);
    }
    
    /**
     * Protokolliert die Ausführungszeit für eine Funktion
     * @param {string} category - Metrik-Kategorie
     * @param {string} name - Funktionsname
     * @param {Function} fn - Zu messende Funktion
     * @returns {*} Funktionsergebnis
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
     * Protokolliert die Ausführungszeit für eine synchrone Funktion
     * @param {string} category - Metrik-Kategorie
     * @param {string} name - Funktionsname
     * @param {Function} fn - Zu messende Funktion
     * @returns {*} Funktionsergebnis
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
     * Überprüft, ob Metrikwerte die Leistungsgrenzen überschreiten
     * @param {string} category - Metrik-Kategorie
     * @param {string} name - Metrik-Name
     * @param {number} value - Metrik-Wert
     * @param {Object} metadata - Metrik-Metadaten
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
            // FIXIERT: Warnungsspam verhindern, indem die Warnungen pro Kategorie begrenzt werden
            const warningKey = `${category}.${name}`;
            const currentWarnings = this.warningCount.get(warningKey) || 0;
            
            if (currentWarnings < 3) { // Maximal 3 Warnungen pro Kategorie
                console.warn(`Pagy-Blocker Leistung: ${category}.${name} überschritt die Grenze (${value} > ${threshold})`, metadata);
                this.warningCount.set(warningKey, currentWarnings + 1);
                
                this.recordMetric('performance', 'threshold_exceeded', 1, { 
                    category, 
                    name, 
                    value, 
                    threshold 
                });
            } else if (currentWarnings === 3) {
                console.warn(`Pagy-Blocker Leistung: ${category}.${name} - weitere Warnungen unterdrückt`);
                this.warningCount.set(warningKey, currentWarnings + 1);
            }
        }
    }
    
    /**
     * Protokolliert Metriken zur Speichernutzung
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
            // Memory API ist möglicherweise nicht verfügbar
        }
    }
    
    /**
     * Bestimmt, ob eine Metrik basierend auf der Abtastrate gesampelt werden sollte
     * @param {string} type - Abtasttyp
     * @returns {boolean} Ob gesampelt werden soll
     */
    shouldSample(type) {
        const rate = this.sampleRates[type] || 1.0;
        return Math.random() < rate;
    }
    
    /**
     * Gibt die Leistungszusammenfassung für eine Kategorie zurück
     * @param {string} category - Metrik-Kategorie
     * @returns {Object} Leistungszusammenfassung
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
     * Gibt alle Leistungsmetriken zurück
     * @returns {Object} Zusammenfassung aller Metriken
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
     * Protokolliert die Leistungszusammenfassung in die Konsole
     * @param {string} category - Optionale Kategoriefilterung
     */
    logPerformanceSummary(category = null) {
        if (category) {
            const summary = this.getPerformanceSummary(category);
            console.log(`Pagy-Blocker Leistungszusammenfassung (${category}):`, summary);
        } else {
            const summary = this.getAllMetrics();
            console.log('Pagy-Blocker Leistungszusammenfassung (Alle):', summary);
        }
    }
    
    /**
     * Setzt alle Metriken zurück
     */
    reset() {
        this.metrics.clear();
        this.sessionId = this.generateSessionId();
        this.startTime = Date.now();
    }
    
    /**
     * Aktiviert oder deaktiviert die Telemetrie
     * @param {boolean} enabled - Ob die Telemetrie aktiviert werden soll
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        if (!enabled) {
            this.metrics.clear();
        }
    }
}

// Globale Telemetrie-Instanz
const telemetry = new TelemetryManager();

// FIXIERT: Nur im Entwicklungsmodus den Speicher überwachen, um Produktionsprobleme zu vermeiden
if (typeof setInterval !== 'undefined' && telemetry.isDevelopment) {
    setInterval(() => {
        telemetry.recordMemoryUsage();
    }, 300000); // Alle 5 Minuten (von 30 Sekunden reduziert)
}

// Export für sowohl CommonJS als auch ES-Module
const exports = {
    TelemetryManager,
    telemetry
};

// CommonJS-Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
}

// ES-Modul-Export (für moderne Umgebungen)
if (typeof window !== 'undefined') {
    window.Telemetry = exports;
}