// Sdílení odkazu: Web Share API, jinak schránka + toast (vždy z kliknutí).
const { test, expect } = require('./support/fixtures');

test.describe('Sdílení', () => {
  test('bez Web Share API zkopíruje odkaz na rozvrh do schránky a řekne to', async ({ page, app, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; });
    await app.open('/');
    await app.timetableReady();

    await page.click('#shareBtn');
    await expect(page.locator('.toast-title')).toHaveText(/zkopírován/);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?type=Class&id=C2A&schedule=Actual/);
  });

  test('s Web Share API předá odkaz systémovému sdílení z uživatelské akce', async ({ page, app, isMobile }) => {
    await page.addInitScript(() => {
      window.__shared = [];
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: async (d) => { window.__shared.push({ d, active: navigator.userActivation ? navigator.userActivation.isActive : null }); },
      });
      Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: () => true });
    });
    await app.open('/');
    await app.timetableReady();

    await page.click('#shareBtn');
    await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
    const [call] = await page.evaluate(() => window.__shared);
    // Denní rozvržení (mobil) sdílí i vybraný den, týdenní mřížka celý týden
    expect(call.d.url).toMatch(isMobile ? /type=Class&id=C2A&schedule=Actual&day=2$/ : /type=Class&id=C2A&schedule=Actual$/);
    expect(call.active).not.toBe(false);
    await expect(page.locator('.toast-title')).toHaveCount(0);
  });

  test('tabule změn sdílí odkaz i s filtrem', async ({ page, app, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; });
    await app.open('/?view=changes&class=C2A');
    await expect(page.locator('#changesList tbody tr').first()).toBeVisible();
    await page.click('#changesShare');
    await expect(page.locator('.toast-title')).toHaveText(/zkopírován/);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/view=changes.*class=C2A/);
  });
});
