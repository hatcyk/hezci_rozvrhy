// Admin page: pure modules (format, chart) in Node + static checks of admin.html.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'admin.html'), 'utf8');
const adminJs = fs.readFileSync(path.join(PUBLIC, 'admin', 'admin.js'), 'utf8');
const load = (file) => import(path.join(PUBLIC, 'admin', file));

test('semafor stáří dat: text a symbol, ne jen barva', async () => {
    const { semaphoreState } = await load('format.js');
    assert.deepEqual(
        [semaphoreState({ isHealthy: true, dataAgeMin: 10, maxAgeMin: 120, consecutiveFailures: 0 }).level,
         semaphoreState({ isHealthy: true, dataAgeMin: 10, maxAgeMin: 120, consecutiveFailures: 2 }).level,
         semaphoreState({ isHealthy: false, dataAgeMin: 150, maxAgeMin: 120 }).level,
         semaphoreState({ isHealthy: false, dataAgeMin: 300, maxAgeMin: 120 }).level,
         semaphoreState({ isHealthy: false, dataAgeMin: null }).level,
         semaphoreState(undefined).level],
        ['ok', 'warn', 'warn', 'bad', 'bad', 'bad']);
    const states = [semaphoreState({ isHealthy: true, dataAgeMin: 1, maxAgeMin: 120 }), semaphoreState({ isHealthy: false, dataAgeMin: 150, maxAgeMin: 120 }), semaphoreState({})];
    assert.equal(new Set(states.map(s => s.symbol)).size, 3);
    for (const s of states) assert.ok(s.label.length > 3);
});

test('formátování: minuty, trvání, data v pražském čase, odkaz jen na GitHub', async () => {
    const f = await load('format.js');
    assert.equal(f.formatMinutes(45), '45 min');
    assert.equal(f.formatMinutes(125), '2 h 5 min');
    assert.equal(f.formatMinutes(60 * 26), '1 den 2 h');
    assert.equal(f.formatMinutes(60 * 24 * 3), '3 dny');
    assert.equal(f.formatMinutes(null), '–');
    assert.equal(f.formatDuration(850), '850 ms');
    assert.equal(f.formatDuration(185000), '3 min 5 s');
    assert.match(f.formatDateTime('2026-11-04T09:15:00Z'), /4\. ?11\..*10:15/);
    assert.equal(f.formatDateTime('nesmysl'), '–');
    assert.equal(f.safeGithubUrl('https://github.com/hatcyk/hezci_rozvrhy/actions/runs/42'), 'https://github.com/hatcyk/hezci_rozvrhy/actions/runs/42');
    assert.equal(f.safeGithubUrl('javascript:alert(1)'), null);
    assert.equal(f.safeGithubUrl('https://evil.example/actions/runs/1'), null);
    assert.equal(f.formatCounts({ sent: 4, users: 3, nested: { x: 1 } }), 'sent 4, users 3');
});

test('chartModel: bod na každý rozestup, osa omezená, dlouhé mezery nahoře', async () => {
    const { chartModel } = await load('chart.js');
    const t = (min) => new Date(Date.parse('2026-11-04T09:00:00Z') - min * 60000).toISOString();
    const runs = [t(600), t(585), t(570), t(555), t(60), t(45), t(30), t(15)].map((startedAt, i) => ({ startedAt, trigger: i % 2 ? 'dispatch' : 'schedule', status: i === 7 ? 'network' : 'ok' }));
    const m = chartModel(runs, { since: t(60 * 24 * 7), now: t(0), width: 700, height: 250 });
    assert.equal(m.points.length, 7);
    assert.equal(m.points.filter(p => p.capped).length, 1, 'the 495-min night gap');
    assert.ok(m.yMax >= 60 && m.yMax <= 240);
    for (const p of m.points) {
        assert.ok(p.x >= m.pad.left - 0.001 && p.x <= 700 - m.pad.right + 0.001);
        assert.ok(p.y >= m.pad.top - 0.001 && p.y <= 250 - m.pad.bottom + 0.001);
    }
    assert.equal(m.points.at(-1).kind, 'failed');
    assert.deepEqual(new Set(m.points.slice(0, -1).map(p => p.kind)), new Set(['schedule', 'other']));
    assert.equal(m.xTicks.length, 7);
    assert.ok(m.xTicks.every(x => x.x > m.pad.left));
    assert.match(m.points[0].title, /rozestup 15 min/);
    assert.deepEqual(chartModel([], { since: t(100), now: t(0) }).points, []);
});

test('admin.html: noindex, bez inline skriptů a stylů (vynucená CSP), jen vlastní zdroje', () => {
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /<html lang="cs"/);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length >= 1);
    for (const [, attrs, body] of scripts) {
        assert.match(attrs, /src="\/admin\//);
        assert.equal(body.trim(), '');
    }
    assert.ok(!/\sstyle=/.test(html), 'style attributes would be blocked by style-src');
    assert.ok(!/\son[a-z]+=/i.test(html), 'no inline event handlers');
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no third-party URLs');
});

test('admin.js používá jen id, která v admin.html existují; žádné innerHTML', () => {
    const ids = [...adminJs.matchAll(/\$\('([A-Za-z]+)'\)/g)].map(m => m[1]);
    assert.ok(ids.length > 15);
    for (const id of new Set(ids)) assert.match(html, new RegExp(`id="${id}"`), id);
    for (const file of ['admin.js', 'api.js', 'format.js', 'chart.js']) {
        const src = fs.readFileSync(path.join(PUBLIC, 'admin', file), 'utf8');
        assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(src), file);
    }
    // the secret is kept in sessionStorage only
    const api = fs.readFileSync(path.join(PUBLIC, 'admin', 'api.js'), 'utf8');
    assert.ok(!/localStorage/.test(api));
    assert.match(api, /sessionStorage/);
});
