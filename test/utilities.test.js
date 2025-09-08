import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
  getDomainFromUrl,
  isValidDomain,
  validateStringChars,
  debounce,
  throttle,
  safeJsonParse,
  deepClone,
  sanitizeInput,
  generateId,
} from '../core/utilities.js';

// Mock EXTENSION_CONFIG
jest.mock('../core/config.js', () => ({
  EXTENSION_CONFIG: {
    LIMITS: {
      MAX_DOMAIN_LENGTH: 253,
      MAX_LABEL_LENGTH: 63,
      MAX_URL_LENGTH: 2048,
    },
    PERFORMANCE: {
      DEBOUNCE_DELAY: 100,
      BATCH_SIZE: 10,
    },
  },
}));

describe('Utilities', () => {
  describe('getDomainFromUrl', () => {
    test('should extract domain from valid HTTP URL', () => {
      expect(getDomainFromUrl('https://www.example.com/path')).toBe('www.example.com');
    });

    test('should extract domain from valid HTTPS URL', () => {
      expect(getDomainFromUrl('https://example.com')).toBe('example.com');
    });

    test('should handle URLs without protocol', () => {
      expect(getDomainFromUrl('example.com')).toBe('example.com');
    });

    test('should return null for invalid URL', () => {
      expect(getDomainFromUrl('invalid-url')).toBe(null);
    });

    test('should return null for empty input', () => {
      expect(getDomainFromUrl('')).toBe(null);
    });

    test('should return null for non-string input', () => {
      expect(getDomainFromUrl(null)).toBe(null);
      expect(getDomainFromUrl(123)).toBe(null);
    });
  });

  describe('isValidDomain', () => {
    test('should validate simple domain', () => {
      expect(isValidDomain('example.com')).toBe(true);
    });

    test('should validate subdomain', () => {
      expect(isValidDomain('sub.example.com')).toBe(true);
    });

    test('should reject domain with consecutive dots', () => {
      expect(isValidDomain('example..com')).toBe(false);
    });

    test('should reject domain starting with dot', () => {
      expect(isValidDomain('.example.com')).toBe(false);
    });

    test('should reject domain ending with dot', () => {
      expect(isValidDomain('example.com.')).toBe(false);
    });

    test('should reject localhost', () => {
      expect(isValidDomain('localhost')).toBe(false);
    });

    test('should reject IP addresses', () => {
      expect(isValidDomain('127.0.0.1')).toBe(false);
    });

    test('should reject domain with invalid characters', () => {
      expect(isValidDomain('exam ple.com')).toBe(false);
      expect(isValidDomain('example!.com')).toBe(false);
    });

    test('should reject single label domain', () => {
      expect(isValidDomain('example')).toBe(false);
    });

    test('should handle empty input', () => {
      expect(isValidDomain('')).toBe(false);
      expect(isValidDomain(null)).toBe(false);
    });
  });

  describe('validateStringChars', () => {
    test('should validate string with allowed characters', () => {
      const result = validateStringChars('hello', ['h', 'e', 'l', 'o']);
      expect(result.isValid).toBe(true);
    });

    test('should reject string with invalid characters', () => {
      const result = validateStringChars('hello', ['h', 'e', 'l']);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid character');
    });

    test('should handle empty input', () => {
      const result = validateStringChars('', ['a']);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Input must be a non-empty string');
    });

    test('should handle non-string input', () => {
      const result = validateStringChars(123, ['1', '2', '3']);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Input must be a non-empty string');
    });
  });

  describe('debounce', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
    });

    test('should delay function execution', () => {
      const mockFn = jest.fn();
      const debouncedFn = debounce(mockFn, 100);

      debouncedFn();
      expect(mockFn).not.toBeCalled();

      jest.advanceTimersByTime(50);
      expect(mockFn).not.toBeCalled();

      jest.advanceTimersByTime(50);
      expect(mockFn).toBeCalledTimes(1);
    });

    test('should cancel previous call', () => {
      const mockFn = jest.fn();
      const debouncedFn = debounce(mockFn, 100);

      debouncedFn();
      jest.advanceTimersByTime(50);

      debouncedFn();
      jest.advanceTimersByTime(50);

      expect(mockFn).not.toBeCalled();

      jest.advanceTimersByTime(50);
      expect(mockFn).toBeCalledTimes(1);
    });
  });

  describe('throttle', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.clearAllTimers();
    });

    test('should limit function execution rate', () => {
      const mockFn = jest.fn();
      const throttledFn = throttle(mockFn, 100);

      throttledFn();
      expect(mockFn).toBeCalledTimes(1);

      throttledFn();
      expect(mockFn).toBeCalledTimes(1);

      jest.advanceTimersByTime(100);

      throttledFn();
      expect(mockFn).toBeCalledTimes(2);
    });
  });

  describe('safeJsonParse', () => {
    test('should parse valid JSON', () => {
      const result = safeJsonParse('{"key": "value"}');
      expect(result).toEqual({ key: 'value' });
    });

    test('should return fallback for invalid JSON', () => {
      const result = safeJsonParse('invalid json', { default: true });
      expect(result).toEqual({ default: true });
    });

    test('should return null for invalid JSON without fallback', () => {
      const result = safeJsonParse('invalid json');
      expect(result).toBe(null);
    });
  });

  describe('deepClone', () => {
    test('should clone primitive values', () => {
      expect(deepClone(42)).toBe(42);
      expect(deepClone('hello')).toBe('hello');
      expect(deepClone(null)).toBe(null);
    });

    test('should clone arrays', () => {
      const original = [1, 2, { nested: true }];
      const cloned = deepClone(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned[2]).not.toBe(original[2]);
    });

    test('should clone objects', () => {
      const original = { a: 1, b: { c: 2 } };
      const cloned = deepClone(original);
      expect(cloned).toEqual(original);
      expect(cloned).not.toBe(original);
      expect(cloned.b).not.toBe(original.b);
    });
  });

  describe('sanitizeInput', () => {
    test('should escape HTML characters', () => {
      expect(sanitizeInput('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    test('should trim whitespace', () => {
      expect(sanitizeInput('  hello  ')).toBe('hello');
    });

    test('should limit length', () => {
      const longString = 'a'.repeat(1500);
      expect(sanitizeInput(longString)).toHaveLength(1000);
    });

    test('should handle non-string input', () => {
      expect(sanitizeInput(123)).toBe('');
      expect(sanitizeInput(null)).toBe('');
    });
  });

  describe('generateId', () => {
    test('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(0);
    });

    test('should contain timestamp and random part', () => {
      const id = generateId();
      expect(id).toMatch(/^\d+-[a-z0-9]+$/);
    });
  });
});
