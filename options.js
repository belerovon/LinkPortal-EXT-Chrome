/* ═══════════════════════════════════════════════
   LinkPortal Chrome Extension — options.js
   ═══════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

async function loadSettings() {
  const stored = await chrome.storage.sync.get(['baseUrl', 'token', 'username']);
  if (stored.baseUrl)  $('base-url').value  = stored.baseUrl;
  if (stored.token)    $('api-token').value  = stored.token;
  if (stored.username) $('username').value   = stored.username;
  loadCacheInfo();
  if (stored.baseUrl) loadPortalLogo(stored.baseUrl);
}

// ── Load portal logo in header ──
async function loadPortalLogo(baseUrl) {
  if (!baseUrl) return;
  const base = baseUrl.replace(/\/$/, '');
  const logoEl    = $('portal-logo-opts');
  const defaultEl = $('default-icon-opts');
  for (const ext of ['svg', 'png']) {
    try {
      const url = `${base}/img/logo.${ext}`;
      const res = await fetch(url, { mode: 'cors' });
      if (res.ok) {
        logoEl.src = url;
        logoEl.style.display = '';
        defaultEl.style.display = 'none';
        return;
      }
    } catch {}
  }
}

async function loadCacheInfo() {
  const stored = await chrome.storage.local.get(['cache']);
  const cache = stored.cache;
  if (cache?.syncTime) {
    $('last-sync-time').textContent = new Date(cache.syncTime).toLocaleString('de');
    let total = 0;
    if (cache.links) for (const lnks of Object.values(cache.links)) total += (lnks||[]).length;
    $('cache-link-count').textContent = `${total} Links`;
  } else {
    $('last-sync-time').textContent = 'Noch nie';
    $('cache-link-count').textContent = '0 Links';
  }
}

async function saveSettings() {
  const baseUrl  = $('base-url').value.trim().replace(/\/$/, '');
  const token    = $('api-token').value.trim();
  const username = $('username').value.trim();

  if (!baseUrl || !token) {
    showStatus('⚠ URL und Token sind Pflichtfelder', 'error');
    return;
  }
  if (!baseUrl.startsWith('https://')) {
    showStatus('⚠ URL muss mit https:// beginnen', 'error');
    return;
  }

  await chrome.storage.sync.set({ baseUrl, token, username });
  loadPortalLogo(baseUrl);
  showStatus('✓ Gespeichert', 'success');
}

async function resetSettings() {
  if (!confirm('Alle Einstellungen und Cache zurücksetzen?')) return;
  await chrome.storage.sync.clear();
  await chrome.storage.local.clear();
  $('base-url').value  = '';
  $('api-token').value = '';
  $('username').value  = '';
  $('portal-logo-opts').style.display = 'none';
  $('default-icon-opts').style.display = '';
  loadCacheInfo();
  showStatus('✓ Zurückgesetzt', 'success');
}

async function testConnection() {
  const baseUrl = $('base-url').value.trim().replace(/\/$/, '');
  const token   = $('api-token').value.trim();
  const result  = $('test-result');
  const btn     = $('btn-test');

  if (!baseUrl || !token) { showResult(result, 'error', '⚠ Bitte URL und Token eingeben'); return; }
  if (!baseUrl.startsWith('https://')) { showResult(result, 'error', '⚠ URL muss mit https:// beginnen'); return; }

  showResult(result, 'loading', '⏳ Verbindung wird getestet…');
  btn.disabled = true;

  try {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (res.status === 403) {
      showResult(result, 'error', '❌ 403 – Kein Zugriff. Der Token ist ungültig oder hat keine API-Berechtigung.<br><small>Hinweis: Bei einem 403-Fehler wird die Extension automatisch ausgeloggt.</small>');
    } else if (res.status === 401) {
      showResult(result, 'error', '❌ 401 – Ungültiger oder abgelaufener Token');
    } else if (res.ok) {
      const me = await res.json().catch(() => ({}));
      const uid = me.sub || me.id || $('user-id').value || '?';
      let html = `✅ Verbindung erfolgreich!<br>
        <small>👤 <strong>${escHtml(String(me.username||'?'))}</strong>
        &nbsp;·&nbsp; ID: <strong>${escHtml(String(uid))}</strong>
        ${me.is_admin ? ' &nbsp;·&nbsp; 🛡 Admin' : ''}
        ${me.groups?.length ? `<br>Gruppen: ${me.groups.join(', ')}` : ''}
        </small>`;
      if (me.username && !$('username').value.trim()) {
        $('username').value = me.username;
        html += `<br><small>💡 Benutzername automatisch eingetragen</small>`;
      }
      try {
        const tabsRes = await fetch(`${baseUrl}/api/tabs`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (tabsRes.ok) {
          const tabs = await tabsRes.json();
          html += `<br><small>📂 ${tabs.length} Tab${tabs.length !== 1 ? 's' : ''} verfügbar</small>`;
        }
      } catch {}
      showResult(result, 'success', html);
    } else {
      showResult(result, 'error', `❌ HTTP ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    showResult(result, 'error', `❌ ${escHtml(err.message)}`);
  }
  btn.disabled = false;
}

async function syncNow() {
  const baseUrl = $('base-url').value.trim().replace(/\/$/, '');
  const token   = $('api-token').value.trim();
  const result  = $('sync-result');
  const btn     = $('btn-sync-now');

  if (!baseUrl || !token) { showResult(result, 'error', '⚠ Zuerst speichern'); return; }

  showResult(result, 'loading', '⏳ Synchronisation läuft…');
  btn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ action: 'fetchAndCache', baseUrl, token });
    if (response?.ok) {
      await loadCacheInfo();
      showResult(result, 'success', `✅ Synchronisiert um ${new Date().toLocaleTimeString('de')}`);
    } else if (response?.error?.includes('403')) {
      showResult(result, 'error', '❌ 403 – Token ungültig. Extension wird ausgeloggt.');
    } else {
      showResult(result, 'error', `❌ ${escHtml(response?.error || 'Unbekannter Fehler')}`);
    }
  } catch (err) {
    showResult(result, 'error', `❌ ${escHtml(err.message)}`);
  }
  btn.disabled = false;
}

async function clearCache() {
  if (!confirm('Cache leeren?')) return;
  await chrome.storage.local.remove(['cache', 'cacheTime']);
  loadCacheInfo();
  showResult($('sync-result'), 'success', '✅ Cache geleert');
}

function showStatus(msg, type) {
  const s = $('save-status');
  s.textContent = msg;
  s.className = `save-status ${type}`;
  setTimeout(() => { s.textContent = ''; s.className = 'save-status'; }, 3000);
}

function showResult(el, type, html) {
  el.style.display = '';
  el.className = `test-result ${type}`;
  el.innerHTML = html;
}

function toggleToken() {
  const input = $('api-token'), icon = $('eye-icon');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  icon.innerHTML = show
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  $('btn-save').addEventListener('click', saveSettings);
  $('btn-reset').addEventListener('click', resetSettings);
  $('btn-test').addEventListener('click', testConnection);
  $('btn-sync-now').addEventListener('click', syncNow);
  $('btn-clear-cache').addEventListener('click', clearCache);
  $('btn-toggle-token').addEventListener('click', toggleToken);
  // Live logo preview when URL changes
  $('base-url').addEventListener('blur', () => {
    const url = $('base-url').value.trim();
    if (url.startsWith('https://')) loadPortalLogo(url);
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveSettings(); }
  });
});
