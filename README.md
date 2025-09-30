# Pagy Blocker

[![Chrome MV3](https://img.shields.io/badge/Chrome%20MV3-supported-brightgreen)](https://developer.chrome.com/docs/extensions/mv3/) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Ein schneller, schlanker Werbeblocker für Chromium-Browser. Pagy Blocker nutzt die native [declarativeNetRequest API](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/) (Manifest V3) für hervorragende Performance, geringe Speicherlast und maximale Privatsphäre – ohne Telemetrie oder externe Dienste.

– Sprache: Deutsch

## Highlights

- Performance: Statische, vor‑kompilierte Regeln (JSON) für schnelle Initialisierung und geringe CPU-/RAM‑Last.
- MV3 nativ: Nutzt `declarativeNetRequest` ohne Content-Overhead oder WebRequest-Hooks.
- Datenschutz: Keine Serveranfragen, kein Tracking, keine Telemetrie. Alles läuft lokal.
- Einfache Steuerung: Domainweise aktivieren/deaktivieren direkt im Popup (mit Icon-/Badge‑Anzeige).
- Saubere Regeln: Unterstützt ABP‑ähnliche Netzwerkregeln, kosmetische Filter werden bewusst nicht geladen.
- Robuste Tools: Skripte zum Deduplizieren und Vor‑Kompilieren der Filterlisten enthalten.

## Installation (manuell, aus dem Quellcode)

1) [Repository](https://github.com/zerox80/pagy-blocker) herunterladen oder klonen.
2) Optional: Filterliste bauen (empfohlen, wenn du `filter_optimized.txt` geändert hast):

```
npm run build:filters
```

3) In Chrome/Chromium `chrome://extensions` öffnen, Entwicklermodus aktivieren.
4) „Entpackte Erweiterung laden“ wählen und den Ordner dieses Repos auswählen.

Fertig. Das Symbol erscheint in der Toolbar. Über das Popup kannst du Pagy Blocker pro Domain ein-/ausschalten.

## Nutzung

- Popup öffnen: Zeigt Status, aktuelle Domain, Filteranzahl sowie eine (konservative) Block‑Statistik.
- Umschalten pro Domain: Der Schalter aktiviert/deaktiviert die Filter für die aktive Domain. Das Icon/Badge zeigt den Status.
- Nach Umschalten lädt der aktive Tab ggf. einmal neu, damit Änderungen sofort greifen.

## Wie es funktioniert

- Statische Regeln: [`filter_lists/filter_precompiled.json`](filter_lists/filter_precompiled.json) wird über [`manifest.json`](manifest.json) als DNR‑Ruleset geladen.
- Domain‑Pause: Beim Deaktivieren für eine Domain werden dynamische „ALLOW“-Regeln gesetzt (ohne `main_frame`) über [updateDynamicRules](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/#method-updateDynamicRules), damit Anfragen dieser Domain ungehindert passieren.
- Zählungen/Stats: Das Popup nutzt – falls verfügbar – [`declarativeNetRequest.getMatchedRules`](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/#method-getMatchedRules) und zeigt andernfalls eine realistische, niedrige Schätzung an.

## Filterlisten pflegen

Quellliste: [`filter_lists/filter_optimized.txt`](filter_lists/filter_optimized.txt)

- Kommentare mit `!` und Metadaten `[ ... ]` werden ignoriert.
- Ausnahme‑Regeln `@@` sowie kosmetische Filter (`##`, `#@#`, `#?#`) werden für MV3/DNR nicht übernommen.
- Reine Domain‑Einträge wie `||example.com^` werden als schnelle Domain‑Regeln kompiliert.
- Alle anderen Muster werden (RE2‑sicher) in Regex‑DNR‑Regeln konvertiert; nur typische Ressourcentypen (ohne `main_frame`).
- Obergrenze: ca. 30.000 Regeln (hart begrenzt in Chrome, Datei wird entsprechend gekappt).

Befehle:

```
# Duplikate in der Quellliste erkennen/entfernen
npm run dedupe:filters -- --stats

# Duplikate in-place entfernen
npm run dedupe:filters:inplace

# Liste in DNR‑JSON kompilieren (für die Extension)
npm run build:filters
```

Ausgabe: `filter_lists/filter_precompiled.json` (wird vom Manifest geladen).

## Entwicklung

- Voraussetzungen: Node.js >= 16 (nur für die Build‑Skripte); die Extension benötigt keinen Build‑Step zur Laufzeit.
- Wichtige Verzeichnisse:
  - [`background/`](background/): Service Worker (Hintergrundlogik, DNR‑Updates, Icon/Badge‑Status)
  - [`content/`](content/): Content‑Script für Status/Events
  - [`popup/`](popup/): Popup‑UI (Status, Umschalter, Statistiken)
  - [`core/`](core/): Konfiguration, Logger, Utilities, Blocker‑Engine
  - [`filter_lists/`](filter_lists/): Filterquelle (`filter_optimized.txt`) und vor‑kompilierte Regeln (`filter_precompiled.json`)
  - [`tools/`](tools/): Skripte zum Deduplizieren und Vor‑Kompilieren

Lokales Testen:

```
# Regeln neu bauen und Extension neu laden
npm run build:filters
```

Anschließend in `chrome://extensions` die Erweiterung neu laden.

## Berechtigungen (Warum?)

- [`declarativeNetRequest`](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/): Kern der MV3‑Blockierung (lädt Regeln, blockiert Anfragen).
- [`declarativeNetRequestFeedback`](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest/): Liefert (wo möglich) Match‑Infos für die Statistik im Popup.
- `storage`: Speichert lokal deaktivierte Domains und Fehlerprotokolle (keine Telemetrie).
- `tabs` + `"<all_urls>"`: Ermittelt Domain/URL des aktiven Tabs und setzt dynamische Ausnahmeregeln pro Domain.

Es findet keine Kommunikation mit externen Servern statt. Details siehe Datenschutz.

## Datenschutz

Transparenz ist zentral: Es gibt keine Telemetrie, kein Tracking, keine Serverkommunikation. Siehe [`DATENSCHUTZ.md`](DATENSCHUTZ.md) für alle Details.

- Datei: [`DATENSCHUTZ.md`](DATENSCHUTZ.md)

## Fehlerbehebung (Kurz)

- Popup zeigt „Fehler beim Laden“: Extension in `chrome://extensions` neu laden und Tab aktualisieren.
- Filteranzahl ist 0: `npm run build:filters` ausführen und die Extension neu laden.
- Umschalten ohne Wirkung: Nach dem Umschalten den aktiven Tab neu laden (passiert meist automatisch).

## Beiträge willkommen

Richtlinien in [`CONTRIBUTING.md`](CONTRIBUTING.md). Kleine, fokussierte PRs bevorzugt. Bitte Verhalten in [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) beachten.

## Lizenz

MIT – siehe [`LICENSE`](LICENSE)
