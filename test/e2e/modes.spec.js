// Zvláštní režimy a pohyb: čára „teď“ bez překreslování, omezený pohyb, zvýšený
// kontrast (iOS a macOS „Zvýšit kontrast“), vysoký kontrast Windows a najetí myší
// na blok hodiny ve světlém režimu.
const { test, expect } = require('./support/fixtures');

function lum([r, g, b]) {
  const l = [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const parse = (s) => { const v = s.match(/[\d.]+/g).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };

/** Den s čárou „teď“ (mobil: z přehledu, počítač: rozvržení Den). */
async function openToday(page, app, isMobile) {
  await app.timetableReady();
  await app.openDay(isMobile);
  if (!isMobile) await page.click('#layoutSeg [data-layout="day"]');
  await expect(page.locator('.tl .nowline')).toBeVisible();
}

/** Vlastnosti, které mění nekonečné animace na stránce. */
const infiniteAnimations = () => document.getAnimations()
  .filter(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity)
  .map(a => ({
    target: `${a.effect.target?.className || ''}${a.effect.pseudoElement || ''}`,
    props: [...new Set(a.effect.getKeyframes().flatMap(k => Object.keys(k)))].filter(p => !['offset', 'computedOffset', 'easing', 'composite'].includes(p)),
  }));

test.describe('Čára „teď“ a pohyb', () => {
  test('bod čáry dýchá jen průhledností a měřítkem (běží v kompozitoru, bez překreslování)', async ({ page, app, isMobile }) => {
    await app.open('/', { reducedMotion: 'no-preference' });
    await openToday(page, app, isMobile);
    const anims = await page.evaluate(infiniteAnimations);
    expect(anims.length, 'čára „teď“ má animaci').toBeGreaterThan(0);
    for (const a of anims) expect(a.props.filter(p => p !== 'opacity' && p !== 'transform'), a.target).toEqual([]);
  });

  test('omezený pohyb: nic se samo nepohybuje', async ({ page, app, isMobile }) => {
    await app.open('/', { reducedMotion: 'reduce' });
    await openToday(page, app, isMobile);
    expect(await page.evaluate(infiniteAnimations)).toEqual([]);
  });
});

test.describe('Režimy kontrastu', () => {
  test('zvýšený kontrast (prefers-contrast: more): plné plochy bez skla a plně bílý tlumený text', async ({ page, app, isMobile }) => {
    await page.emulateMedia({ contrast: 'more' });
    await app.open('/', { theme: 'light' });
    await app.timetableReady();
    const s = await page.evaluate((mobile) => {
      const nav = getComputedStyle(document.querySelector(mobile ? '#viewNav' : '#sidebar'));
      const muted = document.querySelector(mobile ? '#viewNav a:not([aria-current])' : '.side-h');
      return { bg: nav.backgroundColor, blur: nav.backdropFilter || nav.webkitBackdropFilter, muted: getComputedStyle(muted).color };
    }, isMobile);
    expect(parse(s.bg)[3], `pozadí lišty ${s.bg}`).toBe(1);
    expect(s.blur).toBe('none');
    expect(s.muted).toBe('rgb(255, 255, 255)');
  });

  test('vysoký kontrast Windows (forced-colors): štítek času „teď“ zůstane čitelný', async ({ page, app, isMobile }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await app.open('/');
    await openToday(page, app, isMobile);
    const pill = await page.locator('.tl .now-pill').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { text: el.textContent.trim(), adjust: cs.forcedColorAdjust, color: cs.color, bg: cs.backgroundColor };
    });
    expect(pill.text).toMatch(/^\d{1,2}:\d{2}$/);
    // bez forced-color-adjust: none nakreslí Chrome pod text podložku a HighlightText na ní zmizí
    expect(pill.adjust).toBe('none');
    expect(ratio(parse(pill.color), parse(pill.bg))).toBeGreaterThanOrEqual(4.5);
  });

  test('najetí myší na blok hodiny nesníží kontrast tlumeného textu pod 4,5 : 1 (světlý režim)', async ({ page, app, isMobile }) => {
    test.skip(isMobile, 'najetí myší je na počítači');
    await app.open('/', { theme: 'light' });
    await app.timetableReady();
    const block = page.locator('.wg-col .ev:not(.is-cancelled):not(.current-time)').filter({ has: page.locator('.ev-w') }).first();
    await block.hover();
    const s = await block.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { filter: cs.filter, bg: cs.backgroundColor, muted: getComputedStyle(el.querySelector('.ev-w')).color };
    });
    // filtr by zesvětlil i bílý text, který světlejší být nemůže: kontrast by klesl (4,42 : 1)
    expect(s.filter).toBe('none');
    const bg = parse(s.bg), fg = parse(s.muted);
    const text = [0, 1, 2].map(i => fg[3] * fg[i] + (1 - fg[3]) * bg[i]);
    expect(ratio(text, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
