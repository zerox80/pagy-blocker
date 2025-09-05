# Datenschutzerklärung für Pagy Blocker

**Zuletzt aktualisiert:** 14. August 2025

## 1. Verantwortlicher

**Name:** zerox80
**E-Mail:** rujbin@proton.me

## 2. Grundprinzipien

- **Keine Datenerhebung:** Diese Erweiterung erhebt, verarbeitet oder überträgt keinerlei personenbezogene Daten an den Entwickler oder Dritte.
- **Keine Serverkommunikation:** Es findet keine Kommunikation mit externen Servern, Tracking- oder Analysediensten statt.
- **Keine Cookies:** Die Erweiterung setzt keine Cookies und verwendet keine vergleichbaren Technologien.
- **Open Source:** Der vollständige Quellcode ist öffentlich auf GitHub einsehbar.

Rechtsgrundlage: Soweit überhaupt personenbezogene Daten verarbeitet würden, erfolgt dies auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an Funktionsfähigkeit und Sicherheit der Erweiterung). Derzeit werden keine personenbezogenen Daten an uns übermittelt.

## 3. Datenverarbeitung im Browser

Pagy Blocker speichert ausschließlich folgende Informationen lokal im Browser:

| Datenart                                                | Speicherort           | Löschfrist                                   |
| ------------------------------------------------------- | --------------------- | -------------------------------------------- |
| Einstellungen (z. B. UI-Status)                         | chrome.storage.local  | Bis Entfernung/Zurücksetzen/Deinstallation   |
| Deaktivierte Domains (Whitelist)                        | chrome.storage.local  | Bis Entfernung/Zurücksetzen/Deinstallation   |
| Fehlerprotokolle (kritische Fehler, max. 50 Einträge)   | chrome.storage.local  | Bis Entfernung/Zurücksetzen/Deinstallation   |

**Hinweis:** Derzeit wird `chrome.storage.session` nicht verwendet. Die Verwaltung und Löschung der lokal gespeicherten Daten erfolgt durch Sie über die Browseroberfläche (z. B. `chrome://extensions`).

## 4. Nutzung von Browser-APIs und Drittanbietern

- Die Erweiterung nutzt ausschließlich offizielle Browser-APIs (z. B. Chrome Extensions API, declarativeNetRequest, storage).
- Es werden keine externen Dienste, Tracker, Telemetrie oder Crash-Reports verwendet. Netzwerkaufrufe laden ausschließlich lokal mitgelieferte Dateien über `chrome.runtime.getURL` (z. B. `filter_lists/filter_precompiled.json`); es werden keine Daten an Server übertragen.
- Berechtigungen gemäß `manifest.json`: `storage`, `declarativeNetRequest`, `tabs` sowie Host-Berechtigung `"<all_urls>"` zur Funktionsfähigkeit. Es werden keine Browserverläufe an uns übermittelt, gespeichert oder weitergegeben.
- Keine Empfänger, keine Drittlandübermittlungen.
- Beim Download über den Chrome Web Store oder GitHub gelten deren Datenschutzbestimmungen.

## 5. Rechte der Nutzer nach DSGVO

Sie haben das Recht auf:

- **Auskunft** über die lokal gespeicherten Daten (einsehbar über die Erweiterungseinstellungen)
- **Löschung** aller Daten durch Deinstallation der Erweiterung
- **Widerspruch** durch Deaktivierung oder Entfernen der Erweiterung
- **Berichtigung** unzutreffender Daten
- **Einschränkung der Verarbeitung**
- **Datenübertragbarkeit**
- **Beschwerderecht** bei einer Aufsichtsbehörde (z. B. Ihres gewöhnlichen Aufenthaltsorts)

Hinweis: Diese Rechte bestehen, soweit die gesetzlichen Voraussetzungen erfüllt sind. Da die Erweiterung keine personenbezogenen Daten an uns übermittelt, betreffen viele Rechte in der Praxis Ihre lokal gespeicherten Einstellungen.

## 6. Open Source & Transparenz

Der vollständige Quellcode ist öffentlich einsehbar unter:  
[github.com/zerox80/pagy-blocker](https://github.com/zerox80/pagy-blocker)

## 7. Änderungsvorbehalt

Diese Datenschutzerklärung kann bei Weiterentwicklung der Extension angepasst werden. Die jeweils aktuelle Version ist im Repository einsehbar.
