/* ════════════════════════════════════════════════════
   LinkPortal Extension — background.js
   Service Worker: Sync alle 30 Min, 30-Tage-Logout
   ════════════════════════════════════════════════════ */

const ALARM_NAME        = 'linkportal-sync';
const SYNC_MINUTES      = 30;
const MAX_INACTIVE_DAYS = 30;

// ── Setup alarm ──
chrome.runtime.onInstalled.addListener(() => scheduleAlarm());
chrome.runtime.onStartup.addListener(() => {
  checkExpiry();
  scheduleAlarm();
});

function scheduleAlarm() {
  chrome.alarms.get(ALARM_NAME, alarm => {
    if (!alarm) {
      chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: SYNC_MINUTES,
        periodInMinutes: SYNC_MINUTES,
      });
    }
  });
}

// ── 30-Tage-Inaktivitätsprüfung ──
async function checkExpiry() {
  const { cacheTime } = await chrome.storage.local.get(['cacheTime']);
  if (!cacheTime) return;

  const daysSince = (Date.now() - cacheTime) / (1000 * 60 * 60 * 24);
  if (daysSince >= MAX_INACTIVE_DAYS) {
    console.log('[LinkPortal] 30 Tage ohne Sync → automatischer Logout');
    await performLogout('expired');
  }
}

// ── Logout: Cache & Token löschen ──
async function performLogout(reason) {
  await chrome.storage.local.clear();
  await chrome.storage.sync.remove(['token', 'username']);
  await chrome.storage.local.set({ logoutReason: reason });
  console.log(`[LinkPortal] Logout wegen: ${reason}`);
}

// ── Alarm: Sync oder Expiry prüfen ──
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== ALARM_NAME) return;
  await checkExpiry();
  const { token } = await chrome.storage.sync.get(['token']);
  if (token) await syncInBackground();
});

// ── Hintergrund-Sync ──
async function syncInBackground() {
  const { baseUrl, token } = await chrome.storage.sync.get(['baseUrl', 'token']);
  if (!baseUrl || !token) return;

  try {
    const data = await fetchAllData(baseUrl, token);
    await chrome.storage.local.set({ cache: data, cacheTime: Date.now() });
    console.log('[LinkPortal] Sync OK:', new Date().toLocaleTimeString());
  } catch (err) {
    console.warn('[LinkPortal] Sync fehlgeschlagen:', err.message);
    // 403 → Logout
    if (err.message.includes('403')) await performLogout('403');
  }
}

// ── Alle Daten laden ──
async function fetchAllData(baseUrl, token) {
  const base = baseUrl.replace(/\/$/, '');

  async function get(path) {
    const res = await fetch(base + '/api' + path, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.status === 403) throw new Error('403');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const tabs = await get('/tabs');
  const result = { tabs, sections: {}, links: {}, syncTime: Date.now() };

  for (const tab of tabs) {
    const sections = await get(`/tabs/${tab.id}/sections`);
    result.sections[tab.id] = sections;
    for (const sec of sections) {
      try {
        const links = await get(`/sections/${sec.id}/links`);
        result.links[sec.id] = links;
      } catch {
        result.links[sec.id] = [];
      }
    }
  }
  return result;
}

// ── Message Handler ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'syncNow') {
    syncInBackground()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === 'fetchAndCache') {
    fetchAllData(msg.baseUrl, msg.token)
      .then(data => {
        chrome.storage.local.set({ cache: data, cacheTime: Date.now() });
        sendResponse({ ok: true, data });
      })
      .catch(err => {
        if (err.message.includes('403')) performLogout('403');
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (msg.action === 'logout') {
    performLogout(msg.reason || 'manual')
      .then(() => sendResponse({ ok: true }));
    return true;
  }
});
