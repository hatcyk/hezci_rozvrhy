// Klávesnice a dialogy (WCAG 2.1.1, 2.4.3, 2.4.7): hodiny ve všech
// rozvrženích (a v pásu přehledu) jdou otevřít Enterem, panely jsou modální
// <dialog> s fokusem uvnitř, Esc je zavře a fokus se vrátí na ovládací prvek,
// který je otevřel (u položek nabídky „⋯“ na tlačítko „⋯“).
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
  mobil: ['day', 'compact-list', 'card-view'],
  desktop: ['week-view', 'day'],
};

test.describe('Karty hodin z klávesnice', () => {
  for (const layout of new Set([...LAYOUTS.mobil, ...LAYOUTS.desktop])) {
    test(`${layout}: Tab na kartu, Enter otevře detail, Esc zavře a vrátí fokus`, async ({ page, app }, info) => {
      test.skip(!LAYOUTS[info.project.name].includes(layout), `rozvržení ${layout} není pro ${info.project.name}`);
      await app.open('/', { layout });
      await app.timetableReady();
      await app.openDay(info.project.name === 'mobil');

      // Všechny hodiny jsou fokusovatelná tlačítka (nativní <button>, nebo role=button)
      const counts = await page.evaluate((sel) => {
        const els = [...document.querySelectorAll(sel)];
        const role = (e) => e.getAttribute('role') || (e.tagName === 'BUTTON' ? 'button' : e.tagName.toLowerCase());
        return { all: els.length, focusable: els.filter(e => e.tabIndex >= 0 && !e.closest('[inert]')).length, roles: [...new Set(els.map(role))] };
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

  test('mezerník otevře detail stejně jako Enter (i z pásu hodin přehledu)', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    expect(await tabToLesson(page)).toBe(true);
    await page.keyboard.press(' ');
    await expect(page.locator('#lessonModal')).toHaveAttribute('open', '');
    await page.locator('#modalClose').click();
    await expect(page.locator('#lessonModal')).not.toHaveAttribute('open', '');
  });
});

/** [název, otevírací tlačítko, dialog, projekty, položka nabídky „⋯“] */
const SHEETS = [
  ['Nastavení', '#settingsToggle', '#settingsModal', ['mobil', 'desktop'], false],
  ['Hledání (název rozvrhu)', '#valueDropdownTrigger', '#searchSheet', ['mobil'], false],
  ['Hledání (kulaté tlačítko)', '#searchFab', '#searchSheet', ['mobil'], false],
  ['Notifikace', '#notificationBell', '#notificationModal', ['desktop'], false],
  ['Upozornění z nabídky', '#notifMenuBtn', '#notificationModal', ['mobil'], true],
  ['Oblíbené', '#favoritesBtn', '#favoritesModal', ['mobil', 'desktop'], true],
  ['Do kalendáře', '#calendarBtn', '#calendarModal', ['mobil', 'desktop'], true],
];

test.describe('Dialogy: fokus a Esc', () => {
  for (const [name, opener, sheet, projects, inMenu] of SHEETS) {
    test(`${name}: modální, fokus zůstává uvnitř, Esc zavře a vrátí fokus`, async ({ page, app }, info) => {
      test.skip(!projects.includes(info.project.name), `jen ${projects.join(', ')}`);
      await app.open('/');
      await app.timetableReady();

      if (inMenu) {
        // Nabídka „⋯“: šipkou dolů se otevře s fokusem na první položce, šipkami se chodí
        await page.focus('#moreBtn');
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('#moreBtn')).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('#moreMenu [role="menuitem"]').first()).toBeFocused();
        for (let i = 0; i < 8 && !(await page.locator(opener).evaluate(e => e === document.activeElement)); i++) {
          await page.keyboard.press('ArrowDown');
        }
        await expect(page.locator(opener)).toBeFocused();
      } else {
        await page.focus(opener);
      }
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
      await expect(page.locator(inMenu ? '#moreBtn' : opener)).toBeFocused();
      if (inMenu) await expect(page.locator('#moreMenu')).toBeHidden();
    });
  }

  test('nabídka „⋯“: Esc ji zavře a vrátí fokus, klik mimo ji zavře', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await page.click('#moreBtn');
    await expect(page.locator('#moreMenu')).toBeVisible();
    await expect(page.locator('#moreMenu [role="menuitem"]').first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('#refreshBtn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#moreMenu')).toBeHidden();
    await expect(page.locator('#moreBtn')).toBeFocused();
    await expect(page.locator('#moreBtn')).toHaveAttribute('aria-expanded', 'false');
    await page.click('#moreBtn');
    await page.mouse.click(5, 400);
    await expect(page.locator('#moreMenu')).toBeHidden();
  });

  test('vrstvené panely: Nastavení → Notifikace, Esc zavře jen horní', async ({ page, app }) => {
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
    await page.click('#moreBtn');
    await page.click('#calendarBtn');
    const subscribe = page.locator('#calendarSubscribe');
    await expect(subscribe).toHaveAttribute('href', /^webcal:\/\/127\.0\.0\.1:\d+\/api\/ical\/Class\/C2A\.ics\?schedule=actual,next$/);
    await page.check('#calendarGroups input[value="1.sk"]');
    await page.check('input[name="calSchedule"][value="permanent"]');
    await expect(subscribe).toHaveAttribute('href', /schedule=permanent&group=1\.sk$/);
    await expect(page.locator('.cal-note')).toContainText('Outlook');
  });
});
