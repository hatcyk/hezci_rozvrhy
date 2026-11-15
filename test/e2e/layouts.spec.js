// Rozvržení rozvrhu (návrh G): na mobilu Den / Seznam / Karty v Nastavení
// (uloží se), na počítači Týden a Den; Agenda a Denní z verze 2.0 se
// převedou na Den; ochrana před mobilním rozvržením na počítači.
const { test, expect, LESSON } = require('./support/fixtures');

const container = (page) => page.locator('#timetableHost');

test.describe('Rozvržení – mobil', () => {
  test.skip(({ isMobile }) => !isMobile, 'Nastavení rozvržení je jen na mobilu');

  test('Nastavení → Rozvržení přepne všechna mobilní rozvržení a volbu si pamatuje', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await expect(container(page)).toHaveClass(/\bday-mode\b/); // výchozí na mobilu je Den
    await app.openDay(true);

    const sheet = page.locator('#settingsModal');
    for (const [i, id] of ['compact-list', 'card-view', 'day'].entries()) {
      await page.click('#settingsToggle');
      await expect(sheet).toHaveAttribute('open', '');
      // Panel rozvržení zůstává rozbalený pro další otevření
      if (i === 0) await page.click('#settingsLayout');
      await expect(page.locator('#settingsLayout')).toHaveAttribute('aria-expanded', 'true');
      await page.locator(`.layout-option-card[data-layout-id="${id}"]`).click();
      // Volba zavře celé Nastavení a fokus vrátí na tlačítko, které ho otevřelo
      await expect(sheet).not.toHaveAttribute('open', '');
      await expect(page.locator('#settingsToggle')).toBeFocused();
      await expect(container(page)).toHaveClass(new RegExp(`\\b${id}-mode\\b`));
      await expect(page.locator(`#timetableHost ${LESSON}`).first()).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('layoutMode'))).toBe(id);
      await expect(page.locator('#currentLayoutDescription')).not.toBeEmpty();
    }
    // Agenda ani Denní se nenabízí (sloučené do Den)
    await page.click('#settingsToggle');
    await expect(page.locator('.layout-option-card')).toHaveCount(3);
    await expect(page.locator('.layout-option-card[data-layout-id="agenda"], .layout-option-card[data-layout-id="single-day"]')).toHaveCount(0);
    await page.locator('.layout-option-card[data-layout-id="compact-list"]').click();
    await expect(sheet).not.toHaveAttribute('open', '');
    await page.reload();
    await app.timetableReady();
    await expect(container(page)).toHaveClass(/\bcompact-list-mode\b/);
  });

  test('uložená Agenda z verze 2.0 se převede na Den', async ({ page, app }) => {
    await app.open('/', { layout: 'agenda' });
    await app.timetableReady();
    await expect(container(page)).toHaveClass(/\bday-mode\b/);
    expect(await page.evaluate(() => localStorage.getItem('layoutMode'))).toBe('day');
  });

  test('výběr dne v pásu týdne přepne zobrazený den', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await app.openDay(true);
    const friday = page.locator('#daySelector button', { hasText: 'Pá' });
    await friday.click();
    await expect(friday).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#daySelector button', { hasText: 'St' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#ttTitle')).toHaveText('Pátek');
  });

  test('karty: listují se do strany a tlačítky ‹ ›', async ({ page, app }) => {
    await app.open('/', { layout: 'card-view' });
    await app.timetableReady();
    await app.openDay(true);
    await expect(page.locator('#cardPrevBtn')).toBeDisabled();
    await page.click('#cardNextBtn');
    await expect(page.locator('.card-dot').nth(1)).toHaveClass(/\bactive\b/);
    await expect(page.locator('#cardPrevBtn')).toBeEnabled();
  });
});

test.describe('Rozvržení – desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Týden je jen na desktopu');

  test('výchozí je celý týden (5 dní)', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await expect(container(page)).toHaveClass(/\bweek-view-mode\b/);
    await expect(page.locator('.wg-col')).toHaveCount(5);
    await expect(page.locator('.wg-dh.today')).toHaveAttribute('aria-current', 'date');
    await expect(page.locator('.wg-col.today .nowline')).toBeVisible();
  });

  test('uložené mobilní rozvržení se na desktopu nepoužije', async ({ page, app }) => {
    await app.open('/', { layout: 'compact-list' });
    await app.timetableReady();
    await expect(container(page)).toHaveClass(/\bweek-view-mode\b/);
  });

  test('uložené denní zobrazení (2.0) se převede na Den a vykreslí i na desktopu', async ({ page, app }) => {
    await app.open('/', { layout: 'single-day' });
    await app.timetableReady();
    await expect(container(page)).toHaveClass(/\bday-mode\b/);
    await expect(page.locator(LESSON).filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator('#layoutSeg [data-layout="day"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('zúžení okna na mobil přepne na mobilní rozvržení', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(container(page)).toHaveClass(/\bday-mode\b/);
    // Ovládání týdne se přesune pod pás týdne, panel zmizí, objeví se spodní lišta
    await expect(page.locator('#paneToolsSlot #ttControls')).toBeAttached();
    await expect(page.locator('#searchFab')).toBeVisible();
  });
});
