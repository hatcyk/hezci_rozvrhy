// viewport-fit=cover: stránka sahá pod výřez a zaoblené rohy displeje, takže
// každý prvek u okraje musí sám dodržet env(safe-area-inset-*). Bezpečnou
// oblast telefonu na šířku emuluje Chromium (Emulation.setSafeAreaInsetsOverride).
const { test, expect } = require('./support/fixtures');

const INSET = 47; // iPhone s výřezem na šířku
const INSETS = { top: 0, topMax: 0, left: INSET, leftMax: INSET, right: INSET, rightMax: INSET, bottom: 21, bottomMax: 21 };

async function emulateInsets(page, context) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: INSETS });
}

/**
 * Viditelné prvky uvnitř `rootSelector`, které přesahují do vložek vlevo nebo
 * vpravo (prázdné pole = v pořádku). Pozadí přes celou šířku smí být jen
 * kořen sám.
 */
function outside(page, rootSelector, { self = false } = {}) {
  return page.evaluate(({ rootSelector, inset, self }) => {
    const bad = [];
    const roots = document.querySelectorAll(rootSelector);
    if (!roots.length) return [`${rootSelector} na stránce není`];
    for (const root of roots) {
      const all = [...root.querySelectorAll('*')];
      if (self) all.push(root);
      for (const el of all) {
        if (el.closest('[inert], [hidden], .sr-only, .vh')) continue;
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 2 || b.height < 2) continue;
        if (b.right <= 0 || b.left >= innerWidth || b.bottom <= 0 || b.top >= innerHeight) continue; // mimo obrazovku
        if (b.left < inset - 0.5 || b.right > innerWidth - inset + 0.5) {
          bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className.baseVal ?? el.className).split(' ')[0]} ${Math.round(b.left)}..${Math.round(innerWidth - b.right)}`);
        }
      }
    }
    return bad.slice(0, 12);
  }, { rootSelector, inset: INSET, self });
}

async function envWorks(page) {
  return page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:env(safe-area-inset-left);top:0;width:1px;height:1px';
    document.body.appendChild(d);
    const left = d.getBoundingClientRect().left;
    d.remove();
    return left;
  });
}

test.describe('Bezpečná oblast: telefon na šířku', () => {
  test.beforeEach(async ({ page, context, isMobile }) => {
    test.skip(!isMobile, 'rozvržení telefonu');
    await page.setViewportSize({ width: 844, height: 390 });
    await emulateInsets(page, context);
  });

  test('rám: lišty, hledání, hlášky a toast nesahají pod výřez', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    expect(await envWorks(page), 'emulace bezpečné oblasti').toBe(INSET);
    await page.evaluate(() => {
      for (const id of ['offlineBanner', 'outageBanner', 'updateBanner']) document.getElementById(id).classList.remove('hidden');
      const box = document.createElement('div');
      box.className = 'toast-container';
      box.innerHTML = '<div class="toast g-toast g-glass" style="max-width:none">Zkušební hláška přes celou šířku</div>';
      document.body.appendChild(box);
    });
    for (const sel of ['.topbar', '#banners', '#viewNav', '#searchFab', '.toast-container', '#overview']) {
      expect(await outside(page, sel, { self: sel !== '.toast-container' }), sel).toEqual([]);
    }
    // odkaz „Přeskočit na obsah“
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    expect(await outside(page, '.skip-link', { self: true }), '.skip-link').toEqual([]);
  });

  const openFromMenu = (opener) => async (page) => { await page.click('#moreBtn'); await page.click(opener); };
  const SHEETS = [
    ['Nastavení', '#settingsModal', (page) => page.click('#settingsToggle')],
    ['Hledání', '#searchSheet', (page) => page.click('#searchFab')],
    ['Upozornění', '#notificationModal', openFromMenu('#notifMenuBtn')],
    ['Oblíbené', '#favoritesModal', openFromMenu('#favoritesBtn')],
    ['Do kalendáře', '#calendarModal', openFromMenu('#calendarBtn')],
  ];
  for (const [name, sheet, open] of SHEETS) {
    test(`panel ${name}: nadpis, zavírací tlačítko a obsah jsou v bezpečné oblasti`, async ({ page, app }) => {
      await app.open('/');
      await app.timetableReady();
      await open(page);
      const dialog = page.locator(sheet);
      await expect(dialog).toHaveAttribute('open', '');
      await page.waitForFunction((s) => document.querySelector(s).getAnimations({ subtree: true }).every(a => a.playState !== 'running' || a.effect.getComputedTiming().iterations === Infinity), sheet);
      // panel sám sahá od okraje k okraji (sklo pod výřezem), obsah ne
      const box = await dialog.boundingBox();
      expect([box.x, box.width]).toEqual([0, 844]);
      expect(await outside(page, `${sheet}`), sheet).toEqual([]);
      const close = await dialog.locator('.g-sheet-head .g-circle').first().boundingBox();
      expect(844 - (close.x + close.width)).toBeGreaterThanOrEqual(INSET);
    });
  }

  test('detail hodiny: obsah je v bezpečné oblasti', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await app.openDay(true);
    await page.locator('#timetable .lesson').first().click();
    await expect(page.locator('#lessonModal')).toHaveAttribute('open', '');
    await page.waitForFunction(() => document.querySelector('#lessonModal').getAnimations({ subtree: true }).every(a => a.playState !== 'running'));
    expect(await outside(page, '#lessonModal'), '#lessonModal').toEqual([]);
  });
});

// iPhone s Dynamic Island na výšku v aplikaci na ploše (black-translucent): stránka sahá pod stavový řádek
const PORTRAIT = { top: 59, topMax: 59, left: 0, leftMax: 0, right: 0, rightMax: 0, bottom: 34, bottomMax: 34 };

/** Viditelné prvky, které do pásu stavového řádku (0 … top) něco kreslí: text, obrázek nebo vlastní pozadí. */
function inStatusBar(page, top) {
  return page.evaluate((top) => {
    const bad = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('[inert], [hidden], .sr-only, .vh')) continue;
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2 || b.bottom <= 0.5 || b.top >= top - 0.5) continue;
      const cs = getComputedStyle(el);
      const paints = /^(img|svg|video|canvas)$/i.test(el.tagName)
        || [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
        || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || cs.backgroundImage !== 'none';
      if (paints) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className.baseVal ?? el.className).split(' ')[0]} ${Math.round(b.top)}..${Math.round(b.bottom)}`);
    }
    return bad.slice(0, 12);
  }, top);
}

test.describe('Bezpečná oblast: telefon na výšku pod stavovým řádkem', () => {
  test.beforeEach(async ({ page, context, isMobile }) => {
    test.skip(!isMobile, 'telefon');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: PORTRAIT });
  });

  test('do pásu stavového řádku nic nevyčnívá: přehled, den a ostatní pohledy', async ({ page, app, isMobile }) => {
    await app.open('/');
    await app.timetableReady();
    expect(await page.evaluate(() => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;top:env(safe-area-inset-top);left:0;width:1px;height:1px';
      document.body.appendChild(d);
      const t = d.getBoundingClientRect().top;
      d.remove();
      return t;
    }), 'emulace bezpečné oblasti').toBe(PORTRAIT.top);
    expect(await inStatusBar(page, PORTRAIT.top), 'přehled').toEqual([]);
    await app.openDay(isMobile);
    expect(await inStatusBar(page, PORTRAIT.top), 'den').toEqual([]);
    for (const view of ['changes', 'rooms', 'common']) {
      await page.click(`#viewNav a[data-view="${view}"]`);
      await expect(page.locator('html')).toHaveAttribute('data-view', view);
      expect(await inStatusBar(page, PORTRAIT.top), view).toEqual([]);
    }
  });

  test('obsah posunutý pod stavový řádek zakryje pás oblohy, bez výřezu pás nic nezabírá', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    const band = () => page.evaluate(() => {
      const cs = getComputedStyle(document.body, '::after');
      return { position: cs.position, top: cs.top, height: cs.height, image: cs.backgroundImage !== 'none', events: cs.pointerEvents, z: Number(cs.zIndex) };
    });
    const zTabbar = await page.evaluate(() => Number(getComputedStyle(document.documentElement).getPropertyValue('--z-tabbar')));
    expect(await band()).toEqual({ position: 'fixed', top: '0px', height: `${PORTRAIT.top}px`, image: true, events: 'none', z: zTabbar });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { ...PORTRAIT, top: 0, topMax: 0 } });
    expect((await band()).height).toBe('0px');
  });

  test('kiosk na telefonu: hlavička i patička jsou v bezpečné oblasti', async ({ page, app }) => {
    await app.open('/?kiosk=changes');
    await expect(page.locator('.k-row').first()).toBeVisible();
    const box = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { head: r('.kiosk-head').top, foot: innerHeight - r('.kiosk-foot').bottom };
    });
    expect(box.head).toBeGreaterThanOrEqual(PORTRAIT.top);
    expect(box.foot).toBeGreaterThanOrEqual(PORTRAIT.bottom);
    expect(await inStatusBar(page, PORTRAIT.top), 'kiosk').toEqual([]);
  });
});

test.describe('Bezpečná oblast: počítač a kiosk', () => {
  test.beforeEach(async ({ page, context, isMobile }) => {
    test.skip(isMobile, 'rozvržení počítače');
    await emulateInsets(page, context);
  });

  test('postranní panel, obsah, lišta pohledu a toast', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    expect(await envWorks(page), 'emulace bezpečné oblasti').toBe(INSET);
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.className = 'toast-container';
      box.innerHTML = '<div class="toast g-toast g-glass">Zkušební hláška</div>';
      document.body.appendChild(box);
    });
    for (const sel of ['#sidebar', '.topbar', '#timetableView', '.toast-container']) {
      expect(await outside(page, sel, { self: sel !== '.toast-container' }), sel).toEqual([]);
    }
    await page.click('a[data-view="changes"]');
    await expect(page.locator('html')).toHaveAttribute('data-view', 'changes');
    for (const sel of ['.topbar', '#changesView']) expect(await outside(page, sel, { self: true }), sel).toEqual([]);
  });

  test('kiosk: tabule nesahá pod okraje', async ({ page, app }) => {
    await app.open('/?kiosk=changes');
    await expect(page.locator('.k-row').first()).toBeVisible();
    expect(await outside(page, '#kioskView'), '#kioskView').toEqual([]);
  });
});
