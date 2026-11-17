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

  test('Vercel Analytics a Speed Insights z vlastní domény, až po načtení stránky; mimo Vercel 404 nic nerozbije', async ({ page, app }) => {
    const scripts = ['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js'];
    // Pořadí událostí z prohlížeče: načtení stránky, pak teprve požadavky analytiky
    const events = [];
    page.on('load', () => events.push('load'));
    page.on('request', r => { if (scripts.includes(new URL(r.url()).pathname)) events.push(r.url()); });
    const failed = [];
    page.on('response', r => { if (scripts.includes(new URL(r.url()).pathname)) failed.push(r.status()); });
    await app.open('/');
    await app.timetableReady();
    await expect.poll(() => events.filter(e => e !== 'load').length).toBe(2);
    expect(events[0], 'mimo kritickou cestu: až po události load').toBe('load');
    for (const url of events.slice(1)) expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/_vercel\/(insights|speed-insights)\/script\.js$/);
    // Statický server testů (jako `npm start` mimo Vercel) skripty nemá
    await expect.poll(() => failed).toEqual([404, 404]);
    expect(await page.evaluate(() => typeof window.va === 'function' && typeof window.si === 'function'),
      'fronty window.va / window.si podle návodu Vercelu').toBe(true);
    await expect(page.locator('#error')).toBeHidden();
  });
});
