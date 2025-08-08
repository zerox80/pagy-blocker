# Pagy Blocker

[![Version](https://img.shields.io/badge/version-9.0.0-blue.svg)](https://github.com/zerox80/pagy-blocker/releases) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Ein blitzschneller, ressourcenschonender Werbeblocker für Chrome, der die native `declarativeNetRequest` API für maximale Performance und Privatsphäre nutzt.

---

## Inhaltsverzeichnis

- [Features](#features)
- [Performance-Vergleich](#performance-vergleich)
- [Installation](#installation)
- [Nutzung](#nutzung)
- [Technische Details](#technische-details)
- [Mitwirken](#mitwirken)
- [Datenschutz & Lizenz](#datenschutz--lizenz)

---

## Features

- **Native Blockierung:** Nutzt die Chrome `declarativeNetRequest` API für Blockierung im Browser-Kern.
- **Pro-Tab-Kontrolle:** Deaktivieren Sie den Blocker mit einem Klick für einzelne Domains.
- **Dynamische Regeln:** Temporäre Regeln für die aktuelle Browser-Sitzung.
- **Optimierte Filter:** Basiert auf EasyList; die Filterliste wird vor dem Laden in ein kompaktes JSON-Format vor-kompiliert.
- **Minimaler Ressourcenverbrauch:** Effizienter als traditionelle JavaScript-basierte Blocker.

---

## Performance-Vergleich

| Feature               | Pagy Blocker (Nativ) | uBlock Origin (JS) | AdBlock Plus (JS) |
| --------------------- | -------------------- | ------------------ | ----------------- |
| **Performance**       | Extrem schnell       | Schnell            | Langsam           |
| **Ressourcen**        | Minimal              | Mittel             | Hoch              |
| **Pro-Tab-Kontrolle** | ✅ Ja                | ❌ Nein            | ❌ Nein           |
| **Manifest V3**       | ✅ Nativ             | 🔄 Portiert        | 🔄 Portiert       |

---

## Installation

### 1. Für Endbenutzer (Chrome Web Store)

Die Erweiterung ist im Chrome Web Store verfügbar.  
[➡️ Zum Chrome Web Store](https://chrome.google.com/webstore/detail/IHRE_EXTENSION_ID)

### 2. Für Entwickler

1. **Repository klonen:**
    ```bash
    git clone https://github.com/zerox80/pagy-blocker.git
    cd pagy-blocker
    ```
2. **Filterliste vor-kompilieren (Node.js):**
    Voraussetzungen: Node.js ≥ 16.
    ```bash
    npm run build:filters
    ```
    Dabei gilt:
    - Eingabe: `filter_lists/filter_optimized.txt`
    - Ausgabe: `filter_lists/filter_precompiled.json`
    - Skript: `tools/precompile-filters.mjs`
    - Das Manifest bindet die Ausgabe automatisch ein (`declarative_net_request.rule_resources`).
3. **Erweiterung laden:**
    - Öffnen Sie `chrome://extensions/`.
    - Aktivieren Sie den **Entwicklermodus**.
    - Klicken Sie auf **"Entpackte Erweiterung laden"** und wählen Sie den `pagy-blocker`-Ordner aus.

---

## Nutzung

1. Klicken Sie auf das Pagy-Blocker-Symbol in der Toolbar.
2. Schalten Sie den Blocker global ein/aus oder deaktivieren Sie ihn für die aktuelle Domain.
3. Die Seite wird automatisch neu geladen, um die Änderungen zu übernehmen.

---

## Technische Details

- **Manifest V3:** Modernste, sichere und zukunftssichere Architektur.
- **Service Worker:** Effiziente Hintergrundverarbeitung ohne persistente Prozesse.
- **`declarativeNetRequest`:** Regeln werden direkt vom Browser angewendet, was den JS-Overhead eliminiert.
- **Pre-Kompilierung:** Filterlisten werden offline mit dem Node-Tool `tools/precompile-filters.mjs` (Befehl: `npm run build:filters`) in ein statisches DNR-JSON (`filter_lists/filter_precompiled.json`) umgewandelt.

---

## Filter-Precompiler (Node-Tool)

Dieses Projekt enthält ein kleines Node.js-Tool, das die Text-Filterliste in ein JSON-Regelset für Chrome's `declarativeNetRequest` (DNR) vor-kompiliert.

- Befehl: `npm run build:filters`
- Eingabe: `filter_lists/filter_optimized.txt`
- Ausgabe: `filter_lists/filter_precompiled.json`
- Verwendet wird ein robustes Regex-Mapping für typische ABP-Muster:
  - Unterstützt: `||domain.tld^`, `|http(s)://...`, Wildcards `*`
  - Ignoriert: kosmetische Regeln (`##`, `#@#`, `#?#`), Ausnahmen (`@@`), Kommentare (`!`, `[]`)
  - Standardmäßig werden http/https-Requests abgedeckt.

Hinweise und Fehlerbehebung:
- Wenn die Anzahl der generierten Regeln kleiner wirkt als erwartet, prüfen Sie, ob die Textliste Kommentare, Leerzeilen, Ausnahme- oder kosmetische Regeln enthält – diese werden absichtlich übersprungen.
- Doppelte oder semantisch identische Einträge erhöhen nicht zwingend die Wirksamkeit und können vom Browser intern konsolidiert werden.
- Das generierte JSON wird im Manifest referenziert und direkt vom Browser geladen; die `TXT`-Datei dient optional als Fallback zur Anzeige.

Beispielausgabe des Tools:
```
[precompile-filters] Wrote 137 rules to filter_lists/filter_precompiled.json in 3ms
```

---

## Filterliste bereinigen (Dedupe)

Um doppelte Domain-Einträge (Form: `||domain.tld^` ohne Pfad) aus der Textliste zu entfernen, steht ein dedizierter Dedupe-Task bereit. Kommentare, Leerzeilen, Ausnahmen (`@@`) und kosmetische Regeln (`##`, `#@#`, `#?#`) bleiben unverändert erhalten.

- Sicherer Modus (schreibt in neue Datei):
  ```bash
  npm run dedupe:filters -- --stats
  ```
  Ergebnis: `filter_lists/filter_optimized.cleaned.txt`

- In-Place (überschreibt die bestehende Datei):
  ```bash
  npm run dedupe:filters:inplace -- --stats
  ```

Flags:
- `--stats` zeigt eine Zusammenfassung inkl. Liste der duplizierten Domains und deren Häufigkeit.

Hinweis: Das Precompile-Tool dedupliziert Domain-only Einträge intern ebenfalls (für Performance). Das Dedupe-Tool hilft, die Textquelle sauber zu halten.

---

## Mitwirken

Beiträge sind herzlich willkommen! Bitte lesen Sie unsere [**Beitragsrichtlinien**](CONTRIBUTING.md), um zu erfahren, wie Sie helfen können.

Alle Mitwirkenden müssen sich an unseren [**Verhaltenskodex**](CODE_OF_CONDUCT.md) halten.

1. Forken Sie das Repository.
2. Erstellen Sie einen neuen Branch: `git checkout -b feature/MeinFeature`
3. Committen Sie Ihre Änderungen: `git commit -m 'Add: MeinFeature'`
4. Pushen Sie zum Branch: `git push origin feature/MeinFeature`
5. Öffnen Sie einen Pull Request.

---

## Datenschutz & Lizenz

- **Datenschutz:** Wir sammeln keine Daten. Alle Operationen finden lokal statt. Lesen Sie die vollständige [**Datenschutzerklärung**](DATENSCHUTZ.md).
- **Lizenz:** Dieses Projekt ist unter der [**MIT-Lizenz**](LICENSE) lizenziert.
