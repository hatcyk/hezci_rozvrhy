// Prohlížeč bez light-dark() (Safari < 17.5, tedy iPhone s iOS 16.4–17.4): Chromium
// light-dark() umí, proto se nepodporovaná funkce napodobí přejmenováním v sestaveném
// CSS. Vlastní vlastnost pak nese neplatnou hodnotu, jako by ji dostal starý Safari,
// a @supports not (color: light-dark(…)) zapne náhradu. Vykreslené barvy každého
// prvku musí být stejné jako v prohlížeči, který light-dark() umí.
const { test, expect } = require('./support/fixtures');

const PROPS = ['color', 'background-color', 'background-image', 'border-top-color', 'box-shadow', 'outline-color'];

/** Barvy všech prvků (a pseudoprvků ::before / ::after, kde něco kreslí). */
function snapshot(props) {
  const out = [];
  const els = [document.documentElement, ...document.querySelectorAll('body, body *')];
  for (const [i, el] of els.entries()) {
    for (const pseudo of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, pseudo);
      if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
      const tag = `${i}:${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.classList.length ? '.' + [...el.classList].join('.') : ''}${pseudo || ''}`;
      out.push([tag, props.map(p => cs.getPropertyValue(p)).join(' | ')]);
    }
  }
  return out;
}

const STATES = [
  ['rozvrh', '/', {}, async () => {}],
  ['nastavení (náhledy oblohy)', '/', {}, async (page) => {
    await page.click('#settingsToggle');
    await expect(page.locator('#settingsModal')).toHaveAttribute('open', '');
  }],
  ['omezená průhlednost', '/', { storage: { transparency: 'reduced' } }, async () => {}],
  ['změny', '/?view=changes', {}, async (page) => { await expect(page.locator('#changesList tbody tr').first()).toBeVisible(); }],
];

test.describe('Náhrada za light-dark() (iOS 16.4–17.4)', () => {
  for (const theme of ['dark', 'light']) {
    for (const [name, url, opts, prepare] of STATES) {
      test(`${name} – ${theme === 'dark' ? 'tmavý' : 'světlý'} motiv: stejné barvy jako s light-dark()`, async ({ page, app }) => {
        await app.open(url, { theme, reducedMotion: 'reduce', ...opts });
        if (url === '/') await app.timetableReady();
        await prepare(page);
        const supported = await page.evaluate(snapshot, PROPS);

        // druhé načtení: sestavené CSS bez funkce light-dark()
        let rewritten = false;
        await page.route('**/css/app.css*', async (route) => {
          const res = await route.fetch();
          const css = (await res.text()).replaceAll('light-dark(', 'light-dark-nepodporovano(');
          rewritten = true;
          await route.fulfill({ response: res, body: css });
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        if (url === '/') await app.timetableReady();
        await prepare(page);
        expect(rewritten).toBe(true);
        expect(await page.evaluate(() => CSS.supports('color', 'light-dark(#000, #fff)'))).toBe(true); // Chromium sám umí
        const fallback = await page.evaluate(snapshot, PROPS);

        expect(fallback.length).toBe(supported.length);
        const diff = [];
        for (let i = 0; i < supported.length; i++) {
          if (supported[i][1] !== fallback[i][1]) diff.push(`${supported[i][0]}: ${supported[i][1]}  ≠  ${fallback[i][1]}`);
        }
        expect(diff.slice(0, 8), `${diff.length} prvků s jinou barvou`).toEqual([]);
      });
    }
  }

  test('kiosk je i bez light-dark() vždy noční', async ({ page, app, isMobile }) => {
    test.skip(isMobile, 'kiosk je pro velkou obrazovku');
    await page.route('**/css/app.css*', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()).replaceAll('light-dark(', 'light-dark-nepodporovano(') });
    });
    await app.open('/?kiosk=changes', { theme: 'light' });
    await expect(page.locator('.kiosk')).toBeVisible();
    const sky = await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage);
    expect(sky).toContain('rgb(5, 10, 26)'); // --sky-1 noc #050A1A
  });
});
