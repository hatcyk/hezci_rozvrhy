// Offline režim a banner stáří dat (/api/status, smlouva S4).
const { test, expect, school } = require('./support/fixtures');

const banner = (page) => page.locator('#offlineBanner');

test.describe('Offline', () => {
  test('ztráta spojení ukáže banner, návrat spojení ho skryje', async ({ page, app, context }) => {
    await app.open('/');
    await app.timetableReady();
    await expect(banner(page)).toBeHidden();

    await context.setOffline(true);
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText('Režim offline');
    // Rozvrh zůstává zobrazený
    await expect(page.locator('#valueDropdownLabel')).toHaveText('2.A');

    await context.setOffline(false);
    await expect(banner(page)).toBeHidden();
  });

  test('start bez sítě vykreslí rozvrh z uložené kopie a řekne, jak je stará', async ({ page, app }) => {
    const cached = (data) => JSON.stringify({ data, timestamp: Date.parse('2026-11-04T08:15:00+01:00'), ttl: 1 });
    await app.open('/', {
      offline: true,
      storage: {
        bakalari_cache_definitions: cached(school.docs['definitions/current']),
        bakalari_cache_timetable_Class_C2A_actual: cached(school.docs['timetables/Class_C2A_Actual'].data),
      },
    });
    await app.timetableReady();
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText('před 5 min');
    // Firestore se vůbec nečetl
    expect(await page.evaluate(() => (window.__reads || []).filter(p => p.startsWith('timetables/')))).toEqual([]);
  });

  test('zastaralá data na serveru: banner říká, z kdy data jsou', async ({ page, app }) => {
    await app.open('/', { status: { isHealthy: false, lastSuccessAt: '2026-11-04T06:30:00.000Z', dataAgeMin: 110 } });
    await app.timetableReady();
    await expect(page.locator('#outageBanner')).toBeVisible();
    await expect(page.locator('#outageBannerText')).toHaveText(/data jsou z dnes v 7:30 \(před 1 h\)/);
  });

  test('částečný sběr: banner řekne, že část rozvrhů může být starší, a po úplném sběru zmizí', async ({ page, app }) => {
    await app.open('/', { status: { isHealthy: true, lastStatus: 'partial', lastSuccessAt: '2026-11-04T07:00:00.000Z', dataAgeMin: 20 } });
    await app.timetableReady();
    await expect(page.locator('#outageBanner')).toBeVisible();
    await expect(page.locator('#outageBannerText')).toHaveText('Část rozvrhů se z Bakalářů nepodařilo aktualizovat – některé mohou být starší. Všechny byly naposledy staženy dnes v 8:00 (před 20 min).');
  });

  test('úplný sběr (ok): žádný banner', async ({ page, app }) => {
    await app.open('/', { status: { isHealthy: true, lastStatus: 'ok', lastSuccessAt: '2026-11-04T07:15:00.000Z', dataAgeMin: 5 } });
    await app.timetableReady();
    await expect(page.locator('#outageBanner')).toBeHidden();
  });
});
