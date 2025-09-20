import { jest, describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import * as blockerEngineModule from '../core/blocker-engine.js';

// Helper to await sendResponse from background message handler
function invokeMessage(handler, message, sender = { id: 'test-extension-id' }) {
  return new Promise((resolve) => {
    handler(message, sender, (resp) => resolve(resp));
  });
}

describe('Background service worker', () => {
  let messageHandler;
  let onUpdatedHandler;
  let onActivatedHandler;

  beforeAll(async () => {
    // Use fake timers early so debounce captures them
    jest.useFakeTimers();
    // Ensure fresh mocks baseline
    jest.clearAllMocks();
    // Default tabs.query behavior
    chrome.tabs.query.mockResolvedValue([]);
    // Default storage behavior to avoid undefined access during import
    chrome.storage.local.get.mockResolvedValue({});
    chrome.storage.local.set.mockResolvedValue(undefined);
    // Import background to register listeners
    await import('../background/background.js');

    // Capture registered listeners
    messageHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    onActivatedHandler = chrome.tabs.onActivated.addListener.mock.calls[0][0];
    onUpdatedHandler = chrome.tabs.onUpdated.addListener.mock.calls[0][0];
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getPopupData returns domain, pause state and stats', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);

    const be = blockerEngineModule.blockerEngine;
    jest.spyOn(be, 'isDomainDisabled').mockResolvedValue(false);
    jest.spyOn(be, 'getStats').mockResolvedValue({ initialized: true, filterCount: 10, runtime: 1, blockedRequests: 2 });

    const resp = await invokeMessage(messageHandler, { command: 'getPopupData' });

    expect(resp.domain).toBe('example.com');
    expect(resp.isPaused).toBe(false);
    expect(typeof resp.filterCount).toBe('number');
    expect(resp.stats).toEqual({ initialized: true, filterCount: 10, runtime: 1, blockedRequests: 2 });
  });

  test('getState returns pause state for sender tab', async () => {
    const be = blockerEngineModule.blockerEngine;
    jest.spyOn(be, 'isDomainDisabled').mockResolvedValue(true);

    const resp = await invokeMessage(messageHandler, { command: 'getState' }, { id: 'test-extension-id', tab: { url: 'https://sub.example.com/path' } });

    expect(resp.domain).toBe('sub.example.com');
    expect(resp.isPaused).toBe(true);
  });

  test('toggleDomainState happy path triggers DNR update and reload', async () => {
    // Active tab for reload
    const activeTab = { id: 42, url: 'https://example.com' };
    chrome.tabs.query.mockImplementation(async (opts) => {
      if (opts && opts.active && opts.currentWindow) return [activeTab];
      return [activeTab, { id: 99, url: 'https://other.com' }];
    });

    // Existing dynamic rules empty; ensure DNR updates resolve
    chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([]);
    chrome.declarativeNetRequest.updateDynamicRules.mockResolvedValue(undefined);

    // Spy to avoid actual storage work in engine
    const be = blockerEngineModule.blockerEngine;
    jest.spyOn(be, 'addDisabledDomain').mockResolvedValue(undefined);
    jest.spyOn(be, 'getDisabledDomains').mockResolvedValue(['example.com']);

    const resp = await invokeMessage(messageHandler, { command: 'toggleDomainState', domain: 'example.com', isPaused: true });

    expect(resp).toEqual({ success: true });
    expect(be.addDisabledDomain).toHaveBeenCalledWith('example.com');
    expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalled();
    expect(chrome.tabs.reload).toHaveBeenCalledWith(42);
  });

  test('toggleDomainState returns error on DNR failure', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);
    chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([]);
    chrome.declarativeNetRequest.updateDynamicRules.mockRejectedValue(new Error('dnr failed'));

    const be = blockerEngineModule.blockerEngine;
    jest.spyOn(be, 'addDisabledDomain').mockResolvedValue(undefined);
    jest.spyOn(be, 'getDisabledDomains').mockResolvedValue(['example.com']);

    const resp = await invokeMessage(messageHandler, { command: 'toggleDomainState', domain: 'example.com', isPaused: true });

    expect(resp).toHaveProperty('error');
    expect(resp.error).toMatch(/dnr failed/i);
  });

  test('updateDynamicRules diffing: remove wrong RT and add new with minimal free IDs', async () => {
    // Disabled domains stored: a.com, b.com
    chrome.storage.local.get.mockResolvedValue({ disabledDomains: ['a.com', 'b.com'] });

    // Existing dynamic rules: id 1 for a.com with wrong resourceTypes (includes main_frame), id 3 for c.com
    chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([
      {
        id: 1,
        priority: 200,
        action: { type: 'allow' },
        condition: { initiatorDomains: ['a.com'], resourceTypes: ['main_frame', 'script'] },
      },
      {
        id: 3,
        priority: 200,
        action: { type: 'allow' },
        condition: { initiatorDomains: ['c.com'], resourceTypes: ['script'] },
      },
    ]);

    // Next DNR update should remove id 1 and add a.com with id 2, and b.com with id 4
    chrome.declarativeNetRequest.updateDynamicRules.mockResolvedValue(undefined);

    // Trigger by toggling domain (message handler calls updateDynamicRules internally)
    const be = blockerEngineModule.blockerEngine;
    jest.spyOn(be, 'addDisabledDomain').mockResolvedValue(undefined);
    jest.spyOn(be, 'getDisabledDomains').mockResolvedValue(['a.com', 'b.com']);

    // Clear call history to isolate
    chrome.declarativeNetRequest.updateDynamicRules.mockClear();

    await invokeMessage(messageHandler, { command: 'toggleDomainState', domain: 'b.com', isPaused: true });

    expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledTimes(1);
    const args = chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
    expect(args.removeRuleIds).toContain(1);
    const addedDomains = args.addRules.map(r => ({ id: r.id, d: r.condition.initiatorDomains[0], rt: r.condition.resourceTypes }));
    // Ensure a.com and b.com are added with resourceTypes not containing main_frame
    const allRT = new Set(addedDomains.flatMap(r => r.rt));
    expect(allRT.has('main_frame')).toBe(false);
    const ids = addedDomains.map(r => r.id).sort((a,b) => a-b);
    // Expect minimal free ids 2 and 4 given used 1 and 3
    expect(ids.length).toBe(2);
    expect(ids[0]).toBe(2);
    expect(ids[1]).toBeGreaterThan(2);
  });

  test('Icon/badge updates are debounced and cached to avoid redundant updates', async () => {
    // Provide tab info for get
    chrome.tabs.get.mockResolvedValue({ id: 77, url: 'https://site.com' });

    const be = blockerEngineModule.blockerEngine;
    jest.spyOn(be, 'isDomainDisabled').mockResolvedValue(false);

    // Trigger two quick updates
    onUpdatedHandler(77, { status: 'complete' }, {});

    // No call until debounce expires
    expect(chrome.action.setIcon).not.toHaveBeenCalled();

    // Flush timers
    await jest.advanceTimersByTimeAsync(200);
    // allow async body of debounced function to complete
    await Promise.resolve();

    expect(chrome.action.setIcon).toHaveBeenCalledTimes(1);
    expect(chrome.action.setBadgeText).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.get).toHaveBeenCalledWith(77);

    // Trigger again with same state; should be cached and not set icon again
    onUpdatedHandler(77, { status: 'complete' }, {});
    await jest.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    expect(chrome.action.setIcon).toHaveBeenCalledTimes(1);
  });
});
