// Přehled a „teď“ v hraničních situacích (nálezy revize 15. 11. 2026):
// dělená hodina s odpadlou skupinou, data z jiného týdne, celodenní akce,
// nenačtený rozvrh, hledání z jiného pohledu, souběh načítání, víkend,
// historie Dne a názvy hodin pro čtečku.
const { test, expect, school, NOW } = require('./support/fixtures');

const KEY = 'timetables/Class_C2A_Actual';
const WED = 2;
const pressedSchedule = (page) => page.locator('.schedule-type-btn[aria-pressed="true"]');

/** Kopie rozvrhu 2.A (aktuální týden) upravená funkcí `edit(lekce) → lekce`. */
function c2a(edit) {
  const doc = JSON.parse(JSON.stringify(school.docs[KEY]));
  return { ...doc, data: edit(doc.data) };
}

/** Středeční 1. hodina rozdělená: 1. sk podle `first`, 2. sk Fyzika v U11. */
function splitFirstHour(first) {
  return c2a((data) => {
    const base = data.find(l => l.day === WED && l.hour === 1);
    const rest = data.filter(l => !(l.day === WED && l.hour === 1));
    return [...rest,
      { ...base, group: '1.sk', ...first },
      { ...base, group: '2.sk', subject: 'Fyzika', teacher: 'Libor Návrhový', room: 'U11' }];
  });
}

/** Středa: hodiny `hours` (nebo všechny) nahradí funkcí `to`, v každé hodině jedna položka pro celou třídu. */
const wednesday = (to, hours = null) => c2a((data) => {
  const hit = (l) => l.day === WED && (!hours || hours.includes(l.hour));
  const seen = new Set();
  return data.filter(l => !hit(l) || (!seen.has(l.hour) && seen.add(l.hour))).map(l => (hit(l) ? to(l) : l));
});
const trip = (l) => ({ ...l, subject: 'Exkurze', teacher: '', room: null, group: null, type: 'absent', changed: true, changeInfo: { raw: 'Akce', description: 'Exkurze (EXK)' } });
const removed = (l) => ({ ...l, group: null, type: 'removed', changed: true, changeInfo: { raw: 'Zrušeno', description: 'Zrušeno - Ředitelské volno' } });

test.describe('Přehled: dělená hodina', () => {
  const CANCELLED = { type: 'removed', changed: true, changeInfo: { raw: 'Zrušeno', description: 'Zrušeno - Nemoc vyučujícího' } };

  test('jedné skupině hodina odpadá: je vidět, které skupiny se učebna týká, a že druhé odpadá', async ({ page, app, isMobile }) => {
    await app.open('/', { docs: { [KEY]: splitFirstHour(CANCELLED) } });
    await app.timetableReady();
    const now = page.locator(isMobile ? '#ovHero' : '#nowCard');
    await expect(now).toContainText(/teď, 1\. hodina/i);
    await expect(now).toContainText('Fyzika');
    await expect(now).toContainText('U11');
    await expect(now).toContainText('2. sk');
    await expect(now).toContainText('1. sk odpadá');
    await expect(now).not.toContainText('A101');
    if (!isMobile) return;

    // Pás hodin: zkratka i učebna ze skupiny, která hodinu má; učebna odpadlé skupiny tam není
    const first = page.locator('#ovStrip .ov-h').first();
    await expect(first.locator('.a')).toHaveText('FYZ');
    await expect(first.locator('.r')).toHaveText('2. sk U11');
    // Čtečka: nejdřív skupina, která hodinu má, potom odpadlá
    await expect(first).toHaveAccessibleName(/^1\. hodina, teď, 8:00–8:45, dělená hodina: Fyzika \(FYZ\), 2\. sk, vyučující Libor Návrhový, učebna U11; .+, 1\. sk, .*odpadá, nemoc vyučujícího$/);
  });

  test('skupiny s různými předměty: každý předmět má svou skupinu', async ({ page, app, isMobile }) => {
    await app.open('/', { docs: { [KEY]: splitFirstHour({ subject: 'Dějepis' }) } });
    await app.timetableReady();
    const now = page.locator(isMobile ? '#ovHero' : '#nowCard');
    await expect(now).toContainText('1. sk Dějepis, 2. sk Fyzika');
    await expect(now).toContainText('A101');
    await expect(now).toContainText('U11');
    if (isMobile) await expect(page.locator('#ovStrip .ov-h').first().locator('.a')).toHaveText('DEJ / FYZ');
  });
});

test.describe('Přehled: data z jiného týdne', () => {
  // Pondělí 9. 11. 8:20, dokument Actual je ještě z týdne 2.–6. 11.
  const MONDAY = '2026-11-09T08:20:00+01:00';

  test('zastaralá data se nevydávají za dnešek', async ({ page, app, isMobile }) => {
    await app.open('/', { time: MONDAY, docs: { 'timetables/Class_C2A_Next': null } });
    await app.timetableReady();
    const now = page.locator(isMobile ? '#ovHero' : '#nowCard');
    await expect(now).toContainText(/rozvrh není aktuální/i);
    await expect(now).toContainText('z minulého týdne (2.–6. listopadu)');
    await expect(now).not.toContainText(/teď, \d+\. hodina/i);
    await expect(page.locator('#navChangesCount')).toBeHidden();
    if (isMobile) {
      await expect(page.locator('#ovWeekTitle')).toHaveText('Týden 2.–6. listopadu');
      await expect(page.locator('.ov-weekrows .wr')).toHaveCount(5);
      await expect(page.locator('.ov-weekrows .wr.today')).toHaveCount(0);
      await expect(page.locator('.ov-weekrows .wr-dot')).toHaveCount(0);
      await expect(page.locator('#ovStrip')).toHaveCount(0);
      await expect(page.locator('.ov-tile').first()).toContainText('minulý týden');
    } else {
      // Týden 2.–6. 11.: žádný sloupec „dnes“ ani čára „teď“
      await expect(page.locator('#ttTitle')).toHaveText('Týden 2.–6. listopadu');
      await expect(page.locator('#timetable .wg-col')).toHaveCount(5);
      await expect(page.locator('#timetable .today')).toHaveCount(0);
      await expect(page.locator('#timetable .nowline')).toHaveCount(0);
      await expect(page.locator('#daySelector [aria-current="date"]')).toHaveCount(0);
    }
  });

  // Pondělí 16. 11.: Actual je z 2.–6. 11. (o dva týdny zpět), Next z 9.–13. 11.
  const TWO_WEEKS_LATER = '2026-11-16T08:20:00+01:00';

  test('data stará dva týdny nejsou „z minulého týdne“, uvede se jejich týden', async ({ page, app, isMobile }) => {
    await app.open('/', { time: TWO_WEEKS_LATER, docs: { 'timetables/Class_C2A_Next': null } });
    await app.timetableReady();
    const now = page.locator(isMobile ? '#ovHero' : '#nowCard');
    await expect(now).toContainText(/rozvrh není aktuální/i);
    await expect(now).toContainText('Data jsou z týdne 2.–6. listopadu');
    await expect(now).not.toContainText(/minul/i);
    if (isMobile) {
      await expect(page.locator('.ov-tile').first()).toContainText('v týdnu 2.–6. 11.');
      await expect(page.locator('.ov-tile').first()).not.toContainText(/minul/i);
    }
  });

  test('Next existuje, ale také není z tohoto týdne: nevydává se za aktuální', async ({ page, app, isMobile }) => {
    await app.open('/', { time: TWO_WEEKS_LATER });
    await app.timetableReady();
    const now = page.locator(isMobile ? '#ovHero' : '#nowCard');
    await expect(now).toContainText(/rozvrh není aktuální/i);
    await expect(now).toContainText('Data jsou z týdne 2.–6. listopadu');
    await expect(now).not.toContainText(/teď, \d+\. hodina/i);
    await expect(page.locator('#navChangesCount')).toBeHidden();
    if (isMobile) {
      await expect(page.locator('#ovWeekTitle')).toHaveText('Týden 2.–6. listopadu');
      await expect(page.locator('.ov-weekrows .wr.today')).toHaveCount(0);
      await expect(page.locator('#ovStrip')).toHaveCount(0);
    }
  });

  test('tento týden je už v dokumentu Next: přehled ho vezme jako aktuální', async ({ page, app, isMobile }) => {
    test.skip(!isMobile, 'Přehled je na mobilu');
    await app.open('/', { time: MONDAY });
    await app.timetableReady();
    await expect(page.locator('#ovHero')).toContainText(/teď, 1\. hodina/i);
    await expect(page.locator('#ovWeekTitle')).toHaveText('Týden 9.–13. listopadu');
    await expect(page.locator('.ov-weekrows .wr.today')).toHaveAttribute('data-day', '0');
    // Dnešní řádek otevře Den z téhož týdne (9. 11.), ne z minulého
    await page.locator('.ov-weekrows .wr.today').click();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'day');
    await expect(page.locator('#ttSub')).toContainText('9. listopadu');
    await expect(page.locator('#daySelector [aria-current="date"] .wk-num')).toHaveText('9');
  });
});

test.describe('Přehled: akce a den bez výuky', () => {
  const EARLY = '2026-11-04T07:30:00+01:00';

  test('celodenní akce v 7:30 není „Dnešní výuka skončila / Volno“', async ({ page, app, isMobile }) => {
    await app.open('/', { time: EARLY, docs: { [KEY]: wednesday(trip) } });
    await app.timetableReady();
    const now = page.locator(isMobile ? '#ovHero' : '#nowCard');
    await expect(now).toContainText(/dnes místo výuky/i);
    await expect(now).toContainText('Exkurze, 1.–7. hodina');
    await expect(now).toContainText('Akce');
    await expect(now).not.toContainText(/skončila|Volno|dnes už nic/);
    await expect(now).toContainText(/Další:? zítra v 8:00/);
    if (isMobile) await expect(page.locator('.ov-sum')).toHaveText('Dnes je místo výuky akce: Exkurze (1.–7. hodina).');
  });

  test('den, kdy všechno odpadá, v 7:30 neříká, že výuka skončila', async ({ page, app, isMobile }) => {
    await app.open('/', { time: EARLY, docs: { [KEY]: wednesday(removed) } });
    await app.timetableReady();
    const now = page.locator(isMobile ? '#ovHero' : '#nowCard');
    await expect(now).toContainText(isMobile ? 'Dnes všechny hodiny odpadají' : 'dnes vše odpadá');
    await expect(now).toContainText('Volno');
    await expect(now).not.toContainText(/skončila|dnes už nic/);
  });

  test('akce jen v 1.–3. hodině: nadpis ji jmenuje, další hodina je čtvrtá', async ({ page, app, isMobile }) => {
    await app.open('/', { docs: { [KEY]: wednesday(trip, [1, 2, 3]) } });
    await app.timetableReady();
    const now = page.locator(isMobile ? '#ovHero' : '#nowCard');
    await expect(now).toContainText('1.–3. hodina: Exkurze');
    await expect(now).not.toContainText('odpadá');
    await expect(now).toContainText(/4\. hodina/);
  });
});

test.describe('Výběr rozvrhu', () => {
  test('nenačtený rozvrh: pod novým jménem nezůstane přehled předchozího', async ({ page, app, isMobile }) => {
    await app.open('/', { docs: { 'timetables/Teacher_T1_Actual': null } });
    await app.timetableReady();
    const now = page.locator(isMobile ? '#ovHero' : '#nowCard');
    await expect(now).toContainText('A101');

    await page.click('#valueDropdownTrigger');
    await page.fill('#searchInput', 'ukaz');
    await page.locator('.sr-pick').first().click();
    await expect(page.locator('#valueDropdownLabel')).toHaveText('Mgr. Jana Ukázková');
    await expect(page.locator('#error')).toBeVisible();
    if (isMobile) {
      await expect(page.locator('#overview')).toContainText('Přehled teď nejde načíst');
      await expect(page.locator('#ovHero')).toHaveCount(0);
      await expect(page.locator('#ovStrip')).toHaveCount(0);
      await expect(page.locator('.ov-weekrows')).toHaveCount(0);
    } else {
      await expect(page.locator('#nowCard')).toBeHidden();
    }
    await expect(page.locator('#navChangesCount')).toBeHidden();
  });

  test('hledání v jiném pohledu přepne na Rozvrh s vybraným rozvrhem', async ({ page, app, isMobile }) => {
    await app.open(isMobile ? '/?view=rooms' : '/?view=changes');
    await expect(page.locator('html')).toHaveAttribute('data-view', isMobile ? 'rooms' : 'changes');
    await expect(page.locator('#valueDropdownLabel')).toHaveText('2.A');
    if (isMobile) await page.click('#searchFab');
    await page.fill('#searchInput', 'ukaz');
    await page.locator('.sr-pick').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'timetable');
    await expect(page.locator('#timetableView')).toBeVisible();
    await app.timetableReady('Mgr. Jana Ukázková');
    // Zpět vrátí do pohledu, ze kterého se hledalo
    await page.goBack();
    await expect(page.locator('html')).toHaveAttribute('data-view', isMobile ? 'rooms' : 'changes');
  });

  test('oblíbené v postranním panelu přepnou z jiného pohledu na Rozvrh', async ({ page, app, isMobile }) => {
    test.skip(isMobile, 'postranní panel je na počítači');
    await page.route('**/api/favorites/**', route => route.fulfill({ json: { favoriteTimetables: [{ type: 'Class', id: 'C1A' }] } }));
    await app.open('/?view=changes');
    await expect(page.locator('html')).toHaveAttribute('data-view', 'changes');
    await page.locator('#sideFavs .side-item').first().click();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'timetable');
    await app.timetableReady('1.A');
  });

  test('pozdní odpověď nepřepíše novější volbu týdne', async ({ page, app, isMobile }) => {
    test.skip(isMobile, 'přepínač týdne je hned po ruce na počítači');
    // Firestore: dokumenty *_Next odpovídají za 900 ms, ostatní hned
    await page.addInitScript(() => {
      let fb;
      Object.defineProperty(window, 'firebase', {
        configurable: true,
        get() { return fb; },
        set(v) {
          fb = v;
          const orig = v.firestore;
          v.firestore = function firestore() {
            const db = orig.call(v);
            return { ...db, collection(c) {
              const col = db.collection(c);
              return { doc(id) {
                const ref = col.doc(id);
                return { ...ref, get: () => new Promise(res => setTimeout(() => res(ref.get()), /_Next$/.test(id) ? 900 : 0)) };
              } };
            } };
          };
        },
      });
    });
    await app.open('/');
    await app.timetableReady();
    await page.click('.schedule-type-btn[data-schedule="next"]');
    await page.click('.schedule-type-btn[data-schedule="permanent"]');
    await expect(pressedSchedule(page)).toHaveAttribute('data-schedule', 'permanent');
    await expect(page.locator('#ttTitle')).toHaveText('Stálý rozvrh');
    await page.waitForTimeout(1500); // pozdní odpověď příštího týdne dorazila
    await expect(page.locator('#ttTitle')).toHaveText('Stálý rozvrh');
    await expect(page.locator('#timetable [data-changed="true"]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-loading', 'true');
  });
});

test.describe('Víkend', () => {
  const SATURDAY = '2026-11-07T10:00:00+01:00';

  test('dlaždice Změny a odznak počítají stejný týden jako modul Týden', async ({ page, app, isMobile }) => {
    test.skip(!isMobile, 'Přehled je na mobilu');
    await app.open('/', { time: SATURDAY });
    await app.timetableReady();
    await expect(page.locator('#ovWeekTitle')).toHaveText('Týden 9.–13. listopadu');
    const tile = page.locator('.ov-tile').first();
    await expect(tile.locator('.ov-tile-big')).toHaveText('1');
    await expect(tile.locator('.ov-tile-foot')).toHaveText('příští týden');
    await expect(page.locator('#navChangesCount')).toHaveText('1');
    await expect(page.locator('#navChangesCountSr')).toHaveText(/1 změna v rozvrhu příští týden/);
  });

  test('„Dnes“ o víkendu nevrací na uplynulý týden', async ({ page, app, isMobile }) => {
    test.skip(isMobile, 'lišta pohledu je na počítači');
    await app.open('/', { time: SATURDAY });
    await app.timetableReady();
    await expect(page.locator('#ttTitle')).toHaveText('Týden 9.–13. listopadu');
    await page.click('#todayBtn');
    await expect(pressedSchedule(page)).toHaveAttribute('data-schedule', 'next');
    await expect(page.locator('#ttTitle')).toHaveText('Týden 9.–13. listopadu');
    // Z uplynulého týdne „Dnes“ skočí na pondělí příštího
    await page.click('#prevBtn');
    await expect(page.locator('#ttTitle')).toHaveText('Týden 2.–6. listopadu');
    await page.click('#todayBtn');
    await expect(page.locator('#ttTitle')).toHaveText('Týden 9.–13. listopadu');
    await page.click('#layoutSeg [data-layout="day"]');
    await expect(page.locator('#ttTitle')).toHaveText('Pondělí 9. listopadu');
  });
});

test.describe('Historie Dne (mobil)', () => {
  test.beforeEach(({ isMobile }) => { test.skip(!isMobile, 'Přehled / Den jsou obrazovky mobilu'); });
  const histScreen = (page) => page.evaluate(() => (history.state && history.state.screen) || null);

  test('den otevřený odkazem má záznam v historii, Zpět vrátí na Přehled', async ({ page, app }) => {
    await app.open('/?type=Class&id=C2A&day=2');
    await app.timetableReady();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'day');
    await expect(page).toHaveURL(/\/$/);
    expect(await histScreen(page)).toBe('day');
    await page.goBack();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'overview');
    await expect(page.locator('#ovHero')).toBeVisible();
  });

  test('„Rozvrh“ u třídy ve Změnách: Zpět vrátí jedním krokem do Změn', async ({ page, app }) => {
    await app.open('/?view=changes');
    const link = page.locator('#changesView a[data-open-class]').first();
    await link.click();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'timetable');
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'day');
    expect(await histScreen(page)).toBe('day');
    await page.goBack();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'changes');
    // Vpřed: zpátky na Den té třídy
    await page.goForward();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'timetable');
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'day');
  });

  test('učebna z Volných učeben: „‹“ ukáže Přehled učebny na místě, Zpět pak vrátí do Volných učeben', async ({ page, app }) => {
    await app.open('/?view=rooms');
    const link = page.locator('#roomsResult .room-link').first();
    const name = (await link.innerText()).trim();
    await link.click();
    await app.timetableReady(name);
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'day');
    await page.locator('#backBtn').click();
    await expect(page.locator('html')).toHaveAttribute('data-screen', 'overview');
    await expect(page.locator('html')).toHaveAttribute('data-view', 'timetable');
    // Obrazovka a záznam historie se shodují
    expect(await histScreen(page)).toBe(null);
    await page.goBack();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'rooms');
  });

  test('rychlé Zpět po klepnutí na řádek týdne nenechá Den bez záznamu v historii', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    // Zpět hned, jak Den zapíše svůj záznam do historie (dřív, než se stihne zobrazit)
    await page.evaluate(() => {
      const push = history.pushState.bind(history);
      history.pushState = (st, ...rest) => {
        push(st, ...rest);
        if (st && st.screen === 'day') { history.pushState = push; history.back(); }
      };
      document.querySelector('.ov-weekrows .wr[data-day="4"]').click();
    });
    await page.waitForTimeout(1200);
    const screen = await page.evaluate(() => document.documentElement.dataset.screen);
    // Zobrazená obrazovka a historie se shodují (Den jen se záznamem Dne)
    expect([screen, await histScreen(page)]).toEqual(['overview', null]);
  });
});

test.describe('Názvy hodin pro čtečku', () => {
  test('říkají totéž co obrazovka a neopakují obsah', async ({ page, app, isMobile }) => {
    await app.open('/');
    await app.timetableReady();
    if (isMobile) {
      const strip = page.locator('#ovStrip .ov-h');
      await expect(strip.nth(2)).toHaveAccessibleName(/^3\. hodina, 9:45–10:30, Matematika \(MAT\), vyučující Adam Šablonový, učebna U15, suplování, původně /);
      await expect(strip.nth(3)).toHaveAccessibleName(/, jiná učebna/);
      await expect(strip.nth(4)).toHaveAccessibleName(/, odpadá, nemoc vyučujícího$/);
      await app.openDay(isMobile);
    }
    const names = await page.locator('#timetable .lesson').evaluateAll(els => els.map(el => el.textContent));
    expect(names.length).toBeGreaterThan(5);
    const sub = page.locator('#timetable .lesson.is-sub').first();
    await expect(sub).toHaveAccessibleName(/^\d\. hodina, \d+:\d\d–\d+:\d\d, .+, vyučující .+, učebna .+, suplování/);
    for (const btn of await page.locator('#timetable .lesson').all()) {
      const name = await btn.evaluate(el => el.querySelector('.sr-only').textContent);
      await expect(btn).toHaveAccessibleName(name); // viditelné zkratky se nečtou podruhé
      expect(name).not.toMatch(/, změna$|zrušeno|nekoná se/);
    }
  });
});

test.describe('Přehled: obnovení „teď“', () => {
  test('pravidelné obnovení hrdiny (15 s) nechá nadpis, na který sekce odkazuje (aria-labelledby)', async ({ page, app }) => {
    await page.clock.install({ time: NOW });
    await app.open('/', { time: null });
    await app.timetableReady();
    await expect(page.locator('#ovHero > h2#ovHeroLabel')).toHaveText('Teď');
    await page.evaluate(() => { window.__big = document.querySelector('#ovHero .ov-big'); });
    await page.clock.fastForward(16_000);
    // hrdina se překreslil (nový prvek), sekce pořád má svůj nadpis
    await expect.poll(() => page.evaluate(() => !!document.querySelector('#ovHero .ov-big') && window.__big !== document.querySelector('#ovHero .ov-big'))).toBe(true);
    await expect(page.locator('#ovHero')).toHaveAttribute('aria-labelledby', 'ovHeroLabel');
    await expect(page.locator('#ovHero > h2#ovHeroLabel')).toHaveText('Teď');
  });
});
