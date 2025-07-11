// js/utils.js
// Simple utilities for the Pagy Blocker extension

/**
 * Simple yielding function for UI responsiveness (rarely needed)
 */
export const fastYield = () => new Promise(resolve => setTimeout(resolve, 0));