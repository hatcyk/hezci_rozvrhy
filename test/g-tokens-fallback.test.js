// Náhrada za light-dark() v tokenech návrhu G. Funkce light-dark() je až v Safari 17.5;
// na iPhonu s iOS 16.4–17.4 by byla neplatná a obloha, sklo i bloky by propadly na
// průhlednou barvu. Proto:
//  - light-dark() smí být jen uvnitř @supports (color: light-dark(…)),
//  - @supports not (…) má statické hodnoty pro noc (výchozí, kiosk) i ráno ([data-theme="light"])
//    a ty se musí přesně shodovat s větvemi light-dark() (jinak by se motivy v prohlížečích lišily).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'public', 'css', 'g');
const css = fs.readFileSync(path.join(DIR, 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Obsah bloku { … } začínajícího prvním „{“ za indexem `at`. */
function blockAt(text, at) {
    const open = text.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
    }
    throw new Error('neuzavřený blok');
}
/** Pravidla v bloku: [{ selector, decls: Map }]. */
function rules(body) {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(body))) {
        const decls = new Map();
        for (const d of m[2].split(';')) {
            const i = d.indexOf(':');
            if (i > 0 && d.trim().startsWith('--')) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim().replace(/\s+/g, ' '));
        }
        out.push({ selector: m[1].trim().replace(/\s+/g, ' '), decls });
    }
    return out;
}
function branches(v) {
    const inner = v.match(/^light-dark\((.+)\)$/)[1];
    let depth = 0;
    for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === '(') depth++; else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) return { light: inner.slice(0, i).trim(), dark: inner.slice(i + 1).trim() };
    }
    throw new Error(`light-dark bez dvou větví: ${v}`);
}

const SUP = '@supports (color: light-dark(#000, #fff))';
const NOT = '@supports not (color: light-dark(#000, #fff))';

test('light-dark() je v tokens.css jen uvnitř @supports (color: light-dark(…))', () => {
    assert.ok(css.includes(SUP), `chybí ${SUP}`);
    const sup = blockAt(css, css.indexOf(SUP));
    const outside = css.replace(sup, '').replace(SUP, '').replace(NOT, '');
    assert.ok(!/light-dark\(/.test(outside), 'light-dark() mimo @supports: v Safari < 17.5 by token propadl na průhlednou barvu');
});

test('žádný jiný soubor CSS návrhu G ani správa light-dark() nepoužívá', () => {
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.css') && f !== 'tokens.css').map(f => path.join(DIR, f));
    files.push(path.join(__dirname, '..', 'public', 'admin', 'admin.css'));
    for (const f of files) assert.ok(!/light-dark\(/.test(fs.readFileSync(f, 'utf8')), `${path.basename(f)} používá light-dark()`);
});

test('náhrada bez light-dark(): noc i ráno mají stejné hodnoty jako větve light-dark()', () => {
    const themed = rules(blockAt(css, css.indexOf(SUP))).find(r => r.selector === ':root');
    assert.ok(themed && themed.decls.size >= 10, 'tokeny s light-dark() v :root');
    assert.ok(css.includes(NOT), `chybí ${NOT}`);
    const fallback = rules(blockAt(css, css.indexOf(NOT)));
    const night = fallback.find(r => /(^|,\s*):root\s*(,|$)/.test(r.selector));
    const morning = fallback.find(r => r.selector.includes('[data-theme="light"]'));
    assert.ok(night, 'noc: pravidlo pro :root');
    assert.ok(morning, 'ráno: pravidlo pro [data-theme="light"]');
    // kiosk je vždy noc, i když má uživatel ráno; náhledy oblohy v nastavení mají vlastní motiv
    assert.match(morning.selector, /:not\(\[data-kiosk\]\)/, 'kiosk nesmí dostat ranní barvy');
    for (const sel of ['.set-theme-sky--dark', '.set-theme-sky--system::after']) assert.ok(night.selector.includes(sel), `noc: ${sel}`);
    for (const sel of ['.set-theme-sky--light', '.set-theme-sky--system::before']) assert.ok(morning.selector.includes(sel), `ráno: ${sel}`);
    for (const [name, value] of themed.decls) {
        const b = branches(value);
        assert.strictEqual(night.decls.get(name), b.dark, `${name} noc`);
        assert.strictEqual(morning.decls.get(name), b.light, `${name} ráno`);
    }
    assert.strictEqual(night.decls.size, themed.decls.size, 'noc: navíc tokeny bez light-dark()');
    assert.strictEqual(morning.decls.size, themed.decls.size, 'ráno: navíc tokeny bez light-dark()');
});

test('závoj dialogu (::backdrop) má vlastní token: Safari < 17.4 do ::backdrop proměnné nedědí', () => {
    assert.match(css, /:root,\s*::backdrop\s*\{[^}]*--backdrop:/);
});
