/* ════════════════════════════════════════════════════
   LinkPortal Extension — background.js  v1.5.0
   Basic Auth · Periodic Sync · 30-day Logout
   ════════════════════════════════════════════════════ */

const ALARM_NAME        = 'linkportal-sync';
const SYNC_MINUTES      = 30;
const MAX_INACTIVE_DAYS = 30;

chrome.runtime.onInstalled.addListener(() => scheduleAlarm());
chrome.runtime.onStartup.addListener(() => {
  restoreIcon();
  checkExpiry();
  scheduleAlarm();
});

// ── Restore toolbar icon from cached pixel data ──
async function restoreIcon() {
  try {
    const { logoPixels } = await chrome.storage.local.get(['logoPixels']);
    if (!logoPixels) return;
    const imageData = {};
    for (const [sz, pixels] of Object.entries(logoPixels)) {
      const size = parseInt(sz);
      // ImageData is available in Chrome service workers
      imageData[size] = new ImageData(new Uint8ClampedArray(pixels), size, size);
    }
    await chrome.action.setIcon({ imageData });
  } catch (e) {
    console.warn('[LinkPortal] restoreIcon failed:', e.message);
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
  } catch (err) {
    if (err.status === 403 || (err.message||'').includes('403')) await performLogout('403');
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
      .catch(err => {
        if (err.status === 403) performLogout('403');
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }
  if (msg.action === 'logout') {
    performLogout(msg.reason || 'manual').then(() => sendResponse({ ok: true }));
    return true;
  }
});
