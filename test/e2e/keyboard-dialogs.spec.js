// Klávesnice a dialogy (WCAG 2.1.1, 2.4.3, 2.4.7): karty hodin ve všech
// rozvrženích jdou otevřít Enterem, panely jsou modální <dialog> s fokusem
// uvnitř, Esc je zavře a fokus se vrátí na ovládací prvek, který je otevřel.
const { test, expect, LESSON } = require('./support/fixtures');

const focusedIsLesson = (page) => page.evaluate((sel) => !!document.activeElement?.matches(sel), LESSON);

/** Tabulátorem dojde na první kartu hodiny (nejvýš `max` zastávek). */
async function tabToLesson(page, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await focusedIsLesson(page)) return true;
  }
  return false;
}

const LAYOUTS = {
  mobil: ['agenda', 'compact-list', 'card-view', 'single-day'],
  desktop: ['week-view', 'single-day'],
};

test.describe('Karty hodin z klávesnice', () => {
  for (const layout of new Set([...LAYOUTS.mobil, ...LAYOUTS.desktop])) {
    test(`${layout}: Tab na kartu, Enter otevře detail, Esc zavře a vrátí fokus`, async ({ page, app }, info) => {
      test.skip(!LAYOUTS[info.project.name].includes(layout), `rozvržení ${layout} není pro ${info.project.name}`);
      await app.open('/', { layout });
      await app.timetableReady();

      // Všechny viditelné karty jsou fokusovatelné (v kartovém zobrazení jen aktuální karta, ostatní inert)
      const counts = await page.evaluate((sel) => {
        const els = [...document.querySelectorAll(sel)];
        return { all: els.length, focusable: els.filter(e => e.tabIndex >= 0 && !e.closest('[inert]')).length, roles: [...new Set(els.map(e => e.getAttribute('role')))] };
      }, LESSON);
      expect(counts.focusable).toBeGreaterThan(0);
      expect(counts.roles).toEqual(['button']);

      expect(await tabToLesson(page), 'karta hodiny dosažitelná tabulátorem').toBe(true);
      const card = page.locator(':focus');
      const cardText = await card.innerText();
      await page.keyboard.press('Enter');
      const modal = page.locator('#lessonModal');
      await expect(modal).toHaveAttribute('open', '');
      expect(await modal.evaluate(d => d.matches(':modal'))).toBe(true);
      await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('#lessonModal'))).toBe(true);

      await page.keyboard.press('Escape');
      await expect(modal).not.toHaveAttribute('open', '');
      await expect.poll(() => focusedIsLesson(page)).toBe(true);
      expect(await page.locator(':focus').innerText()).toBe(cardText);
    });
  }

  test('mezerník otevře detail stejně jako Enter', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    expect(await tabToLesson(page)).toBe(true);
    await page.keyboard.press(' ');
    await expect(page.locator('#lessonModal')).toHaveAttribute('open', '');
    await page.locator('#modalClose').click();
    await expect(page.locator('#lessonModal')).not.toHaveAttribute('open', '');
  });
});

/** [název, otevírací tlačítko, dialog, projekty] */
const SHEETS = [
  ['Nastavení', '#settingsToggle', '#settingsModal', ['mobil']],
  ['Výběr rozvrhu', '#valueDropdownTrigger', '#dropdownMobileSheet', ['mobil']],
  ['Notifikace', '#notificationBell', '#notificationModal', ['desktop']],
  ['Oblíbené', '#favoritesBtn', '#favoritesModal', ['mobil', 'desktop']],
  ['Do kalendáře', '#calendarBtn', '#calendarModal', ['mobil', 'desktop']],
];

test.describe('Dialogy: fokus a Esc', () => {
  for (const [name, opener, sheet, projects] of SHEETS) {
    test(`${name}: modální, fokus zůstává uvnitř, Esc zavře a vrátí fokus`, async ({ page, app }, info) => {
      test.skip(!projects.includes(info.project.name), `jen ${projects.join(', ')}`);
      await app.open('/');
      await app.timetableReady();

      await page.focus(opener);
      await page.keyboard.press('Enter');
      const dialog = page.locator(sheet);
      await expect(dialog).toHaveAttribute('open', '');
      expect(await dialog.evaluate(d => d.matches(':modal'))).toBe(true);
      await expect.poll(() => page.evaluate((s) => !!document.activeElement?.closest(s), sheet)).toBe(true);

      // Stránka za panelem je inertní: tabulátor neopustí panel
      // (body = fokus přešel do UI prohlížeče, což je u nativního modálu v pořádku)
      let escaped = 0;
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate((s) => { const a = document.activeElement; return !a || a === document.body || !!a.closest(s); }, sheet);
        if (!inside) escaped++;
      }
      expect(escaped, 'zastávek tabulátoru mimo panel').toBe(0);

      await page.keyboard.press('Escape');
      await expect(dialog).not.toHaveAttribute('open', '');
      await expect(page.locator(opener)).toBeFocused();
    });
  }

  test('vrstvené panely: Nastavení → Notifikace, Esc zavře jen horní', async ({ page, app }, info) => {
    test.skip(info.project.name !== 'mobil', 'Nastavení je jen na mobilu');
    await app.open('/');
    await app.timetableReady();
    await page.click('#settingsToggle');
    await page.click('#settingsNotifications');
    await expect(page.locator('#notificationModal')).toHaveAttribute('open', '');
    await expect(page.locator('#settingsModal')).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(page.locator('#notificationModal')).not.toHaveAttribute('open', '');
    await expect(page.locator('#settingsModal')).toHaveAttribute('open', '');
  });

  test('Do kalendáře: webcal odkaz se mění podle volby týdne a skupiny', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await page.click('#calendarBtn');
    const subscribe = page.locator('#calendarSubscribe');
    await expect(subscribe).toHaveAttribute('href', /^webcal:\/\/127\.0\.0\.1:\d+\/api\/ical\/Class\/C2A\.ics\?schedule=actual,next$/);
    await page.check('#calendarGroups input[value="1.sk"]');
    await page.check('input[name="calSchedule"][value="permanent"]');
    await expect(subscribe).toHaveAttribute('href', /schedule=permanent&group=1\.sk$/);
    await expect(page.locator('.cal-note')).toContainText('Outlook');
  });
});
