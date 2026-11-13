// Automatický audit přístupnosti (axe-core, WCAG 2.2 A/AA) v obou motivech.
// Automat najde jen část problémů – ruční kontrola se čtečkou a zoomem zůstává.
const { test, expect, axeViolations, LESSON } = require('./support/fixtures');

/** [název, URL, příprava stavu] */
const STATES = [
  ['rozvrh', '/', async (page, app) => { await app.timetableReady(); }],
  ['detail hodiny', '/', async (page, app) => {
    await app.timetableReady();
    await page.locator(LESSON).filter({ visible: true }).first().click();
    await expect(page.locator('#lessonModal')).toHaveAttribute('open', '');
  }],
  ['detail změněné hodiny (původně → nyní)', '/', async (page, app) => {
    await app.timetableReady();
    await page.locator(LESSON).filter({ visible: true }).and(page.locator('[data-changed="true"]')).first().click();
    await expect(page.locator('#modalDiff')).toBeVisible();
  }],
  ['jen změny', '/', async (page, app) => {
    await app.timetableReady();
    await page.click('#onlyChangesBtn');
    await expect(page.locator('.oc-day').first()).toBeVisible();
  }],
  ['nastavení / notifikace', '/', async (page, app, isMobile) => {
    await app.timetableReady();
    await page.click(isMobile ? '#settingsToggle' : '#notificationBell');
    await expect(page.locator(isMobile ? '#settingsModal' : '#notificationModal')).toHaveAttribute('open', '');
  }],
  ['do kalendáře', '/', async (page, app) => {
    await app.timetableReady();
    await page.click('#calendarBtn');
    await expect(page.locator('#calendarModal')).toHaveAttribute('open', '');
  }],
  ['změny', '/?view=changes', async (page) => { await expect(page.locator('#changesList tbody tr').first()).toBeVisible(); }],
  ['volné učebny', '/?view=rooms', async (page) => { await expect(page.locator('#roomsResult .room-link').first()).toBeVisible(); }],
  ['společné volno', '/?view=common&with=Teacher:T1,Class:C2A', async (page) => { await expect(page.locator('.common-summary li').first()).toBeVisible(); }],
];

test.describe('Přístupnost (axe)', () => {
  for (const theme of ['dark', 'light']) {
    for (const [name, url, prepare] of STATES) {
      test(`${name} – ${theme === 'dark' ? 'tmavý' : 'světlý'} motiv: 0 porušení`, async ({ page, app, isMobile }) => {
        await app.open(url, { theme });
        await prepare(page, app, isMobile);
        expect(await axeViolations(page)).toEqual([]);
      });
    }
  }

  test('kiosk: 0 porušení', async ({ page, app, isMobile }) => {
    test.skip(isMobile, 'kiosk je pro velkou obrazovku');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await app.open('/?kiosk=changes');
    await expect(page.locator('.k-row').first()).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});
