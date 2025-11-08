# Pagy Blocker

[![Chrome MV3](https://img.shields.io/badge/Chrome%20MV3-supported-brightgreen)](https://developer.chrome.com/docs/extensions/mv3/) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A fast, lightweight ad blocker for Chromium browsers. Pagy Blocker utilizes the native [declarativeNetRequest API](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/) (Manifest V3) for excellent performance, low memory usage, and maximum privacy – without telemetry or external services.

## Highlights

-   **Performance**: Static, pre-compiled rules (JSON) for fast initialization and low CPU/RAM usage.
-   **MV3 Native**: Uses `declarativeNetRequest` without content script overhead or WebRequest hooks.
-   **Privacy**: No server requests, no tracking, no telemetry. Everything runs locally.
-   **Easy Control**: Enable/disable per domain directly in the popup (with icon/badge display).
-   **Clean Rules**: Supports ABP-like network rules; cosmetic filters are deliberately not loaded.
-   **Robust Tools**: Scripts for deduplicating and pre-compiling filter lists included.

## Manual Installation (from source code)

1.  Download or clone the [repository](https://github.com/zerox80/pagy-blocker).
2.  Optionally build the filter list (recommended if you changed `filter_optimized.txt`):
    ```bash
    npm run build:filters
    ```
3.  Open `chrome://extensions` in Chrome/Chromium and enable Developer mode.
4.  Choose "Load unpacked extension" and select the folder of this repository.

Done. The icon will appear in the toolbar. Use the popup to enable/disable Pagy Blocker per domain.

## Usage

-   **Open Popup**: Shows the status, current domain, filter count, and (conservative) block statistics.
-   **Toggle per Domain**: The switch enables/disables filters for the active domain. The icon/badge shows the status.
-   After toggling, the active tab may reload automatically to apply changes immediately.

## How It Works

-   **Static Rules**: [`filter_lists/filter_precompiled.json`](filter_lists/filter_precompiled.json) is loaded as a DNR ruleset via [`manifest.json`](manifest.json).
-   **Domain Pause**: When disabled for a domain, dynamic "ALLOW" rules are set (without `main_frame`) via [updateDynamicRules](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/#method-updateDynamicRules), allowing requests from that domain to pass through.
-   **Counts/Stats**: The popup uses [`declarativeNetRequest.getMatchedRules`](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/#method-getMatchedRules) when available.

## Maintaining Filter Lists

The source list is located at [`filter_lists/filter_optimized.txt`](filter_lists/filter_optimized.txt).

-   Comments with `!` and metadata `[ ... ]` are ignored.
-   Exception rules `@@` and cosmetic filters (`##`, `#@#`, `#?#`) are not included for MV3/DNR.
-   Pure domain entries like `||example.com^` are compiled as fast domain rules.
-   All other patterns are converted to RE2-safe regex DNR rules for typical resource types (without `main_frame`).
-   The upper limit is approximately 30,000 rules (a hard limit in Chrome).

### Commands

-   Deduplicate/remove duplicates in the source list:
    ```bash
    npm run dedupe:filters -- --stats
    ```
-   Remove duplicates in-place:
    ```bash
    npm run dedupe:filters:inplace
    ```
-   Compile the list into DNR-JSON for the extension:
    ```bash
    npm run build:filters
    ```
    The output is `filter_lists/filter_precompiled.json`, which is loaded by the manifest.

## Development

-   **Requirements**: Node.js >= 16 (for build scripts only); the extension does not require a build step at runtime.
-   **Important Directories**:
    -   [`background/`](background/): Service Worker (background logic, DNR updates, icon/badge status).
    -   [`content/`](content/): Content Script for status/events.
    -   [`popup/`](popup/): Popup UI (status, toggles, statistics).
    -   [`core/`](core/): Configuration, Logger, Utilities, Blocker Engine.
    -   [`filter_lists/`](filter_lists/): Filter source (`filter_optimized.txt`) and pre-compiled rules (`filter_precompiled.json`).
    -   [`tools/`](tools/): Scripts for deduplicating and pre-compiling.

### Local Testing

1.  Rebuild the rules:
    ```bash
    npm run build:filters
    ```
2.  Reload the extension in `chrome://extensions`.

## Permissions

-   [`declarativeNetRequest`](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/): Core of MV3 blocking (loads rules, blocks requests).
-   [`declarativeNetRequestFeedback`](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/): Provides match info for statistics in the popup.
-   `storage`: Stores locally disabled domains and error logs (no telemetry).
-   `tabs` + `"<all_urls>"`: Determines the domain/URL of the active tab and sets dynamic exception rules per domain.

No communication with external servers occurs. See the privacy section for details.

## Privacy

Transparency is central: There is no telemetry, no tracking, and no server communication. See [`DATENSCHUTZ.md`](DATENSCHUTZ.md) for all details.

## Troubleshooting

-   **Popup shows "Error loading"**: Reload the extension in `chrome://extensions` and refresh the tab.
-   **Filter count is 0**: Run `npm run build:filters` and reload the extension.
-   **Toggle without effect**: After toggling, reload the active tab (this usually happens automatically).

## Contributions

Contributions are welcome! Please follow the guidelines in [`CONTRIBUTING.md`](CONTRIBUTING.md). Small, focused PRs are preferred. Please respect the behavior outlined in the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

MIT – see [`LICENSE`](LICENSE)
