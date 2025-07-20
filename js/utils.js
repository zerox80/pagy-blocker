/**
 * @file utils.js
 * @description Sammlung von Hilfsfunktionen, die in der gesamten Erweiterung verwendet werden.
 */

/**
 * Extrahiert den Domainnamen sicher aus einer URL.
 * @param {string} url - Die vollständige URL.
 * @returns {string|null} Der Domainname oder null bei einem Fehler.
 */
export function getDomainFromURL(rawUrl) {
    // Frühzeitige Typ- und Leerstring-Prüfung
    if (typeof rawUrl !== 'string') {
        return null;
    }

    const url = rawUrl.trim();
    if (!url) {
        return null;
    }

    // Wenn kein Schema vorhanden ist, "http://" voranstellen, damit URL() nicht wirft
    let normalized = url;
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(normalized)) {
        normalized = `http://${normalized}`;
    }

    try {
        const { hostname } = new URL(normalized);
        // Hostname normalisieren: Kleinbuchstaben & trailing dot entfernen
        const cleanHost = hostname.replace(/\.$/, '').toLowerCase();
        return cleanHost || null;
    } catch (e) {
        // Fängt Fehler bei ungültigen URLs ab.
        console.error(`Ungültige URL-Struktur: ${url}`, e);
        return null;
    }
}

// Standard-Export für bequemes Importieren
export default getDomainFromURL;
