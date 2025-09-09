import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { BlockerEngine } from '../core/blocker-engine.js';

// Mock chrome APIs
global.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
    },
    onChanged: {
      addListener: jest.fn(),
    },
  },
  runtime: {
    getURL: (path) => path,
  },
};

describe('BlockerEngine', () => {
  let blockerEngine;

  beforeEach(() => {
    blockerEngine = new BlockerEngine();
    // Reset mocks before each test
    chrome.storage.local.get.mockReset();
    chrome.storage.local.set.mockReset();
  });

  describe('Race Condition', () => {
    test('should prevent race conditions when adding and checking disabled domains', async () => {
      const domain1 = 'example.com';
      const domain2 = 'test.com';

      // Initial state in storage
      chrome.storage.local.get.mockResolvedValue({ disabledDomains: [domain1] });

      // Set up a "slow" add operation
      const addPromise = blockerEngine.addDisabledDomain(domain2);

      // Immediately check for a domain
      const checkPromise = blockerEngine.isDomainDisabled(domain1);

      await Promise.all([addPromise, checkPromise]);

      const finalDomains = await blockerEngine.getDisabledDomains();
      expect(finalDomains).toContain(domain1);
      expect(finalDomains).toContain(domain2);
    });
  });
});
