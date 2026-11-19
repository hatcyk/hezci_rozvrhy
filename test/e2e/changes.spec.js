// Pohled „Změny“: tabule změn celé školy z agregátů (smlouva S3).
const { test, expect } = require('./support/fixtures');

const rows = (page) => page.locator('#changesList tbody tr');

test.describe('Změny dnes', () => {
  test('tabule dneška: třídy, sloučené suplování, stáří dat, jen 2 čtení', async ({ page, app }) => {
    await app.open('/?view=changes');
    await expect(rows(page).first()).toBeVisible();
    await expect(page.locator('#changesSummary')).toHaveText(/^Dnes/);
    await expect(page.locator('#changesQuickDays [aria-pressed="true"]')).toHaveText('Dnes');
    await expect(page.locator('#changesFreshness')).not.toBeEmpty();

    // Třídy seřazené přirozeně (2.A < 10.A), ve středu mají změny 1.A, 2.A, 3.C, 4.D a 10.A
    const titles = await page.locator('#changesList .chg-class-title').allInnerTexts();
    expect(titles.map(t => t.trim().split(/\s/)[0])).toEqual(['1.A', '2.A', '3.C', '4.D', '10.A']);

    // 2.A: suplování (changed + přeškrtnutý originál) je jeden řádek „původně → nyní“
    const section = page.locator('.chg-class').filter({ has: page.locator('h3', { hasText: /^2\.A/ }) });
    const classRows = (await section.locator('tbody tr').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
    expect(classRows).toHaveLength(4);
    expect(classRows.find(r => r.startsWith('3.'))).toMatch(/Suplování/i);

    // Tabule čte dva souhrnné dokumenty, ne rozvrhy všech tříd. Na pozadí se
    // načte jen uložený rozvrh, aby byla záložka „Rozvrh“ hned připravená
    // (návrh G: rám aplikace ukazuje v přehledu i počet volných učeben, proto smí číst freeRooms).
    const reads = await page.evaluate(() => window.__reads.filter(p => p.startsWith('aggregates/') || p.startsWith('timetables/')));
    const aggs = new Set(reads.filter(p => p.startsWith('aggregates/')));
    expect(aggs.has('aggregates/changes_Actual') && aggs.has('aggregates/changes_Next')).toBe(true);
    expect([...aggs].filter(p => !/^aggregates\/(changes|freeRooms)_(Actual|Next)$/.test(p))).toEqual([]);
    expect(reads.filter(p => p.startsWith('timetables/') && p !== 'timetables/Class_C2A_Actual')).toEqual([]);
  });

  test('filtr třídy a vyučujícího se propíše do adresy', async ({ page, app }) => {
    await app.open('/?view=changes');
    await expect(rows(page).first()).toBeVisible();

    await page.selectOption('#changesClass', 'C1A');
    await expect(page).toHaveURL(/class=C1A/);
    await expect(rows(page)).toHaveCount(2);

    await page.selectOption('#changesClass', '');
    await page.selectOption('#changesTeacher', 'T8');
    // Jméno se páruje i se zkráceným tvarem v popisu suplování
    await expect(rows(page).first()).toBeVisible();
    for (const text of await rows(page).allInnerTexts()) expect(text).toContain('Šablonový');

    // Obnovení stránky zachová filtr z adresy
    await page.reload();
    await expect(page.locator('#changesTeacher')).toHaveValue('T8');
  });

  test('den bez změn ukáže prázdný stav, „Zítra“ přepne na čtvrtek', async ({ page, app }) => {
    await app.open('/?view=changes');
    await expect(rows(page).first()).toBeVisible();

    await page.selectOption('#changesDay', '2026-11-06');
    await expect(page.locator('#changesList')).toContainText('žádné změny');
    await expect(page).toHaveURL(/date=2026-11-06/);

    await page.locator('#changesQuickDays button', { hasText: 'Zítra' }).click();
    await expect(page.locator('#changesSummary')).toHaveText(/^Zítra/);
    await expect(page.locator('#changesQuickDays [aria-pressed="true"]')).toHaveText('Zítra');
    await expect(rows(page)).toHaveCount(2); // čtvrtek: 2.B suplování + zrušená hodina
  });

  test('chybějící agregát: srozumitelná hláška místo prázdné stránky', async ({ page, app }) => {
    await app.open('/?view=changes', { docs: { 'aggregates/changes_Actual': null, 'aggregates/changes_Next': null } });
    await expect(page.locator('#changesList')).toContainText('Přehled změn zatím není k dispozici');
    await expect(rows(page)).toHaveCount(0);
  });
});

// Režim pro televizi (/?kiosk=changes) se nabízí jen na počítači: na telefonu a tabletu tabuli nikdo
// nespouští a tlačítko jen zabíralo místo. Kiosk sám dál funguje na adrese.
test.describe('Režim pro televizi', () => {
  const tv = (page) => page.locator('#changesView a[href="/?kiosk=changes"]');

  test('telefon ho nenabízí, počítač ano', async ({ page, app, isMobile }) => {
    await app.open('/?view=changes');
    await expect(rows(page).first()).toBeVisible();
    if (isMobile) await expect(tv(page)).toBeHidden();
    else await expect(tv(page)).toBeVisible();
  });

  test.describe('tablet na šířku (dotyk, 1180 px)', () => {
    test.use({ viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true });
    test('nenabízí ho ani v rozvržení pro počítač', async ({ page, app }) => {
      await app.open('/?view=changes');
      await expect(rows(page).first()).toBeVisible();
      await expect(page.locator('#sidebar')).toBeVisible(); // rozvržení pro počítač (≥ 1080 px)
      await expect(tv(page)).toBeHidden();
    });
  });

  test('kiosk dál funguje na adrese', async ({ page, app }) => {
    await app.open('/?kiosk=changes');
    await expect(page.locator('.k-row').first()).toBeVisible();
  });
});
