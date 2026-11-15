// Vzorník návrhu G: přepínání ráno/noc a průhlednosti, ikony ze spritu, živý kontrast z tokenů.
(function () {
    const html = document.documentElement;

    // ráno / noc
    const seg = document.querySelectorAll('[data-theme-set]');
    seg.forEach((b) => b.addEventListener('click', () => {
        html.setAttribute('data-theme', b.dataset.themeSet);
        seg.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        render();
    }));

    // omezená průhlednost
    const tr = document.getElementById('dzTransparency');
    tr.addEventListener('click', () => {
        const on = tr.getAttribute('aria-pressed') !== 'true';
        tr.setAttribute('aria-pressed', String(on));
        if (on) html.setAttribute('data-transparency', 'reduced'); else html.removeAttribute('data-transparency');
        render();
    });

    // ukázkový panel
    const sheet = document.getElementById('dzSheet');
    document.getElementById('dzOpenSheet').addEventListener('click', () => sheet.showModal());
    sheet.querySelector('[data-close]').addEventListener('click', () => sheet.close());
    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

    // ikony
    fetch('icons.svg').then((r) => r.text()).then((svg) => {
        const ids = [...svg.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
        document.getElementById('dzIcons').innerHTML = ids.map((id) =>
            `<li><svg class="i" aria-hidden="true"><use href="icons.svg#${id}"></use></svg>${id}</li>`).join('');
    });

    // ---- barvy a kontrast ----
    const probe = document.createElement('i');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    document.body.appendChild(probe);
    function color(token) {
        probe.style.color = '';
        probe.style.color = `var(--${token})`;
        const m = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
        return { c: m.slice(0, 3), a: m.length > 3 ? m[3] : 1 };
    }
    const over = (fg, bg) => fg.c.map((v, i) => Math.round(fg.a * v + (1 - fg.a) * bg[i]));
    const lum = (c) => { const l = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    const fmt = (r) => r.toFixed(2).replace('.', ',') + ' : 1';

    const SW = [
        ['sky-1', 'obloha nahoře'], ['sky-2', 'obloha uprostřed'], ['sky-3', 'obloha dole'], ['blk', 'blok hodiny'],
        ['now', 'teď, dnešek'], ['sub', 'suplování'], ['room', 'jiná učebna'], ['cancel', 'odpadá'], ['extra', 'akce, přidaná hodina'],
    ];

    function render() {
        const sky3 = color('sky-3').c;
        const white = [255, 255, 255];
        const surf = {
            'obloha dole': sky3,
            'závoj': over(color('veil'), sky3),
            'závoj silnější': over(color('veil-strong'), sky3),
            'sklo': over(color('glass'), sky3),
            'spodní panel': over(color('sheet'), sky3),
            'blok hodiny': color('blk').c,
        };
        document.getElementById('dzSwatches').innerHTML = SW.map(([t, label]) => {
            const c = color(t).c;
            const vsBlk = ratio(c, surf['blok hodiny']);
            const info = ['sky-1', 'sky-2', 'sky-3', 'blk'].includes(t)
                ? `bílý text ${fmt(ratio(white, c))}`
                : `na bloku ${fmt(vsBlk)}`;
            return `<div class="dz-sw"><i style="background:${hex(c)}"></i><div><b>${label}</b><span>--${t} ${hex(c)}</span><span>${info}</span></div></div>`;
        }).join('');

        const rows = [];
        const tx2 = color('tx-2');
        for (const [name, bg] of Object.entries(surf)) {
            rows.push(['bílý text', white, name, bg, 4.5]);
            rows.push(['tlumený text', over(tx2, bg), name, bg, 4.5]);
        }
        for (const [t, label] of SW.slice(4)) for (const name of ['blok hodiny', 'závoj', 'sklo']) rows.push([label, color(t).c, name, surf[name], 3]);
        rows.push(['text na zlaté', color('now-ink').c, 'zlatá', color('now').c, 4.5]);
        document.querySelector('#dzContrast tbody').innerHTML = rows.map(([fl, f, bl, b, need]) => {
            const r = ratio(f, b);
            return `<tr><td><span class="dz-pair"><i style="background:${hex(f)}"></i>${fl}</span></td><td><span class="dz-pair"><i style="background:${hex(b)}"></i>${bl}</span></td><td>${fmt(r)}</td><td class="${r >= need ? 'ok' : 'bad'}">${r >= need ? 'splňuje' : 'nesplňuje'} (min. ${String(need).replace('.', ',')})</td></tr>`;
        }).join('');
    }
    render();
})();
