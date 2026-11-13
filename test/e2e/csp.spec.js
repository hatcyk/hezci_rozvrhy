// Příprava na vynucení CSP (DEPLOYMENT.md): aplikace dnes posílá
// Content-Security-Policy-Report-Only. Tento test stejnou politiku VYNUTÍ
// v prohlížeči a ověří, že nic z aplikace nezablokuje – tedy že hashe inline
// skriptů sedí a seznam zdrojů je úplný.
const fs = require('fs');
const path = require('path');
const { test, expect, LESSON } = require('./support/fixtures');
const { buildAppCsp, inlineScriptHashes } = require('../../backend/security-headers');

const INDEX_HTML = path.join(__dirname, '..', '..', 'public', 'index.html');
const APP_CSP = buildAppCsp({ scriptHashes: inlineScriptHashes(fs.readFileSync(INDEX_HTML, 'utf8')) });

test.beforeEach(async ({ page }) => {
  // Hlavička jen pro dokument (navigace), stejně jako ji posílá server
  await page.route((url) => url.pathname === '/' || url.pathname === '/index.html', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': APP_CSP } });
  });
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
});

const violations = (page) => page.evaluate(() => window.__csp);

test.describe('Vynucená CSP', () => {
  test('rozvrh, detail a panely běží bez porušení; vložený inline skript se zablokuje', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await page.locator(LESSON).filter({ visible: true }).first().click();
    await expect(page.locator('#lessonModal')).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await page.click('#calendarBtn');
    await expect(page.locator('#calendarModal')).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    expect(await violations(page)).toEqual([]);

    // Kontrola, že politika opravdu platí: cizí inline skript neproběhne
    await page.evaluate(() => {
      const s = document.createElement('script');
      s.textContent = 'window.__injected = 1';
      document.body.append(s);
    });
    expect(await page.evaluate(() => window.__injected)).toBeUndefined();
    await expect.poll(() => violations(page)).toEqual([expect.stringMatching(/^script-src/)]);
  });

  for (const url of ['/?view=changes', '/?view=rooms', '/?view=common&with=Teacher:T1,Class:C2A', '/?kiosk=changes']) {
    test(`${url}: bez porušení`, async ({ page, app }) => {
      await app.open(url);
      await expect(page.locator('#changesList tbody tr, #roomsResult .room-link, .common-summary li, .k-row').first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
});
