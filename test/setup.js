// Jest setup for browser extension testing
import { jest } from '@jest/globals';

// Mock Chrome API
global.chrome = {
  runtime: {
    id: 'test-extension-id',
    getURL: jest.fn((path) => `chrome-extension://test-extension-id${path}`),
    onInstalled: {
      addListener: jest.fn(),
    },
    onStartup: {
      addListener: jest.fn(),
    },
    onMessage: {
      addListener: jest.fn(),
    },
  },
  storage: {
    onChanged: {
      addListener: jest.fn(),
    },
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
      clear: jest.fn(),
      getBytesInUse: jest.fn(async () => 0),
      onChanged: {
        addListener: jest.fn(),
      },
    },
  },
  tabs: {
    query: jest.fn(),
    get: jest.fn(),
    sendMessage: jest.fn(),
    reload: jest.fn(),
    onActivated: {
      addListener: jest.fn(),
    },
    onUpdated: {
      addListener: jest.fn(),
    },
    onRemoved: {
      addListener: jest.fn(),
    },
  },
  declarativeNetRequest: {
    getDynamicRules: jest.fn(async () => []),
    updateDynamicRules: jest.fn(async () => {}),
    getMatchedRules: jest.fn(),
  },
  action: {
    setIcon: jest.fn(),
    setBadgeText: jest.fn(),
    setBadgeBackgroundColor: jest.fn(),
  },
};

// Mock performance API
global.performance = {
  now: jest.fn(() => Date.now()),
  memory: {
    usedJSHeapSize: 1000000,
    totalJSHeapSize: 2000000,
    jsHeapSizeLimit: 5000000,
  },
};

// Minimal fetch stub used by background/blocker-engine
global.fetch = jest.fn(async () => ({
  ok: true,
  json: async () => ([]),
  text: async () => ('')
}));

// Mock console for cleaner test output
global.console = {
  ...console,
  debug: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
