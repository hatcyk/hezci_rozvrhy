// Bloky hodin na časové ose (Týden a Den): řádek textu je v bloku buď celý, nebo
// vůbec (nesmí být useknutý v půlce výšky), a slovo stavu („suplování“) se nesmí
// useknout uprostřed – v úzké dělené hodině zůstane jen ikona, slovo čte čtečka.
const { test, expect } = require('./support/fixtures');

const DESK = [[1080, 760], [1180, 800], [1280, 800], [1366, 768], [1536, 864], [1920, 1080], [1280, 650]];
const PHONE = [[320, 640], [360, 740], [390, 844]];

function cutText() {
  const out = [];
  for (const ev of document.querySelectorAll('.ev')) {
    if (!ev.offsetParent) continue;
    const er = ev.getBoundingClientRect();
    const name = `${ev.querySelector('.ev-s')?.textContent.trim()} (${Math.round(er.width)}×${Math.round(er.height)})`;
    for (const line of ev.querySelectorAll('.ev-l1, .ev-l2, .ev-l3')) {
      if (getComputedStyle(line).display === 'none') continue;
      const lr = line.getBoundingClientRect();
      if (!lr.height || lr.left >= er.right - 1 || lr.top >= er.bottom - 1) continue; // řádek mimo blok = skrytý celý
      // řádek stlačený flexboxem pod svou výšku, nebo přesahující spodek bloku
      if (line.scrollHeight > line.clientHeight + 1 || lr.bottom > er.bottom + 0.5) {
        out.push(`${name}: řádek „${line.textContent.trim().slice(0, 28)}“ ${Math.round(line.clientHeight)} z ${line.scrollHeight} px`);
      }
    }
    for (const st of ev.querySelectorAll('.ev-l2 .g-st')) {
      const sr = st.getBoundingClientRect();
      const l2 = st.closest('.ev-l2').getBoundingClientRect();
      const word = [...st.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()) || st.querySelector('.g-st-w');
      if (!sr.width || !word) continue;
      const rg = document.createRange(); rg.selectNodeContents(word);
      const tr = rg.getBoundingClientRect();
      const right = Math.min(sr.right, l2.right, er.right);
      const shown = tr.top < Math.min(sr.bottom, l2.bottom, er.bottom) - 1 && tr.left < right - 1;
      if (shown && tr.right > right + 0.5) out.push(`${name}: stav „${st.textContent.trim()}“ useknutý (${Math.round(tr.width)} px, místo ${Math.round(right - tr.left)} px)`);
    }
  }
  return out;
}

test.describe('Bloky hodin bez useknutého textu', () => {
  for (const layout of ['week-view', 'day']) {
    test(`${layout === 'day' ? 'Den' : 'Týden'}: řádky a stav celé, nebo skryté`, async ({ page, app, isMobile }) => {
      test.skip(isMobile && layout === 'week-view', 'Týden je jen na počítači');
      test.setTimeout(90_000);
      const sizes = isMobile ? PHONE : DESK;
      const fails = [];
      for (const [i, [width, height]] of sizes.entries()) {
        await page.setViewportSize({ width, height });
        if (i === 0) await app.open('/', { reducedMotion: 'reduce', layout });
        else await page.goto('/', { waitUntil: 'domcontentloaded' });
        await app.timetableReady();
        if (isMobile) {
          if (!await page.locator('html[data-screen="day"]').count()) await page.locator('#overview .wr.today').click();
          await expect(page.locator('html')).toHaveAttribute('data-screen', 'day');
        }
        await expect(page.locator('.ev').first()).toBeVisible();
        for (const f of await page.evaluate(cutText)) fails.push(`${width}×${height}: ${f}`);
      }
      expect(fails, 'useknutý text v blocích hodin').toEqual([]);
    });
  }
});
