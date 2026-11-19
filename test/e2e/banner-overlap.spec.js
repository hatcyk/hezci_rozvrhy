// Hlášky nahoře (zastaralá data, chyba, offline, nová verze) se na počítači
// nesmí schovat pod zvonek a nastavení. V pohledech mimo rozvrh tlačítka
// plavou v pravém horním rohu nad obsahem, takže řádek hlášek je musí
// obtékat stejně jako nadpis pohledu.
const { test, expect } = require('./support/fixtures');

const VIEWS = [
  ['změny', '/?view=changes'],
  ['volné učebny', '/?view=rooms'],
  ['společné volno', '/?view=common&with=Teacher:T1,Class:C2A'],
  ['rozvrh', '/'],
];
const WIDTHS = [1080, 1280, 1920];

function overlaps() {
  for (const id of ['outageBanner', 'offlineBanner', 'updateBanner']) document.getElementById(id)?.classList.remove('hidden');
  const err = document.getElementById('error');
  err.textContent = 'Nepodařilo se načíst rozvrhy. Zkuste stránku obnovit.';
  err.classList.remove('hidden');
  const shown = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0;
  const buttons = [...document.querySelectorAll('.tb-actions > button')].filter(shown);
  const banners = [...document.querySelectorAll('.banners > *')].filter(shown);
  const hits = [];
  for (const b of buttons) {
    const r = b.getBoundingClientRect();
    for (const n of banners) {
      const s = n.getBoundingClientRect();
      if (r.left < s.right && r.right > s.left && r.top < s.bottom && r.bottom > s.top) hits.push(`${b.id} × ${n.id}`);
    }
  }
  return { hits, buttons: buttons.length, banners: banners.length };
}

test.describe('Hlášky a tlačítka v rohu (počítač)', () => {
  test.skip(({ isMobile }) => isMobile, 'na telefonu tlačítka drží vlastní řádek');

  for (const [name, url] of VIEWS) {
    test(`${name}: zvonek ani nastavení nepřekrývají hlášky`, async ({ page }) => {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(url);
        await expect(page.locator('#settingsToggle')).toBeVisible();
        const r = await page.evaluate(overlaps);
        expect(r.buttons, `${width} px: tlačítka v rohu`).toBeGreaterThan(0);
        expect(r.banners, `${width} px: hlášky`).toBeGreaterThan(0);
        expect(r.hits, `${width} px`).toEqual([]);
      }
    });
  }
});
