// Hledání při otevřené klávesnici iOS (snímky 7805 a 7807). Klávesnice iOS layout viewport nezmenší,
// jen ho zakryje a viditelnou oblast případně posune dolů; position: fixed se počítá od layout
// viewportu. Chromium klávesnici iOS neumí, proto test podstrčí visualViewport s rozměry naměřenými
// v iOS Simulatoru 26.5 (aplikace na ploše: klávesnice s lištou 403 px z 874) a pošle jeho události.
const { test, expect } = require('./support/fixtures');

const INSETS = { top: 59, topMax: 59, left: 0, leftMax: 0, right: 0, rightMax: 0, bottom: 34, bottomMax: 34 };
const KB = 390; // 403 px z 874 přepočtené na 844

/** Podstrčí rozměry visualViewport (klávesnice, posun) a pošle resize + scroll. */
function keyboard(page, { open = true, offsetTop = 0 } = {}) {
  return page.evaluate(({ kb, open, offsetTop }) => {
    const vv = window.visualViewport;
    const h = open ? innerHeight - kb : innerHeight;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => h });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => (open ? offsetTop : 0) });
    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('scroll'));
  }, { kb: KB, open, offsetTop });
}

const box = (page, sel) => page.locator(sel).evaluate(el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; });

test.describe('Hledání s klávesnicí na telefonu', () => {
  test.beforeEach(async ({ page, context, isMobile }) => {
    test.skip(!isMobile, 'telefon');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: INSETS });
  });

  test('panel vyplní viditelnou oblast nad klávesnicí, stránka pod ním stojí a lišta zmizí', async ({ page, app }) => {
    await app.open('/');
    await app.timetableReady();
    await page.evaluate(() => window.scrollTo(0, 400));
    const pageTop = await box(page, '#overview');
    await page.click('#searchFab');
    const sheet = page.locator('#searchSheet');
    await expect(sheet).toHaveAttribute('open', '');
    await expect(page.locator('#searchInput')).toBeFocused();
    await page.waitForFunction(() => document.querySelector('#searchSheet').getAnimations().every(a => a.playState !== 'running'));

    // stránka pod panelem se neposune a sama posouvat nejde
    expect(await box(page, '#overview')).toEqual(pageTop);
    expect(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1), 'pozadí je zamčené').toBe(true);
    // plovoucí lišta a lupa se pod panelem neukazují
    await expect(page.locator('#viewNav')).toBeHidden();
    await expect(page.locator('#searchFab')).toBeHidden();

    for (const offsetTop of [0, 300]) {
      await keyboard(page, { offsetTop });
      const visTop = offsetTop;
      const visBottom = offsetTop + 844 - KB;
      const s = await box(sheet, ':scope');
      expect(s.top, `panel pod stavovým řádkem (posun ${offsetTop})`).toBeGreaterThanOrEqual(visTop + INSETS.top - 0.5);
      expect(Math.abs(s.bottom - visBottom), `panel končí u klávesnice (posun ${offsetTop})`).toBeLessThanOrEqual(1);
      const input = await box(page, '#searchInput');
      expect(input.top).toBeGreaterThanOrEqual(visTop + INSETS.top);
      expect(input.bottom).toBeLessThanOrEqual(visBottom);
      // seznam se posouvá uvnitř panelu a končí nad klávesnicí
      const list = await box(page, '#searchSlotSheet');
      expect(list.bottom).toBeLessThanOrEqual(visBottom + 0.5);
      expect(await page.locator('#searchSlotSheet').evaluate(el => getComputedStyle(el).overflowY)).toBe('auto');
    }

    // klávesnice zmizí: panel zase od spodního okraje, po zavření stránka na původním místě a lišta zpět
    await keyboard(page, { open: false });
    expect(Math.round((await box(sheet, ':scope')).bottom)).toBe(844);
    await page.keyboard.press('Escape');
    await expect(sheet).not.toHaveAttribute('open', '');
    expect(await page.evaluate(() => Math.round(scrollY))).toBe(400);
    expect(await box(page, '#overview')).toEqual(pageTop);
    await expect(page.locator('#viewNav')).toBeVisible();
    await expect(page.locator('#searchFab')).toBeVisible();
  });

  test('klávesnice nad obsahem stránky: plovoucí lišta a lupa nevisí přes obsah', async ({ page, app }) => {
    await app.open('/?view=common');
    await expect(page.locator('#commonTitle')).toBeVisible();
    await expect(page.locator('#viewNav')).toBeVisible();
    await keyboard(page);
    await expect(page.locator('#viewNav')).toBeHidden();
    await expect(page.locator('#searchFab')).toBeHidden();
    await keyboard(page, { open: false });
    await expect(page.locator('#viewNav')).toBeVisible();
  });
});
