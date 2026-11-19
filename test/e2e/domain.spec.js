// Aplikace na jiné doméně, než na které ji testy jinak otevírají (cílově vlastní
// doména vedle *.vercel.app): nic v klientu nesmí předpokládat adresu nasazení.
// Stránka běží na https://rozvrh.domena.test (doména .test je vyhrazená,
// RFC 6761, nikde neexistuje). Každý požadavek na ni obslouží Playwright:
// soubory z lokálního statického serveru, /api/* atrapa z fixtures. Prohlížeč
// se tak nikam nepřipojí a stránka má přesto vlastní zabezpečený původ.
const { test, expect, apiResponse, HEALTHY } = require('./support/fixtures');

const HOST = 'rozvrh.domena.test';
const ORIGIN = `https://${HOST}`;

/** Obslouží požadavky na HOST (registrované po atrapě z fixtures, proto mají přednost). */
async function serveAs(context, baseURL, seen) {
  await context.route((url) => url.hostname === HOST, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    seen.push(`${req.method()} ${url.pathname}`);
    if (url.pathname.startsWith('/api/')) {
      const r = apiResponse(req.method(), url.pathname, HEALTHY);
      return route.fulfill({ status: r.status || 200, json: r.json, headers: { 'Cache-Control': 'no-store' } });
    }
    const response = await route.fetch({ url: baseURL + url.pathname + url.search });
    return route.fulfill({ response });
  });
}

test.describe('Jiná doména', () => {
  test('aplikace se na jiné doméně načte, přihlásí a mluví jen se svým původem', async ({ page, app, context, baseURL }) => {
    const seen = [];
    const hosts = new Set();
    page.on('request', (r) => hosts.add(new URL(r.url()).hostname));
    await serveAs(context, baseURL, seen);

    await app.open(`${ORIGIN}/`);
    await app.timetableReady();
    expect(await page.evaluate(() => [location.origin, window.isSecureContext])).toEqual([ORIGIN, true]);
    expect(seen).toContain('POST /api/auth');
    expect(seen).toContain('GET /api/status');
    // nic na adresu testovacího serveru ani na *.vercel.app; cizí servery jen ty, které fixtures povolují
    const allowed = new Set([HOST, 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com', 'api.sunrisesunset.io']);
    expect([...hosts].filter((h) => !allowed.has(h))).toEqual([]);
  });

  test('odkaz pro sdílení a odběr kalendáře vedou na aktuální doménu', async ({ page, app, context, baseURL }) => {
    await serveAs(context, baseURL, []);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    await page.addInitScript(() => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; });
    await app.open(`${ORIGIN}/`);
    await app.timetableReady();

    await page.click('#moreBtn');
    await page.click('#shareBtn');
    await expect(page.locator('.toast-title')).toHaveText(/zkopírován/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^https:\/\/rozvrh\.domena\.test\/\?type=Class&id=C2A&schedule=Actual/);

    await page.click('#moreBtn');
    await page.click('#calendarBtn');
    await expect(page.locator('#calendarSubscribe')).toHaveAttribute('href', 'webcal://rozvrh.domena.test/api/ical/Class/C2A.ics?schedule=actual,next');
  });

  test('manifest: id, start_url a scope patří aktuální doméně (instalace je vázaná na původ)', async ({ page, app, context, baseURL }) => {
    await serveAs(context, baseURL, []);
    await app.open(`${ORIGIN}/`);
    await app.timetableReady();
    const m = await page.evaluate(async () => {
      const href = document.querySelector('link[rel="manifest"]').href;
      const json = await (await fetch(href)).json();
      const start = new URL(json.start_url, href);
      // id se podle specifikace manifestu vztahuje k původu start_url
      return { href, start: start.href, scope: new URL(json.scope, href).href, id: new URL(json.id, start.origin).href };
    });
    expect(m).toEqual({ href: `${ORIGIN}/manifest.webmanifest`, start: `${ORIGIN}/`, scope: `${ORIGIN}/`, id: `${ORIGIN}/` });
  });
});
