// Načítání při startu: nikdy nekonečné „Načítám…“ (časové limity kroků, jeden
// opakovaný pokus /api/auth, hláška se „Zkusit znovu“, uložená kopie s časem). Kroky zpomaluje nebo zasekává
// atrapa Firebase (support/fake-firebase.js: slow, requireSignIn) a page.route;
// limity (firebase-client.js STEP_LIMITS) posouvá page.clock, nic nečeká doopravdy.
const { test, expect, school, NOW } = require('./support/fixtures');

const LIMIT = { authFetch: 6000, signIn: 8000, read: 8000 };
const SAVED_AT = Date.parse('2026-11-04T08:15:00+01:00');
const saved = (data) => JSON.stringify({ data, timestamp: SAVED_AT, ttl: 1 });
/** Uložená kopie 2.A z minula: 1. hodina ve středu v učebně Z99 (čerstvá data mají A101). */
const OLD_COPY = school.docs['timetables/Class_C2A_Actual'].data.map(l => (l.day === 2 && l.hour === 1 ? { ...l, room: 'Z99' } : l));
const SAVED = {
  bakalari_cache_definitions: saved(school.docs['definitions/current']),
  bakalari_cache_timetable_Class_C2A_actual: saved(OLD_COPY),
};

/** Odpovědi /api/auth podle pořadí: 'hang' = neodpoví nikdy, jinak se pustí na atrapu ve fixtures. */
async function authReplies(page, replies) {
  let n = 0;
  await page.route('**/api/auth', (route) => (replies[n++] === 'hang' ? undefined : route.fallback()));
  return () => n;
}

test.describe('Časové limity kroků startu', () => {
  test('/api/auth neodpovídá: po limitu jeden další pokus a rozvrh se načte', async ({ page, app }) => {
    const count = await authReplies(page, ['hang']);
    await page.clock.install({ time: NOW });
    await app.open('/', { time: null, requireSignIn: true });
    await expect.poll(count).toBe(1);
    await expect(page.locator('#valueDropdownLabel')).toHaveText('Načítám…');
    await page.clock.fastForward(LIMIT.authFetch);
    await app.timetableReady();
    expect(count()).toBe(2);
    await expect(page.locator('#error')).toBeHidden();
  });

  test('/api/auth neodpovídá ani napodruhé, nic uloženého: srozumitelná hláška se „Zkusit znovu“, žádné nekonečné Načítám…', async ({ page, app }) => {
    const count = await authReplies(page, ['hang', 'hang']);
    await page.clock.install({ time: NOW });
    await app.open('/', { time: null, requireSignIn: true });
    await expect.poll(count).toBe(1);
    await page.clock.fastForward(LIMIT.authFetch);
    await expect.poll(count).toBe(2);
    await page.clock.fastForward(LIMIT.authFetch);
    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error')).toHaveText(/^Nepodařilo se načíst rozvrhy/);
    await expect(page.locator('#errorRetry')).toBeVisible();
    await expect(page.locator('#errorRetry')).toHaveText('Zkusit znovu');
    await expect(page.locator('#valueDropdownLabel')).not.toHaveText('Načítám…');
    await expect(page.locator('#timetableSkeleton')).toBeHidden();
    await expect(page.locator('html')).not.toHaveAttribute('data-loading', 'true');
    expect(count()).toBe(2);
  });

  test('přihlášení se zasekne, uložená kopie existuje: rozvrh z ní s časem uložení a „Zkusit znovu“ obnoví stránku', async ({ page, app }) => {
    await page.clock.install({ time: NOW });
    await app.open('/', { time: null, storage: SAVED, slow: { signIn: 'hang' }, requireSignIn: true });
    await page.clock.fastForward(LIMIT.signIn);
    const banner = page.locator('#offlineBanner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Aktuální data se nepodařilo načíst – zobrazuji uložený rozvrh z dnes v 8:15.');
    await expect(page.locator('#timetable')).toContainText('Z99');
    await expect(page.locator('#valueDropdownLabel')).toHaveText('2.A');
    await expect(page.locator('#error')).toBeHidden();

    await page.evaluate(() => { window.__beforeRetry = 1; });
    await Promise.all([page.waitForEvent('framenavigated'), page.locator('#offlineRetry').click()]);
    await expect.poll(() => page.evaluate(() => window.__beforeRetry)).toBeUndefined();
  });

  test('čtení rozvrhu z Firestore se zasekne, nic uloženého: po limitu hláška se „Zkusit znovu“', async ({ page, app }) => {
    await page.clock.install({ time: NOW });
    await app.open('/', { time: null, slow: { 'timetables/Class_C2A_Actual': 'hang' } });
    await expect(page.locator('#valueDropdownLabel')).toHaveText('2.A');
    await page.clock.fastForward(LIMIT.read);
    await expect(page.locator('#error')).toHaveText('Server rozvrhů neodpovídá. Zkontrolujte připojení k internetu, případně vypněte blokování obsahu pro tuto stránku, a zkuste to znovu.');
    await expect(page.locator('#errorRetry')).toBeVisible();
    await expect(page.locator('#timetableSkeleton')).toBeHidden();
    await Promise.all([page.waitForEvent('framenavigated'), page.locator('#errorRetry').click()]);
  });

  test('seznamy (definice) se zaseknou, nic uloženého: po limitu hláška, ne Načítám…', async ({ page, app }) => {
    await page.clock.install({ time: NOW });
    await app.open('/', { time: null, slow: { 'definitions/current': 'hang' } });
    await expect(page.locator('#valueDropdownLabel')).toHaveText('Načítám…');
    await page.clock.fastForward(LIMIT.read);
    await expect(page.locator('#error')).toHaveText(/^Server rozvrhů neodpovídá/);
    await expect(page.locator('#errorRetry')).toBeVisible();
    await expect(page.locator('#valueDropdownLabel')).toHaveText('Nenačteno');
  });
});
