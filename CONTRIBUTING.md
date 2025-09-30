# Beitragsrichtlinien

Danke, dass du zu Pagy Blocker beitragen möchtest! Dieses Dokument fasst kurz zusammen, wie du mitmachen kannst.

– Forke das Repo und arbeite in einem Feature-Branch (z. B. `feature/dein-feature`).
– Halte Änderungen fokussiert und klein; eine Aufgabe pro Pull Request.
– Folge dem vorhandenen Stil (ES Modules, klare Benennung, kurze Funktionen).
– Füge bei Änderungen an Verhalten kurze Hinweise in der README hinzu.
– Teste die Extension lokal (chrome://extensions → Entwicklermodus → Entpackte Erweiterung laden).

## Entwicklung

- Filter neu bauen: `npm run build:filters`
- Filter deduplizieren: `npm run dedupe:filters -- --stats`

## Code-Qualität

- Nutze nur `chrome.*` APIs in MV3-kompatibler Weise (Service Worker, Promises).
- Vermeide unnötige Logs; produktive Logs laufen über `core/logger.js`.
- Achte auf sichere String-Verarbeitung (siehe `sanitizeInput`).

## Pull Requests

1. Beschreibe das „Warum“ und „Was“ prägnant.
2. Verweise auf relevante Issues, wenn vorhanden.
3. Beschreibe manuelle Testschritte (vor allem für Popup/Background).

Danke! 🙌

