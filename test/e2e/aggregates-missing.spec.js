// Bez agregátů (aggregates/changes_*, freeRooms_*): po vydání verze, než doběhne první sběr, nebo když
// je pravidla Firestore nepustí. Každý pohled musí skončit srozumitelným stavem, nikdy ne
// nekonečným „Načítám…“ (kiosk na produkci 19. 11., snímek 7803).
const { test, expect } = require('./support/fixtures');

const AGGS = ['aggregates/changes_Actual', 'aggregates/changes_Next', 'aggregates/freeRooms_Actual', 'aggregates/freeRooms_Next'];
const MISSING = Object.fromEntries(AGGS.map(p => [p, null]));

test.describe('Chybějící nebo nedostupný agregát', () => {
  test('kiosk: dokumenty ještě nejsou → přehled zatím není k dispozici', async ({ page, app }) => {
    await app.open('/?kiosk=changes', { docs: MISSING });
    await expect(page.locator('#kioskBoard')).toContainText('Přehled změn zatím není k dispozici');
  });

  test('kiosk: pravidla čtení odmítnou → změny se nedaří načíst, ne „Načítám“', async ({ page, app }) => {
    await app.open('/?kiosk=changes', { denied: AGGS });
    await expect(page.locator('#kioskBoard')).toContainText('Změny se teď nedaří načíst');
    await expect(page.locator('#kioskBoard')).not.toContainText('Načítám');
  });

  test('kiosk: Firestore neodpoví → po časovém limitu srozumitelná hláška', async ({ page, app }) => {
    await page.clock.install({ time: new Date('2026-11-04T08:20:00+01:00') });
    await app.open('/?kiosk=changes', { stalled: AGGS });
    await expect(page.locator('#kioskBoard')).toContainText('Načítám změny');
    await page.clock.runFor(16_000);
    await expect(page.locator('#kioskBoard')).toContainText('Změny se teď nedaří načíst');
  });

  for (const [name, opts] of [['dokumenty chybí', { docs: MISSING }], ['čtení odmítnuto', { denied: AGGS }]]) {
    test(`pohled Změny: ${name}`, async ({ page, app }) => {
      await app.open('/?view=changes', opts);
      await expect(page.locator('#changesList')).toContainText('Přehled změn zatím není k dispozici');
      await expect(page.locator('#changesList')).toHaveAttribute('aria-busy', 'false');
    });

    test(`pohled Volné učebny: ${name}`, async ({ page, app }) => {
      await app.open('/?view=rooms', opts);
      await expect(page.locator('#roomsResult')).toContainText('Přehled volných učeben zatím není k dispozici');
      await expect(page.locator('#roomsResult')).toHaveAttribute('aria-busy', 'false');
    });
  }
});

test('kiosk: Firestore neodpoví, ale prohlížeč má uloženou kopii → po časovém limitu tabule z ní', async ({ page, app }) => {
  const cached = (id) => JSON.stringify({ data: app.school.docs[`aggregates/${id}`], timestamp: Date.parse('2026-11-04T07:00:00+01:00'), ttl: 600000 });
  await page.clock.install({ time: new Date('2026-11-04T08:20:00+01:00') });
  await app.open('/?kiosk=changes', {
    stalled: ['aggregates/changes_Actual', 'aggregates/changes_Next'],
    storage: { bakalari_cache_aggregate_changes_Actual: cached('changes_Actual'), bakalari_cache_aggregate_changes_Next: cached('changes_Next') },
  });
  await expect(page.locator('#kioskBoard')).toContainText('Načítám změny');
  await page.clock.runFor(16_000);
  await expect(page.locator('.k-row').first()).toBeVisible();
});
