// Rozvržení rozvrhu: na mobilu přepínání v Nastavení (4 rozvržení, uloží se),
// na desktopu týdenní mřížka a ochrana před mobilním rozvržením.
const { test, expect, LESSON } = require('./support/fixtures');

const container = (page) => page.locator('#timetableView');

test.describe('Rozvržení – mobil', () => {
  test.skip(({ isMobile }) => !isMobile, 'Nastavení rozvržení je jen na mobilu');

  test('Nastavení → Rozvržení přepne všechna mobilní rozvržení a volbu si pamatuje', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await expect(container(page)).toHaveClass(/\bagenda-mode\b/); // výchozí na mobilu

    const sheet = page.locator('#settingsModal');
    for (const [i, id] of ['compact-list', 'card-view', 'single-day', 'agenda'].entries()) {
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
      await expect(page.locator(LESSON).first()).toBeAttached();
      expect(await page.evaluate(() => localStorage.getItem('layoutMode'))).toBe(id);
      await expect(page.locator('#currentLayoutDescription')).not.toBeEmpty();
    }

    await page.click('#settingsToggle');
    await page.locator('.layout-option-card[data-layout-id="compact-list"]').click();
    await expect(sheet).not.toHaveAttribute('open', '');
    await page.reload();
    await app.timetableReady();
    await expect(container(page)).toHaveClass(/\bcompact-list-mode\b/);
  });

  test('výběr dne přepne zobrazený den', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    const friday = page.locator('#daySelector button', { hasText: 'Pá' });
    await friday.click();
    await expect(friday).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#daySelector button', { hasText: 'St' })).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('Rozvržení – desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Týdenní mřížka je jen na desktopu');

  test('výchozí je celý týden (5 dní)', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await expect(container(page)).toHaveClass(/\bweek-view-mode\b/);
    await expect(page.locator('.timetable-row')).toHaveCount(5);
  });

  test('uložené mobilní rozvržení se na desktopu nepoužije', async ({ page, app }) => {
    await app.open('/', { layout: 'agenda' });
    await app.timetableReady();
    await expect(container(page)).toHaveClass(/\bweek-view-mode\b/);
  });

  test('uložené denní zobrazení se vykreslí i na desktopu', async ({ page, app }) => {
    await app.open('/', { layout: 'single-day' });
    await app.timetableReady();
    await expect(container(page)).toHaveClass(/\bsingle-day-mode\b/);
    await expect(page.locator(LESSON).first()).toBeVisible();
  });

  test('zúžení okna na mobil přepne na mobilní rozvržení', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(container(page)).toHaveClass(/\bagenda-mode\b/);
  });
});
