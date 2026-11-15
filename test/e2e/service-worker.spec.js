// Skutečný service worker v Chromiu (ostatní e2e testy ho blokují):
// instalace a precache, nasazení nové verze, selhaná instalace, navigace při
// výpadku serveru (spadlé spojení, 503, server neodpovídá) a hláška o nové verzi.
//
// Každý test má vlastní malý server nad public/ (port přidělí systém), aby šlo
// „nasadit“ verzi B a řídit výpadky. Skripty Firebase z gstatic nahrazuje
// atrapa ze stejného serveru; prohlížeč má navíc zakázané všechny cizí adresy.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { test: base, expect } = require('@playwright/test');
const { buildSchool } = require('./support/school');
const { installFakeFirebase } = require('./support/fake-firebase');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const GSTATIC = 'https://www.gstatic.com/firebasejs/9.22.0/';
const USER_ID = 'anon-00000000-0000-4000-8000-000000000000';
const school = buildSchool();

// Atrapa SDK pro worker (importScripts) i pro stránku (tam už window.firebase
// nastavila atrapa z addInitScript a tenhle skript nic nepřepíše)
const SDK_STUB = 'if (!self.firebase) self.firebase = { initializeApp() {}, messaging: () => ({ onBackgroundMessage() {} }) };';

const swSource = () => fs.readFileSync(path.join(PUBLIC, 'firebase-messaging-sw.js'), 'utf8');
const SHELL_A = /const SHELL_CACHE = '([^']+)';/.exec(swSource())[1];
const SHELL_B = 'bakalari-shell-bbbbbbbbbb-bbbbbbbbbb';
const PRECACHE_COUNT = 9 + 4; // soubory kostry + čtyři skripty Firebase

/** „Verze B“: jiné hashe balíků a jiný název mezipaměti, jinak stejná aplikace. */
const asVersionB = (text) => text.replace(/\?v=[a-f0-9]{10}/g, '?v=bbbbbbbbbb').replace(SHELL_A, SHELL_B);

function startServer() {
  const state = { version: 'A', failPath: null, navigation: 'ok', hits: {} };
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => { state.hits[req.path] = (state.hits[req.path] || 0) + 1; next(); });
  app.get('/__e2e/gstatic/:file', (req, res) => res.type('js').send(SDK_STUB));
  app.use('/api', (req, res) => {
    if (req.method === 'POST' && req.path === '/auth') return res.json({ token: 'e2e-custom-token', userId: USER_ID });
    if (req.method === 'GET' && req.path === '/status') return res.json({ isHealthy: true, lastSuccessAt: new Date().toISOString(), dataAgeMin: 5 });
    if (req.path === `/favorites/${USER_ID}`) return res.json({ favoriteTimetables: [] });
    return res.status(404).json({ error: 'v e2e testu není' });
  });
  app.get('/firebase-messaging-sw.js', (req, res) => {
    const sw = swSource().split(GSTATIC).join('/__e2e/gstatic/');
    res.set('Cache-Control', 'no-cache').type('js').send(state.version === 'B' ? asVersionB(sw) : sw);
  });
  app.get(['/', '/index.html'], (req, res) => {
    if (state.navigation === 'hang') return; // server mlčí
    if (state.navigation === 'down') return req.socket.destroy(); // spadlé spojení
    if (state.navigation === '503') return res.status(503).type('text').send('Service Unavailable');
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').split(GSTATIC).join('/__e2e/gstatic/');
    res.type('html').send(state.version === 'B' ? asVersionB(html).replace('<head>', '<head><meta name="e2e-version" content="B">') : html);
  });
  app.use((req, res, next) => (state.failPath && req.path === state.failPath ? res.status(503).send('e2e: výpadek') : next()));
  app.use(express.static(PUBLIC));
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({
      state,
      origin: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
    }));
  });
}

const test = base.extend({
  site: async ({ page }, use) => {
    const server = await startServer();
    await page.addInitScript(installFakeFirebase, {
      docs: school.docs, offline: false, userId: USER_ID,
      storage: { selectedType: 'Class', selectedValue: 'C2A', theme: 'dark' },
    });
    const site = {
      ...server,
      /** Otevře aplikaci a počká na vykreslený rozvrh. */
      async open(url = '/') {
        const response = await page.goto(server.origin + url, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#valueDropdownLabel')).toHaveText('2.A');
        return response;
      },
      /** Počká, až stránku řídí aktivní worker a žádný další se neinstaluje. */
      async workerSettled() {
        await expect.poll(() => page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          return !!(reg && reg.active && !reg.installing && !reg.waiting && navigator.serviceWorker.controller);
        })).toBe(true);
      },
      /** Mezipaměti kostry: název → počet položek. */
      caches: () => page.evaluate(async () => {
        const out = {};
        for (const name of await caches.keys()) out[name] = (await (await caches.open(name)).keys()).length;
        return out;
      }),
      shellKeys: (name) => page.evaluate(async (n) => (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search), name),
      version: () => page.evaluate(() => document.querySelector('meta[name="e2e-version"]')?.content || 'A'),
    };
    await use(site);
    await server.close();
  },
});

test.use({
  serviceWorkers: 'allow',
  // Nic mimo lokální server: cizí jména se vůbec nepřeloží
  launchOptions: { args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] },
});

test.describe('Service worker', () => {
  test('první návštěva: nainstaluje se, uloží jen kostru a aplikace se pak otevře i bez serveru', async ({ page, site }) => {
    const pageRequests = [];
    page.on('request', (r) => pageRequests.push(new URL(r.url()).pathname));
    await site.open('/');
    await site.workerSettled();

    expect(await site.caches()).toEqual({ [SHELL_A]: PRECACHE_COUNT });
    const keys = await site.shellKeys(SHELL_A);
    expect(keys).toContain('/');
    expect(keys.filter((k) => /icon-(180|512)|maskable|spsd_lo|index\.html/.test(k) && k !== '/spsd_logo_white.png')).toEqual([]);
    // Ikona v zavřeném dialogu nastavení se se stránkou nestahuje
    expect(pageRequests).not.toContain('/icon-192.png');

    site.state.navigation = 'down';
    for (const url of ['/', '/index.html', '/?view=changes', '/?type=Class&id=C2A&schedule=Actual&hl=change&day=2']) {
      const response = await site.open(url);
      expect(response.status(), url).toBe(200);
      expect(response.fromServiceWorker(), url).toBe(true);
    }
  });

  test('různé adresy aplikace nepřidávají další kopie index.html', async ({ site }) => {
    await site.open('/');
    await site.workerSettled();
    for (const url of ['/?view=changes', '/?view=rooms', '/?type=Class&id=C2A&schedule=Actual&hl=change&day=1',
      '/?type=Class&id=C2A&schedule=Next&hl=change', '/index.html?view=common']) {
      await site.open(url);
    }
    expect(await site.caches()).toEqual({ [SHELL_A]: PRECACHE_COUNT });
  });

  test('server odpovídá 503: otevře se aplikace z mezipaměti, ne chybová stránka (N15)', async ({ page, site }) => {
    await site.open('/');
    await site.workerSettled();
    site.state.navigation = '503';
    const response = await site.open('/?view=rooms');
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).not.toContainText('Service Unavailable');
    // Chybová odpověď kostru v mezipaměti nepřepsala
    site.state.navigation = 'down';
    await site.open('/');
  });

  test('server neodpovídá: po zhruba 3 s se otevře aplikace z mezipaměti', async ({ site }) => {
    await site.open('/');
    await site.workerSettled();
    site.state.navigation = 'hang';
    const started = Date.now();
    const response = await site.open('/?view=changes');
    const waited = Date.now() - started;
    expect(response.fromServiceWorker()).toBe(true);
    expect(waited).toBeGreaterThan(2500);
    expect(waited).toBeLessThan(8000);
  });

  test('nasazení nové verze: další načtení běží na nové verzi, stará mezipaměť zmizí, hláška se neukáže', async ({ page, site }) => {
    await site.open('/');
    await site.workerSettled();
    site.state.version = 'B';
    await site.open('/');
    expect(await site.version()).toBe('B');
    await expect.poll(() => site.caches()).toEqual({ [SHELL_B]: PRECACHE_COUNT });
    await site.workerSettled();
    await expect(page.locator('#updateBanner')).toBeHidden();
  });

  test('otevřená karta se o nové verzi dozví a obnoví se až na pokyn uživatele', async ({ page, site }) => {
    await site.open('/');
    await site.workerSettled();
    await expect(page.locator('#updateBanner')).toBeHidden();
    await page.evaluate(() => { window.__notReloaded = true; });

    site.state.version = 'B';
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const banner = page.locator('#updateBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText(/Je k dispozici nová verze\./);
    await expect(banner).toHaveAttribute('role', 'status');
    expect(await page.evaluate(() => window.__notReloaded), 'stránka se sama neobnovila').toBe(true);
    expect(await site.version()).toBe('A');

    await banner.getByRole('button', { name: 'Obnovit' }).click();
    await expect.poll(() => site.version()).toBe('B');
    await expect(page.locator('#valueDropdownLabel')).toHaveText('2.A');
    await expect(page.locator('#updateBanner')).toBeHidden();
  });

  test('selhaná instalace nové verze nechá starou verzi i její mezipaměť funkční a příště se zopakuje', async ({ page, site }) => {
    await site.open('/');
    await site.workerSettled();

    // Nasazení, při kterém se jeden soubor kostry nestáhne
    site.state.version = 'B';
    site.state.failPath = '/icons.svg';
    const before = site.state.hits['/icons.svg'] || 0;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect.poll(() => site.state.hits['/icons.svg'] || 0).toBeGreaterThan(before);
    await site.workerSettled();

    const caches = await site.caches();
    expect(caches[SHELL_A], 'stará mezipaměť zůstala celá').toBe(PRECACHE_COUNT);
    expect(caches[SHELL_B] || 0, 'nová mezipaměť je prázdná').toBe(0);
    await expect(page.locator('#updateBanner')).toBeHidden();

    // Stará verze dál funguje bez serveru
    site.state.navigation = 'down';
    const offline = await site.open('/?view=changes');
    expect(offline.fromServiceWorker()).toBe(true);
    expect(await site.version()).toBe('A');

    // Další návštěva po odeznění výpadku instalaci zopakuje a dokončí
    site.state.navigation = 'ok';
    site.state.failPath = null;
    await site.open('/');
    await expect.poll(() => site.caches()).toEqual({ [SHELL_B]: PRECACHE_COUNT });
  });
});
