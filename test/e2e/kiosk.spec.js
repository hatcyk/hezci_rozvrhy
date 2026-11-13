// Kiosk (/?kiosk=changes): tabule změn pro televizi ve vestibulu.
const { test, expect, school } = require('./support/fixtures');

test.describe('Kiosk', () => {
  test.skip(({ isMobile }) => isMobile, 'kiosk je pro velkou obrazovku');

  test('tabule dneška s hodinami a živými odběry, změna dorazí bez obnovení', async ({ page, app }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await app.open('/?kiosk=changes');
    await expect(page.locator('.k-row').first()).toBeVisible();

    await expect(page.locator('#kioskView')).toBeVisible();
    await expect(page.locator('.app-container')).toBeHidden();
    await expect(page.locator('#kioskDay')).toHaveText(/dnes, středa 4\. 11\./);
    await expect(page.locator('#kioskTime')).toHaveText('8:20');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => [window.__listenerCount('aggregates/changes_Actual'), window.__listenerCount('aggregates/changes_Next')])).toEqual([1, 1]);
    // Kiosk nežádá o notifikace ani nečte oblíbené
    expect(app.api.filter(c => /\/api\/(fcm|favorites)\//.test(c))).toEqual([]);

    const before = await page.locator('.k-row').count();
    await page.evaluate((agg) => {
      agg.days[2].items.push({ classId: 'C10A', className: '10.A', hour: 1, group: null, subject: 'Fyzika', teacher: 'Mgr. Olga Smyšlená', room: 'U15', kind: 'changed', description: 'Suplování: FYZ, Smyšlená Olga (MAT, Ukázková Jana)' });
      window.__fakeSet('aggregates/changes_Actual', agg);
    }, JSON.parse(JSON.stringify(school.docs['aggregates/changes_Actual'])));
    await expect(page.locator('.k-row')).toHaveCount(before + 1);
  });

  test('samo posouvá a tlačítko pauzy posouvání zastaví (WCAG 2.2.2)', async ({ page, app }) => {
    test.slow(); // posouvání začíná po 6s úvodní pauze (skutečný čas, ne page.clock)
    await page.setViewportSize({ width: 1280, height: 720 });
    await app.open('/?kiosk=changes');
    await expect(page.locator('.k-row').first()).toBeVisible();
    const board = page.locator('#kioskBoard');
    expect(await board.evaluate(b => b.scrollHeight - b.clientHeight), 'obsah musí přetékat').toBeGreaterThan(0);

    await expect.poll(() => board.evaluate(b => b.scrollTop), { timeout: 15_000 }).toBeGreaterThan(0);

    const pause = page.locator('#kioskPause');
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await expect(pause).toHaveText('Spustit posouvání');
    const stopped = await board.evaluate(b => b.scrollTop);
    await page.waitForTimeout(1500);
    expect(await board.evaluate(b => b.scrollTop)).toBe(stopped);

    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
  });

  test('po 15:00 ukazuje zítřek; bez Wake Lock srozumitelná hláška', async ({ page, app }) => {
    await page.addInitScript(() => { delete Navigator.prototype.wakeLock; });
    await app.open('/?kiosk=changes', { time: '2026-11-04T15:30:00+01:00' });
    await expect(page.locator('#kioskDay')).toHaveText(/zítra, čtvrtek 5\. 11\./);
    await expect(page.locator('#kioskWake')).toContainText('může zhasnout');
  });
});
