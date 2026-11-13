// Společné prostředí e2e testů: syntetická škola, atrapa Firebase a API,
// zablokovaná síť mimo lokální server a pevně nastavený čas.
// Nic se nepřipojuje k produkci (Firebase, Bakaláři, Vercel, GitHub).
const { test: base, expect } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');
const { buildSchool } = require('./school');
const { installFakeFirebase } = require('./fake-firebase');

const school = buildSchool();
const USER_ID = 'anon-00000000-0000-4000-8000-000000000000';
/** Středa 4. 11. 2026 8:20 – probíhá 1. hodina. */
const NOW = '2026-11-04T08:20:00+01:00';
const HEALTHY = { isHealthy: true, lastSuccessAt: '2026-11-04T07:15:00.000Z', dataAgeMin: 5 };
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
/** Karty hodin ve všech pěti rozvrženích. */
const LESSON = '.lesson-card, .card-lesson-half, .compact-lesson-item:not(.compact-empty-lesson):not(.compact-lesson-split), .compact-lesson-half, .agenda-row[data-lesson-id]';

/** Odpověď atrapy backendu; cokoli neznámého je 404, aby se nic neočekávaného neschovalo. */
function apiResponse(method, pathname, status) {
  if (method === 'POST' && pathname === '/api/auth') return { json: { token: 'e2e-custom-token', userId: USER_ID } };
  if (method === 'GET' && pathname === '/api/status') return { json: status };
  if (pathname === `/api/favorites/${USER_ID}`) return { json: method === 'GET' ? { favoriteTimetables: [] } : { success: true } };
  return { status: 404, json: { error: 'v e2e testu není' } };
}

const test = base.extend({
  app: async ({ page, context }, use) => {
    const errors = [];
    const blocked = new Set();
    const api = [];
    let status = HEALTHY;

    page.on('pageerror', e => errors.push(e.message));
    // alert()/confirm() aplikace už nepoužívá (nahradily je toasty a <dialog>)
    page.on('dialog', d => { errors.push(`nativní dialog ${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });

    await context.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (!LOCAL_HOSTS.has(url.hostname)) {
        blocked.add(url.hostname);
        return route.abort('blockedbyclient');
      }
      if (url.pathname.startsWith('/api/')) {
        api.push(`${req.method()} ${url.pathname}`);
        const r = apiResponse(req.method(), url.pathname, status);
        return route.fulfill({ status: r.status || 200, json: r.json, headers: { 'Cache-Control': 'no-store' } });
      }
      return route.continue();
    });

    const app = {
      school, errors, blocked, api,
      /**
       * Otevře aplikaci se syntetickými daty.
       * @param {string} [url]
       * @param {{ time?: string|null, theme?: 'dark'|'light', layout?: string, selected?: string,
       *   docs?: Record<string, object|null>, storage?: Record<string,string>, offline?: boolean,
       *   reducedMotion?: 'reduce'|'no-preference', status?: object }} [opts]
       */
      async open(url = '/', opts = {}) {
        const { time = NOW, theme = 'dark', layout, selected = 'Class:C2A', docs = {}, storage = {}, offline = false, reducedMotion = 'no-preference' } = opts;
        if (opts.status) status = opts.status;
        if (time) await page.clock.setFixedTime(new Date(time));
        await page.emulateMedia({ colorScheme: theme, reducedMotion });
        const [selectedType, selectedValue] = selected.split(':');
        const seed = { selectedType, selectedValue, theme, ...(layout ? { layoutMode: layout } : {}), ...storage };
        await page.addInitScript(installFakeFirebase, { docs: { ...school.docs, ...docs }, storage: seed, offline, userId: USER_ID });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      },
      /** Počká, až je vykreslený rozvrh s daným názvem v roletce. */
      async timetableReady(label = '2.A') {
        await expect(page.locator('#valueDropdownLabel')).toHaveText(label);
        await expect(page.locator(LESSON).filter({ visible: true }).first()).toBeVisible();
      },
      setStatus(next) { status = next; },
    };

    await use(app);

    // Každý test zároveň hlídá, že stránka nevyhodila výjimku a nešla mimo povolené adresy
    expect(errors, 'chyby JavaScriptu na stránce').toEqual([]);
    const allowed = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com', 'cdn.jsdelivr.net', 'api.sunrisesunset.io']);
    expect([...blocked].filter(h => !allowed.has(h)), 'neočekávané požadavky mimo lokální server').toEqual([]);
  },
});

/** Porušení WCAG 2.2 A/AA podle axe ve čitelném tvaru (prázdné pole = v pořádku). */
async function axeViolations(page, { include } = {}) {
  // Kontrast se počítá z vykreslených barev: během animace (vysouvání panelu,
  // prolínání) by vyšel špatně, proto se čeká na doběhnutí konečných animací
  await page.waitForFunction(() => document.getAnimations()
    .filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity)
    .length === 0, null, { timeout: 5_000 });
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  return result.violations.map(v => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map(n => n.target.join(' ') + (v.id === 'color-contrast' ? ` (${(n.any[0] || {}).data?.contrastRatio}:1)` : '')),
  }));
}

module.exports = { test, expect, axeViolations, school, NOW, HEALTHY, LESSON, USER_ID };
