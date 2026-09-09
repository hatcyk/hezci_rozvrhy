#!/usr/bin/env node
/**
 * End-to-end check of the notification on/off flow, driven through a real
 * browser against a running instance of the app.
 *
 * It seeds a throwaway user that already has a token (as if notifications had
 * been enabled in an earlier session), then clicks through the actual UI and
 * asserts what reached the server. Deletes nothing: remove the e2e-notif-*
 * user documents afterwards if you care about tidiness.
 *
 * Needs Google Chrome and a running server with Firebase credentials:
 *   FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json PORT=3456 npm start
 *   APP_URL=http://127.0.0.1:3456 node tools/e2e-notifications.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT || 9370);
const BASE = (process.env.APP_URL || 'http://127.0.0.1:3456').replace(/\/$/, '');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'rozvrh-e2e-'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const USER = 'e2e-notif-' + Date.now();
const TOKEN = 'FAKE_TOKEN_' + Date.now();

const api = async (path, body) => {
  const r = await fetch(BASE + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
};
const prefs = () => api(`/api/fcm/preferences/${USER}`);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  // 1. seed: user with a token + one watched class incl. lesson reminders
  await api('/api/fcm/subscribe', { userId: USER, token: TOKEN });
  await api('/api/fcm/update-preferences', { userId: USER, watchedTimetables: [
    { type: 'Class', id: 'ZL', name: '2.A', scheduleType: 'Actual', groupFilters: [],
      notificationTypes: { changes: { lesson_removed: true, substitution: true, room_change: true, lesson_added: false, subject_change: false },
                           reminders: { next_lesson_room: true, next_lesson_teacher: false, next_lesson_subject: false } } },
    { type: 'Class', id: 'ZL', name: '2.A', scheduleType: 'Next', groupFilters: [],
      notificationTypes: { changes: { lesson_removed: true, substitution: true, room_change: true, lesson_added: false, subject_change: false },
                           reminders: { next_lesson_room: true, next_lesson_teacher: false, next_lesson_subject: false } } },
  ]});
  const seeded = await prefs();
  console.log(`seeded user ${USER}: hasTokens=${seeded.hasTokens} watched=${seeded.watchedTimetables.length}\n`);

  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
    `--user-data-dir=${OUT}/p${PORT}`, '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
  let t; for (let i = 0; i < 40; i++) { try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.length) break; } catch {} await sleep(250); }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(); const netLog = []; let prefLoads = 0;
  ws.onmessage = (m) => { const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === 'Network.requestWillBeSent' && d.params.request.url.includes('/api/fcm/')) { netLog.push(d.params.request.method + ' ' + d.params.request.url.replace(BASE, '')); if (d.params.request.url.includes('/preferences/')) prefLoads++; }
    if (d.method === 'Fetch.requestPaused') { const p = d.params;
      const h = Object.entries(p.request.headers).filter(([k]) => k.toLowerCase() !== 'referer').map(([name, value]) => ({ name, value }));
      h.push({ name: 'Referer', value: 'https://spsd-rozvrhy.vercel.app/' });
      ws.send(JSON.stringify({ id: ++id, method: 'Fetch.continueRequest', params: { requestId: p.requestId, headers: h } })); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.exceptionDetails ? 'EXC ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) : r.result?.result?.value; };

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*googleapis.com*' }] });
  await send('Browser.grantPermissions', { origin: BASE, permissions: ['notifications'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('userId', ${JSON.stringify(USER)});` });

  const bellOn = () => ev(`!document.getElementById('notificationBell').classList.contains('disabled')`);
  // Poll instead of sleeping: the bell is painted after preferences come back.
  const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms;
    while (Date.now() < end) { if (await fn() === true) return true; await sleep(300); } return false; };
  // Wait until the app has (re)read notification preferences after a navigation.
  const settle = async () => { const seen = prefLoads;
    await waitFor(async () => prefLoads > seen, 15000); await sleep(800); };

  const goto = async () => {
    const seen = prefLoads;
    await send('Page.navigate', { url: BASE + '/' });
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (await ev(`!!document.querySelector('.lesson-card, .compact-lesson-item, .agenda-row, .lesson-card-full')`)) break;
    }
    await waitFor(async () => prefLoads > seen, 30000);
    await sleep(800);
  };

  await goto();
  console.log(`permission = ${await ev('Notification.permission')}`);
  check('bell shows ON after load (token exists on server)', await waitFor(bellOn));

  // open the notification modal and press "turn off"
  await ev(`document.getElementById('notificationBell').click(); 'x'`);
  await settle();
  const disableVisible = await ev(`(() => { const b = document.getElementById('notificationToggleDisable'); return b && getComputedStyle(b).display !== 'none'; })()`);
  check('modal offers the "turn off" button', disableVisible === true);

  const listBlocked = await ev(`(() => { const l = document.getElementById('flatTimetableList'); return l ? getComputedStyle(l).pointerEvents === 'none' : null; })()`);
  check('watched-class list is usable while notifications are ON', listBlocked === false, listBlocked ? 'list is pointer-events:none, class cannot be changed' : '');

  netLog.length = 0;
  await ev(`document.getElementById('notificationToggleDisable').click(); 'x'`);
  await sleep(5000);
  console.log(`  fcm calls after clicking off: ${JSON.stringify(netLog)}`);

  const afterDisable = await prefs();
  check('server really dropped the token after "turn off"', afterDisable.hasTokens === false, `hasTokens=${afterDisable.hasTokens}`);
  check('bell shows OFF right after clicking off', (await ev(`document.getElementById('notificationBell').classList.contains('disabled')`)) === true);

  // the reported symptom: it comes back on by itself a moment later
  await ev(`document.getElementById('notificationBell').click(); 'x'`);  // reopen -> reloads preferences
  await settle();
  await sleep(2000);
  check('stays OFF after reopening the modal', (await bellOn()) === false);

  // and after a reload (boot-time reconcile runs here)
  await goto();
  await sleep(2000);
  const afterReload = await prefs();
  check('stays OFF after a page reload', (await bellOn()) === false);
  check('server still has no token after reload', afterReload.hasTokens === false, `hasTokens=${afterReload.hasTokens}`);

  // --- the permission prompt must be asked for before anything is awaited ---
  // Browsers only prompt while the click still counts as user activation, so
  // registering the service worker first meant Firefox never asked at all.
  await ev(`(() => {
    window.__order = [];
    window.__alerts = [];
    window.alert = (m) => window.__alerts.push(String(m));       // alert() would block CDP
    Notification.requestPermission = () => { window.__order.push('permission'); return Promise.resolve('default'); };
    const sw = navigator.serviceWorker;
    const reg = sw.register.bind(sw), get = sw.getRegistration.bind(sw);
    sw.register = (...a) => { window.__order.push('sw'); return reg(...a); };
    sw.getRegistration = (...a) => { window.__order.push('sw'); return get(...a); };
    return 'stubbed';
  })()`);
  await ev(`document.getElementById('notificationBell').click(); 'x'`);
  await settle();
  await ev(`document.getElementById('notificationToggleEnable').click(); 'x'`);
  await sleep(3000);
  const order = await ev(`JSON.stringify(window.__order)`);
  const alerts = await ev(`JSON.stringify(window.__alerts)`);
  check('permission is requested before the service worker is touched', JSON.parse(order)[0] === 'permission', `order=${order}`);
  check('a dismissed prompt is reported as dismissed, not as denied', /znovu/.test(alerts), `alert=${alerts}`);

  // --- switching the watched class while notifications are ON ---
  await api('/api/fcm/subscribe', { userId: USER, token: TOKEN + '_2' });
  const reEnabled = await prefs();
  check('re-subscribing turns notifications back on server-side', reEnabled.notificationsEnabled === true, `notificationsEnabled=${reEnabled.notificationsEnabled}`);

  await goto();
  check('bell is ON again after re-enabling', await waitFor(bellOn));

  await ev(`document.getElementById('notificationBell').click(); 'x'`);
  await settle();
  const before = await prefs();
  const beforeIds = before.watchedTimetables.map(t => t.id).join(',');

  const toggled = await ev(`(() => {
    const inputs = [...document.querySelectorAll('#flatTimetableList .flat-toggle-input')];
    const off = inputs.find(i => !i.checked);
    if (!off) return null;
    off.click();
    return off.dataset.name + '|' + off.dataset.id;
  })()`);
  await sleep(4000);
  const after = await prefs();
  const newId = toggled ? toggled.split('|')[1] : null;
  check('a class can be added while notifications stay ON', !!toggled && after.watchedTimetables.some(t => t.id === newId),
        `toggled=${toggled} before=[${beforeIds}] after=[${after.watchedTimetables.map(t => t.id).join(',')}]`);
  check('switching the class did not turn notifications off', after.notificationsEnabled === true, `notificationsEnabled=${after.notificationsEnabled}`);

  console.log(`\n${pass} passed, ${fail} failed  (user ${USER})`);
  ws.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('harness failed:', e.message); process.exit(2); });
