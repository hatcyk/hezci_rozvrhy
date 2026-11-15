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
