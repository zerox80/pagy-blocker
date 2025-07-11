// js/utils.js
// Shared utilities for the Pagy Blocker extension

/**
 * High-performance yielding function using MessageChannel for better performance
 */
export const fastYield = (() => {
  if (typeof scheduler !== 'undefined' && scheduler.postTask) {
    return () => scheduler.postTask(() => {}, { priority: 'user-blocking' });
  }
  
  // Fallback to MessageChannel for faster yielding than setTimeout
  const channel = new MessageChannel();
  const promises = [];
  
  channel.port2.onmessage = () => {
    const resolve = promises.shift();
    if (resolve) resolve();
  };
  
  return () => new Promise(resolve => {
    promises.push(resolve);
    channel.port1.postMessage(null);
  });
})();

/**
 * Safe memory info getter with fallback
 */
export function getMemoryInfo() {
  const defaultSize = 50000000; // 50MB fallback
  return (performance.memory && performance.memory.usedJSHeapSize) ? 
    performance.memory : { usedJSHeapSize: defaultSize };
}

/**
 * Get optimal cache size based on available memory
 */
export function getOptimalCacheSize(baseMultiplier = 1000000, minSize = 50, maxSize = 200) {
  const memInfo = getMemoryInfo();
  const baseSize = Math.floor(memInfo.usedJSHeapSize / baseMultiplier);
  return Math.min(maxSize, Math.max(minSize, baseSize));
}

/**
 * Cache coordination system for managing multiple caches
 */
export class CacheCoordinator {
  constructor() {
    this.caches = new Set();
    this.lastGlobalCleanup = Date.now();
    this.memoryPressureThreshold = 0.8; // 80% memory usage
  }
  
  register(cache) {
    this.caches.add(cache);
  }
  
  unregister(cache) {
    this.caches.delete(cache);
  }
  
  // Global cache optimization
  optimizeAll() {
    const memInfo = getMemoryInfo();
    const isHighMemoryPressure = memInfo.usedJSHeapSize > (memInfo.totalJSHeapSize || 100000000) * this.memoryPressureThreshold;
    
    for (const cache of this.caches) {
      if (cache.optimize) cache.optimize();
      
      // Aggressive cleanup under memory pressure
      if (isHighMemoryPressure && cache.cleanup) {
        cache.cleanup();
      }
    }
    
    this.lastGlobalCleanup = Date.now();
  }
  
  // Emergency cleanup when memory is critically low
  emergencyCleanup() {
    for (const cache of this.caches) {
      if (cache.clear) cache.clear();
      if (cache.cleanup) cache.cleanup();
    }
  }
  
  // Get aggregated cache statistics
  getAllStats() {
    const stats = {};
    let totalMemory = 0;
    
    for (const cache of this.caches) {
      if (cache.getStats) {
        const cacheStats = cache.getStats();
        const cacheName = cache.constructor.name || 'UnknownCache';
        stats[cacheName] = cacheStats;
        if (cacheStats.size) totalMemory += cacheStats.size;
      }
    }
    
    return { caches: stats, totalMemory, cacheCount: this.caches.size };
  }
}

// Global cache coordinator instance
export const globalCacheCoordinator = new CacheCoordinator();