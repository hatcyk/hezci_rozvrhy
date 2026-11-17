// Start aplikace, vykreslení rozvrhu (přehled na mobilu, týden na počítači),
// přepínání týdne, hledání rozvrhu a automatické přepnutí na příští týden
// podle času (page.clock). Návrh G „Obloha“.
const { test, expect, LESSON } = require('./support/fixtures');

const pressedSchedule = (page) => page.locator('.schedule-type-btn[aria-pressed="true"]');
const reads = (page) => page.evaluate(() => window.__reads || []);

test.describe('Rozvrh', () => {
  test('start: přihlásí se, načte definice a rozvrh uložené třídy, dnešek je vybraný', async ({ page, app, isMobile }) => {
    await app.open('/');
    await app.timetableReady('2.A');

    await expect(pressedSchedule(page)).toHaveAttribute('data-schedule', 'actual');
    await expect(page.locator('#daySelector [aria-current="date"]')).toContainText('St');
    await expect(page.locator('#daySelector [aria-current="date"] .wk-num')).toHaveText('4');
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('#offlineBanner')).toBeHidden();
    await expect(page.locator('#outageBanner')).toBeHidden();
    // „Teď / Další“ podle pevného času (středa 8:20 = 1. hodina): hrdina přehledu
    // na mobilu, karta „teď“ v postranním panelu na počítači
    const now = page.locator(isMobile ? '#ovHero' : '#nowCard');
    await expect(now).toContainText(/teď, 1\. hodina/i);
    await expect(now).toContainText('A101');
    await expect(now).toContainText('zbývá 25 min');
    // Počet změn v týdnu na „Jen změny“ i u pohledu Změny
    await expect(page.locator('#onlyChangesCount')).toHaveText('5');
    await expect(page.locator('#navChangesCount')).toHaveText('5');

    expect(await reads(page)).toEqual(expect.arrayContaining(['definitions/current', 'timetables/Class_C2A_Actual']));
    // Smlouva S1: identitu přiděluje server, Firestore se čte až po přihlášení
    expect(app.api[0]).toBe('POST /api/auth');
    expect(await page.evaluate(() => localStorage.getItem('userId'))).toBe('anon-00000000-0000-4000-8000-000000000000');
    expect(await page.title()).toBe('Lepší Rozvrh');
  });

  test('přehled (mobil): věta o změnách, pás hodin a týden; řádek otevře Den a Zpět vrátí přehled', async ({ page, app, isMobile }) => {
    test.skip(!isMobile, 'Přehled je domov záložky Rozvrh na mobilu');
    await app.open('/');
    await app.timetableReady();
    await expect(page.locator('.ov-sum')).toContainText(/Dnes 4 změny: 3\.\shodina suplování, 4\.\shodina v jiné učebně, 5\.\shodina odpadá a 6\.\shodina suplování pro 1\.\ssk\./);
    await expect(page.locator('#ovStrip .ov-h.cur')).toContainText('Teď');
    await expect(page.locator('.ov-weekrows .wr')).toHaveCount(5);
    await expect(page.locator('.ov-weekrows .wr.today')).toContainText('Dnes');
    await expect(page.locator('.ov-weekrows .wr.today .wr-dot')).toBeVisible();
    await expect(page.locator('.ov-tile').first()).toContainText('4');

    // Pátek v týdnu → Den na pátek, nadpis „Pátek“, fokus na nadpis
    await page.locator('.ov-weekrows .wr[data-day="4"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'day');
    await expect(page.locator('#ttTitle')).toHaveText('Pátek');
    await expect(page.locator('#ttTitle')).toBeFocused();
    await expect(page.locator('#daySelector button').nth(4)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#timetableHost .lesson').first()).toBeVisible();

    // Zpět (tlačítko i systémové Zpět) → přehled
    await page.click('#backBtn');
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'overview');
    await page.locator('.ov-weekrows .wr.today').click();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'day');
    await page.goBack();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'overview');
    // Druhé klepnutí na záložku Rozvrh vrátí z Dne na přehled
    await page.locator('.ov-weekrows .wr.today').click();
    await page.locator('#viewNav a[data-view="timetable"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'overview');
  });

  test('Den: časová osa ve skutečném měřítku, zlatá čára „teď“, dělená hodina vedle sebe', async ({ page, app, isMobile }) => {
    await app.open('/', { layout: 'day' });
    await app.timetableReady();
    await app.openDay(isMobile);
    const tl = page.locator('#timetableHost .tl');
    await expect(tl).toBeVisible();
    await expect(page.locator('.tl .nowline')).toBeVisible();
    await expect(page.locator('.tl .now-pill')).toHaveText('8:20');
    // Přestávka 10:30–10:50 je delší mezera než 8:45–8:50
    const b2 = await page.locator('.tl .ev').nth(1).boundingBox();
    const b1 = await page.locator('.tl .ev').nth(0).boundingBox();
    const b3 = await page.locator('.tl .ev').nth(2).boundingBox();
    const b4 = await page.locator('.tl .ev').nth(3).boundingBox();
    expect(b4.y - (b3.y + b3.height)).toBeGreaterThan((b2.y - (b1.y + b1.height)) * 2);
    // Dělená 6. hodina: dva bloky vedle sebe ve stejné výšce
    const split = page.locator('.tl .ev.is-split');
    await expect(split).toHaveCount(2);
    const [s1, s2] = [await split.nth(0).boundingBox(), await split.nth(1).boundingBox()];
    expect(Math.abs(s1.y - s2.y)).toBeLessThan(1);
    expect(s2.x).toBeGreaterThan(s1.x + s1.width - 1);
    // Stav: ikona + slovo, odpadlá hodina přeškrtnutá
    await expect(page.locator('.tl .ev.is-sub').first()).toContainText('suplování');
    await expect(page.locator('.tl .ev.is-room')).toContainText('jiná učebna');
    await expect(page.locator('.tl .ev.is-cancelled')).toContainText('odpadá');
  });

  test('přepnutí týdne (Stálý / Příští) načte odpovídající snímek', async ({ page, app, isMobile }) => {
    await app.open('/');
    await app.timetableReady();
    await app.openDay(isMobile);

    await page.click('.schedule-type-btn[data-schedule="permanent"]');
    await expect(pressedSchedule(page)).toHaveAttribute('data-schedule', 'permanent');
    await expect.poll(() => reads(page)).toContain('timetables/Class_C2A_Permanent');
    // Stálý rozvrh nemá změny: tlačítko „Jen změny“ nic nenabízí
    await expect(page.locator(`${LESSON}[data-changed="true"]`).filter({ visible: true })).toHaveCount(0);
    await expect(page.locator('#onlyChangesBtn')).toBeHidden();

    await page.click('.schedule-type-btn[data-schedule="next"]');
    await expect(pressedSchedule(page)).toHaveAttribute('data-schedule', 'next');
    await expect.poll(() => reads(page)).toContain('timetables/Class_C2A_Next');
    await expect(page.locator(LESSON).filter({ visible: true }).first()).toBeVisible();
  });

  test('počítač: ‹ › přepínají týdny, Dnes vrací aktuální týden, Den / Týden mění rozvržení', async ({ page, app, isMobile }) => {
    test.skip(isMobile, 'lišta pohledu je na počítači');
    await app.open('/');
    await app.timetableReady();
    await expect(page.locator('#ttTitle')).toHaveText('Týden 2.–6. listopadu');
    await expect(page.locator('#prevBtn')).toBeDisabled();
    await page.click('#nextBtn');
    await expect(pressedSchedule(page)).toHaveAttribute('data-schedule', 'next');
    await expect(page.locator('#ttTitle')).toHaveText('Týden 9.–13. listopadu');
    await page.click('#todayBtn');
    await expect(pressedSchedule(page)).toHaveAttribute('data-schedule', 'actual');

    await page.click('#layoutSeg [data-layout="day"]');
    await expect(page.locator('#timetableHost')).toHaveClass(/\bday-mode\b/);
    await expect(page.locator('#ttTitle')).toHaveText('Středa 4. listopadu');
    await page.click('#nextBtn');
    await expect(page.locator('#ttTitle')).toHaveText('Čtvrtek 5. listopadu');
    expect(await page.evaluate(() => localStorage.getItem('layoutMode'))).toBe('day');
    // Hlavička dne v týdnu otevře ten den
    await page.click('#layoutSeg [data-layout="week-view"]');
    await page.click('.wg-dh[data-day="0"]');
    await expect(page.locator('#ttTitle')).toHaveText('Pondělí 2. listopadu');
  });

  test('hledání: bez diakritiky, šipky a Enter, výsledky po skupinách', async ({ page, app, isMobile }) => {
    await app.open('/');
    await app.timetableReady();

    // Tlačítko s názvem rozvrhu otevře hledání s fokusem v poli (mobil panel, počítač nabídka v panelu)
    await page.click('#valueDropdownTrigger');
    if (isMobile) await expect(page.locator('#searchSheet')).toHaveAttribute('open', '');
    await expect(page.locator('#searchInput')).toBeFocused();
    await page.keyboard.type('ukaz');
    await expect(page.locator('#searchResults .sr-group h3')).toHaveText(['Vyučující']);
    await expect(page.locator('#searchStatus')).toHaveText(/Nalezeno 1 rozvrh/);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.sr-pick').first()).toBeFocused();
    await page.keyboard.press('Enter');

    await app.timetableReady('Mgr. Jana Ukázková');
    if (isMobile) await expect(page.locator('#searchSheet')).not.toHaveAttribute('open', '');
    await expect.poll(() => reads(page)).toContain('timetables/Teacher_T1_Actual');
    expect(await page.evaluate(() => [localStorage.getItem('selectedType'), localStorage.getItem('selectedValue')])).toEqual(['Teacher', 'T1']);
    // Nedávné volby se zapamatují
    expect(JSON.parse(await page.evaluate(() => localStorage.getItem('recentTimetables')))[0]).toEqual({ type: 'Teacher', id: 'T1' });

    // „/“ otevře hledání odkudkoli, Esc ho zavře
    await page.locator('#timetableView').focus();
    await page.keyboard.press('/');
    await expect(page.locator('#searchInput')).toBeFocused();
    await page.keyboard.type('A10');
    await expect(page.locator('#searchResults .sr-group h3')).toHaveText(['Učebny']);
    await page.keyboard.press('Escape');
    if (isMobile) await expect(page.locator('#searchSheet')).not.toHaveAttribute('open', '');
    else await expect(page.locator('#searchResults')).toBeHidden();
  });

  test('hvězdička oblíbených je samostatné tlačítko vedle položky', async ({ page, app, isMobile }) => {
    await app.open('/');
    await app.timetableReady();
    await page.click('#valueDropdownTrigger');
    const row = page.locator('#searchResults .sr-row').filter({ hasText: '2.B' }).first();
    const star = row.locator('.sr-fav');
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect(star).toHaveAccessibleName('Oblíbené: 2.B');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    // Výběr se nezměnil, oblíbené jsou nahoře hledání (a v panelu na počítači)
    await expect(page.locator('#valueDropdownLabel')).toHaveText('2.A');
    await expect.poll(() => app.api.filter(a => a.startsWith('POST /api/favorites')).length).toBe(1);
    if (!isMobile) await expect(page.locator('#sideFavs .side-item')).toContainText('Třída 2.B');
  });

  test('oblíbené nad limitem nových uživatelů (429): hvězdička se vrátí, toast řekne česky proč', async ({ page, app }) => {
    const LIMIT = { error: 'Příliš mnoho nových uživatelů z této sítě, zkuste to později.', retryAfterSec: 300 };
    await page.route('**/api/favorites/**', (route) => (route.request().method() === 'POST'
      ? route.fulfill({ status: 429, headers: { 'Retry-After': '300' }, json: LIMIT })
      : route.fulfill({ json: { favoriteTimetables: [] } })));
    await app.open('/');
    await app.timetableReady();
    await page.click('#valueDropdownTrigger');
    const star = page.locator('#searchResults .sr-row').filter({ hasText: '2.B' }).first().locator('.sr-fav');
    await star.click();
    const toast = page.locator('.toast').filter({ hasText: 'Oblíbené se nepodařilo uložit.' });
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Příliš mnoho nových uživatelů z této sítě, zkuste to později. Znovu to půjde zhruba za 5 min.');
    await expect(star).toHaveAttribute('aria-pressed', 'false');
  });

  test('„Jen změny“ ukáže seznam změn týdne a jde vypnout', async ({ page, app, isMobile }) => {
    await app.open('/');
    await app.timetableReady();
    await app.openDay(isMobile);

    const btn = page.locator('#onlyChangesBtn');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.oc-day tbody tr')).toHaveCount(5);
    await expect(page.locator('.oc-day-title')).toHaveCount(2);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(LESSON).filter({ visible: true }).first()).toBeVisible();
  });

  test('HTML z dat Bakalářů se zobrazí jako text, nespustí se (XSS)', async ({ page, app }) => {
    const docs = JSON.parse(JSON.stringify(app.school.docs['timetables/Class_C2A_Actual']));
    for (const l of docs.data.filter(x => x.day === 2 && x.hour === 2)) {
      l.subject = 'Matematika<img src=x onerror="window.__xss=(window.__xss||0)+1">';
      l.room = '<b onmouseover=alert(1)>U12</b>';
    }
    await app.open('/', { docs: { 'timetables/Class_C2A_Actual': docs } });
    await app.timetableReady();

    const card = page.locator(LESSON).filter({ visible: true }).filter({ hasText: 'Matematika<img' }).first();
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

  test('víkend: přehled ukáže volno a další hodinu v pondělí', async ({ page, app, isMobile }) => {
    test.skip(!isMobile, 'přehled je na mobilu');
    await app.open('/', { time: '2026-11-07T10:00:00+01:00' });
    await app.timetableReady();
    await expect(page.locator('#ovHero')).toContainText('Víkend');
    await expect(page.locator('#ovHero')).toContainText('Volno');
    await expect(page.locator('#ovHero .ov-next')).toContainText(/Další: v pondělí v 8:00/);
    await expect(page.locator('#ovWeekTitle')).toHaveText('Týden 9.–13. listopadu');
  });
});
