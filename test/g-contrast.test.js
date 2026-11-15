// Kontrast tokenů návrhu G podle WCAG 2.2 (1.4.3 text ≥ 4,5 : 1, 1.4.11 grafika ≥ 3 : 1).
// Barvy se čtou přímo z public/css/g/tokens.css (obě větve light-dark()) a průhledné vrstvy
// se skládají přes nejsvětlejší místo oblohy (--sky-3 dole, případně záři nahoře) = nejhorší případ.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'g', 'tokens.css'), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-reduced-transparency'));

function parseColor(s) {
    s = s.trim();
    let m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) return { c: [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)), a: 1 };
    m = s.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/);
    if (m) return { c: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
    throw new Error(`neznámá barva: ${s}`);
}
function token(name, mode) {
    const m = root.match(new RegExp(`--${name}:\\s*([^;]+);`));
    assert.ok(m, `token --${name} chybí`);
    const v = m[1].trim();
    const ld = v.match(/^light-dark\((.+)\)$/);
    if (!ld) return parseColor(v);
    // rozdělení na dvě větve podle čárky mimo závorky
    let depth = 0, cut = -1;
    for (let i = 0; i < ld[1].length; i++) {
        const ch = ld[1][i];
        if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === ',' && depth === 0) { cut = i; break; }
    }
    return parseColor(mode === 'light' ? ld[1].slice(0, cut) : ld[1].slice(cut + 1));
}
const over = (fg, bg) => fg.c.map((v, i) => Math.round(fg.a * v + (1 - fg.a) * bg[i]));
function lum(c) {
    const l = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

for (const mode of ['light', 'dark']) {
    const t = (n) => token(n, mode);
    const sky3 = t('sky-3').c, sky2 = t('sky-2').c;
    const glowTop = over(t('glow'), t('sky-1').c);
    const white = [255, 255, 255];
    const tx2 = (bg) => over(t('tx-2'), bg);
    const surfaces = {
        'obloha dole': sky3,
        'obloha uprostřed': sky2,
        'záře nahoře': glowTop,
        'sklo': over(t('glass'), sky3),
        'sklo silnější': over(t('glass-strong'), sky3),
        'závoj': over(t('veil'), sky3),
        'závoj silnější': over(t('veil-strong'), sky3),
        'spodní panel': over(t('sheet'), sky3),
        'čip na závoji': over(t('chip'), over(t('veil'), sky3)),
        // plovoucí sklo (spodní lišta, hledání, toast) leží nad posouvaným obsahem: nejhorší je bílá
        // plocha (buňka „volno pro všechny“, vybraný čip) a zlatá (dnešek, štítek „teď“)
        'plovoucí sklo nad bílou': over(t('glass-float'), white),
        'plovoucí sklo nad zlatou': over(t('glass-float'), t('now').c),
        'plovoucí sklo nad oblohou': over(t('glass-float'), sky3),
        'blok hodiny': t('blk').c,
        'plná náhrada': t('solid').c,
        'plná náhrada silnější': t('solid-strong').c,
    };
    for (const [name, bg] of Object.entries(surfaces)) {
        test(`${mode}: bílý text na ploše „${name}“ ≥ 4,5`, () => {
            const r = ratio(white, bg);
            assert.ok(r >= 4.5, `${r.toFixed(2)} : 1`);
        });
        // na čipu (vybraný segment, filtr) se píše jen plnou bílou, tlumený text tam není
        if (name === 'čip na závoji') continue;
        test(`${mode}: tlumený text na ploše „${name}“ ≥ 4,5`, () => {
            const r = ratio(tx2(bg), bg);
            assert.ok(r >= 4.5, `${r.toFixed(2)} : 1`);
        });
    }
    for (const acc of ['now', 'sub', 'room', 'cancel', 'extra']) {
        // akcenty (ikony stavů, proužky, body) leží vždy na bloku, závoji nebo skle, nikdy přímo na obloze
        // (korál přímo na ranní obloze má jen 2,9 : 1)
        for (const name of ['blok hodiny', 'závoj', 'závoj silnější', 'sklo', 'spodní panel']) {
            test(`${mode}: ${acc} (ikona, proužek) na ploše „${name}“ ≥ 3`, () => {
                const r = ratio(t(acc).c, surfaces[name]);
                assert.ok(r >= 3, `${r.toFixed(2)} : 1`);
            });
        }
    }
    test(`${mode}: text na zlaté ≥ 4,5`, () => {
        const r = ratio(t('now-ink').c, t('now').c);
        assert.ok(r >= 4.5, `${r.toFixed(2)} : 1`);
    });
    test(`${mode}: vybraný segment a záložka (bílá plocha, tmavé písmo) ≥ 3 proti sklu, písmo ≥ 4,5`, () => {
        assert.ok(ratio(t('now-ink').c, white) >= 4.5);
        for (const name of ['sklo', 'sklo silnější', 'plovoucí sklo nad oblohou', 'plovoucí sklo nad bílou', 'spodní panel']) {
            const r = ratio(white, surfaces[name]);
            assert.ok(r >= 3, `${name}: ${r.toFixed(2)} : 1`);
        }
    });
    test(`${mode}: zlatý fokus proti závoji i bloku ≥ 3`, () => {
        assert.ok(ratio(t('now').c, surfaces['závoj']) >= 3);
        assert.ok(ratio(t('now').c, t('blk').c) >= 3);
    });
}
