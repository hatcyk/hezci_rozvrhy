// Kontrast z vykreslených pixelů tam, kde ho axe nespočítá (sklo, stavové plochy):
//  - plovoucí sklo (spodní lišta, hledání) nad bílým obsahem = nejhorší případ, který
//    nastane např. nad bílou buňkou ve Společném volnu (WCAG 1.4.3 a 1.4.11);
//  - vybraný segment, aktuální záložka a položka panelu se od nevybraných liší
//    aspoň 3 : 1 (WCAG 1.4.11), ne jen o odstín výplně.
// Text se při měření zprůhlední, aby se vzorkovalo jen pozadí.
const { test, expect } = require('./support/fixtures');

const HIDE_TEXT = `*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }
  svg.i { visibility: hidden !important; } *:focus, *:focus-visible { outline: none !important; }`;

function lum([r, g, b]) {
  const l = [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = ([r, g, b, a], bg) => [r, g, b].map((v, i) => a * v + (1 - a) * bg[i]);
const parse = (s) => { const v = s.match(/[\d.]+/g).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };

/** Barvy pixelů v bodech (CSS px) ze snímku okna; PNG se dekóduje v prázdné stránce. */
async function pixels(page, points) {
  const png = (await page.screenshot()).toString('base64');
  const scale = await page.evaluate(() => devicePixelRatio);
  const blank = await page.context().newPage();
  try {
    return await blank.evaluate(async ({ png, points, scale }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
      return points.map(([x, y]) => [...cx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data].slice(0, 3));
    }, { png, points, scale });
  } finally { await blank.close(); }
}

/** Body uvnitř prvku (mřížka), mimo zaoblené rohy. */
async function grid(locator, cols = 5, rows = 3) {
  const r = await locator.boundingBox();
  const pts = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    pts.push([r.x + r.width * (0.2 + 0.6 * i / Math.max(1, cols - 1)), r.y + r.height * (0.25 + 0.5 * j / Math.max(1, rows - 1))]);
  }
  return pts;
}
/** Bod v okraji tlačítka (vlevo od textu), kde je vidět jen jeho plocha. */
async function padPoint(locator) {
  const r = await locator.boundingBox();
  return [r.x + 5, r.y + r.height / 2];
}

test.describe('Plovoucí sklo nad bílým obsahem', () => {
  test.skip(({ isMobile }) => !isMobile, 'spodní lišta a kulaté hledání jsou jen na mobilu');
  for (const theme of ['dark', 'light']) {
    test(`popisky lišty ≥ 4,5 : 1 a ikony ≥ 3 : 1 i nad bílou plochou – ${theme === 'dark' ? 'tmavý' : 'světlý'} motiv`, async ({ page, app }) => {
      await app.open('/', { theme, reducedMotion: 'reduce' });
      await app.timetableReady();
      const colors = await page.evaluate(() => ({
        label: getComputedStyle(document.querySelector('#viewNav a:not([aria-current])')).color,
        current: getComputedStyle(document.querySelector('#viewNav a[aria-current]')).color,
        fab: getComputedStyle(document.querySelector('#searchFab')).color,
      }));
      // bílá vrstva pod lištou (z-index lišty je 50), nad veškerým obsahem
      // počet změn (zlatá kapka s vlastním tmavým písmem) není pozadí popisku
      await page.addStyleTag({ content: `body::after { content: ""; position: fixed; inset: 0; z-index: 40; background: #fff; } .vn-count { visibility: hidden !important; } ${HIDE_TEXT}` });
      await page.mouse.move(1, 1);
      const others = page.locator('#viewNav a:not([aria-current])');
      const pts = [];
      for (let i = 0; i < await others.count(); i++) pts.push(...await grid(others.nth(i)));
      const navBg = await pixels(page, pts);
      const worstNav = navBg.reduce((w, c) => (lum(c) > lum(w) ? c : w));
      const curBg = await pixels(page, await grid(page.locator('#viewNav a[aria-current]')));
      const worstCur = curBg.reduce((w, c) => (ratio(over(parse(colors.current), c), c) < ratio(over(parse(colors.current), w), w) ? c : w));
      const fabBg = await pixels(page, await grid(page.locator('#searchFab'), 3, 3));
      const worstFab = fabBg.reduce((w, c) => (lum(c) > lum(w) ? c : w));

      const label = ratio(over(parse(colors.label), worstNav), worstNav);
      const current = ratio(over(parse(colors.current), worstCur), worstCur);
      const fab = ratio(over(parse(colors.fab), worstFab), worstFab);
      expect(label, `popisek záložky na ${worstNav}`).toBeGreaterThanOrEqual(4.5);
      expect(current, `popisek aktuální záložky na ${worstCur}`).toBeGreaterThanOrEqual(4.5);
      expect(fab, `ikona hledání na ${worstFab}`).toBeGreaterThanOrEqual(3);
    });
  }
});

test.describe('Vybraný stav je vidět (≥ 3 : 1 proti nevybranému)', () => {
  for (const theme of ['dark', 'light']) {
    test(`segmenty, aktuální záložka a položka panelu – ${theme === 'dark' ? 'tmavý' : 'světlý'} motiv`, async ({ page, app, isMobile }) => {
      await app.open('/', { theme, reducedMotion: 'reduce' });
      await app.timetableReady();
      await app.openDay(isMobile);
      await page.addStyleTag({ content: HIDE_TEXT });
      await page.mouse.move(1, 1);
      const pairs = [
        ['Stálý / Aktuální / Příští', '#ttControls .tt-sched > [aria-pressed="true"]', '#ttControls .tt-sched > [aria-pressed="false"]'],
        [isMobile ? 'spodní lišta' : 'postranní panel', '#viewNav a[aria-current]', '#viewNav a:not([aria-current])'],
      ];
      if (!isMobile) pairs.push(['Den / Týden', '#layoutSeg > [aria-pressed="true"]', '#layoutSeg > [aria-pressed="false"]']);
      for (const [name, on, off] of pairs) {
        const [a, b] = await pixels(page, [await padPoint(page.locator(on).first()), await padPoint(page.locator(off).first())]);
        expect(ratio(a, b), `${name}: vybraný ${a} proti nevybranému ${b}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
