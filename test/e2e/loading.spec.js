// Načítání při startu: nikdy nekonečné „Načítám…“ (časové limity kroků, jeden
// opakovaný pokus /api/auth, hláška se „Zkusit znovu“), uložený rozvrh hned
// při opakované návštěvě a kostra při první. Kroky zpomaluje nebo zasekává
// atrapa Firebase (support/fake-firebase.js: slow, requireSignIn) a page.route;
// limity (firebase-client.js STEP_LIMITS) posouvá page.clock, nic nečeká doopravdy.
const { test, expect, school, NOW, LESSON } = require('./support/fixtures');

const LIMIT = { authFetch: 6000, signIn: 8000, read: 8000 };
const SAVED_AT = Date.parse('2026-11-04T08:15:00+01:00');
const saved = (data) => JSON.stringify({ data, timestamp: SAVED_AT, ttl: 1 });
/** Uložená kopie 2.A z minula: 1. hodina ve středu v učebně Z99 (čerstvá data mají A101). */
const OLD_COPY = school.docs['timetables/Class_C2A_Actual'].data.map(l => (l.day === 2 && l.hour === 1 ? { ...l, room: 'Z99' } : l));
const SAVED = {
  bakalari_cache_definitions: saved(school.docs['definitions/current']),
  bakalari_cache_timetable_Class_C2A_actual: saved(OLD_COPY),
};

/**
 * Zaznamená, jestli se po prvním vykreslení rozvrhu (mobil: přehled, počítač: týden)
 * plocha vyprázdnila nebo ukázala kostru.
 */
function watchBlank() {
  window.__blank = [];
  const mobile = matchMedia('(max-width: 1079px)').matches;
  const seen = () => (mobile ? document.querySelector('#overview .ov-hero:not(.ov-hero--skel)') : document.querySelector('#timetable .lesson'));
  const skel = () => (mobile ? document.querySelector('#overview .ov-hero--skel') : document.querySelector('#timetableSkeleton:not(.hidden)'));
  new MutationObserver(() => {
    if (!window.__painted) { if (seen()) window.__painted = performance.now(); return; }
    if (!seen()) window.__blank.push('prázdný rozvrh');
    if (skel()) window.__blank.push('kostra');
  }).observe(document, { childList: true, subtree: true, attributes: true });
}

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
    await expect(page.locator('#timetable')).toContainText('Z99');
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
    // po obnovení je uložený rozvrh zase hned na obrazovce
    await expect(page.locator('#timetable')).toContainText('Z99');
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

test.describe('Uložený rozvrh hned, kostra při první návštěvě', () => {
  test('opakovaná návštěva: uložený rozvrh je vidět hned, ještě před přihlášením, a čerstvá data ho nahradí bez prázdného místa', async ({ page, app }) => {
    await page.addInitScript(watchBlank);
    await page.clock.install({ time: NOW });
    await app.open('/', { time: null, storage: SAVED, slow: { signIn: 3000 } });
    // Přihlášení ještě běží (3 s), Firestore se nečetlo, a rozvrh z kopie už je na obrazovce
    await expect(page.locator('#valueDropdownLabel')).toHaveText('2.A');
    await expect(page.locator('#timetable')).toContainText('Z99');
    await expect(page.locator(LESSON).filter({ visible: true }).first()).toBeVisible();
    expect(await page.evaluate(() => (window.__reads || []).filter(p => p.startsWith('timetables/')))).toEqual([]);
    await expect(page.locator('#timetableSkeleton')).toBeHidden();

    await page.clock.fastForward(3000);
    await expect(page.locator('#timetable')).not.toContainText('Z99');
    await expect(page.locator('#timetable')).toContainText('A101');
    expect(await page.evaluate(() => (window.__readsDone || []).includes('timetables/Class_C2A_Actual'))).toBe(true);
    expect(await page.evaluate(() => window.__blank), 'mezi kopií a čerstvými daty nic nezmizí').toEqual([]);
    await expect(page.locator('#offlineBanner')).toBeHidden();
    await expect(page.locator('#error')).toBeHidden();
  });

  test('opakovaná návštěva se stejnými daty: rozvrh se po přihlášení nepřekresluje', async ({ page, app }) => {
    await page.clock.install({ time: NOW });
    // vše jako při minulé návštěvě: rozvrh i dlaždice volných učeben (agregát)
    const same = {
      ...SAVED,
      bakalari_cache_timetable_Class_C2A_actual: saved(school.docs['timetables/Class_C2A_Actual'].data),
      bakalari_cache_aggregate_freeRooms_Actual: saved(school.docs['aggregates/freeRooms_Actual']),
    };
    await app.open('/', { time: null, storage: same, slow: { signIn: 2000 } });
    await expect(page.locator(LESSON).first()).toBeAttached();
    await page.evaluate(() => { window.__first = document.querySelector('#timetable .lesson'); window.__ov = document.querySelector('#overview .ov-hero'); });
    await page.clock.fastForward(2000);
    await expect.poll(() => page.evaluate(() => (window.__readsDone || []).includes('timetables/Class_C2A_Actual'))).toBe(true);
    await page.clock.fastForward(500);
    expect(await page.evaluate(() => window.__first === document.querySelector('#timetable .lesson') && window.__first.isConnected), 'stejné prvky rozvrhu').toBe(true);
    expect(await page.evaluate(() => !window.__ov || window.__ov === document.querySelector('#overview .ov-hero')), 'stejný přehled').toBe(true);
    // obnovení jen hrdiny přehledu nesmí sebrat nadpis, na který sekce odkazuje (aria-labelledby)
    await expect(page.locator('#ovHero > h2#ovHeroLabel')).toHaveText('Teď');
  });

  test('první návštěva: místo prázdné plochy kostra, dokud se přihlášení nedokončí', async ({ page, app, isMobile }) => {
    await page.clock.install({ time: NOW });
    await app.open('/', { time: null, slow: { signIn: 3000 } });
    if (isMobile) await expect(page.locator('#overview .ov-hero--skel')).toBeVisible();
    else await expect(page.locator('#timetableSkeleton .g-skel').first()).toBeVisible();
    await expect(page.locator('#valueDropdownLabel')).toHaveText('Načítám…');
    // pomalé „dýchání“ bloků
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.animationName === 'g-skel-breathe').length)).toBeGreaterThan(0);
    await page.clock.fastForward(3000);
    await app.timetableReady();
    await expect(page.locator('#timetableSkeleton')).toBeHidden();
  });

  test('kostra při omezeném pohybu (prefers-reduced-motion) stojí', async ({ page, app, isMobile }) => {
    await page.clock.install({ time: NOW });
    await app.open('/', { time: null, slow: { signIn: 3000 }, reducedMotion: 'reduce' });
    await expect(page.locator(isMobile ? '#overview .ov-hero--skel' : '#timetableSkeleton .g-skel').first()).toBeVisible();
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.animationName === 'g-skel-breathe' && a.playState === 'running').length)).toBe(0);
  });
});
