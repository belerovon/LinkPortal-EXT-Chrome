/* ═══════════════════════════════════════════════════════════
   LinkPortal Extension — popup.js  v1.5.0
   ═══════════════════════════════════════════════════════════ */

const VERSION = '1.5.0';
const MAX_INACTIVE_DAYS = 30;

const S = {
  baseUrl:'', token:'', username:'', lang:'en',
  theme:'auto',
  tabs:[], sections:{}, links:{}, perms:{},
  portalTitle:'LinkPortal',
  activeTab:null, allLinks:[],
  tokenSaved:false, testPassed:false,
  lastTestedUrl:'', lastTestedUser:'', lastTestedToken:'',
  // DnD state
  dragSrcId:null, dragSrcSecId:null,
};

const $ = id => document.getElementById(id);
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const ini = s => (s||'?').charAt(0).toUpperCase();
const mkAuth = (u,t) => 'Basic ' + btoa(unescape(encodeURIComponent((u||'')+':'+(t||''))));
const apiUrl = p => S.baseUrl.replace(/\/$/,'')+'/api'+p;

// ── Theme ──
function applyTheme(theme) {
  S.theme = theme || 'auto';
  document.documentElement.dataset.theme = S.theme;
  // Update settings panel buttons
  document.querySelectorAll('.theme-btn-lg').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === S.theme));
}

async function changeTheme(theme) {
  applyTheme(theme);
  await chrome.storage.local.set({ theme });
}

// ── Language ──
function applyLang() {
  const ver = 'v'+VERSION;
  try {
    $('search-input').placeholder   = t('search_placeholder');
    $('loading-text').textContent    = t('loading');
    $('setup-title').textContent     = t('setup_title');
    $('setup-desc').textContent      = t('setup_desc');
    $('btn-open-settings').textContent = t('setup_btn');
    $('btn-logout-settings').textContent = t('logout_btn');
    $('error-title').textContent     = t('error_title');
    $('btn-retry').textContent       = t('retry');
    $('btn-refresh').title           = t('refresh');
    $('dd-lbl-portal').textContent   = t('open_portal');
    $('dd-lbl-settings').textContent = t('menu_settings');
    $('dd-version').textContent      = ver;
    $('dd-lang-sel').value           = _lang;
    // Settings — theme
    $('s-lbl-theme-title').textContent  = t('menu_theme')||'Design';
    $('s-lbl-theme-light').textContent  = t('theme_light')||'Hell';
    $('s-lbl-theme-auto').textContent   = t('theme_auto')||'Auto';
    $('s-lbl-theme-dark').textContent   = t('theme_dark')||'Dunkel';
    // Settings
    $('s-title-lbl').textContent     = t('settings_title');
    $('s-lbl-conn').textContent      = t('lbl_connection');
    $('s-lbl-url').textContent       = t('lbl_url');
    $('s-base-url').placeholder      = 'https://portal.example.com';
    $('s-hint-url').textContent      = t('lbl_url_hint');
    $('s-lbl-user').textContent      = t('lbl_user');
    $('s-hint-user').textContent     = t('lbl_user_hint');
    $('s-lbl-token').textContent     = t('lbl_token');
    $('s-hint-token').textContent    = t('lbl_token_hint');
    $('s-lbl-test-title').textContent= t('lbl_test');
    $('s-lbl-test-btn').textContent  = t('btn_test');
    $('s-lbl-sync-title').textContent= t('lbl_sync_section');
    $('s-lbl-last-sync').textContent = t('lbl_last_sync');
    $('s-lbl-auto').textContent      = t('lbl_auto_sync');
    $('s-auto-val').textContent      = t('lbl_auto_val');
    $('s-lbl-cached').textContent    = t('lbl_cached');
    $('s-lbl-sync-now').textContent  = t('btn_sync_now');
    $('s-lbl-clear').textContent     = t('btn_clear_cache');
    $('s-lbl-lang-title').textContent= t('lbl_lang');
    $('s-lbl-lang-sel').textContent  = t('lbl_lang_select');
    $('s-hint-lang').textContent     = t('lbl_lang_hint');
    $('s-lbl-reset').textContent     = t('btn_reset');
    $('s-lbl-save').textContent      = t('btn_save');
    $('s-lang').value                = _lang;
    // Dialog
    $('dlg-lbl-url').textContent     = t('lbl_link_url');
    $('dlg-btn-current').textContent = t('btn_use_current');
    $('dlg-lbl-title').textContent   = t('lbl_link_title');
    $('dlg-lbl-desc').textContent    = t('lbl_link_desc');
    $('dlg-lbl-logo').textContent    = t('lbl_link_logo');
    $('dlg-lbl-sec').textContent     = t('lbl_link_section');
    $('dlg-lbl-cancel').textContent  = t('btn_cancel');
    $('dlg-lbl-save').textContent    = t('btn_save_link');
    // Tab add button
    if($('tab-add-btn')) $('tab-add-btn').textContent = t('btn_add_link');
  } catch(e) { console.warn('applyLang error:', e); }
}

// ── Show screen ──
function showScreen(name) {
  ['logout','setup','loading','error','main','settings'].forEach(n => {
    const el = $('screen-'+n); if(el) el.style.display = 'none';
  });
  const el = $('screen-'+name); if(el) el.style.display = 'flex';
  // Hide search bar in settings
  const sw = $('search-wrap');
  if(sw) sw.style.display = (name === 'settings') ? 'none' : '';
}

// ── Logout — keeps URL and username, only removes token ──
async function doLogout(reason) {
  await chrome.storage.local.remove(['cache','cacheTime']);
  await chrome.storage.sync.remove(['token']); // ← only token!
  S.token = ''; S.tokenSaved = false; S.testPassed = false;
  $('logout-icon').textContent  = reason==='403' ? t('logout_403_icon')  : t('logout_exp_icon');
  $('logout-title').textContent = reason==='403' ? t('logout_403_title') : t('logout_exp_title');
  $('logout-desc').textContent  = reason==='403' ? t('logout_403_desc')  : t('logout_exp_desc');
  showScreen('logout');
}

// ── API ──
async function apiFetch(method, path, body) {
  const opts = {
    method, credentials:'omit',
    headers:{'Authorization':mkAuth(S.username,S.token),'Content-Type':'application/json'}
  };
  if(body) opts.body = JSON.stringify(body);
  const res = await fetch(apiUrl(path), opts);
  if(res.status===403) throw Object.assign(new Error('403'),{status:403});
  if(!res.ok) throw new Error('HTTP '+res.status+': '+res.statusText);
  if(res.status===204) return null;
  return res.json();
}
const apiGet  = p    => apiFetch('GET',p);
const apiPost = (p,b)=> apiFetch('POST',p,b);
const apiPut  = (p,b)=> apiFetch('PUT',p,b);
const apiDel  = p    => apiFetch('DELETE',p);

// ── Branding: logo (cached) + title ──
async function loadBranding() {
  const base = S.baseUrl.replace(/\/$/,'');

  // Check logo cache first
  const { logoDataUrl, logoSrc } = await chrome.storage.local.get(['logoDataUrl','logoSrc']);
  if(logoDataUrl) {
    $('portal-logo').src = logoDataUrl;
    $('portal-logo').style.display = '';
    $('default-icon').style.display = 'none';
  }

  // Fetch fresh logo
  for(const ext of ['svg','png']) {
    try {
      const r = await fetch(base+'/img/logo.'+ext, {mode:'cors'});
      if(!r.ok) continue;
      const blob = await r.blob();
      const reader = new FileReader();
      reader.onload = async e => {
        const dataUrl = e.target.result;
        $('portal-logo').src = dataUrl;
        $('portal-logo').style.display = '';
        $('default-icon').style.display = 'none';
        await chrome.storage.local.set({ logoDataUrl: dataUrl });

        // For PNG: set toolbar icon immediately and cache data URL for background restore
        if(ext === 'png') {
          const img = new Image();
          img.onload = async () => {
            try {
              const d = {};
              for(const sz of [16, 48]) {
                const c = document.createElement('canvas');
                c.width = c.height = sz;
                c.getContext('2d').drawImage(img, 0, 0, sz, sz);
                d[sz] = c.getContext('2d').getImageData(0, 0, sz, sz);
              }
              chrome.action.setIcon({ imageData: d }).catch(()=>{});
            } catch {}
          };
          img.src = dataUrl;
        }
      };
      reader.readAsDataURL(blob);
      break;
    } catch {}
  }

  // Portal title: try HTML <title>
  try {
    const r = await fetch(base+'/', {credentials:'omit', mode:'cors'});
    if(r.ok) {
      const html = await r.text();
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = m?.[1]?.trim();
      if(title && title !== 'LinkPortal' && title.length < 60) {
        S.portalTitle = title;
        $('portal-title').textContent = title;
      }
    }
  } catch {}
  // Fallback: app-settings
  if(S.portalTitle === 'LinkPortal') {
    try {
      const settings = await apiGet('/admin/app-settings');
      const title = settings?.portal_name || settings?.site_title || '';
      if(title && title !== 'LinkPortal') {
        S.portalTitle = title;
        $('portal-title').textContent = title;
      }
    } catch {}
  }
}

// ── Fetch all portal data ──
async function fetchFromApi() {
  $('loading-text').textContent = t('loading');
  const tabs = await apiGet('/tabs');
  const sections={}, links={}, perms={};
  for(let i=0;i<tabs.length;i++) {
    const tab=tabs[i];
    $('loading-text').textContent = t('loading_tab')+' "'+tab.title+'"… ('+(i+1)+'/'+tabs.length+')';
    perms[tab.id] = tab.perms || {can_read:true,can_edit:false,can_delete:false};
    const secs = await apiGet('/tabs/'+tab.id+'/sections');
    sections[tab.id] = secs;
    for(const sec of secs) {
      try { links[sec.id] = await apiGet('/sections/'+sec.id+'/links'); }
      catch(e) { if(e.status===403) throw e; links[sec.id]=[]; }
    }
  }
  const data={tabs,sections,links,perms,syncTime:Date.now()};
  await chrome.storage.local.set({cache:data,cacheTime:Date.now()});
  return data;
}

function applyData(data) {
  S.tabs=data.tabs||[]; S.sections=data.sections||{};
  S.links=data.links||{}; S.perms=data.perms||{};
  S.allLinks=[];
  for(const tab of S.tabs)
    for(const sec of (S.sections[tab.id]||[]))
      for(const link of (S.links[sec.id]||[]))
        S.allLinks.push({...link,tabTitle:tab.title,tabId:tab.id,
          sectionTitle:sec.title,sectionId:sec.id});
}

// ── Load data (cache-first) ──
async function loadData(force=false) {
  showScreen('loading');
  $('cache-badge').style.display='none';
  if(!force) {
    const {cacheTime}=await chrome.storage.local.get(['cacheTime']);
    if(cacheTime&&(Date.now()-cacheTime)/86400000>=MAX_INACTIVE_DAYS){await doLogout('expired');return;}
  }
  try {
    if(!force){
      const {cache}=await chrome.storage.local.get(['cache']);
      if(cache){
        applyData(cache); renderAll(); showScreen('main');
        $('cache-badge').style.display='';
        $('cache-badge').title=t('cache_from')+' '+new Date(cache.syncTime).toLocaleString();
        bgRefresh(); return;
      }
    }
    applyData(await fetchFromApi()); renderAll(); showScreen('main');
  } catch(err) {
    if(err.status===403){await doLogout('403');return;}
    const {cache}=await chrome.storage.local.get(['cache']);
    if(cache){applyData(cache);renderAll();showScreen('main');
      $('cache-badge').style.display='';
      $('cache-badge').title=t('cache_offline')+' '+new Date(cache.syncTime).toLocaleString();}
    else{$('error-message').textContent=err.message;showScreen('error');}
  }
}

async function bgRefresh() {
  try{applyData(await fetchFromApi());$('cache-badge').style.display='none';
    if(S.activeTab)renderTabContent(S.activeTab);}
  catch(e){if(e.status===403)await doLogout('403');}
}

// ── Render ──
function renderAll() {
  if(!S.tabs.length){
    $('tabs-bar').style.display='none';
    $('tab-content').innerHTML='<div class="empty-tab"><div class="empty-icon">🔒</div><p>'+t('no_tabs')+'</p></div>';
    return;
  }
  $('tabs-bar').style.display='';
  if(!S.activeTab||!S.tabs.find(t2=>t2.id===S.activeTab)) S.activeTab=S.tabs[0].id;
  renderTabBar(); renderTabContent(S.activeTab);
}

// ── Tab bar: hamburger toggle ──
function renderTabBar() {
  const activeTab = S.tabs.find(t2=>t2.id===S.activeTab);
  const label = $('active-tab-label');
  label.textContent = (activeTab?.icon ? activeTab.icon+' ' : '') + (activeTab?.title||'');

  // Add-link button: show if any tab has edit perms
  const canAdd = S.tabs.some(tab=>(S.perms[tab.id]||{}).can_edit);
  const addBtn = $('tab-add-btn');
  addBtn.style.display = canAdd ? '' : 'none';
  addBtn.textContent = t('btn_add_link');
}

function openTabsDropdown() {
  const dropdown = $('tabs-dropdown');
  const chevron  = $('tabs-chevron');
  if(dropdown.style.display !== 'none') {
    dropdown.style.display = 'none'; chevron.classList.remove('open'); return;
  }
  dropdown.innerHTML = S.tabs.map(tab =>
    '<button class="tab-drop-item'+(tab.id===S.activeTab?' active':'')+'" data-id="'+tab.id+'">'+
    (tab.icon?'<span class="tab-drop-icon">'+tab.icon+'</span>':'')+
    '<span>'+esc(tab.title)+'</span></button>'
  ).join('');
  dropdown.querySelectorAll('.tab-drop-item').forEach(btn => {
    btn.addEventListener('click', () => {
      S.activeTab = parseInt(btn.dataset.id);
      dropdown.style.display = 'none'; chevron.classList.remove('open');
      clearSearch(); renderTabBar(); renderTabContent(S.activeTab);
    });
  });
  dropdown.style.display = ''; chevron.classList.add('open');
}

// ── Render tab content ──
function renderTabContent(tabId) {
  const content = $('tab-content');
  const secs = S.sections[tabId]||[];
  const tabPerm = S.perms[tabId]||{};
  const canEdit = tabPerm.can_edit||false, canDel = tabPerm.can_delete||false;
  let html='', has=false;
  for(let i=0;i<secs.length;i++){
    const sec=secs[i], lnks=S.links[sec.id]||[];
    if(!lnks.length) continue;
    has=true;
    if(i>0) html+='<div class="section-divider"></div>';
    html+='<div class="section-block" data-sec-id="'+sec.id+'"><div class="section-header">'+
      (sec.icon?'<span class="section-icon">'+sec.icon+'</span>':'')+
      '<span class="section-title">'+esc(sec.title)+'</span>'+
      '<span class="section-count">'+lnks.length+'</span></div>'+
      lnks.map(l=>linkHtml({...l, sectionId:sec.id}, canEdit, canDel)).join('')+'</div>';
  }
  content.innerHTML = has ? html :
    '<div class="empty-tab"><div class="empty-icon">📭</div><p>'+t('no_links')+'</p></div>';
  bindLinks(content, tabId, canEdit, canDel);
}

// ── Link HTML ──
function linkHtml(link, canEdit, canDel, hi='') {
  const title = hi?hilite(link.title||'',hi):esc(link.title||'');
  const desc  = hi?hilite(link.description||'',hi):esc(link.description||'');
  const openSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  const editSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const delSvg ='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
  const dragSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="16" y2="18"/></svg>';
  return '<a class="link-item" data-id="'+link.id+'" data-sec="'+link.sectionId+'" data-url="'+esc(link.url)+'" href="#">'+
    (canEdit?'<span class="drag-handle">'+dragSvg+'</span>':'')+
    favicon(link)+
    '<div class="link-info"><div class="link-title">'+title+'</div>'+
    (link.description?'<div class="link-desc">'+desc+'</div>':'')+
    '</div><div class="link-actions">'+
    (canEdit?'<button class="link-action-btn edit-btn" data-id="'+link.id+'">'+editSvg+'</button>':'')+
    (canDel?'<button class="link-action-btn del" data-id="'+link.id+'">'+delSvg+'</button>':'')+
    '<button class="link-action-btn open-btn">'+openSvg+'</button>'+
    '</div></a>';
}

function favicon(link) {
  const base=S.baseUrl.replace(/\/$/,''), logo=link.logo_url||link.logo||'';
  if(logo){
    if(logo.startsWith('http')||logo.startsWith('/')) {
      const src=logo.startsWith('/')?base+logo:logo;
      return '<img class="link-favicon" src="'+esc(src)+'" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="link-favicon-fallback" style="display:none">'+ini(link.title)+'</div>';
    }
    return '<div class="link-favicon-fallback" style="background:var(--bg3);font-size:14px">'+logo+'</div>';
  }
  try{
    const d=new URL(link.url).hostname;
    return '<img class="link-favicon" src="https://www.google.com/s2/favicons?domain='+d+'&sz=32" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="link-favicon-fallback" style="display:none">'+ini(link.title)+'</div>';
  } catch { return '<div class="link-favicon-fallback">'+ini(link.title)+'</div>'; }
}

function bindLinks(container, tabId, canEdit, canDel) {
  container.querySelectorAll('.link-item').forEach(el => {
    el.addEventListener('click', e => {
      if(e.target.closest('.link-action-btn')||e.target.closest('.drag-handle')) return;
      e.preventDefault(); chrome.tabs.create({url:el.dataset.url});
    });
    el.querySelector('.open-btn')?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation(); chrome.tabs.create({url:el.dataset.url});
    });
    if(canEdit) el.querySelector('.edit-btn')?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const id=parseInt(el.dataset.id);
      const link=S.allLinks.find(l=>l.id===id);
      if(link) openLinkDialog(link,tabId);
    });
    if(canDel) el.querySelector('.del')?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation(); deleteLink(parseInt(el.dataset.id), tabId);
    });
  });
}

// ── Drag & Drop — pointer events with capture (works in Extension popups) ──
// ── Global DnD — one-time init, avoids listener buildup on tab switches ──
let _dnd = null;

function initGlobalDnD() {
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.drag-handle')) return;
    const item = e.target.closest('.link-item');
    if (!item || !item.closest('#tab-content')) return;
    e.preventDefault();

    const secId = parseInt(item.dataset.sec);
    if (isNaN(secId)) { console.warn('[LP] drag: NaN secId, dataset.sec=', item.dataset.sec); return; }
    const secBlock = item.closest('.section-block');
    if (!secBlock) return;

    const line = document.createElement('div');
    line.className = 'drop-line';
    item.after(line);
    item.classList.add('dragging');
    _dnd = { item, secId, secBlock, line, dropTarget: null, dropBefore: true };
  }, { passive: false });

  document.addEventListener('pointermove', e => {
    if (!_dnd) return;
    e.preventDefault();
    _dnd.item.style.visibility = 'hidden';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    _dnd.item.style.visibility = '';
    if (!under) return;
    const target = under.closest('.link-item');
    if (!target || target === _dnd.item) return;
    if (parseInt(target.dataset.sec) !== _dnd.secId) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    _dnd.dropTarget = target;
    _dnd.dropBefore = before;
    _dnd.line.style.display = 'block';
    if (before) target.before(_dnd.line);
    else target.after(_dnd.line);
  }, { passive: false });

  const finishDnD = async () => {
    if (!_dnd) return;
    const { item, secId, secBlock, line, dropTarget, dropBefore } = _dnd;
    _dnd = null;
    item.classList.remove('dragging');
    item.style.visibility = '';
    line.remove();
    if (!dropTarget) return;
    if (dropBefore) dropTarget.before(item);
    else dropTarget.after(item);
    const newOrder = [...secBlock.querySelectorAll('.link-item')]
      .map(i => parseInt(i.dataset.id)).filter(id => !isNaN(id));
    S.links[secId] = newOrder.map(id => (S.links[secId]||[]).find(l => l.id===id)).filter(Boolean);
    try {
      await apiPut('/sections/'+secId+'/links/sort', { ids: newOrder });
      const { cache } = await chrome.storage.local.get(['cache']);
      if (cache) { cache.links[secId] = S.links[secId]; await chrome.storage.local.set({ cache }); }
    } catch(err) { console.warn('[LP] sort:', err.message); }
  };
  document.addEventListener('pointerup', finishDnD);
  document.addEventListener('pointercancel', () => {
    if (!_dnd) return;
    _dnd.item.classList.remove('dragging');
    _dnd.item.style.visibility = '';
    _dnd.line.remove();
    _dnd = null;
  });
}

// ── Search ──
function performSearch(q) {
  q=q.trim().toLowerCase();
  const sr=$('search-results'),tc=$('tab-content'),tb=$('tabs-bar');
  if(!q){sr.style.display='none';tc.style.display='';tb.style.display='';return;}
  tc.style.display='none';tb.style.display='none';sr.style.display='';
  const m=S.allLinks.filter(l=>[l.title,l.description||'',l.url,l.tabTitle,l.sectionTitle].join(' ').toLowerCase().includes(q));
  const cnt=m.length;
  $('results-header').textContent=cnt+' '+(cnt===1?t('results_suffix_one'):t('results_suffix_many'));
  const list=$('results-list');
  if(!cnt){list.innerHTML='<div class="no-results"><div class="no-results-icon">🔍</div><span>'+t('no_results_prefix')+' "'+esc(q)+'"</span></div>';return;}
  const openSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  list.innerHTML = m.map(link => {
    const tp=S.perms[link.tabId]||{};
    const editSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    const delSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    return '<a class="link-item" data-id="'+link.id+'" data-sec="'+link.sectionId+'" data-url="'+esc(link.url)+'" href="#">'+
      favicon(link)+
      '<div class="link-info"><div class="link-title">'+hilite(link.title||'',q)+'</div>'+
      (link.description?'<div class="link-desc">'+hilite(link.description,q)+'</div>':'')+
      '<div class="result-breadcrumb"><span>'+esc(link.tabTitle)+'</span> › '+esc(link.sectionTitle)+'</div>'+
      '</div><div class="link-actions">'+
      (tp.can_edit?'<button class="link-action-btn edit-btn" data-id="'+link.id+'">'+editSvg+'</button>':'')+
      (tp.can_delete?'<button class="link-action-btn del" data-id="'+link.id+'">'+delSvg+'</button>':'')+
      '<button class="link-action-btn open-btn">'+openSvg+'</button>'+
      '</div></a>';
  }).join('');
  list.querySelectorAll('.link-item').forEach(el=>{
    el.addEventListener('click',e=>{if(e.target.closest('.link-action-btn'))return;e.preventDefault();chrome.tabs.create({url:el.dataset.url});});
    el.querySelector('.open-btn')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();chrome.tabs.create({url:el.dataset.url});});
    const id=parseInt(el.dataset.id),link=S.allLinks.find(l=>l.id===id);
    el.querySelector('.edit-btn')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(link)openLinkDialog(link,link.tabId);});
    el.querySelector('.del')?.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(link)deleteLink(id,link.tabId);});
  });
}

function clearSearch(){$('search-input').value='';$('search-clear').style.display='none';performSearch('');}
function hilite(t2,q){return esc(t2).replace(new RegExp('('+escRx(q)+')','gi'),'<mark>$1</mark>');}

// ══════════════════════════════════════════
// LINK CRUD
// ══════════════════════════════════════════
function openLinkDialog(link, tabId) {
  const secSel=$('dlg-sec'); secSel.innerHTML='';
  let hasOptions=false;
  for(const tab of S.tabs){
    if(!(S.perms[tab.id]||{}).can_edit) continue;
    for(const sec of (S.sections[tab.id]||[])){
      if(sec.section_type && sec.section_type !== 'links') continue;
      const opt=document.createElement('option');
      opt.value=sec.id; opt.textContent=tab.title+' › '+sec.title;
      if(link&&link.sectionId===sec.id) opt.selected=true;
      else if(!link&&tab.id===tabId&&!hasOptions) opt.selected=true;
      secSel.appendChild(opt); hasOptions=true;
    }
  }
  if(!hasOptions){alert(t('no_edit_sections'));return;}
  $('dlg-title').textContent=$('dlg-title').textContent = link?t('dlg_edit_title'):t('dlg_add_title');
  $('dlg-link-id').value  = link?link.id:'';
  $('dlg-url').value       = link?(link.url||''):'';
  $('dlg-title-inp').value = link?(link.title||''):'';
  $('dlg-desc').value      = link?(link.description||''):'';
  $('dlg-logo').value      = link?(link.logo_url||link.logo||''):'';
  $('dlg-err').style.display='none';
  $('dlg-sec-field').style.display = link?'none':'';
  $('dlg-backdrop').style.display='flex';
  $('dlg-url').focus();
}
function closeLinkDialog(){$('dlg-backdrop').style.display='none';}

async function saveLinkDialog() {
  const url  = $('dlg-url').value.trim();
  const title= $('dlg-title-inp').value.trim();
  const desc = $('dlg-desc').value.trim();
  const logo = $('dlg-logo').value.trim();
  const secId= parseInt($('dlg-sec').value);
  const linkId= parseInt($('dlg-link-id').value);
  const isEdit= !!linkId;
  if(!url){showDlgErr(t('err_url_required'));return;}
  if(!title){showDlgErr(t('err_title_required'));return;}
  $('dlg-save').disabled=true;
  try {
    const body={url,title,description:desc||null,logo_url:logo||null};
    if(isEdit) await apiPut('/links/'+linkId,body);
    else await apiPost('/sections/'+secId+'/links',body);
    closeLinkDialog();
    applyData(await fetchFromApi());
    renderTabContent(S.activeTab);
    renderTabBar();
  } catch(err){showDlgErr(err.message);}
  $('dlg-save').disabled=false;
}

async function deleteLink(linkId, tabId) {
  if(!confirm(t('confirm_delete_link'))) return;
  try {
    await apiDel('/links/'+linkId);
    applyData(await fetchFromApi());
    renderTabContent(S.activeTab||tabId);
    renderTabBar();
  } catch(err){alert(err.message);}
}

function showDlgErr(msg){$('dlg-err').style.display='';$('dlg-err').textContent=msg;}

// ══════════════════════════════════════════
// SETTINGS (inline panel)
// ══════════════════════════════════════════
async function openSettings() {
  closeDropdown();
  const stored=await chrome.storage.sync.get(['baseUrl','token','username']);
  $('s-base-url').value  = stored.baseUrl||'';
  $('s-username').value  = stored.username||'';
  if(stored.token){
    S.tokenSaved=true; S.testPassed=true;
    S.lastTestedUrl=stored.baseUrl||''; S.lastTestedUser=stored.username||''; S.lastTestedToken='(saved)';
    $('s-api-token').value=''; $('s-api-token').placeholder=t('lbl_token_hint');
    $('s-api-token').readOnly=true; $('s-api-token').type='password';
    $('s-btn-edit-tok').style.display=''; $('s-btn-show-tok').style.display='none';
  } else {
    S.tokenSaved=false; S.testPassed=false;
    $('s-api-token').value=''; $('s-api-token').readOnly=false;
    $('s-api-token').placeholder='eyJhbGciOiJIUzI1NiIs…';
    $('s-btn-edit-tok').style.display='none'; $('s-btn-show-tok').style.display='';
  }
  $('s-lang').value=_lang;
  updateSaveBtn(); loadCacheInfo();
  showScreen('settings');
}

function closeSettings(){
  if(S.baseUrl&&S.token) showScreen('main'); else showScreen('setup');
}

function updateSaveBtn(){
  const ok=S.testPassed&&($('s-base-url')?.value.trim())&&($('s-username')?.value.trim());
  if($('s-btn-save')) $('s-btn-save').disabled=!ok;
}

function watchSettingsFields(){
  ['s-base-url','s-username'].forEach(id=>{
    $(id)?.addEventListener('input',()=>{
      if($('s-base-url').value.trim()!==S.lastTestedUrl||$('s-username').value.trim()!==S.lastTestedUser) S.testPassed=false;
      updateSaveBtn();
    });
  });
  $('s-api-token')?.addEventListener('input',()=>{if(!S.tokenSaved){S.testPassed=false;}updateSaveBtn();});
}

async function testConnection(){
  const baseUrl=$('s-base-url').value.trim().replace(/\/$/,'');
  const username=$('s-username').value.trim();
  let token=S.tokenSaved?'':$('s-api-token').value.trim();
  const res=$('s-test-result');
  if(!baseUrl||!username){showSResult(res,'error','⚠ '+t('err_fields'));return;}
  if(!baseUrl.startsWith('https://')){showSResult(res,'error','⚠ '+t('err_https'));return;}
  if(S.tokenSaved&&!token){const st=await chrome.storage.sync.get(['token']);token=st.token||'';}
  if(!token){showSResult(res,'error','⚠ '+t('err_fields'));return;}
  showSResult(res,'loading',t('test_loading')); $('s-btn-test').disabled=true;
  try{
    const r=await fetch(baseUrl+'/api/tabs',{headers:{'Authorization':mkAuth(username,token),'Cache-Control':'no-cache'},credentials:'omit'});
    if(r.status===403){S.testPassed=false;showSResult(res,'error',t('test_err_403'));}
    else if(r.status===401){S.testPassed=false;showSResult(res,'error',t('test_err_401'));}
    else if(r.ok){
      const tabs=await r.json().catch(()=>[]);
      S.testPassed=true; S.lastTestedUrl=baseUrl; S.lastTestedUser=username; S.lastTestedToken=S.tokenSaved?'(saved)':token;
      showSResult(res,'success',t('test_ok')+'<br><small>📂 '+tabs.length+' '+t('test_tabs')+'</small>');
    } else {S.testPassed=false;showSResult(res,'error',t('test_err_http')+' '+r.status);}
  }catch(err){S.testPassed=false;showSResult(res,'error','❌ '+esc(err.message));}
  $('s-btn-test').disabled=false; updateSaveBtn();
}

async function saveSettings(){
  const baseUrl=$('s-base-url').value.trim().replace(/\/$/,'');
  const username=$('s-username').value.trim();
  if(!baseUrl||!username){showStatus('⚠ '+t('err_fields'),'error');return;}
  if(!baseUrl.startsWith('https://')){showStatus('⚠ '+t('err_https'),'error');return;}
  if(!S.testPassed){showStatus('⚠ '+t('err_test_first'),'error');return;}
  let token=S.tokenSaved?'':$('s-api-token').value.trim();
  if(S.tokenSaved){const st=await chrome.storage.sync.get(['token']);token=st.token||'';}
  if(!token){showStatus('⚠ No token','error');return;}
  await chrome.storage.sync.set({baseUrl,token,username});
  S.baseUrl=baseUrl; S.token=token; S.username=username;
  S.tokenSaved=true;
  $('s-api-token').value=''; $('s-api-token').readOnly=true;
  $('s-api-token').placeholder=t('lbl_token_hint');
  $('s-btn-edit-tok').style.display=''; $('s-btn-show-tok').style.display='none';
  showStatus(t('save_ok'),'success'); updateSaveBtn();
}

async function resetSettings(){
  if(!confirm(t('confirm_reset'))) return;
  await chrome.storage.sync.clear(); await chrome.storage.local.clear();
  S.baseUrl='';S.token='';S.username='';S.tabs=[];S.tokenSaved=false;S.testPassed=false;
  $('s-base-url').value='';$('s-username').value='';
  $('s-api-token').value='';$('s-api-token').readOnly=false;
  $('s-api-token').placeholder='eyJhbGciOiJIUzI1NiIs…';
  $('s-btn-edit-tok').style.display='none';$('s-btn-show-tok').style.display='';
  $('s-test-result').style.display='none';$('s-sync-result').style.display='none';
  $('portal-logo').style.display='none';$('default-icon').style.display='';
  $('portal-title').textContent='LinkPortal';
  loadCacheInfo(); updateSaveBtn();
  showStatus(t('reset_ok'),'success');
  setTimeout(()=>showScreen('setup'),1200);
}

function editToken(){
  S.tokenSaved=false; S.testPassed=false;
  $('s-api-token').value=''; $('s-api-token').readOnly=false;
  $('s-api-token').placeholder='eyJhbGciOiJIUzI1NiIs…'; $('s-api-token').type='password';
  $('s-btn-edit-tok').style.display='none'; $('s-btn-show-tok').style.display='';
  updateSaveBtn(); $('s-api-token').focus();
}

function toggleTokenVis(){
  if($('s-api-token').readOnly) return;
  const show=$('s-api-token').type==='password';
  $('s-api-token').type=show?'text':'password';
  $('s-eye').innerHTML=show
    ?'<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    :'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}

// ── FIX: syncNow uses in-memory state directly ──
async function syncNow(){
  if(!S.baseUrl||!S.token||!S.username){
    showSResult($('s-sync-result'),'error',t('sync_err')); return;
  }
  $('s-btn-sync').disabled=true;
  showSResult($('s-sync-result'),'loading',t('sync_loading'));
  try {
    // Use fetchFromApi directly (same as refresh button) — avoids message passing issues
    applyData(await fetchFromApi());
    if(S.activeTab) renderTabContent(S.activeTab);
    renderTabBar();
    await loadCacheInfo();
    showSResult($('s-sync-result'),'success',t('sync_ok')+' '+new Date().toLocaleTimeString());
  } catch(err) {
    if(err.status===403){showSResult($('s-sync-result'),'error',t('test_err_403'));}
    else showSResult($('s-sync-result'),'error','❌ '+esc(err.message));
  }
  $('s-btn-sync').disabled=false;
}

async function clearCache(){
  if(!confirm(t('confirm_cache'))) return;
  await chrome.storage.local.remove(['cache','cacheTime']);
  loadCacheInfo(); showSResult($('s-sync-result'),'success',t('cache_cleared'));
}

async function loadCacheInfo(){
  const {cache}=await chrome.storage.local.get(['cache']);
  $('s-sync-time').textContent=cache?.syncTime?new Date(cache.syncTime).toLocaleString():t('lbl_sync_never');
  if(cache?.links){let n=0;for(const l of Object.values(cache.links))n+=(l||[]).length;$('s-cache-cnt').textContent=n+' Links';}
  else $('s-cache-cnt').textContent='0 Links';
}

async function changeLang(code){
  setLang(code); await chrome.storage.local.set({lang:code}); applyLang();
  if($('s-lang')) $('s-lang').value=code;
  if($('dd-lang-sel')) $('dd-lang-sel').value=code;
  if(S.baseUrl&&S.token){
    try{await apiFetch('PUT','/settings',{language:code});}catch{}
  }
}

function showStatus(msg,type){const s=$('s-save-status');s.textContent=msg;s.className='save-status '+type;setTimeout(()=>{s.textContent='';s.className='save-status';},3000);}
function showSResult(el,type,html){if(!el)return;el.style.display='';el.className='test-result '+type;el.innerHTML=html;}

// ── Dropdown ──
function openDropdown(){const d=$('dropdown-menu');d.style.display=d.style.display==='none'?'block':'none';}
function closeDropdown(){const d=$('dropdown-menu');if(d)d.style.display='none';}

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
async function init(){
  // Default to English before anything loads (prevents missing text on error)
  setLang('en'); applyLang();

  // Check logout triggered by background
  const {logoutReason}=await chrome.storage.local.get(['logoutReason']);
  if(logoutReason){await chrome.storage.local.remove(['logoutReason']);await doLogout(logoutReason);return;}

  // Load stored prefs
  const stored=await chrome.storage.sync.get(['baseUrl','token','username']);
  const local=await chrome.storage.local.get(['lang','theme','logoDataUrl']);

  S.baseUrl=stored.baseUrl||''; S.token=stored.token||''; S.username=stored.username||'';

  // Theme
  applyTheme(local.theme||'auto');

  // Language — fallback to English on any error
  const activeLang=local.lang||'en';
  try { setLang(activeLang); } catch { setLang('en'); }
  applyLang();

  // Show cached logo immediately
  if(local.logoDataUrl){
    $('portal-logo').src=local.logoDataUrl;
    $('portal-logo').style.display='';
    $('default-icon').style.display='none';
  }

  if(!S.baseUrl||!S.token||!S.username){showScreen('setup');return;}

  loadBranding(); // non-blocking
  await loadData();

  // Sync lang from portal (best-effort, keep English on fail)
  try{
    const me=await apiGet('/auth/me');
    if(me.language&&I18N[me.language]&&me.language!==_lang){
      await changeLang(me.language);
    }
  }catch{}
}

document.addEventListener('DOMContentLoaded',()=>{
  initGlobalDnD(); // one-time global DnD — must be first
  watchSettingsFields();

  // Setup/Logout buttons
  $('btn-open-settings').addEventListener('click',openSettings);
  $('btn-logout-settings').addEventListener('click',openSettings);
  $('btn-retry').addEventListener('click',()=>loadData(true));
  $('btn-refresh').addEventListener('click',async()=>{
    $('btn-refresh').classList.add('spinning');
    await loadData(true);
    $('btn-refresh').classList.remove('spinning');
  });

  // Dropdown
  $('btn-menu').addEventListener('click',e=>{e.stopPropagation();openDropdown();});
  $('dd-settings').addEventListener('click',openSettings);
  $('dd-open-portal').addEventListener('click',()=>{closeDropdown();if(S.baseUrl)chrome.tabs.create({url:S.baseUrl});});
  document.addEventListener('click',e=>{
    if(!e.target.closest('.dropdown-wrap'))closeDropdown();
    if(!e.target.closest('.tabs-toggle-wrap')){
      $('tabs-dropdown').style.display='none';
      $('tabs-chevron').classList.remove('open');
    }
  });

  // Theme buttons (in settings panel)
  document.querySelectorAll('.theme-btn-lg').forEach(b=>b.addEventListener('click',()=>changeTheme(b.dataset.theme)));

  // Language dropdown in menu
  $('dd-lang-sel').addEventListener('change',e=>{e.stopPropagation();changeLang(e.target.value);});

  // Tab toggle
  $('tabs-toggle-btn').addEventListener('click',e=>{e.stopPropagation();openTabsDropdown();});
  $('tab-add-btn').addEventListener('click',()=>openLinkDialog(null,S.activeTab));

  // Search
  const si=$('search-input'),sc=$('search-clear');let tm;
  si.addEventListener('input',()=>{sc.style.display=si.value?'':'none';clearTimeout(tm);tm=setTimeout(()=>performSearch(si.value),200);});
  sc.addEventListener('click',clearSearch);
  si.addEventListener('keydown',e=>{if(e.key==='Escape')clearSearch();});

  // Settings panel
  $('btn-settings-back').addEventListener('click',closeSettings);
  $('s-btn-test').addEventListener('click',testConnection);
  $('s-btn-save').addEventListener('click',saveSettings);
  $('s-btn-reset').addEventListener('click',resetSettings);
  $('s-btn-edit-tok').addEventListener('click',editToken);
  $('s-btn-show-tok').addEventListener('click',toggleTokenVis);
  $('s-btn-sync').addEventListener('click',syncNow);
  $('s-btn-clear').addEventListener('click',clearCache);
  $('s-lang').addEventListener('change',e=>changeLang(e.target.value));

  // Link dialog
  $('dlg-close').addEventListener('click',closeLinkDialog);
  $('dlg-cancel').addEventListener('click',closeLinkDialog);
  $('dlg-save').addEventListener('click',saveLinkDialog);
  $('dlg-btn-current').addEventListener('click',async()=>{
    try{const[tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(tab){if(!$('dlg-url').value)$('dlg-url').value=tab.url||'';if(!$('dlg-title-inp').value)$('dlg-title-inp').value=tab.title||'';}}catch{}
  });
  $('dlg-backdrop').addEventListener('click',e=>{if(e.target===$('dlg-backdrop'))closeLinkDialog();});

  // Keyboard
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeLinkDialog();closeDropdown();}});

  init();
});
