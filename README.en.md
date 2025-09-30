# Pagy Blocker

[![Chrome MV3](https://img.shields.io/badge/Chrome%20MV3-supported-brightgreen)](https://developer.chrome.com/docs/extensions/mv3/) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A fast, lightweight ad blocker for Chromium browsers. Pagy Blocker utilizes the native [declarativeNetRequest API](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/) (Manifest V3) for excellent performance, low memory usage, and maximum privacy – without telemetry or external services.

– Language: English

## Highlights

- Performance: Static, pre-compiled rules (JSON) for fast initialization and low CPU/RAM usage.
- MV3 native: Uses `declarativeNetRequest` without content script overhead or WebRequest hooks.
- Privacy: No server requests, no tracking, no telemetry. Everything runs locally.
- Easy control: Enable/disable per domain directly in the popup (with icon/badge display).
- Clean rules: Supports ABP-like network rules, cosmetic filters are deliberately not loaded.
- Robust tools: Scripts for deduplicating and pre-compiling filter lists included.

## Manual Installation (from source code)

1) Download or clone the [repository](https://github.com/zerox80/pagy-blocker).
2) Optionally build the filter list (recommended if you changed `filter_optimized.txt`):

```
npm run build:filters
```

3) Open `chrome://extensions` in Chrome/Chromium, enable Developer mode.
4) Choose "Load unpacked extension" and select the folder of this repository.

Done. The icon appears in the toolbar. Use the popup to enable/disable Pagy Blocker per domain.

## Usage

- Open popup: Shows status, current domain, filter count, and (conservative) block statistics.
- Toggle per domain: The switch enables/disables filters for the active domain. The icon/badge shows the status.
- After toggling, the active tab may reload automatically to apply changes immediately.

## How it works

- Static rules: [`filter_lists/filter_precompiled.json`](filter_lists/filter_precompiled.json) is loaded as DNR ruleset via [`manifest.json`](manifest.json).
- Domain pause: When disabled for a domain, dynamic "ALLOW" rules are set (without `main_frame`) via [updateDynamicRules](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/#method-updateDynamicRules), allowing requests from that domain to pass through.
- Counts/Stats: The popup uses – if available – [`declarativeNetRequest.getMatchedRules`](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/#method-getMatchedRules) and otherwise shows a realistic, low estimate.

## Maintaining Filter Lists

Source list: [`filter_lists/filter_optimized.txt`](filter_lists/filter_optimized.txt)

- Comments with `!` and metadata `[ ... ]` are ignored.
- Exception rules `@@` as well as cosmetic filters (`##`, `#@#`, `#?#`) are not included for MV3/DNR.
- Pure domain entries like `||example.com^` are compiled as fast domain rules.
- All other patterns are (RE2-safe) converted to regex DNR rules; only typical resource types (without `main_frame`).
- Upper limit: approx. 30,000 rules (hard limit in Chrome, file is capped accordingly).

Commands:

```
# Deduplicate/remove duplicates in source list
npm run dedupe:filters -- --stats

# Remove duplicates in-place
npm run dedupe:filters:inplace

# Compile list into DNR-JSON (for the extension)
npm run build:filters
```

Output: `filter_lists/filter_precompiled.json` (loaded by manifest).

## Development

- Requirements: Node.js >= 16 (only for build scripts); the extension doesn't need a build step at runtime.
- Important directories:
  - [`background/`](background/): Service Worker (background logic, DNR updates, icon/badge status)
  - [`content/`](content/): Content Script for status/events
  - [`popup/`](popup/): Popup UI (status, toggles, statistics)
  - [`core/`](core/): Configuration, Logger, Utilities, Blocker Engine
  - [`filter_lists/`](filter_lists/): Filter source (`filter_optimized.txt`) and pre-compiled rules (`filter_precompiled.json`)
  - [`tools/`](tools/): Scripts for deduplicating and pre-compiling

Local testing:

```
# Rebuild rules and reload extension
npm run build:filters
```

Then reload the extension in `chrome://extensions`.

## Permissions (Why?)

- [`declarativeNetRequest`](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/): Core of MV3 blocking (loads rules, blocks requests).
- [`declarativeNetRequestFeedback`](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/): Provides (if available) match info for statistics in popup.
- `storage`: Stores locally disabled domains and error logs (no telemetry).
- `tabs` + `"<all_urls>"`: Determines domain/URL of active tab and sets dynamic exception rules per domain.

No communication with external servers occurs. See privacy section for details.

## Privacy

Transparency is central: There is no telemetry, no tracking, no server communication. See [`DATENSCHUTZ.md`](DATENSCHUTZ.md) for all details.

- File: [`DATENSCHUTZ.md`](DATENSCHUTZ.md)

## Troubleshooting (Quick)

- Popup shows "Error loading": Reload extension in `chrome://extensions` and refresh tab.
- Filter count is 0: Run `npm run build:filters` and reload extension.
- Toggle without effect: After toggling, reload the active tab (usually happens automatically).

## Contributions welcome

Guidelines in [`CONTRIBUTING.md`](CONTRIBUTING.md). Small, focused PRs preferred. Please respect behavior in [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

MIT – see [`LICENSE`](LICENSE)
