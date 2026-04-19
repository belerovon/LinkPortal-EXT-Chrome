/* ═══════════════════════════════════════════════
   LinkPortal Chrome Extension — popup.js
   ═══════════════════════════════════════════════ */

const MAX_INACTIVE_DAYS = 30;

let state = {
  baseUrl: '', token: '', username: '',
  tabs: [], sections: {}, links: {},
  activeTab: null, allLinks: [], fromCache: false,
};

const $ = id => document.getElementById(id);

// ── Show Screen ──
function showScreen(name) {
  ['setup','loading','error','main','logout'].forEach(n =>
    $(`screen-${n}`).style.display = 'none'
  );
  $(`screen-${name}`).style.display = 'flex';
}

// ── Logout: clear credentials ──
async function doLogout(reason) {
  await chrome.storage.local.clear();
  await chrome.storage.sync.remove(['token', 'username']);

  const icon  = $('logout-icon');
  const title = $('logout-title');
  const desc  = $('logout-desc');

  if (reason === '403') {
    icon.textContent  = '🚫';
    title.textContent = 'Zugriff verweigert';
    desc.textContent  = 'Dein API-Token ist ungültig oder wurde widerrufen. Bitte generiere einen neuen Token im LinkPortal.';
  } else if (reason === 'expired') {
    icon.textContent  = '⏰';
    title.textContent = 'Automatisch abgemeldet';
    desc.textContent  = `Du wurdest nach ${MAX_INACTIVE_DAYS} Tagen ohne Sync automatisch abgemeldet. Bitte konfiguriere die Extension neu.`;
  } else {
    icon.textContent  = '🔒';
    title.textContent = 'Session abgelaufen';
    desc.textContent  = 'Bitte konfiguriere die Extension neu.';
  }
  showScreen('logout');
}

// ── Load Portal Logo ──
async function loadPortalLogo(baseUrl) {
  if (!baseUrl) return;
  const base = baseUrl.replace(/\/$/, '');
  const logoEl   = $('portal-logo');
  const defaultEl= $('default-icon');

  // Try SVG first, then PNG
  for (const ext of ['svg', 'png']) {
    try {
      const url = `${base}/img/logo.${ext}`;
      const res = await fetch(url, { mode: 'cors' });
      if (res.ok) {
        logoEl.src = url;
        logoEl.style.display = '';
        defaultEl.style.display = 'none';

        // Also set as Chrome extension icon dynamically
        if (ext === 'png') {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            try {
              const sizes = [16, 48];
              const iconData = {};
              for (const sz of sizes) {
                const c = document.createElement('canvas');
                c.width = c.height = sz;
                c.getContext('2d').drawImage(img, 0, 0, sz, sz);
                iconData[sz] = c.getContext('2d').getImageData(0, 0, sz, sz);
              }
              chrome.action.setIcon({ imageData: iconData }).catch(() => {});
            } catch {}
          };
          img.src = url;
        }
        return;
      }
    } catch {}
  }
}

// ── API ──
async function apiGet(path) {
  const res = await fetch(
    state.baseUrl.replace(/\/$/, '') + '/api' + path,
    { headers: { 'Authorization': `Bearer ${state.token}` } }
  );
  if (res.status === 403) throw Object.assign(new Error('403 Forbidden'), { status: 403 });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Fetch from API ──
async function fetchFromApi() {
  $('loading-text').textContent = 'Tabs werden geladen…';
  const tabs = await apiGet('/tabs');
  const sections = {}, links = {};

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    $('loading-text').textContent = `Lade Tab „${tab.title}"… (${i+1}/${tabs.length})`;
    const secs = await apiGet(`/tabs/${tab.id}/sections`);
    sections[tab.id] = secs;
    for (const sec of secs) {
      try {
        const lnks = await apiGet(`/sections/${sec.id}/links`);
        links[sec.id] = lnks;
      } catch (e) {
        if (e.status === 403) throw e;
        links[sec.id] = [];
      }
    }
  }

  const data = { tabs, sections, links, syncTime: Date.now() };
  await chrome.storage.local.set({ cache: data, cacheTime: Date.now() });
  return data;
}

// ── Load from cache ──
async function loadFromCache() {
  const { cache } = await chrome.storage.local.get(['cache']);
  return cache || null;
}

// ── Apply data to state ──
function applyData(data, fromCache) {
  state.tabs = data.tabs || [];
  state.sections = data.sections || {};
  state.links = data.links || {};
  state.fromCache = fromCache;
  state.allLinks = [];
  for (const tab of state.tabs) {
    for (const sec of (state.sections[tab.id] || [])) {
      for (const link of (state.links[sec.id] || [])) {
        state.allLinks.push({
          ...link, tabTitle: tab.title, tabIcon: tab.icon,
          tabId: tab.id, sectionTitle: sec.title, sectionIcon: sec.icon,
        });
      }
    }
  }
}

// ── Check 30-day expiry ──
async function check30DayExpiry() {
  const { cacheTime } = await chrome.storage.local.get(['cacheTime']);
  if (!cacheTime) return false;
  const days = (Date.now() - cacheTime) / (1000 * 60 * 60 * 24);
  return days >= MAX_INACTIVE_DAYS;
}

// ── Main Load ──
async function loadData(forceRefresh = false) {
  showScreen('loading');
  $('cache-badge').style.display = 'none';

  // Check expiry before anything
  if (!forceRefresh && await check30DayExpiry()) {
    await doLogout('expired');
    return;
  }

  try {
    if (!forceRefresh) {
      const cached = await loadFromCache();
      if (cached) {
        applyData(cached, true);
        renderAll();
        showScreen('main');
        $('cache-badge').style.display = '';
        $('cache-badge').title = `Cache vom ${new Date(cached.syncTime).toLocaleString('de')}`;
        refreshBackground(); // silent refresh
        return;
      }
    }
    const data = await fetchFromApi();
    applyData(data, false);
    renderAll();
    showScreen('main');
  } catch (err) {
    if (err.status === 403 || err.message.includes('403')) {
      await doLogout('403');
      return;
    }
    // Fallback to cache on error
    const cached = await loadFromCache();
    if (cached) {
      applyData(cached, true);
      renderAll();
      showScreen('main');
      $('cache-badge').style.display = '';
      $('cache-badge').title = `⚠ Offline – Cache vom ${new Date(cached.syncTime).toLocaleString('de')}`;
    } else {
      $('error-message').textContent = err.message;
      showScreen('error');
    }
  }
}

// ── Silent background refresh ──
async function refreshBackground() {
  try {
    const data = await fetchFromApi();
    applyData(data, false);
    $('cache-badge').style.display = 'none';
    if (state.activeTab) renderTabContent(state.activeTab);
  } catch (e) {
    if (e.status === 403) await doLogout('403');
  }
}

// ── Render ──
function renderAll() {
  if (!state.tabs.length) {
    $('tabs-nav').innerHTML = '';
    $('tab-content').innerHTML = `<div class="empty-tab"><div class="empty-icon">🔒</div><p>Keine Tabs verfügbar.</p></div>`;
    return;
  }
  if (!state.activeTab || !state.tabs.find(t => t.id === state.activeTab)) {
    state.activeTab = state.tabs[0].id;
  }
  renderTabs();
  renderTabContent(state.activeTab);
}

function renderTabs() {
  const nav = $('tabs-nav');
  nav.innerHTML = '';
  for (const tab of state.tabs) {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (tab.id === state.activeTab ? ' active' : '');
    btn.innerHTML = `${tab.icon ? `<span class="tab-icon">${tab.icon}</span>` : ''}<span>${escHtml(tab.title)}</span>`;
    btn.addEventListener('click', () => {
      state.activeTab = tab.id;
      nav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      clearSearch();
      renderTabContent(tab.id);
    });
    nav.appendChild(btn);
  }
}

function renderTabContent(tabId) {
  const content = $('tab-content');
  const secs = state.sections[tabId] || [];
  let html = '', hasLinks = false;

  for (let i = 0; i < secs.length; i++) {
    const sec = secs[i];
    const lnks = state.links[sec.id] || [];
    if (!lnks.length) continue;
    hasLinks = true;
    if (i > 0) html += `<div class="section-divider"></div>`;
    html += `
      <div class="section-block">
        <div class="section-header">
          ${sec.icon ? `<span class="section-icon">${sec.icon}</span>` : ''}
          <span class="section-title">${escHtml(sec.title)}</span>
          <span class="section-count">${lnks.length}</span>
        </div>
        ${lnks.map(l => renderLinkItem(l)).join('')}
      </div>`;
  }

  content.innerHTML = hasLinks
    ? html
    : `<div class="empty-tab"><div class="empty-icon">📭</div><p>Keine Links in diesem Tab.</p></div>`;
  attachLinkListeners(content);
}

function renderLinkItem(link, highlight = '') {
  const title = highlight ? highlightText(link.title || '', highlight) : escHtml(link.title || '');
  const desc  = highlight ? highlightText(link.description || '', highlight) : escHtml(link.description || '');
  return `
    <a class="link-item" data-url="${escHtml(link.url)}" href="#">
      ${buildFaviconHtml(link)}
      <div class="link-info">
        <div class="link-title">${title}</div>
        ${link.description ? `<div class="link-desc">${desc}</div>` : ''}
      </div>
      <button class="link-open-btn" title="In neuem Tab öffnen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </button>
    </a>`;
}

function buildFaviconHtml(link) {
  const base = state.baseUrl.replace(/\/$/, '');
  const logo = link.logo_url || link.logo || '';
  if (logo) {
    if (logo.startsWith('http') || logo.startsWith('/')) {
      const src = logo.startsWith('/') ? base + logo : logo;
      return `<img class="link-favicon" src="${escHtml(src)}" alt=""
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
              <div class="link-favicon-fallback" style="display:none">${getInitial(link.title)}</div>`;
    }
    return `<div class="link-favicon-fallback" style="background:var(--bg3);font-size:15px">${logo}</div>`;
  }
  try {
    const domain = new URL(link.url).hostname;
    return `<img class="link-favicon" src="https://www.google.com/s2/favicons?domain=${domain}&sz=32" alt=""
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="link-favicon-fallback" style="display:none">${getInitial(link.title)}</div>`;
  } catch {
    return `<div class="link-favicon-fallback">${getInitial(link.title)}</div>`;
  }
}

function attachLinkListeners(container) {
  container.querySelectorAll('.link-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.link-open-btn')) return;
      e.preventDefault();
      chrome.tabs.create({ url: el.dataset.url });
    });
    el.querySelector('.link-open-btn')?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      chrome.tabs.create({ url: el.dataset.url });
    });
  });
}

// ── Search ──
function performSearch(query) {
  const q = query.trim().toLowerCase();
  const sr = $('search-results'), tc = $('tab-content'), tn = $('tabs-nav');
  if (!q) {
    sr.style.display = 'none'; tc.style.display = ''; tn.style.display = '';
    return;
  }
  tc.style.display = 'none'; tn.style.display = 'none'; sr.style.display = '';
  const matches = state.allLinks.filter(l =>
    [l.title, l.description||'', l.url, l.tabTitle, l.sectionTitle].join(' ').toLowerCase().includes(q)
  );
  $('results-header').textContent = `${matches.length} Ergebnis${matches.length !== 1 ? 'se' : ''}`;
  const list = $('results-list');
  if (!matches.length) {
    list.innerHTML = `<div class="no-results"><div class="no-results-icon">🔍</div><span>Keine Links für „${escHtml(query)}"</span></div>`;
    return;
  }
  list.innerHTML = matches.map(link => `
    <a class="link-item" data-url="${escHtml(link.url)}" href="#">
      ${buildFaviconHtml(link)}
      <div class="link-info">
        <div class="link-title">${highlightText(link.title||'', q)}</div>
        ${link.description ? `<div class="link-desc">${highlightText(link.description, q)}</div>` : ''}
        <div class="result-breadcrumb"><span>${escHtml(link.tabTitle)}</span> › ${escHtml(link.sectionTitle)}</div>
      </div>
      <button class="link-open-btn" title="In neuem Tab öffnen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </button>
    </a>`).join('');
  attachLinkListeners(list);
}

function clearSearch() {
  $('search-input').value = '';
  $('search-clear').style.display = 'none';
  performSearch('');
}

// ── Helpers ──
function highlightText(text, q) {
  return escHtml(text).replace(new RegExp(`(${escRegex(q)})`, 'gi'), '<mark>$1</mark>');
}
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function getInitial(t) { return (t||'?').charAt(0).toUpperCase(); }

// ── Init ──
async function init() {
  // Check if background triggered logout
  const { logoutReason } = await chrome.storage.local.get(['logoutReason']);
  if (logoutReason) {
    await chrome.storage.local.remove(['logoutReason']);
    await doLogout(logoutReason);
    return;
  }

  const stored = await chrome.storage.sync.get(['baseUrl', 'token', 'username']);
  state.baseUrl  = stored.baseUrl  || '';
  state.token    = stored.token    || '';
  state.username = stored.username || '';

  if (!state.baseUrl || !state.token) { showScreen('setup'); return; }

  // Load portal logo in parallel
  loadPortalLogo(state.baseUrl);

  await loadData();
}

// ── Events ──
document.addEventListener('DOMContentLoaded', () => {
  $('btn-open-settings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-logout-settings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-retry').addEventListener('click', () => loadData(true));
  $('btn-refresh').addEventListener('click', async () => {
    const btn = $('btn-refresh');
    btn.classList.add('spinning');
    await loadData(true);
    btn.classList.remove('spinning');
  });

  const si = $('search-input'), sc = $('search-clear');
  let t;
  si.addEventListener('input', () => {
    sc.style.display = si.value ? '' : 'none';
    clearTimeout(t);
    t = setTimeout(() => performSearch(si.value), 200);
  });
  sc.addEventListener('click', clearSearch);
  si.addEventListener('keydown', e => { if (e.key === 'Escape') clearSearch(); });

  init();
});
