// Přepínání pohledů (Rozvrh / Změny / Volné učebny / Společné volno):
// skutečné odkazy, History API, fokus na nadpis, titulek, deeplink z notifikace.
const { test, expect, LESSON } = require('./support/fixtures');

const view = (page) => page.evaluate(() => document.documentElement.dataset.view);

test.describe('Navigace mezi pohledy', () => {
  test('odkazy přepnou pohled, fokus jde na nadpis, Zpět vrátí předchozí pohled', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    const nav = page.getByRole('navigation', { name: 'Pohledy' });
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-view', 'timetable');

    await nav.locator('a[data-view="changes"]').click();
    await expect(page).toHaveURL(/\?view=changes$/);
    await expect(page.locator('#changesTitle')).toBeFocused();
    await expect(page).toHaveTitle(/^Změny v rozvrhu/);
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-view', 'changes');
    // Viditelný je vždy jen jeden <main>, ovládání rozvrhu je skryté
    await expect(page.locator('main:not([hidden])')).toHaveCount(1);
    await expect(page.locator('#timetableToolbar')).toBeHidden();

    await nav.locator('a[data-view="common"]').click();
    await expect(page.locator('#commonTitle')).toBeFocused();

    await page.goBack();
    await expect.poll(() => view(page)).toBe('changes');
    await page.goBack();
    await expect.poll(() => view(page)).toBe('timetable');
    await expect(page.locator(LESSON).first()).toBeVisible();
    await expect(page.locator('#timetableToolbar')).toBeVisible();

    await page.goForward();
    await expect.poll(() => view(page)).toBe('changes');
  });

  test('klávesnice: Enter na odkazu přepne pohled', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await page.focus('#viewNav a[data-view="rooms"]');
    await page.keyboard.press('Enter');
    await expect.poll(() => view(page)).toBe('rooms');
    await expect(page.locator('#roomsTitle')).toBeFocused();
    await expect(page).toHaveURL(/\?view=rooms$/);
  });

  test('přímý odkaz /?view=… otevře pohled hned (zkratky manifestu)', async ({ page, app }) => {
    await app.open('/?view=common');
    await expect(page.locator('#commonView')).toBeVisible();
    await expect(page.locator('#timetableView')).toBeHidden();
    await expect(page).toHaveTitle(/^Společné volno/);
  });

  test('deeplink z notifikace otevře rozvrh, týden i den a vyčistí adresu', async ({ page, app }) => {
    await app.open('/?type=Class&id=C1A&schedule=Next&day=0&hl=change');
    await app.timetableReady('1.A');
    await expect(page.locator('.schedule-type-btn[aria-pressed="true"]')).toHaveAttribute('data-schedule', 'next');
    await expect(page).toHaveURL(/\/$/);
    expect(await view(page)).toBe('timetable');
    // Zvýrazněná změna (suplování 1.A v pondělí 1. hodinu příštího týdne)
    await expect(page.locator('.deep-highlight').first()).toBeVisible();
  });
});
