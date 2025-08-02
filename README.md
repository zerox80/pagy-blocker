# Pagy Blocker

[![Version](https://img.shields.io/badge/version-2.2.0-blue.svg)](https://github.com/zerox80/pagy-blocker/releases) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

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
- **Optimierte Filter:** Basiert auf EasyList mit über 100 vor-kompilierten Regeln.
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
2. **Filter kompilieren:**
    ```bash
    node filter_precompiler.js
    ```
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
- **Pre-Kompilierung:** Filterlisten werden offline mit `filter_precompiler.js` in ein effizientes JSON-Format umgewandelt.

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
