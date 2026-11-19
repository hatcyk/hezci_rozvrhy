// Vodorovné přetečení (WCAG 1.4.10): na žádné běžné šířce se stránka nesmí
// posouvat do strany ani se na telefonu oddálit. Měří se scrollWidth dokumentu
// proti clientWidth a innerWidth proti šířce okna (mobilní Chrome při přetečení
// stránku oddálí, takže samotný scrollWidth by chybu schoval).
// Telefony a tablet běží v projektu „mobil“ (emulace dotyku), počítač v „desktop“.
const { test, expect } = require('./support/fixtures');

const PHONE = [[320, 640], [360, 740], [390, 844], [768, 1024]];
const DESK = [[1080, 800], [1280, 800], [1366, 768], [1536, 864], [1920, 1080]];

async function openDay(page, isMobile) {
  if (!isMobile) {
    await page.click('#layoutSeg [data-layout="day"]');
    await expect(page.locator('#layoutSeg [data-layout="day"]')).toHaveAttribute('aria-pressed', 'true');
    return;
  }
  // po obnovení stránky může zůstat otevřený Den
  if (await page.locator('html[data-screen="day"]').count()) return;
  const today = page.locator('#overview .wr.today');
  await (await today.count() ? today : page.locator('#overview .wr').first()).click();
  await expect(page.locator('html')).toHaveAttribute('data-screen', 'day');
}

async function onlyChanges(page, isMobile) {
  await openDay(page, isMobile);
  if (await page.locator('#onlyChangesBtn[aria-pressed="false"]').count()) await page.locator('#onlyChangesBtn').click();
  await expect(page.locator('.oc-day').first()).toBeVisible();
}

/** [název, URL, rozvržení, příprava, jen mobil / jen počítač] */
const STATES = [
  ['přehled', '/', null, async () => {}, 'mobile'],
  ['týden', '/', null, async (page) => { await expect(page.locator('.wg-col').first()).toBeVisible(); }, 'desk'],
  ['den', '/', null, async (page, isMobile) => { await openDay(page, isMobile); await expect(page.locator('.tl').first()).toBeVisible(); }],
  ['seznam', '/', 'compact-list', async (page) => { await openDay(page, true); await expect(page.locator('.ls-row').first()).toBeVisible(); }, 'mobile'],
  ['karty', '/', 'card-view', async (page) => { await openDay(page, true); await expect(page.locator('.card').first()).toBeVisible(); }, 'mobile'],
  ['jen změny', '/', null, onlyChanges],
  ['změny', '/?view=changes', null, async (page) => { await expect(page.locator('#changesList tbody tr').first()).toBeVisible(); }],
  ['volné učebny', '/?view=rooms', null, async (page) => { await expect(page.locator('#roomsResult .room-link').first()).toBeVisible(); }],
  ['společné volno', '/?view=common&with=Teacher:T1,Class:C2A', null, async (page) => { await expect(page.locator('.common-grid').first()).toBeVisible(); }],
];

/** Rozměry dokumentu a nejvyšší prvky, které přesahují pravý okraj (pro čitelnou chybu). */
function measure() {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const offenders = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (!r.width || r.right <= vw + 1 || getComputedStyle(e).position === 'fixed') continue;
    const p = e.parentElement && e.parentElement.getBoundingClientRect();
    if (p && p.right > vw + 1) continue;
    offenders.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.classList.length ? '.' + [...e.classList].join('.') : ''} → ${Math.round(r.right)} px`);
  }
  return { scrollWidth: de.scrollWidth, clientWidth: vw, innerWidth: window.innerWidth, offenders: offenders.slice(0, 4) };
}

test.describe('Bez vodorovného přetečení', () => {
  for (const [name, url, layout, prepare, only] of STATES) {
    test(`${name}: ${only === 'desk' ? '' : '320–768 px (mobil), '}${only === 'mobile' ? '' : '1080–1920 px (počítač)'}`.replace(/, $/, ''), async ({ page, app, isMobile }) => {
      test.skip(only === 'mobile' && !isMobile, 'jen mobilní rozvržení');
      test.skip(only === 'desk' && isMobile, 'jen počítač');
      test.setTimeout(90_000);
      const sizes = isMobile ? PHONE : DESK;
      const fails = [];
      for (const [i, [width, height]] of sizes.entries()) {
        await page.setViewportSize({ width, height });
        // omezený pohyb: změna velikosti okna by jinak přerušila přechod mezi obrazovkami
        if (i === 0) await app.open(url, { reducedMotion: 'reduce', ...(layout ? { layout } : {}) });
        else await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (url === '/') await app.timetableReady();
        await prepare(page, width < 1080);
        const m = await page.evaluate(measure);
        if (m.innerWidth !== width || m.scrollWidth > m.clientWidth) {
          fails.push(`${width} px: šířka dokumentu ${m.scrollWidth} px, okno ${m.innerWidth} px${m.offenders.length ? ' | ' + m.offenders.join('; ') : ''}`);
        }
      }
      expect(fails, 'stránka přetéká do strany').toEqual([]);
    });
  }
});
