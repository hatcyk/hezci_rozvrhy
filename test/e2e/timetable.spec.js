// Start aplikace, vykreslení rozvrhu, přepínání druhu/týdne a automatické
// přepnutí na příští týden podle času (page.clock).
const { test, expect, LESSON } = require('./support/fixtures');

const pressedSchedule = (page) => page.locator('.schedule-type-btn[aria-pressed="true"]');
const reads = (page) => page.evaluate(() => window.__reads || []);

test.describe('Rozvrh', () => {
  test('start: přihlásí se, načte definice a rozvrh uložené třídy, dnešek je vybraný', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady('2.A');

    await expect(pressedSchedule(page)).toHaveAttribute('data-schedule', 'actual');
    await expect(page.locator('#daySelector [aria-current="date"]')).toHaveText('St');
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('#offlineBanner')).toBeHidden();
    await expect(page.locator('#outageBanner')).toBeHidden();
    // Widget „Teď / Další“ podle pevného času (středa 8:20 = 1. hodina)
    await expect(page.locator('#nextLessonWidget')).toContainText('Teď');
    // Počet změn v týdnu na tlačítku „Jen změny“
    await expect(page.locator('#onlyChangesCount')).toHaveText('5');

    expect(await reads(page)).toEqual(expect.arrayContaining(['definitions/current', 'timetables/Class_C2A_Actual']));
    // Smlouva S1: identitu přiděluje server, Firestore se čte až po přihlášení
    expect(app.api[0]).toBe('POST /api/auth');
    expect(await page.evaluate(() => localStorage.getItem('userId'))).toBe('anon-00000000-0000-4000-8000-000000000000');
    expect(await page.title()).toBe('Lepší Rozvrh');
  });

  test('přepnutí týdne (Stálý / Příští) načte odpovídající snímek', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();

    await page.click('.schedule-type-btn[data-schedule="permanent"]');
    await expect(pressedSchedule(page)).toHaveAttribute('data-schedule', 'permanent');
    await expect.poll(() => reads(page)).toContain('timetables/Class_C2A_Permanent');
    // Stálý rozvrh nemá změny: tlačítko „Jen změny“ nic nenabízí
    await expect(page.locator(`${LESSON.split(',').map(s => `${s.trim()}[data-changed="true"]`).join(', ')}`)).toHaveCount(0);

    await page.click('.schedule-type-btn[data-schedule="next"]');
    await expect(pressedSchedule(page)).toHaveAttribute('data-schedule', 'next');
    await expect.poll(() => reads(page)).toContain('timetables/Class_C2A_Next');
    await expect(page.locator(LESSON).first()).toBeVisible();
  });

  test('výběr vyučujícího přes roletku s hledáním', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();

    await page.click('.type-btn[data-type="Teacher"]');
    await expect(page.locator('.type-btn[data-type="Teacher"]')).toHaveAttribute('aria-pressed', 'true');
    // Po změně druhu se výběr sám otevře s fokusem v hledání (desktop menu, mobil panel)
    await expect(page.locator('.custom-dropdown-search, .dropdown-sheet-search').and(page.locator(':focus'))).toHaveCount(1);
    await page.keyboard.type('Ukáz');
    await page.locator('#valueDropdownMenu:not([inert]) .option-label, #dropdownMobileSheet[open] .option-label')
      .filter({ hasText: 'Ukázková' }).first().click();

    await app.timetableReady('Mgr. Jana Ukázková');
    await expect.poll(() => reads(page)).toContain('timetables/Teacher_T1_Actual');
    expect(await page.evaluate(() => [localStorage.getItem('selectedType'), localStorage.getItem('selectedValue')])).toEqual(['Teacher', 'T1']);
  });

  test('„Jen změny“ ukáže seznam změn týdne a jde vypnout', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();

    const btn = page.locator('#onlyChangesBtn');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.oc-day tbody tr')).toHaveCount(5);
    await expect(page.locator('.oc-day-title')).toHaveCount(2);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(LESSON).first()).toBeVisible();
  });

  test('HTML z dat Bakalářů se zobrazí jako text, nespustí se (XSS)', async ({ page, app }) => {
    const docs = JSON.parse(JSON.stringify(app.school.docs['timetables/Class_C2A_Actual']));
    for (const l of docs.data.filter(x => x.day === 2 && x.hour === 2)) {
      l.subject = 'Matematika<img src=x onerror="window.__xss=(window.__xss||0)+1">';
      l.room = '<b onmouseover=alert(1)>U12</b>';
    }
    await app.open('/', { docs: { 'timetables/Class_C2A_Actual': docs } });
    await app.timetableReady();

    const card = page.locator(LESSON).filter({ hasText: 'Matematika<img' }).first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator('#lessonModal')).toHaveAttribute('open', '');
    await expect(page.locator('#modalSubject')).toHaveText(/Matematika<img/);
    expect(await page.evaluate(() => ({
      executed: window.__xss || 0,
      injected: document.querySelectorAll('img[src="x"], #timetableView b, #lessonModal b').length,
    }))).toEqual({ executed: 0, injected: 0 });
  });
});

test.describe('Automatické přepnutí na příští týden (page.clock)', () => {
  for (const [label, time, expected] of [
    ['čtvrtek 15:00 → aktuální', '2026-11-05T15:00:00+01:00', 'actual'],
    ['pátek 13:59 → aktuální', '2026-11-06T13:59:00+01:00', 'actual'],
    ['pátek 14:05 → příští', '2026-11-06T14:05:00+01:00', 'next'],
    ['sobota 10:00 → příští', '2026-11-07T10:00:00+01:00', 'next'],
    ['neděle 20:00 → příští', '2026-11-08T20:00:00+01:00', 'next'],
  ]) {
    test(label, async ({ page, app }) => {
      await app.open('/', { time });
      await app.timetableReady();
      await expect(pressedSchedule(page)).toHaveAttribute('data-schedule', expected);
      const snapshot = expected === 'next' ? 'timetables/Class_C2A_Next' : 'timetables/Class_C2A_Actual';
      expect(await reads(page)).toContain(snapshot);
    });
  }
});
