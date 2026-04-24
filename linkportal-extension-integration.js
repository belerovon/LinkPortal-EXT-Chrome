/**
 * ═══════════════════════════════════════════════════════════════════
 * LinkPortal — Chrome Extension Auto-Konfiguration
 * ═══════════════════════════════════════════════════════════════════
 *
 * ANLEITUNG: Was muss im LinkPortal konfiguriert werden?
 * ───────────────────────────────────────────────────────
 *
 * SCHRITT 1 — Extension ID herausfinden
 *   → Chrome Extension öffnen → Einstellungen (⋮) → Extension ID kopieren
 *   → Das ist z.B.: "abcdefghijklmnopabcdefghijklmnop"
 *
 * SCHRITT 2 — Admin-Einstellung in LinkPortal
 *   Im Admin-Bereich → App-Einstellungen → neues Feld hinzufügen:
 *   Key: "chrome_extension_id"
 *   Value: <die Extension ID aus Schritt 1>
 *
 * SCHRITT 3 — Frontend-Code einfügen
 *   In der Benutzer-Einstellungsseite des LinkPortals (settings/profile)
 *   diesen JavaScript-Code und HTML-Button einfügen (siehe unten).
 *
 * SCHRITT 4 — API-Token Gruppe konfigurieren
 *   Im Admin → App-Einstellungen → "API-Zugriff Gruppe" auf eine
 *   Gruppe setzen, deren Mitglieder die Extension nutzen dürfen.
 *
 * ═══════════════════════════════════════════════════════════════════
 */


// ═══════════════════════════════════════════════════
// HTML: Button in der Benutzer-Einstellungsseite
// Füge diesen Block in die Benutzereinstellungen ein
// ═══════════════════════════════════════════════════
const BUTTON_HTML = `
<div class="extension-config-section" style="margin-top: 20px;">
  <h3>🔌 Chrome Extension</h3>
  <p>Konfiguriert die LinkPortal Chrome Extension automatisch mit deinen Zugangsdaten.</p>
  <button id="btn-configure-extension" class="btn btn-primary" onclick="LinkPortalExtension.configure()">
    🚀 Extension automatisch konfigurieren
  </button>
  <div id="extension-config-status" style="margin-top: 8px; font-size: 13px;"></div>
</div>
`;


// ═══════════════════════════════════════════════════
// JavaScript: In app.js oder settings.js einfügen
// ═══════════════════════════════════════════════════
const LinkPortalExtension = {

  // Extension ID aus Admin-Einstellungen (wird beim App-Start geladen)
  _extensionId: null,

  async init() {
    try {
      // Lade Extension ID aus App-Einstellungen
      const settings = await API.get('/admin/app-settings');
      this._extensionId = settings['chrome_extension_id'] || null;
    } catch {
      // Nur Admins können App-Settings lesen — für normale User ist das ok
      // Extension ID kann auch hardcoded sein:
      // this._extensionId = 'DEINE_EXTENSION_ID_HIER';
    }
  },

  async configure() {
    const statusEl = document.getElementById('extension-config-status');
    const btn      = document.getElementById('btn-configure-extension');

    // Prüfen ob Chrome Extension API verfügbar
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      if (statusEl) statusEl.innerHTML =
        '<span style="color:red">❌ Chrome Extension nicht installiert oder nicht aktiv.</span>';
      return;
    }

    const extId = this._extensionId;
    if (!extId) {
      if (statusEl) statusEl.innerHTML =
        '<span style="color:orange">⚠ Extension ID nicht konfiguriert. Admin muss "chrome_extension_id" in App-Einstellungen setzen.</span>';
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Konfiguriere…'; }
    if (statusEl) statusEl.textContent = '';

    try {
      // 1. API-Token für den aktuellen User generieren
      const tokenResponse = await API.post('/auth/api-token', { name: 'Chrome Extension' });
      const token    = tokenResponse.token;
      const me       = await API.get('/auth/me');
      const username = me.username;
      const baseUrl  = window.location.origin; // z.B. "https://portal.meinefirma.de"

      if (!token || !username) throw new Error('Token oder Username fehlt');

      // 2. An die Chrome Extension senden
      chrome.runtime.sendMessage(
        extId,
        { action: 'autoConfig', baseUrl, username, token },
        response => {
          if (chrome.runtime.lastError) {
            if (statusEl) statusEl.innerHTML =
              '<span style="color:red">❌ Extension nicht erreichbar: ' +
              chrome.runtime.lastError.message + '</span>';
            if (btn) { btn.disabled = false; btn.textContent = '🚀 Extension automatisch konfigurieren'; }
            return;
          }
          if (response && response.ok) {
            if (statusEl) statusEl.innerHTML =
              '<span style="color:green">✅ Extension erfolgreich konfiguriert! Popup öffnen um zu starten.</span>';
            if (btn) { btn.disabled = false; btn.textContent = '✅ Konfiguriert'; }
          } else {
            const err = response?.error || 'Unbekannter Fehler';
            if (statusEl) statusEl.innerHTML =
              '<span style="color:red">❌ Fehler: ' + err + '</span>';
            if (btn) { btn.disabled = false; btn.textContent = '🚀 Extension automatisch konfigurieren'; }
          }
        }
      );

    } catch (err) {
      if (statusEl) statusEl.innerHTML =
        '<span style="color:red">❌ ' + (err.message || 'Fehler beim Generieren des Tokens') + '</span>';
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Extension automatisch konfigurieren'; }
    }
  }
};

// Beim App-Start initialisieren
// LinkPortalExtension.init();  // ← Diese Zeile in app.js aufrufen


/**
 * ═══════════════════════════════════════════════════════════════════
 * ZUSAMMENFASSUNG: Was du im LinkPortal machen musst
 * ═══════════════════════════════════════════════════════════════════
 *
 * 1. EXTENSION INSTALLIEREN
 *    → ZIP entpacken → chrome://extensions → Entwicklermodus → Laden
 *
 * 2. EXTENSION ID KOPIEREN
 *    → In der Extension auf ⋮ klicken → Einstellungen
 *    → Extension ID oben angezeigt → Kopieren (📋)
 *
 * 3. IN LINKPORTAL ADMIN:
 *    → Admin → App-Einstellungen → Neues Setting:
 *      Key:   chrome_extension_id
 *      Value: [die kopierte Extension ID]
 *
 * 4. IN LINKPORTAL CODE:
 *    a) Diese Datei (linkportal-extension-integration.js) in das
 *       Frontend einfügen (z.B. in data/frontend/js/)
 *    b) In index.html einbinden:
 *       <script src="js/linkportal-extension-integration.js"></script>
 *    c) In app.js beim Start aufrufen:
 *       await LinkPortalExtension.init();
 *    d) In der Benutzer-Einstellungsseite den Button hinzufügen:
 *       document.querySelector('.settings-panel').innerHTML += BUTTON_HTML;
 *       (oder direkt in das HTML der Einstellungsseite)
 *
 * 5. API-TOKEN GRUPPE:
 *    → Admin → App-Einstellungen → "API-Zugriff Gruppe"
 *    → Setze eine Gruppe (z.B. "Portal-Users") die Extension nutzen darf
 *    → Alle User in dieser Gruppe können "Extension konfigurieren" klicken
 *
 * ═══════════════════════════════════════════════════════════════════
 * FLOW WENN USER AUF BUTTON KLICKT:
 * ═══════════════════════════════════════════════════════════════════
 *  User klickt "🚀 Extension automatisch konfigurieren"
 *    │
 *    ├─→ POST /api/auth/api-token  (generiert Token für User)
 *    ├─→ GET  /api/auth/me         (holt Username)
 *    └─→ chrome.runtime.sendMessage(extensionId, {
 *            action: 'autoConfig',
 *            baseUrl: 'https://portal.example.com',
 *            username: 'max.muster',
 *            token: 'eyJ...'
 *        })
 *            │
 *            └─→ Extension verifiziert Token via /api/tabs
 *                └─→ Speichert in chrome.storage.sync
 *                    └─→ Popup öffnen → direkt eingeloggt ✅
 * ═══════════════════════════════════════════════════════════════════
 */
