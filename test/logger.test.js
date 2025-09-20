import { jest, describe, test, expect, beforeEach } from '@jest/globals';
import { createLogger } from '../core/logger.js';

describe('Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('error logs are stored with ring buffer max 50 entries', async () => {
    const logger = createLogger('Test');

    // Existing 60 error logs
    const existing = new Array(60).fill(0).map((_, i) => ({ message: `old-${i}` }));
    chrome.storage.local.get.mockResolvedValue({ errorLogs: existing });
    chrome.storage.local.set.mockResolvedValue(undefined);

    logger.error('boom', { code: 500 });

    // Wait a tick for async storage
    await Promise.resolve();

    expect(chrome.storage.local.get).toHaveBeenCalledWith('errorLogs');
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);

    const arg = chrome.storage.local.set.mock.calls[0][0];
    expect(Array.isArray(arg.errorLogs)).toBe(true);
    expect(arg.errorLogs).toHaveLength(50);
    // Newest entry first
    expect(arg.errorLogs[0].message).toBe('boom');
  });

  test('warn/info/debug formatting: no raw object leak as primary output', () => {
    const logger = createLogger('Format');
    // Elevate to DEBUG to enable all levels
    logger.level = 3;

    logger.warn('warned');
    expect(typeof console.warn.mock.calls[0][0]).toBe('string');

    logger.warn('warned with details', { a: 1 });
    expect(typeof console.warn.mock.calls[1][0]).toBe('string');
    expect(console.warn.mock.calls[1][1]).toEqual({ a: 1 });

    logger.info('info');
    expect(typeof console.log.mock.calls[0][0]).toBe('string');

    logger.debug('debug');
    expect(typeof console.debug.mock.calls[0][0]).toBe('string');

    logger.error('err', { e: true });
    expect(typeof console.error.mock.calls[0][0]).toBe('string');
  });
});
