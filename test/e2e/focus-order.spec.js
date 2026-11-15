// Fokus z klávesnice: na mobilu se nesmí schovat pod plovoucí lištu (WCAG 2.4.11)
// a na počítači jde po lištách nástrojů po řádcích zleva doprava (WCAG 2.4.3).
const { test, expect } = require('./support/fixtures');

/** Kolik procent plochy fokusovaného prvku zakrývá spodní lišta nebo kulaté hledání. */
function obscured() {
  const el = document.activeElement;
  if (!el || el === document.body || el.closest('#viewNav, #searchFab, dialog, .skip-link')) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  let covered = 0;
  for (const id of ['viewNav', 'searchFab']) {
    const b = document.getElementById(id).getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left));
    const h = Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
    covered += w * h;
  }
  const name = (el.getAttribute('aria-label') || el.textContent || el.id || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
  return { name, pct: Math.round(100 * covered / (r.width * r.height)) };
}

test.describe('Fokus nad plovoucí lištou (mobil)', () => {
  test.skip(({ isMobile }) => !isMobile, 'plovoucí lišta je jen na mobilu');
  for (const [name, url] of [['přehled', '/'], ['změny', '/?view=changes']]) {
    test(`${name}: žádná zastávka tabulátoru není ani zčásti pod lištou`, async ({ page, app }) => {
      await app.open(url, { reducedMotion: 'reduce' });
      if (url === '/') await app.timetableReady();
      else await expect(page.locator('#changesList tbody tr').first()).toBeVisible();
      const hidden = [];
      for (let i = 0; i < 45; i++) {
        await page.keyboard.press('Tab');
        const o = await page.evaluate(obscured);
        if (o && o.pct > 0) hidden.push(`${o.name}: ${o.pct} %`);
      }
      expect(hidden, 'fokus zakrytý lištou').toEqual([]);
    });
  }
});

test.describe('Pořadí fokusu v liště (počítač)', () => {
  test.skip(({ isMobile }) => isMobile, 'dvouřádková lišta je jen na počítači');
  test('Tab prochází lištu po řádcích: rozvrh, týden, Jen změny, akce, pak Den / Týden a Dnes ‹ ›', async ({ page, app }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await app.open('/', { reducedMotion: 'reduce' });
    await app.timetableReady();
    await page.locator('#valueDropdownTrigger').focus();
    const stops = [];
    for (let i = 0; i < 16; i++) {
      const s = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el.closest('.topbar')) return null;
        const r = el.getBoundingClientRect();
        return { name: (el.getAttribute('aria-label') || el.textContent).trim().replace(/\s+/g, ' ').slice(0, 20), top: Math.round(r.top) };
      });
      if (!s) break;
      stops.push(s);
      await page.keyboard.press('Tab');
    }
    expect(stops.length).toBeGreaterThanOrEqual(12);
    // řádek se smí změnit jen jednou (z prvního na druhý), nikdy zpět nahoru
    const rows = stops.map(s => (s.top < stops[0].top + 30 ? 1 : 2));
    const back = rows.findIndex((r, i) => i > 0 && r < rows[i - 1]);
    expect(back, `pořadí: ${stops.map((s, i) => `${s.name} (${rows[i]})`).join(' → ')}`).toBe(-1);
  });
});
