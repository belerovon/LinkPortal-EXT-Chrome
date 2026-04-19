/* ═══════════════════════════════════════════
   LinkPortal Extension — popup.js  v1.3
   Basic Auth · i18n · Cache-first
   ═══════════════════════════════════════════ */

const MAX_INACTIVE_DAYS = 30;

let state = {
  baseUrl: '', token: '', username: '', lang: 'de',
  tabs: [], sections: {}, links: {},
  activeTab: null, allLinks: [], fromCache: false,
};

const $ = id => document.getElementById(id);

// ── Apply language to UI ──
function applyLang() {
  $('search-input').placeholder  = t('search_placeholder');
  $('loading-text').textContent  = t('loading');
  $('setup-title').textContent   = t('setup_title');
  $('setup-desc').textContent    = t('setup_desc');
  $('btn-open-settings').textContent = t('setup_btn');
  $('btn-logout-settings').textContent = t('logout_btn');
  $('error-title').textContent   = t('error_title');
  $('btn-retry').textContent     = t('retry');
  $('lang-select').value         = _lang;
  $('btn-refresh').title         = t('refresh');
  $('btn-settings').title        = t('settings');
}

function showScreen(name) {
  ['setup','loading','error','main','logout'].forEach(n =>
    $('screen-' + n).style.display = 'none');
  $('screen-' + name).style.display = 'flex';
}

async function doLogout(reason) {
  await chrome.storage.local.clear();
  await chrome.storage.sync.remove(['token', 'username']);
  const icon = $('logout-icon'), title = $('logout-title'), desc = $('logout-desc');
  if (reason === '403') {
    icon.textContent = t('logout_403_icon');
    title.textContent = t('logout_403_title');
    desc.textContent  = t('logout_403_desc');
  } else {
    icon.textContent = t('logout_exp_icon');
    title.textContent = t('logout_exp_title');
    desc.textContent  = t('logout_exp_desc');
  }
  showScreen('logout');
}

// ── Basic Auth ──
function makeAuth(username, token) {
  return 'Basic ' + btoa(unescape(encodeURIComponent(username + ':' + token)));
}

async function apiGet(path) {
  const res = await fetch(
    state.baseUrl.replace(/\/$/, '') + '/api' + path,
    { headers: { 'Authorization': makeAuth(state.username, state.token) } }
  );
  if (res.status === 403) throw Object.assign(new Error('403'), { status: 403 });
  if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.statusText);
  return res.json();
}

// ── Load portal logo ──
async function loadPortalLogo() {
  const base = state.baseUrl.replace(/\/$/, '');
  const logoEl = $('portal-logo'), defEl = $('default-icon');
  for (const ext of ['svg','png']) {
    try {
      const res = await fetch(base + '/img/logo.' + ext, { mode: 'cors' });
      if (res.ok) {
        logoEl.src = base + '/img/logo.' + ext;
        logoEl.style.display = '';
        defEl.style.display = 'none';
        if (ext === 'png') {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            try {
              const d = {};
              for (const sz of [16,48]) {
                const c = document.createElement('canvas');
                c.width = c.height = sz;
                c.getContext('2d').drawImage(img, 0, 0, sz, sz);
                d[sz] = c.getContext('2d').getImageData(0, 0, sz, sz);
              }
              chrome.action.setIcon({ imageData: d }).catch(() => {});
            } catch {}
          };
          img.src = base + '/img/logo.png';
        }
        return;
      }
    } catch {}
  }
}

// ── Fetch language from portal ──
async function fetchPortalLang() {
  try {
    const me = await apiGet('/auth/me');
    if (me.language && I18N[me.language]) {
      await chrome.storage.local.set({ lang: me.language });
      return me.language;
    }
  } catch {}
  return null;
}

// ── Fetch all data ──
async function fetchFromApi() {
  $('loading-text').textContent = t('loading');
  const tabs = await apiGet('/tabs');
  const sections = {}, links = {};
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    $('loading-text').textContent = t('loading_tab') + ' "' + tab.title + '"… (' + (i+1) + '/' + tabs.length + ')';
    const secs = await apiGet('/tabs/' + tab.id + '/sections');
    sections[tab.id] = secs;
    for (const sec of secs) {
      try { links[sec.id] = await apiGet('/sections/' + sec.id + '/links'); }
      catch (e) { if (e.status === 403) throw e; links[sec.id] = []; }
    }
  }
  const data = { tabs, sections, links, syncTime: Date.now() };
  await chrome.storage.local.set({ cache: data, cacheTime: Date.now() });
  return data;
}

function applyData(data) {
  state.tabs = data.tabs || [];
  state.sections = data.sections || {};
  state.links = data.links || {};
  state.allLinks = [];
  for (const tab of state.tabs)
    for (const sec of (state.sections[tab.id] || []))
      for (const link of (state.links[sec.id] || []))
        state.allLinks.push({ ...link, tabTitle: tab.title, tabIcon: tab.icon, tabId: tab.id,
          sectionTitle: sec.title, sectionIcon: sec.icon });
}

async function loadData(force = false) {
  showScreen('loading');
  $('cache-badge').style.display = 'none';

  // 30-day expiry
  if (!force) {
    const { cacheTime } = await chrome.storage.local.get(['cacheTime']);
    if (cacheTime && (Date.now() - cacheTime) / 86400000 >= MAX_INACTIVE_DAYS) {
      await doLogout('expired'); return;
    }
  }

  try {
    if (!force) {
      const { cache } = await chrome.storage.local.get(['cache']);
      if (cache) {
        applyData(cache);
        renderAll(); showScreen('main');
        $('cache-badge').style.display = '';
        $('cache-badge').title = t('cache_from') + ' ' + new Date(cache.syncTime).toLocaleString();
        bgRefresh(); return;
      }
    }
    applyData(await fetchFromApi());
    renderAll(); showScreen('main');
  } catch (err) {
    if (err.status === 403) { await doLogout('403'); return; }
    const { cache } = await chrome.storage.local.get(['cache']);
    if (cache) {
      applyData(cache); renderAll(); showScreen('main');
      $('cache-badge').style.display = '';
      $('cache-badge').title = t('cache_offline') + ' ' + new Date(cache.syncTime).toLocaleString();
    } else {
      $('error-message').textContent = err.message; showScreen('error');
    }
  }
}

async function bgRefresh() {
  try {
    applyData(await fetchFromApi());
    $('cache-badge').style.display = 'none';
    if (state.activeTab) renderTabContent(state.activeTab);
  } catch (e) { if (e.status === 403) await doLogout('403'); }
}

// ── Render ──
function renderAll() {
  if (!state.tabs.length) {
    $('tabs-nav').innerHTML = '';
    $('tab-content').innerHTML = '<div class="empty-tab"><div class="empty-icon">🔒</div><p>' + t('no_tabs') + '</p></div>';
    return;
  }
  if (!state.activeTab || !state.tabs.find(t2 => t2.id === state.activeTab))
    state.activeTab = state.tabs[0].id;
  renderTabs(); renderTabContent(state.activeTab);
}

function renderTabs() {
  const nav = $('tabs-nav');
  nav.innerHTML = '';
  for (const tab of state.tabs) {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (tab.id === state.activeTab ? ' active' : '');
    btn.innerHTML = (tab.icon ? '<span class="tab-icon">' + tab.icon + '</span>' : '') + '<span>' + esc(tab.title) + '</span>';
    btn.addEventListener('click', () => {
      state.activeTab = tab.id;
      nav.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      clearSearch(); renderTabContent(tab.id);
    });
    nav.appendChild(btn);
  }
}

function renderTabContent(tabId) {
  const content = $('tab-content');
  const secs = state.sections[tabId] || [];
  let html = '', has = false;
  for (let i = 0; i < secs.length; i++) {
    const sec = secs[i], lnks = state.links[sec.id] || [];
    if (!lnks.length) continue;
    has = true;
    if (i > 0) html += '<div class="section-divider"></div>';
    html += '<div class="section-block"><div class="section-header">' +
      (sec.icon ? '<span class="section-icon">' + sec.icon + '</span>' : '') +
      '<span class="section-title">' + esc(sec.title) + '</span>' +
      '<span class="section-count">' + lnks.length + '</span></div>' +
      lnks.map(l => linkHtml(l)).join('') + '</div>';
  }
  content.innerHTML = has ? html :
    '<div class="empty-tab"><div class="empty-icon">📭</div><p>' + t('no_links') + '</p></div>';
  bindLinks(content);
}

function linkHtml(link, hi = '') {
  const title = hi ? hilite(link.title || '', hi) : esc(link.title || '');
  const desc  = hi ? hilite(link.description || '', hi) : esc(link.description || '');
  return '<a class="link-item" data-url="' + esc(link.url) + '" href="#">' +
    favicon(link) +
    '<div class="link-info"><div class="link-title">' + title + '</div>' +
    (link.description ? '<div class="link-desc">' + desc + '</div>' : '') +
    '</div><button class="link-open-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
    '<polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>' +
    '</svg></button></a>';
}

function favicon(link) {
  const base = state.baseUrl.replace(/\/$/, '');
  const logo = link.logo_url || link.logo || '';
  if (logo) {
    if (logo.startsWith('http') || logo.startsWith('/')) {
      const src = logo.startsWith('/') ? base + logo : logo;
      return '<img class="link-favicon" src="' + esc(src) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
             '<div class="link-favicon-fallback" style="display:none">' + ini(link.title) + '</div>';
    }
    return '<div class="link-favicon-fallback" style="background:var(--bg3);font-size:15px">' + logo + '</div>';
  }
  try {
    const d = new URL(link.url).hostname;
    return '<img class="link-favicon" src="https://www.google.com/s2/favicons?domain=' + d + '&sz=32" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
           '<div class="link-favicon-fallback" style="display:none">' + ini(link.title) + '</div>';
  } catch { return '<div class="link-favicon-fallback">' + ini(link.title) + '</div>'; }
}

function bindLinks(container) {
  container.querySelectorAll('.link-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.link-open-btn')) return;
      e.preventDefault(); chrome.tabs.create({ url: el.dataset.url });
    });
    el.querySelector('.link-open-btn')?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation(); chrome.tabs.create({ url: el.dataset.url });
    });
  });
}

// ── Search ──
function performSearch(q) {
  q = q.trim().toLowerCase();
  const sr = $('search-results'), tc = $('tab-content'), tn = $('tabs-nav');
  if (!q) { sr.style.display='none'; tc.style.display=''; tn.style.display=''; return; }
  tc.style.display='none'; tn.style.display='none'; sr.style.display='';
  const m = state.allLinks.filter(l =>
    [l.title,l.description||'',l.url,l.tabTitle,l.sectionTitle].join(' ').toLowerCase().includes(q));
  const cnt = m.length;
  $('results-header').textContent = cnt + ' ' + (cnt===1 ? t('results_suffix_one') : t('results_suffix_many'));
  const list = $('results-list');
  if (!cnt) {
    list.innerHTML = '<div class="no-results"><div class="no-results-icon">🔍</div><span>' +
      t('no_results_prefix') + ' "' + esc(q) + '"</span></div>'; return;
  }
  list.innerHTML = m.map(link =>
    '<a class="link-item" data-url="' + esc(link.url) + '" href="#">' +
    favicon(link) +
    '<div class="link-info"><div class="link-title">' + hilite(link.title||'',q) + '</div>' +
    (link.description ? '<div class="link-desc">' + hilite(link.description,q) + '</div>' : '') +
    '<div class="result-breadcrumb"><span>' + esc(link.tabTitle) + '</span> › ' + esc(link.sectionTitle) + '</div>' +
    '</div><button class="link-open-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
    '<polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>' +
    '</svg></button></a>').join('');
  bindLinks(list);
}

function clearSearch() {
  $('search-input').value = ''; $('search-clear').style.display = 'none'; performSearch('');
}

// ── Lang change in popup ──
async function changeLang(code) {
  setLang(code);
  await chrome.storage.local.set({ lang: code });
  applyLang();
  // Sync to portal
  try {
    const base = state.baseUrl.replace(/\/$/, '');
    await fetch(base + '/api/settings', {
      method: 'PUT',
      headers: { 'Authorization': makeAuth(state.username, state.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: code })
    });
  } catch {}
}

// ── Helpers ──
function hilite(text, q) { return esc(text).replace(new RegExp('('+escRx(q)+')','gi'),'<mark>$1</mark>'); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
function ini(s) { return (s||'?').charAt(0).toUpperCase(); }

// ── Init ──
async function init() {
  // Check background-triggered logout
  const { logoutReason } = await chrome.storage.local.get(['logoutReason']);
  if (logoutReason) {
    await chrome.storage.local.remove(['logoutReason']);
    await doLogout(logoutReason); return;
  }

  const stored = await chrome.storage.sync.get(['baseUrl','token','username']);
  state.baseUrl  = stored.baseUrl  || '';
  state.token    = stored.token    || '';
  state.username = stored.username || '';

  // Load lang: local override → portal
  const { lang } = await chrome.storage.local.get(['lang']);
  const activeLang = lang || 'de';
  setLang(activeLang);
  applyLang();
  $('lang-select').value = activeLang;

  if (!state.baseUrl || !state.token || !state.username) { showScreen('setup'); return; }

  loadPortalLogo();
  await loadData();

  // Try to get lang from portal (after data loaded)
  const portalLang = await fetchPortalLang();
  if (portalLang && portalLang !== activeLang) {
    setLang(portalLang);
    await chrome.storage.local.set({ lang: portalLang });
    applyLang();
    $('lang-select').value = portalLang;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('btn-open-settings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-logout-settings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('btn-retry').addEventListener('click', () => loadData(true));
  $('btn-refresh').addEventListener('click', async () => {
    $('btn-refresh').classList.add('spinning');
    await loadData(true);
    $('btn-refresh').classList.remove('spinning');
  });

  const si = $('search-input'), sc = $('search-clear');
  let tm;
  si.addEventListener('input', () => {
    sc.style.display = si.value ? '' : 'none';
    clearTimeout(tm); tm = setTimeout(() => performSearch(si.value), 200);
  });
  sc.addEventListener('click', clearSearch);
  si.addEventListener('keydown', e => { if (e.key === 'Escape') clearSearch(); });

  $('lang-select').addEventListener('change', e => changeLang(e.target.value));

  init();
});
