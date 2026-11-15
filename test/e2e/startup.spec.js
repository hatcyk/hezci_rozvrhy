// Start aplikace: jen požadavky, které běžný uživatel potřebuje.
const { test, expect } = require('./support/fixtures');

test.describe('Požadavky při startu', () => {
  test('nastavení upozornění se načte jednou a ladicí stav se při startu nezjišťuje', async ({ page, app, isMobile }) => {
    await app.open('/');
    await app.timetableReady();
    await expect.poll(() => app.api.filter(c => c.startsWith('GET /api/fcm/preferences/')).length).toBe(1);
    // Druhý požadavek dřív odcházel až po načtení seznamů; chvíli počkat, jestli nepřijde
    await page.waitForTimeout(1500);
    expect(app.api.filter(c => c.startsWith('GET /api/fcm/preferences/'))).toHaveLength(1);
    expect(app.api.filter(c => c.includes('/api/debug/'))).toEqual([]);

  });

  test('ladicí stav se zjistí až s panelem Upozornění, a jen jednou', async ({ page, app, isMobile }) => {
    test.skip(isMobile, 'zvonek je na počítači; na mobilu se panel otevírá z nabídky');
    await app.open('/');
    await app.timetableReady();
    for (let i = 0; i < 2; i++) {
      await page.click('#notificationBell');
      await expect(page.locator('#notificationModal')).toHaveAttribute('open', '');
      await expect.poll(() => app.api.filter(c => c === 'GET /api/debug/status').length).toBe(1);
      await page.keyboard.press('Escape');
      await expect(page.locator('#notificationModal')).not.toHaveAttribute('open', '');
    }
    expect(app.api.filter(c => c === 'GET /api/debug/status')).toHaveLength(1);
  });
});
