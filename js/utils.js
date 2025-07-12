// Optimierte Utility-Funktionen für Pagy Blocker
// Minimaler Overhead, maximale Performance

export const fastYield = () => new Promise(resolve => setTimeout(resolve, 0));

export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

export function fastExtractDomain(url) {
  try {
    const startIndex = url.indexOf('://');
    if (startIndex === -1) return null;
    
    const afterProtocol = url.substring(startIndex + 3);
    const endIndex = afterProtocol.indexOf('/');
    const domain = endIndex === -1 ? afterProtocol : afterProtocol.substring(0, endIndex);
    
    return domain.toLowerCase();
  } catch {
    return null;
  }
}

export function isValidRule(rule) {
  return rule && 
         rule.id && 
         rule.action && 
         rule.condition && 
         rule.condition.urlFilter;
}