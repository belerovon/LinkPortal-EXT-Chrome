/* ════════════════════════════════════════════════════
   LinkPortal Extension — background.js  v1.5.2
   Basic Auth · Periodic Sync · 30-day Logout
   ════════════════════════════════════════════════════ */

const ALARM_NAME        = 'linkportal-sync';
const SYNC_MINUTES      = 30;
const MAX_INACTIVE_DAYS = 30;
const THRESH_MAX        = 3;
const THRESH_WINDOW_MS  = 5 * 60 * 1000; // 5 minutes

async function record403bg() {
  const now = Date.now();
  const { err403 } = await chrome.storage.local.get(['err403']);
  const list = (err403 || []).filter(ts => now - ts < THRESH_WINDOW_MS);
  list.push(now);
  await chrome.storage.local.set({ err403: list });
  console.warn(`[LP-bg] 403 count: ${list.length}/${THRESH_MAX}`);
  return list.length >= THRESH_MAX;
}

chrome.runtime.onInstalled.addListener(() => scheduleAlarm());
chrome.runtime.onStartup.addListener(() => {
  restoreIcon();
  checkExpiry();
  scheduleAlarm();
});

// ── Restore toolbar icon from cached PNG data URL ──
async function restoreIcon() {
  try {
    const { logoPngUrl } = await chrome.storage.local.get(['logoPngUrl']);
    if (!logoPngUrl) return;
    const res  = await fetch(logoPngUrl);
    const blob = await res.blob();
    const bmp  = await createImageBitmap(blob);
    const imageData = {};
    for (const sz of [16, 48]) {
      const oc  = new OffscreenCanvas(sz, sz);
      const ctx = oc.getContext('2d');
      ctx.drawImage(bmp, 0, 0, sz, sz);
      imageData[sz] = ctx.getImageData(0, 0, sz, sz);
    }
    await chrome.action.setIcon({ imageData });
  } catch (e) {
    console.warn('[LinkPortal] restoreIcon:', e.message);
  }
}

function scheduleAlarm() {
  chrome.alarms.get(ALARM_NAME, alarm => {
    if (!alarm) chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: SYNC_MINUTES, periodInMinutes: SYNC_MINUTES
    });
  });
}

async function checkExpiry() {
  const { cacheTime } = await chrome.storage.local.get(['cacheTime']);
  if (!cacheTime) return;
  const days = (Date.now() - cacheTime) / (1000 * 60 * 60 * 24);
  if (days >= MAX_INACTIVE_DAYS) await performLogout('expired');
}

// ── Logout: keep URL + username, only remove token ──
async function performLogout(reason) {
  await chrome.storage.local.remove(['cache', 'cacheTime']);
  await chrome.storage.sync.remove(['token']); // ← only token!
  await chrome.storage.local.set({ logoutReason: reason });
}

function makeBasicAuth(username, token) {
  return 'Basic ' + btoa(unescape(encodeURIComponent((username||'') + ':' + (token||''))));
}

async function fetchAllData(baseUrl, username, token) {
  const base = baseUrl.replace(/\/$/, '');
  const auth = makeBasicAuth(username, token);

  async function get(path) {
    const res = await fetch(base + '/api' + path, { headers: { 'Authorization': auth } });
    if (res.status === 403) throw Object.assign(new Error('403'), { status: 403 });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  const tabs = await get('/tabs');
  const result = { tabs, sections: {}, links: {}, perms: {}, syncTime: Date.now() };
  for (const tab of tabs) {
    result.perms[tab.id] = tab.perms || { can_read:true, can_edit:false, can_delete:false };
    const sections = await get('/tabs/' + tab.id + '/sections');
    result.sections[tab.id] = sections;
    for (const sec of sections) {
      try { result.links[sec.id] = await get('/sections/' + sec.id + '/links'); }
      catch { result.links[sec.id] = []; }
    }
  }
  return result;
}

async function syncInBackground() {
  const { baseUrl, token, username } = await chrome.storage.sync.get(['baseUrl','token','username']);
  if (!baseUrl || !token || !username) return;
  try {
    const data = await fetchAllData(baseUrl, username, token);
    await chrome.storage.local.set({ cache: data, cacheTime: Date.now() });
    await chrome.storage.local.remove(['err403']);
    // Sync user language preference
    try {
      const meRes = await fetch(baseUrl.replace(/\/$/,'') + '/api/auth/me', {
        headers: { 'Authorization': makeBasicAuth(username, token) },
        credentials: 'omit'
      });
      if (meRes.ok) {
        const me = await meRes.json();
        if (me.language && ['de','en','es'].includes(me.language)) {
          await chrome.storage.local.set({ lang: me.language });
        }
      }
    } catch {}
  } catch (err) {
    if (err.status === 403 || (err.message||'').includes('403')) {
      if (await record403bg()) await performLogout('403');
      // else: transient 403, wait for next sync cycle
    }
  }
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAME) return;
  await checkExpiry();
  const { token } = await chrome.storage.sync.get(['token']);
  if (token) await syncInBackground();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'fetchAndCache') {
    fetchAllData(msg.baseUrl, msg.username, msg.token)
      .then(data => {
        chrome.storage.local.set({ cache: data, cacheTime: Date.now() });
        sendResponse({ ok: true, data });
      })
      .catch(async err => {
        if (err.status === 403) { if (await record403bg()) performLogout('403'); }
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }
  if (msg.action === 'logout') {
    performLogout(msg.reason || 'manual').then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ── Auto-Config from LinkPortal portal page ──
// Called via: chrome.runtime.sendMessage(EXTENSION_ID, { action:'autoConfig', ... })
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'autoConfig') { sendResponse({ ok: false, error: 'unknown action' }); return; }

  const { baseUrl, username, token } = msg;
  if (!baseUrl || !username || !token) {
    sendResponse({ ok: false, error: 'missing baseUrl, username or token' }); return;
  }

  // Verify credentials before saving
  fetch(baseUrl.replace(/\/$/,'') + '/api/tabs', {
    headers: { 'Authorization': makeBasicAuth(username, token) },
    credentials: 'omit'
  }).then(async r => {
    if (!r.ok) { sendResponse({ ok: false, error: 'HTTP ' + r.status }); return; }
    await chrome.storage.sync.set({ baseUrl: baseUrl.replace(/\/$/,''), username, token });
    await chrome.storage.local.remove(['cache', 'cacheTime']);
    // Fetch user language preference and store it
    try {
      const meRes = await fetch(baseUrl.replace(/\/$/,'') + '/api/auth/me', {
        headers: { 'Authorization': makeBasicAuth(username, token) },
        credentials: 'omit'
      });
      if (meRes.ok) {
        const me = await meRes.json();
        if (me.language && ['de','en','es'].includes(me.language)) {
          await chrome.storage.local.set({ lang: me.language });
        }
      }
    } catch {}
    sendResponse({ ok: true, message: 'LinkPortal Extension erfolgreich konfiguriert!' });
  }).catch(err => sendResponse({ ok: false, error: err.message }));

  return true; // keep channel open for async
});
