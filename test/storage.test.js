import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import StorageManager from '../core/storage.js';
import { EXTENSION_CONFIG } from '../core/config.js';

describe('StorageManager', () => {
  let storage;

  beforeEach(() => {
    storage = new StorageManager();
    // Reset chrome storage mocks
    chrome.storage.local.get.mockReset();
    chrome.storage.local.set.mockReset();
    chrome.storage.local.remove.mockReset();
    chrome.storage.local.clear.mockReset();
    chrome.storage.local.getBytesInUse.mockReset();
    // Use real retryAsync; tests don't force retries
  });

  test('updateCache and isCacheValid respect TTL', () => {
    const key = 'k1';
    storage.updateCache(key, 'v1');
    expect(storage.isCacheValid(key)).toBe(true);

    // Manually age the cache entry beyond TTL
    const ttl = EXTENSION_CONFIG.PERFORMANCE.CACHE_TTL;
    storage.cacheTimestamps.set(key, Date.now() - ttl - 1);
    expect(storage.isCacheValid(key)).toBe(false);
  });

  test('get coalesces concurrent operations via pendingOperations', async () => {
    const key = 'k2';
    let resolveDeferred;
    const deferred = new Promise((resolve) => { resolveDeferred = resolve; });
    chrome.storage.local.get.mockReturnValue(deferred);

    const p1 = storage.get(key);
    const p2 = storage.get(key);

    // Only one underlying chrome.storage.local.get call should be made
    expect(chrome.storage.local.get).toHaveBeenCalledTimes(1);

    // Resolve the deferred with the expected shape
    resolveDeferred({ [key]: 'value2' });

    const [v1, v2] = await Promise.all([p1, p2]);
    expect(v1).toBe('value2');
    expect(v2).toBe('value2');
    expect(storage.pendingOperations.has(key)).toBe(false);
  });

  test('throws on invalid extension context (get/set/remove)', async () => {
    const originalRuntime = chrome.runtime;
    // Simulate invalid extension context
    // isExtensionContextValid checks chrome.runtime existence
    // Keep chrome.storage available so calls would work if reached
    // but the function should throw before using storage.
    // eslint-disable-next-line no-global-assign
    chrome.runtime = undefined;

    await expect(storage.get('k3')).rejects.toThrow('Extension context is invalid');
    await expect(storage.set('k3', 1)).rejects.toThrow('Extension context is invalid');
    await expect(storage.remove('k3')).rejects.toThrow('Extension context is invalid');

    // restore
    // eslint-disable-next-line no-global-assign
    chrome.runtime = originalRuntime;
  });

  test('batchGet updates cache for all keys', async () => {
    const keys = ['a', 'b'];
    chrome.storage.local.get.mockResolvedValue({ a: 1, b: 2 });

    const result = await storage.batchGet(keys);
    expect(result).toEqual({ a: 1, b: 2 });
    expect(storage.cache.get('a')).toBe(1);
    expect(storage.cache.get('b')).toBe(2);
  });

  test('batchSet writes and updates cache for all entries', async () => {
    const data = { x: 10, y: 20 };
    chrome.storage.local.set.mockResolvedValue(undefined);

    await storage.batchSet(data);

    expect(chrome.storage.local.set).toHaveBeenCalledWith(data);
    expect(storage.cache.get('x')).toBe(10);
    expect(storage.cache.get('y')).toBe(20);
  });

  test('getUsage returns 0 on error and logs warning', async () => {
    // When invalid context, getUsage should return 0 without throwing
    const originalRuntime = chrome.runtime;
    // eslint-disable-next-line no-global-assign
    chrome.runtime = undefined;
    const usageInvalid = await storage.getUsage();
    expect(usageInvalid).toEqual({ bytesInUse: 0 });
    // restore
    // eslint-disable-next-line no-global-assign
    chrome.runtime = originalRuntime;

    // Valid context but underlying API throws
    chrome.storage.local.getBytesInUse.mockRejectedValue(new Error('fail'));
    const usageError = await storage.getUsage();
    expect(usageError).toEqual({ bytesInUse: 0 });
  });
});
