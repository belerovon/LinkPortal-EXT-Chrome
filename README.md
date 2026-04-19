# LinkPortal Chrome Extension

Chrome Extension für das [LinkPortal](https://github.com/deinname/linkportal) — ein selbst gehostetes Unternehmensportal zum zentralen Verwalten von Links mit SAML-Authentifizierung und Gruppenberechtigungen.

## Features

- 🔗 **Alle deine Links** auf einen Klick — Tabs & Sektionen direkt aus dem Portal
- 🔍 **Volltextsuche** über alle Links, Beschreibungen, Tabs und Sektionen
- 📦 **Offline-Cache** — Links lokal gespeichert, automatischer Hintergrund-Sync alle 30 Min
- 🌐 **Drei Sprachen** — Deutsch, Englisch, Spanisch (synchronisiert mit dem Portal)
- 🔒 **Sicher** — Basic Auth (HTTPS only), automatischer Logout bei 403 oder 30 Tagen Inaktivität
- 🖼 **Dynamisches Logo** — das Portal-Logo erscheint in der Chrome-Toolbar

## Installation (Entwicklermodus)

1. Dieses Repository klonen oder ZIP herunterladen
2. Chrome öffnen → `chrome://extensions/`
3. **Entwicklermodus** einschalten
4. **Entpackte Erweiterung laden** → Ordner auswählen
5. Extension-Icon klicken → **Einstellungen öffnen**
6. LinkPortal-URL, Benutzername und API-Token eingeben
7. **Verbindung testen** → **Speichern**

## Authentifizierung

Die Extension nutzt **HTTP Basic Auth** (`username:api-token`).  
Den API-Token erzeugst du im LinkPortal unter **Einstellungen → API-Token generieren**.

## Dateien

```
linkportal-ext/
├── manifest.json      # Chrome Extension Manifest V3
├── background.js      # Service Worker: Sync, 30-Tage-Logout
├── popup.html/css/js  # Extension Popup
├── options.html/css/js # Einstellungsseite
├── i18n.js            # Übersetzungen (DE/EN/ES)
└── icons/             # Extension Icons
```

## Entwicklung

Keine Build-Tools nötig — reines HTML/CSS/JS, läuft direkt als entpackte Extension.  
Nach Änderungen: `chrome://extensions/` → Extension neu laden (⟳).

## Lizenz

[LinkPortal License v1.0](LICENSE) — MIT-basiert mit Pflicht zur Namensnennung.  
Copyright © 2025 Christian Burgert · [www.kleckerbox.link](https://www.kleckerbox.link)
