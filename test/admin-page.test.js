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

test('každý stav běhu a každý typ změny má český popisek (žádné „partial“ ani „lesson_replaced“ v tabulce)', async () => {
    const f = await load('format.js');
    const { RUN_STATUSES } = require('../backend/cron');
    const { isDescribableChange } = require('../backend/change-detector');
    const czech = (label, key) => {
        assert.equal(typeof label, 'string', `${key}: no label`);
        assert.ok(label.length > 2 && !/_/.test(label) && label !== key, `${key}: "${label}"`);
    };
    for (const status of RUN_STATUSES) czech(f.STATUS_LABELS[status], status);
    assert.equal(f.STATUS_LABELS.partial, 'částečný sběr');

    // every type the sender can put into words (= every type the prefetch writes), plus the admin API's own 'unknown'
    const CHANGE_TYPES = ['substitution', 'room_change', 'lesson_removed', 'lesson_added', 'subject_change', 'type_change', 'lesson_replaced', 'lesson_restored'];
    for (const type of CHANGE_TYPES) {
        assert.equal(isDescribableChange({ type, day: 0, hour: 1, lesson: { subject: 'Fyzika' } }), true, type);
        czech(f.CHANGE_TYPE_LABELS[type], type);
    }
    czech(f.CHANGE_TYPE_LABELS.unknown, 'unknown');
    assert.equal(f.CHANGE_TYPE_LABELS.lesson_replaced, 'jiná hodina');
    assert.equal(f.CHANGE_TYPE_LABELS.lesson_restored, 'koná se');
    assert.equal(new Set(Object.values(f.CHANGE_TYPE_LABELS)).size, Object.keys(f.CHANGE_TYPE_LABELS).length, 'labels tell the types apart');
});

test('odznak stavu běhu: partial je varování, ne chyba; vždy symbol i text', async () => {
    const { statusBadgeState } = await load('format.js');
    assert.deepEqual(statusBadgeState('ok'), { level: 'ok', text: '✓ v pořádku' });
    assert.deepEqual(statusBadgeState('partial'), { level: 'warn', text: '▲ částečný sběr' });
    assert.deepEqual(statusBadgeState('network'), { level: 'bad', text: '✗ chyba sítě' });
    assert.deepEqual(statusBadgeState('login_failed'), { level: 'bad', text: '✗ přihlášení selhalo' });
    assert.deepEqual(statusBadgeState('something_new'), { level: 'bad', text: '✗ something_new' });
    assert.deepEqual(statusBadgeState(undefined), { level: 'bad', text: '✗ ?' });
    // admin.css has a class for every level, and admin.js uses this function
    const css = fs.readFileSync(path.join(PUBLIC, 'admin', 'admin.css'), 'utf8');
    for (const level of ['ok', 'warn', 'bad']) assert.match(css, new RegExp(`\\.badge-${level}\\b`));
    assert.match(adminJs, /statusBadgeState\(status\)/);
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
    // the tooltip names the status in Czech, not by its key
    assert.match(m.points.at(-1).title, /, stav chyba sítě$/);
    const partial = chartModel([{ startedAt: t(30), status: 'ok' }, { startedAt: t(15), status: 'partial' }], { since: t(100), now: t(0) });
    assert.match(partial.points.at(-1).title, /, stav částečný sběr$/);
    assert.doesNotMatch(m.points[0].title, /stav/);
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
