// js/utils.js
// Shared utilities for the Pagy Blocker extension

/**
 * Ultra-fast yielding function for minimal overhead
 */
export const fastYield = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Simple memory info getter
 */
export function getMemoryInfo() {
  return performance.memory || { usedJSHeapSize: 50000000 };
}

/**
 * Simple fixed cache size for performance
 */
export function getOptimalCacheSize(baseMultiplier = 1000000, minSize = 50, maxSize = 200) {
  return 100; // Fixed size for startup speed
}

/**
 * Simplified cache coordinator for minimal overhead
 */
export class SimpleCacheCoordinator {
  constructor() {
    this.caches = [];
  }
  
  register(cache) {
    this.caches.push(cache);
  }
  
  optimizeAll() {
    // Minimal optimization to avoid startup overhead
    this.caches.forEach(cache => {
      if (cache.cleanup) cache.cleanup();
    });
  }
  
  emergencyCleanup() {
    this.caches.forEach(cache => {
      if (cache.clear) cache.clear();
    });
  }
}

// Global cache coordinator instance
export const globalCacheCoordinator = new SimpleCacheCoordinator();