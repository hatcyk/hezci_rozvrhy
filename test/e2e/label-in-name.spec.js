// WCAG 2.5.3 Label in Name: přístupný název tlačítka hodiny obsahuje text,
// který je na tlačítku vidět (zkratku předmětu, jméno, učebnu, stav), takže
// hlasové ovládání najde tlačítko podle toho, co uživatel vidí. Pravidlo axe
// label-content-name-mismatch je experimentální, proto vlastní kontrola.
const { test, expect } = require('./support/fixtures');

/**
 * U každého tlačítka viditelné kousky textu (text viditelných listových
 * prvků; pás přehledu skládá víc údajů do jednoho prvku, ty se dělí na
 * „DEJ / FYZ“, „A101, U11“ a „2. sk U11“) a název, který čte čtečka.
 */
function lessonLabels(page, selector) {
  return page.locator(selector).evaluateAll((buttons) => buttons.map((btn) => {
    const pieces = [];
    const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (el.closest('.sr-only, .vh')) continue;
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      for (const piece of text.split(/\s+\/\s+|,\s+(?=\S+$)|(?<=\bsk)\s+(?=\S+$)/)) {
        // jen oddělovače a zástupná pomlčka nejsou text k vyslovení
        if (/[\p{L}\p{N}]/u.test(piece)) pieces.push(piece.replace(/\.{3}$/, ''));
      }
    }
    return { pieces, visible: btn.innerText.replace(/\s+/g, ' ').trim() };
  }));
}

async function check(page, selector, min) {
  const buttons = page.locator(selector);
  const labels = await lessonLabels(page, selector);
  expect(labels.length, `tlačítek ${selector}`).toBeGreaterThanOrEqual(min);
  const problems = [];
  for (let i = 0; i < labels.length; i++) {
    // název tak, jak ho z obsahu a ARIA skládá prohlížeč pro čtečku
    const name = await buttons.nth(i).evaluate((el) => {
      const hidden = (n) => n.nodeType === 1 && (n.getAttribute('aria-hidden') === 'true');
      const read = (n) => (n.nodeType === 3 ? n.textContent : hidden(n) ? '' : [...n.childNodes].map(read).join(' '));
      return (el.getAttribute('aria-label') || read(el)).replace(/\s+/g, ' ').trim();
    });
    await expect(buttons.nth(i)).toHaveAccessibleName(name.replace(/ ,/g, ','));
    expect(labels[i].pieces.length, `tlačítko ${i} má viditelný text`).toBeGreaterThan(0);
    const lower = name.toLowerCase();
    const missing = labels[i].pieces.filter(p => !lower.includes(p.toLowerCase()));
    if (missing.length) problems.push(`„${labels[i].visible}“: v názvu „${name}“ chybí ${missing.map(m => `„${m}“`).join(', ')}`);
    // věta, ne výčet s opakováním: žádná část se v názvu neopakuje
    const parts = name.split(/[,;:] /).map(s => s.trim().toLowerCase()).filter(s => s.length > 3);
    const repeated = parts.filter((s, k) => parts.indexOf(s) !== k && !/^\d+\. sk$/.test(s));
    if (repeated.length && !name.includes('dělená hodina')) problems.push(`„${name}“ opakuje ${repeated.join(', ')}`);
  }
  expect(problems).toEqual([]);
}

test.describe('Label in Name: tlačítka hodin', () => {
  test('Přehled: pás hodin', async ({ page, app, isMobile }) => {
    test.skip(!isMobile, 'pás hodin je na mobilu');
    await app.open('/');
    await app.timetableReady();
    await check(page, '#ovStrip .ov-h', 5);
    // probíhající hodina ukazuje „Teď“ místo času
    await expect(page.locator('#ovStrip .ov-h.cur .t')).toHaveText('Teď');
    await expect(page.locator('#ovStrip .ov-h.cur')).toHaveAccessibleName(/^1\. hodina, teď, 8:00–8:45, /);
  });

  for (const selected of ['Class:C2A', 'Teacher:T1', 'Room:R11']) {
    test(`Den (${selected.split(':')[0]})`, async ({ page, app, isMobile }) => {
      await app.open('/', { selected, ...(isMobile ? {} : { layout: 'day' }) });
      await expect(page.locator('html')).not.toHaveAttribute('data-loading', 'true');
      await expect(page.locator('.lesson').first()).toBeAttached();
      await app.openDay(isMobile);
      await check(page, '#timetable .lesson', 3);
    });
  }

  test('Týden', async ({ page, app, isMobile }) => {
    test.skip(isMobile, 'Týden je rozvržení počítače');
    await app.open('/');
    await app.timetableReady();
    await check(page, '#timetable .lesson', 20);
    // i úzké sloupce se zkratkami
    await page.setViewportSize({ width: 1100, height: 800 });
    await check(page, '#timetable .lesson', 20);
  });
});
