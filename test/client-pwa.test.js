/**
 * PWA manifest, icons and the static HTML shell (public/).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

/** Width, height and colour type from a PNG's IHDR chunk. */
function pngInfo(file) {
    const buf = fs.readFileSync(path.join(PUBLIC, file.replace(/^\//, '')));
    assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${file} is not a PNG`);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

test('manifest identity and installability fields', () => {
    assert.equal(manifest.id, '/');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.lang, 'cs');
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.description && manifest.description.length > 20);
    assert.match(manifest.theme_color, /^#[0-9A-Fa-f]{6}$/);
});

test('every icon exists with the declared size; maskable icons are present', () => {
    for (const icon of manifest.icons) {
        const { width, height } = pngInfo(icon.src);
        assert.equal(`${width}x${height}`, icon.sizes, icon.src);
    }
    const maskable = manifest.icons.filter(i => i.purpose === 'maskable').map(i => i.sizes);
    assert.deepEqual(maskable.sort(), ['192x192', '512x512']);
    // maskable icons must not reuse the edge-to-edge "any" artwork
    for (const i of manifest.icons.filter(x => x.purpose === 'maskable')) {
        assert.match(i.src, /maskable/);
    }
});

test('notification badge is 96x96 with an alpha channel (monochrome mask)', () => {
    const { width, height, colorType } = pngInfo('/badge-96.png');
    assert.equal(width, 96);
    assert.equal(height, 96);
    assert.ok(colorType === 6 || colorType === 4, 'PNG colour type with alpha');
});

test('screenshots exist, match their declared size and cover narrow + wide', () => {
    assert.ok(manifest.screenshots.length >= 2);
    for (const s of manifest.screenshots) {
        const { width, height } = pngInfo(s.src);
        assert.equal(`${width}x${height}`, s.sizes, s.src);
        assert.ok(s.label, `${s.src} has a label`);
        assert.ok(Math.max(width, height) / Math.min(width, height) <= 2.3, 'aspect ratio Chrome accepts');
    }
    const factors = new Set(manifest.screenshots.map(s => s.form_factor));
    assert.ok(factors.has('narrow') && factors.has('wide'));
});

test('shortcuts: my timetable, today\'s changes, free rooms', () => {
    const urls = manifest.shortcuts.map(s => s.url);
    assert.deepEqual(urls, ['/', '/?view=changes', '/?view=rooms']);
    for (const s of manifest.shortcuts) assert.ok(s.name && s.icons && s.icons.length);
});

test('index.html: zoom allowed, theme-color per scheme, early theme script', () => {
    assert.ok(!/user-scalable\s*=\s*no/i.test(html), 'user-scalable=no blocks zoom (WCAG 1.4.4)');
    assert.ok(!/maximum-scale\s*=\s*1(\.0)?\b/i.test(html));
    assert.match(html, /<html lang="cs">/);
    assert.match(html, /name="theme-color" media="\(prefers-color-scheme: dark\)"/);
    assert.match(html, /name="theme-color" media="\(prefers-color-scheme: light\)"/);
    assert.match(html, /prefers-color-scheme: light\)'\)\.matches/, 'first visit follows the system theme');
    assert.ok(!/id="loading"/.test(html), 'dead #loading overlay removed');
    assert.match(html, /sunrisesunset\.io/i, 'API attribution');
});

test('index.html: sheets are native dialogs with a name and labelled close buttons', () => {
    const dialogs = [...html.matchAll(/<dialog\b[^>]*>/g)].map(m => m[0]);
    assert.equal(dialogs.length, 4);
    for (const d of dialogs) {
        assert.match(d, /aria-labelledby="[^"]+"/, d);
        assert.ok(!/role="dialog"|aria-modal/.test(d), 'native modal dialogs need no role/aria-modal');
        const id = d.match(/aria-labelledby="([^"]+)"/)[1];
        assert.ok(html.includes(`id="${id}"`), `label element #${id} exists`);
    }
    assert.ok(!/<div class="bottom-sheet[ "]/.test(html), 'no div-based sheets left');
    const closeButtons = [...html.matchAll(/<button\b[^>]*class="modal-close"[^>]*>/g)].map(m => m[0]);
    assert.ok(closeButtons.length >= 4);
    for (const b of closeButtons) assert.match(b, /aria-label="[^"]+"/, b);
});

test('index.html: segmented controls expose their state (aria-pressed)', () => {
    for (const cls of ['schedule-type-btn', 'type-btn']) {
        const btns = [...html.matchAll(new RegExp(`<button\\b[^>]*class="${cls}[^"]*"[^>]*>`, 'g'))].map(m => m[0]);
        assert.equal(btns.length, 3);
        assert.equal(btns.filter(b => /aria-pressed="true"/.test(b)).length, 1);
        assert.equal(btns.filter(b => /aria-pressed="false"/.test(b)).length, 2);
    }
    assert.match(html, /id="valueDropdownMenu"[^>]*\binert\b/, 'closed menu is inert');
});
