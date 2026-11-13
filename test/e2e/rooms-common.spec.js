// Volné učebny (agregát freeRooms, smlouva S3) a Společné volno (výpočet
// z rozvrhů vybraných vyučujících a tříd).
const { test, expect } = require('./support/fixtures');

const slotTitles = (page) => page.locator('.rooms-slot-title');

test.describe('Volné učebny', () => {
  test('během 1. hodiny ukáže „Teď“ a „Další hodina“ s poznámkou o rezervacích', async ({ page, app }) => {
    await app.open('/?view=rooms');
    await expect(slotTitles(page)).toHaveCount(2);
    await expect(slotTitles(page).nth(0)).toHaveText(/^Teď.*1\. hodina/s);
    await expect(slotTitles(page).nth(1)).toHaveText(/^Další hodina.*2\. hodina/s);
    await expect(page.locator('#roomsNow')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#roomsResult .room-link').first()).toBeVisible();
    await expect(page.locator('#roomsView .view-note')).toContainText('rozvrhu');
  });

  test('skrytí učebny přežije obnovení stránky, fokus přejde na „Skryté učebny“', async ({ page, app }) => {
    await app.open('/?view=rooms');
    const first = page.locator('#roomsResult .room-link').first();
    const id = await first.getAttribute('data-room');
    await page.click(`#roomsResult button[data-room="${id}"]`);

    await expect(page.locator(`#roomsResult .room-link[data-room="${id}"]`)).toHaveCount(0);
    await expect(page.locator('#roomsHiddenCount')).toHaveText('1');
    await expect(page.locator('#roomsHiddenSummary')).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('hiddenRooms'))).toBe(JSON.stringify([id]));

    await page.reload();
    await expect(page.locator('#roomsResult .room-link').first()).toBeVisible();
    await expect(page.locator(`#roomsResult .room-link[data-room="${id}"]`)).toHaveCount(0);
  });

  test('výběr dne a hodiny se propíše do adresy, proklik otevře rozvrh učebny a Zpět vrátí pohled', async ({ page, app }) => {
    await app.open('/?view=rooms');
    await expect(slotTitles(page).first()).toBeVisible();
    await page.selectOption('#roomsDay', '2026-11-05');
    await page.selectOption('#roomsHour', '4');
    await expect(page).toHaveURL(/date=2026-11-05/);
    await expect(page).toHaveURL(/hour=4/);
    await expect(slotTitles(page).first()).toHaveText(/Vybraná hodina.*4\. hodina/s);

    const link = page.locator('#roomsResult .room-link').first();
    const name = (await link.innerText()).trim();
    await link.click();
    await app.timetableReady(name);
    await expect(page.locator('.type-btn[aria-pressed="true"]')).toHaveAttribute('data-type', 'Room');

    await page.goBack();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.view)).toBe('rooms');
  });

  test('v pátek odpoledne nabídne pondělí příštího týdne', async ({ page, app }) => {
    await app.open('/?view=rooms', { time: '2026-11-06T16:30:00+01:00' });
    await expect(slotTitles(page).first()).toHaveText(/Příští školní den.*pondělí 9\. 11\./s);
  });
});

test.describe('Společné volno', () => {
  test('odkaz se 3 vybranými spočítá volné hodiny', async ({ page, app }) => {
    await app.open('/?view=common&with=Teacher:T1,Teacher:T3,Class:C2A');
    await expect(page.locator('#commonChosen .chip')).toHaveCount(3);
    await expect(page.locator('#commonStatus')).toContainText('hodin');
    expect(await page.locator('.cg-cell.is-free, .cg-cell.is-ideal').count()).toBeGreaterThan(0);
    await expect(page.locator('.common-summary li').first()).toBeVisible();
  });

  test('výběr přes seznam, stálý rozvrh, odebrání vrátí fokus na výběr', async ({ page, app }) => {
    await app.open('/?view=common');
    await expect(page.locator('#commonPick')).toBeVisible();
    await page.selectOption('#commonPick', 'Teacher:T2');
    await page.click('#commonAdd');
    await page.selectOption('#commonPick', 'Class:C1A');
    await page.click('#commonAdd');
    await expect(page.locator('#commonChosen .chip')).toHaveCount(2);
    await expect(page).toHaveURL(/with=(Teacher%3AT2%2CClass%3AC1A|Teacher:T2,Class:C1A)/);

    await page.click('#commonWeek [data-week="permanent"]');
    await expect(page).toHaveURL(/week=permanent/);
    await expect(page.locator('#commonStatus')).toContainText(/podle stálého rozvrhu/i);

    await page.locator('#commonChosen .chip-remove').first().click();
    await expect(page.locator('#commonChosen .chip')).toHaveCount(1);
    await expect(page.locator('#commonPick')).toBeFocused();
    await expect(page.locator('#commonStatus')).toContainText('ještě');
  });
});
