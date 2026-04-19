/* ═════════════════════════════════════════════════
   LinkPortal Extension — options.js  v1.3
   Basic Auth · i18n · masked token · save guard
   ═════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);

let tokenSaved   = false;   // true after a successful save — token is masked
let testPassed   = false;   // true after successful connection test
let lastTestedUrl = '';
let lastTestedUser = '';
let lastTestedToken = '';

// ── Apply language labels ──
function applyLang() {
  $('opt-subtitle').textContent   = t('opt_title');
  $('lbl-connection').textContent = t('opt_connection');
  $('lbl-url').textContent        = t('opt_url_label');
  $('base-url').placeholder       = t('opt_url_placeholder');
  $('lbl-url-hint').textContent   = t('opt_url_hint');
  $('lbl-token').textContent      = t('opt_token_label');
  $('api-token').placeholder      = tokenSaved ? t('opt_token_placeholder') : 'eyJhbGciOiJIUzI1NiIs…';
  $('btn-edit-token').textContent = t('opt_token_edit') + ' ✏️';
  $('lbl-token-hint').textContent = t('opt_token_hint');
  $('lbl-user').textContent       = t('opt_user_label');
  $('username').placeholder       = t('opt_user_placeholder');
  $('lbl-user-hint').textContent  = t('opt_user_hint');
  $('lbl-test-title').textContent = t('opt_test_title');
  $('lbl-test-btn').textContent   = t('opt_test_btn');
  $('lbl-sync-title').textContent = t('opt_sync_title');
  $('lbl-last-sync').textContent  = t('opt_sync_last');
  $('lbl-auto-sync').textContent  = t('opt_sync_auto');
  $('lbl-auto-val').textContent   = t('opt_sync_auto_val');
  $('lbl-cached').textContent     = t('opt_sync_links');
  $('lbl-sync-now').textContent   = t('opt_sync_now');
  $('lbl-clear-cache').textContent= t('opt_cache_clear');
  $('lbl-lang-title').textContent = t('opt_lang_title');
  $('lbl-lang-label').textContent = t('opt_lang_label');
  $('lbl-lang-hint').textContent  = t('opt_lang_hint');
  $('lbl-info-title').textContent = t('opt_info_title');
  $('lbl-info-text').textContent  = t('opt_info_text');
  $('lbl-reset').textContent      = t('opt_reset');
  $('lbl-save').textContent       = t('opt_save');
}

// ── Enable/disable Save button ──
function updateSaveBtn() {
  const url   = $('base-url').value.trim();
  const user  = $('username').value.trim();
  const token = tokenSaved ? '(saved)' : $('api-token').value.trim();
  // Enable if test passed with current values, or if token is already saved (just minor field edits)
  const canSave = testPassed && url && user && token;
  $('btn-save').disabled = !canSave;
}

// ── Watch fields — reset testPassed if credentials changed ──
function watchFields() {
  ['base-url','username'].forEach(id => {
    $(id).addEventListener('input', () => {
      const urlChanged   = $('base-url').value.trim() !== lastTestedUrl;
      const userChanged  = $('username').value.trim() !== lastTestedUser;
      if (urlChanged || userChanged) { testPassed = false; }
      updateSaveBtn();
    });
  });
  $('api-token').addEventListener('input', () => {
    if (!tokenSaved) {
      const tokChanged = $('api-token').value.trim() !== lastTestedToken;
      if (tokChanged) { testPassed = false; }
    }
    updateSaveBtn();
  });
}

// ── Load settings ──
async function loadSettings() {
  const stored = await chrome.storage.sync.get(['baseUrl','token','username']);
  if (stored.baseUrl)  $('base-url').value = stored.baseUrl;
  if (stored.username) $('username').value  = stored.username;

  if (stored.token) {
    // Token exists → mask it
    tokenSaved = true;
    $('api-token').value = '••••••••••••••••••••••••';
    $('api-token').type  = 'password';
    $('api-token').readOnly = true;
    $('btn-edit-token').style.display = '';
    $('btn-toggle-token').style.display = 'none';
    // Already have valid creds → allow save without re-testing
    testPassed = true;
    lastTestedUrl   = stored.baseUrl || '';
    lastTestedUser  = stored.username || '';
    lastTestedToken = '(saved)';
  }

  updateSaveBtn();
  loadCacheInfo();
  if (stored.baseUrl) loadPortalLogo(stored.baseUrl);

  // Language
  const { lang } = await chrome.storage.local.get(['lang']);
  const activeLang = lang || 'de';
  setLang(activeLang);
  applyLang();
  $('lang-select-opts').value = activeLang;
}

// ── Portal logo ──
async function loadPortalLogo(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  const lo = $('portal-logo-opts'), de = $('default-icon-opts');
  for (const ext of ['svg','png']) {
    try {
      const res = await fetch(base + '/img/logo.' + ext, { mode: 'cors' });
      if (res.ok) { lo.src = base + '/img/logo.' + ext; lo.style.display=''; de.style.display='none'; return; }
    } catch {}
  }
}

// ── Cache info ──
async function loadCacheInfo() {
  const { cache } = await chrome.storage.local.get(['cache']);
  if (cache?.syncTime) {
    $('last-sync-time').textContent = new Date(cache.syncTime).toLocaleString();
    let total = 0;
    if (cache.links) for (const l of Object.values(cache.links)) total += (l||[]).length;
    $('cache-link-count').textContent = total + ' Links';
  } else {
    $('last-sync-time').textContent = t('opt_sync_never');
    $('cache-link-count').textContent = '0 Links';
  }
}

// ── Basic Auth helper ──
function makeBasicAuth(username, token) {
  return 'Basic ' + btoa(unescape(encodeURIComponent(username + ':' + token)));
}

// ── Test connection — tests ONLY the API, not a browser session ──
async function testConnection() {
  const baseUrl = $('base-url').value.trim().replace(/\/$/, '');
  // Use actual token value (or saved token from storage if masked)
  let token = tokenSaved ? '' : $('api-token').value.trim();
  const username = $('username').value.trim();
  const result = $('test-result');
  const btn    = $('btn-test');

  if (!baseUrl || !username) {
    showResult(result, 'error', '⚠ ' + t('opt_save_err_fields')); return;
  }
  if (!baseUrl.startsWith('https://')) {
    showResult(result, 'error', '⚠ ' + t('opt_save_err_https')); return;
  }

  // If token is masked, retrieve the real one from storage
  if (tokenSaved && !token) {
    const stored = await chrome.storage.sync.get(['token']);
    token = stored.token || '';
    if (!token) { showResult(result, 'error', '⚠ Kein Token gespeichert. Bitte Token eingeben.'); return; }
  }
  if (!token) { showResult(result, 'error', '⚠ ' + t('opt_save_err_fields')); return; }

  showResult(result, 'loading', t('test_loading'));
  btn.disabled = true;

  try {
    // ✅ Test via Basic Auth — NOT relying on browser session cookie
    const res = await fetch(baseUrl + '/api/tabs', {
      headers: {
        'Authorization': makeBasicAuth(username, token),
        'Cache-Control': 'no-cache'
      },
      credentials: 'omit'   // explicitly exclude browser cookies
    });

    if (res.status === 403) {
      testPassed = false;
      showResult(result, 'error', t('test_err_403'));
    } else if (res.status === 401) {
      testPassed = false;
      showResult(result, 'error', t('test_err_401'));
    } else if (res.ok) {
      const tabs = await res.json().catch(() => []);
      testPassed = true;
      lastTestedUrl   = baseUrl;
      lastTestedUser  = username;
      lastTestedToken = tokenSaved ? '(saved)' : token;

      // Also fetch /auth/me to show user info
      let userHtml = '';
      try {
        const me = await fetch(baseUrl + '/api/auth/me', {
          headers: { 'Authorization': makeBasicAuth(username, token) },
          credentials: 'omit'
        });
        if (me.ok) {
          const m = await me.json();
          userHtml = '<br><small>👤 <strong>' + esc(String(m.username||username)) + '</strong>' +
            (m.is_admin ? ' &nbsp;·&nbsp; 🛡 Admin' : '') +
            (m.groups?.length ? '<br>Gruppen: ' + m.groups.join(', ') : '') + '</small>';
          // Auto-fill username if empty
          if (m.username && !$('username').value.trim()) {
            $('username').value = m.username;
            userHtml += '<br><small>' + t('test_auto_user') + '</small>';
          }
        }
      } catch {}

      showResult(result, 'success',
        t('test_ok') + userHtml +
        '<br><small>📂 ' + tabs.length + ' ' + t('test_tabs') + '</small>');
    } else {
      testPassed = false;
      showResult(result, 'error', t('test_err_http') + ' ' + res.status);
    }
  } catch (err) {
    testPassed = false;
    showResult(result, 'error', '❌ ' + esc(err.message));
  }

  btn.disabled = false;
  updateSaveBtn();
}

// ── Save ──
async function saveSettings() {
  const baseUrl  = $('base-url').value.trim().replace(/\/$/, '');
  const username = $('username').value.trim();

  if (!baseUrl || !username) { showStatus(t('opt_save_err_fields'), 'error'); return; }
  if (!baseUrl.startsWith('https://')) { showStatus(t('opt_save_err_https'), 'error'); return; }
  if (!testPassed) { showStatus(t('opt_save_err_test'), 'error'); return; }

  // Get token (real value or stored)
  let token = tokenSaved ? '' : $('api-token').value.trim();
  if (tokenSaved && !token) {
    const stored = await chrome.storage.sync.get(['token']);
    token = stored.token || '';
  }
  if (!token) { showStatus('⚠ Kein Token — bitte eingeben', 'error'); return; }

  await chrome.storage.sync.set({ baseUrl, token, username });

  // Mask token after save
  tokenSaved = true;
  $('api-token').value = '••••••••••••••••••••••••';
  $('api-token').type = 'password';
  $('api-token').readOnly = true;
  $('btn-edit-token').style.display = '';
  $('btn-toggle-token').style.display = 'none';

  loadPortalLogo(baseUrl);
  showStatus(t('opt_save_ok'), 'success');
  updateSaveBtn();
}

// ── Reset — FIX: properly clear everything ──
async function resetSettings() {
  if (!confirm(t('confirm_reset'))) return;

  // Clear all storage
  await chrome.storage.sync.clear();
  await chrome.storage.local.clear();

  // Reset UI
  $('base-url').value  = '';
  $('username').value  = '';
  $('api-token').value = '';
  $('api-token').readOnly = false;
  $('api-token').type  = 'password';
  $('btn-edit-token').style.display  = 'none';
  $('btn-toggle-token').style.display = '';
  $('portal-logo-opts').style.display = 'none';
  $('default-icon-opts').style.display = '';

  // Reset state
  tokenSaved    = false;
  testPassed    = false;
  lastTestedUrl = '';
  lastTestedUser= '';
  lastTestedToken = '';

  // Reset test/sync result panels
  $('test-result').style.display  = 'none';
  $('sync-result').style.display  = 'none';

  loadCacheInfo();
  updateSaveBtn();
  showStatus(t('opt_reset_ok'), 'success');
}

// ── Edit token (un-mask) ──
function editToken() {
  tokenSaved = false;
  $('api-token').value = '';
  $('api-token').readOnly = false;
  $('api-token').type  = 'password';
  $('api-token').placeholder = 'eyJhbGciOiJIUzI1NiIs…';
  $('btn-edit-token').style.display   = 'none';
  $('btn-toggle-token').style.display = '';
  testPassed = false;
  updateSaveBtn();
  $('api-token').focus();
}

// ── Toggle visibility ──
function toggleToken() {
  if ($('api-token').readOnly) return;
  const show = $('api-token').type === 'password';
  $('api-token').type = show ? 'text' : 'password';
  $('eye-icon').innerHTML = show
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}

// ── Sync now ──
async function syncNow() {
  const stored = await chrome.storage.sync.get(['baseUrl','token','username']);
  if (!stored.baseUrl || !stored.token) {
    showResult($('sync-result'), 'error', t('sync_err_save')); return;
  }
  const btn = $('btn-sync-now');
  showResult($('sync-result'), 'loading', t('sync_loading'));
  btn.disabled = true;
  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'fetchAndCache', baseUrl: stored.baseUrl, token: stored.token, username: stored.username
    });
    if (resp?.ok) {
      await loadCacheInfo();
      showResult($('sync-result'), 'success', t('sync_ok') + ' ' + new Date().toLocaleTimeString());
    } else {
      showResult($('sync-result'), 'error', '❌ ' + esc(resp?.error||'Fehler'));
    }
  } catch (err) {
    showResult($('sync-result'), 'error', '❌ ' + esc(err.message));
  }
  btn.disabled = false;
}

// ── Clear cache ──
async function clearCache() {
  if (!confirm(t('confirm_cache'))) return;
  await chrome.storage.local.remove(['cache','cacheTime']);
  loadCacheInfo();
  showResult($('sync-result'), 'success', t('cache_cleared'));
}

// ── Lang change ──
async function changeLang(code) {
  setLang(code);
  await chrome.storage.local.set({ lang: code });
  applyLang();

  // Sync to portal
  const stored = await chrome.storage.sync.get(['baseUrl','token','username']);
  if (stored.baseUrl && stored.token && stored.username) {
    try {
      await fetch(stored.baseUrl.replace(/\//,'') + '/api/settings', {
        method: 'PUT',
        headers: {
          'Authorization': makeBasicAuth(stored.username, stored.token),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ language: code }),
        credentials: 'omit'
      });
      showResult($('sync-result'), 'success', t('lang_synced'));
    } catch {}
  }
}

function makeBasicAuth(u, t2) {
  return 'Basic ' + btoa(unescape(encodeURIComponent(u + ':' + t2)));
}

function showStatus(msg, type) {
  const s = $('save-status');
  s.textContent = msg; s.className = 'save-status ' + type;
  setTimeout(() => { s.textContent=''; s.className='save-status'; }, 3000);
}
function showResult(el, type, html) {
  el.style.display=''; el.className='test-result '+type; el.innerHTML=html;
}
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  watchFields();
  $('btn-save').addEventListener('click', saveSettings);
  $('btn-reset').addEventListener('click', resetSettings);
  $('btn-test').addEventListener('click', testConnection);
  $('btn-edit-token').addEventListener('click', editToken);
  $('btn-toggle-token').addEventListener('click', toggleToken);
  $('btn-sync-now').addEventListener('click', syncNow);
  $('btn-clear-cache').addEventListener('click', clearCache);
  $('lang-select-opts').addEventListener('change', e => changeLang(e.target.value));
  $('base-url').addEventListener('blur', () => {
    const u = $('base-url').value.trim();
    if (u.startsWith('https://')) loadPortalLogo(u);
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); if (!$('btn-save').disabled) saveSettings(); }
  });
});
