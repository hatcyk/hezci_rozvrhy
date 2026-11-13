/**
 * Admin page: login with ADMIN_SECRET, overview with the data-age traffic
 * light, run table with job filter, interval chart, changes and delivery,
 * statistics, "Spustit sběr" with confirmation, audit.
 * All text goes into the DOM via textContent / DOM nodes, never as markup.
 */

import { apiGet, apiPost, getSecret, setSecret, clearSecret, AdminApiError } from './api.js';
import {
    JOB_LABELS, TRIGGER_LABELS, STATUS_LABELS, DELIVERY_LABELS, SCHEDULE_LABELS, CHANGE_TYPE_LABELS,
    formatDateTime, formatMinutes, formatDuration, formatCounts, semaphoreState, safeGithubUrl,
} from './format.js';
import { chartModel, renderChart } from './chart.js';

const $ = (id) => document.getElementById(id);

/** Element helper: el('td', { class: 'x' }, 'text', childNode, …) */
function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : String(child));
    }
    return node;
}

// ─── theme (same choice as the app: localStorage 'theme') ──────────────────

function applyTheme() {
    let theme = 'dark';
    try {
        const saved = localStorage.getItem('theme');
        if (saved === 'light' || saved === 'dark') theme = saved;
        else if (window.matchMedia('(prefers-color-scheme: light)').matches) theme = 'light';
    } catch { /* storage blocked */ }
    document.documentElement.setAttribute('data-theme', theme);
}

// ─── status line ───────────────────────────────────────────────────────────

function announce(text) {
    $('statusLine').textContent = text;
}

function showIndexWarning(show) {
    $('indexWarning').hidden = !show;
}

// ─── sections ──────────────────────────────────────────────────────────────

function renderHealth(data) {
    const state = semaphoreState(data.status);
    const box = $('semaphore');
    box.dataset.level = state.level;
    $('semaphoreSymbol').textContent = state.symbol;
    $('semaphoreLabel').textContent = state.label;
    $('semaphoreDetail').textContent = state.detail;

    const s = data.status || {};
    const rows = [
        ['Poslední úspěšný sběr', formatDateTime(s.lastSuccessAt)],
        ['Poslední běh sběru', formatDateTime(s.lastRunAt)],
        ['Stav posledního běhu', STATUS_LABELS[s.lastStatus] || s.lastStatus || '–'],
        ['Neúspěšných běhů za sebou', String(s.consecutiveFailures ?? 0)],
        ['Poslední chyba', s.lastError || '–'],
    ];
    $('healthList').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));

    const body = $('lastRunsBody');
    body.replaceChildren(...Object.entries(JOB_LABELS).map(([job, label]) => {
        const run = data.lastRuns && data.lastRuns[job];
        return el('tr', {},
            el('th', { scope: 'row' }, label),
            el('td', {}, run ? formatDateTime(run.startedAt) : '–'),
            el('td', {}, run ? statusBadge(run.status) : '–'),
            el('td', {}, run ? formatDuration(run.durationMs) : '–'),
        );
    }));
}

function statusBadge(status) {
    const ok = status === 'ok';
    return el('span', { class: `badge ${ok ? 'badge-ok' : 'badge-bad'}` }, `${ok ? '✓' : '✗'} ${STATUS_LABELS[status] || status || '?'}`);
}

function renderRuns(data) {
    const body = $('runsBody');
    if (!data.runs.length) {
        body.replaceChildren(el('tr', {}, el('td', { colspan: 7 }, 'Žádné běhy.')));
        return;
    }
    body.replaceChildren(...data.runs.map(run => el('tr', {},
        el('th', { scope: 'row' }, formatDateTime(run.startedAt)),
        el('td', {}, JOB_LABELS[run.job] || run.job),
        el('td', {}, TRIGGER_LABELS[run.trigger] || run.trigger || '–'),
        el('td', {}, formatDuration(run.durationMs)),
        el('td', {}, statusBadge(run.status)),
        el('td', { class: 'mono' }, formatCounts(run.counts)),
        el('td', { class: 'wrap' }, run.error || ''),
    )));
}

function renderIntervals(data) {
    const s = data.stats;
    const summary = s.count
        ? `${s.count} rozestupů za ${data.days} dní: medián ${formatMinutes(s.medianMin)}, 95. percentil ${formatMinutes(s.p95Min)}, ` +
          `nejdelší ${formatMinutes(s.maxMin)}` + (s.longestGap ? ` (${formatDateTime(s.longestGap.from)} – ${formatDateTime(s.longestGap.to)})` : '') + '.'
        : `Za ${data.days} dní nejsou aspoň dva běhy sběru.`;
    $('intervalSummary').textContent = summary + (data.truncated ? ' Zobrazena jen část běhů.' : '');
    renderChart($('intervalChart'), chartModel(data.runs, { since: data.since, now: data.now }), {
        title: `Rozestupy mezi běhy sběru za posledních ${data.days} dní`,
        description: summary,
    });
}

function renderChanges(data) {
    const body = $('changesBody');
    if (!data.items.length) {
        body.replaceChildren(el('tr', {}, el('td', { colspan: 6 }, 'Žádné změny (dokumenty se mažou po 2 dnech).')));
        return;
    }
    body.replaceChildren(...data.items.map(item => {
        const tt = item.timetable || {};
        const types = Object.entries(item.types || {}).map(([t, n]) => `${CHANGE_TYPE_LABELS[t] || t} ${n}×`).join(', ');
        const delivery = DELIVERY_LABELS[item.delivery] || item.delivery;
        const devices = item.delivery === 'sent' ? ` (${item.sentToUsers} uživ., ${item.sentToDevices} zař.)` : '';
        return el('tr', {},
            el('th', { scope: 'row' }, formatDateTime(item.timestamp)),
            el('td', {}, `${tt.name || tt.id || '?'} – ${SCHEDULE_LABELS[tt.scheduleType] || tt.scheduleType || ''}`),
            el('td', {}, item.weekStart || '–'),
            el('td', {}, `${item.changeCount}: ${types}`),
            el('td', {}, el('span', { class: `badge ${item.delivery === 'pending' ? 'badge-warn' : 'badge-neutral'}` }, delivery + devices)),
            el('td', { class: 'wrap' }, (item.preview || []).map(p => p.description).join(' · ')),
        );
    }));
}

function renderStats(data) {
    const u = data.users || {};
    const w = u.watchingByType || {};
    const d = data.lastDays || {};
    const n = (v) => (v === null || v === undefined ? 'nedostupné' : String(v));
    const job = (x, what) => (x ? `${x.total ?? 0} ${what} (${x.runs} běhů)` : 'nedostupné');
    const rows = [
        ['Prohlížeče se zapnutými notifikacemi', n(u.pushEnabled)],
        ['Prohlížeče s upomínkami hodin', n(u.withReminders)],
        ['Sledují rozvrh třídy', n(w.Class)],
        ['Sledují rozvrh učitele', n(w.Teacher)],
        ['Sledují rozvrh učebny', n(w.Room)],
        [`Notifikace o změnách za ${data.days} dní`, job(d.changeNotifications, 'doručení')],
        [`Upomínky za ${data.days} dní`, job(d.reminders, 'upomínek')],
        [`Detekované změny za ${data.days} dní`, job(d.prefetch, 'změn')],
    ];
    $('statsList').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
    const problems = (data.problems || []).map(p => `${p.stat}: ${p.indexMissing ? 'chybí index Firestore' : p.error}`);
    $('statsProblems').textContent = problems.length ? `Nedostupné hodnoty – ${problems.join('; ')}` : '';
}

const AUDIT_LABELS = {
    auth_failed: 'chybné tajemství',
    auth_locked: 'zablokováno (moc pokusů)',
    prefetch_dispatch: 'spuštění sběru',
    view_health: 'přehled',
    view_runs: 'běhy',
    view_intervals: 'graf intervalů',
    view_changes: 'změny',
    view_stats: 'statistiky',
    view_audit: 'audit',
};

function renderAudit(data) {
    const body = $('auditBody');
    if (!data.items.length) {
        body.replaceChildren(el('tr', {}, el('td', { colspan: 5 }, 'Žádné záznamy.')));
        return;
    }
    body.replaceChildren(...data.items.map(item => el('tr', {},
        el('th', { scope: 'row' }, formatDateTime(item.at)),
        el('td', {}, AUDIT_LABELS[item.action] || item.action),
        el('td', {}, item.target || ''),
        el('td', { class: 'mono wrap' }, item.details ? formatCounts(item.details) : ''),
        el('td', { class: 'mono' }, item.ipHash || ''),
    )));
}

// ─── loading ───────────────────────────────────────────────────────────────

async function section(name, path, render) {
    try {
        const data = await apiGet(path);
        render(data);
        return data;
    } catch (error) {
        if (error instanceof AdminApiError && [401, 429, 503].includes(error.status)) throw error;
        announce(`Část „${name}“ se nepodařilo načíst: ${error.message}`);
        return null;
    }
}

async function loadRuns() {
    const job = $('jobFilter').value;
    const data = await section('Běhy úloh', `/runs?limit=100${job ? `&job=${encodeURIComponent(job)}` : ''}`, renderRuns);
    if (data) showIndexWarning(data.indexMissing || !$('indexWarning').hidden);
}

async function loadAll() {
    announce('Načítám…');
    try {
        // One after another: the first answer also verifies the secret.
        const health = await section('Přehled', '/health', renderHealth);
        await loadRuns();
        const intervals = await section('Graf', '/runs/intervals?days=7', renderIntervals);
        await section('Změny', '/changes?limit=50', renderChanges);
        await section('Statistiky', '/stats', renderStats);
        await section('Audit', '/audit?limit=50', renderAudit);
        showIndexWarning(Boolean((health && health.indexMissing) || (intervals && intervals.indexMissing)));
        announce(`Načteno ${formatDateTime(new Date().toISOString())}.`);
        return true;
    } catch (error) {
        handleAuthError(error);
        return false;
    }
}

function handleAuthError(error) {
    const status = error instanceof AdminApiError ? error.status : 0;
    let message = `Chyba: ${error.message}`;
    if (status === 401) {
        clearSecret();
        message = 'Neplatné tajemství.';
    } else if (status === 429) {
        clearSecret();
        message = `Příliš mnoho chybných pokusů. Zkuste to znovu za ${formatMinutes((error.body.retryAfterSec || 60) / 60)}.`;
    } else if (status === 503) {
        message = error.message || 'Admin API není na serveru nastavené.';
    }
    showLogin(message);
}

// ─── login / logout ────────────────────────────────────────────────────────

function showLogin(errorText = '') {
    $('dashboard').hidden = true;
    $('loginSection').hidden = false;
    $('logoutBtn').hidden = true;
    $('refreshBtn').hidden = true;
    const err = $('loginError');
    err.textContent = errorText;
    err.hidden = !errorText;
    $('secretInput').value = '';
    $('secretInput').focus();
}

async function showDashboard() {
    $('loginSection').hidden = true;
    $('dashboard').hidden = false;
    $('logoutBtn').hidden = false;
    $('refreshBtn').hidden = false;
    if (await loadAll()) $('dashboardTitle').focus();
}

// ─── dispatch ──────────────────────────────────────────────────────────────

function renderDispatchResult(body, status) {
    const out = $('dispatchResult');
    out.replaceChildren();
    if (status === 200) {
        const url = safeGithubUrl(body.htmlUrl);
        out.append(`Sběr spuštěn${body.workflowRunId ? ` (běh ${body.workflowRunId})` : ''}. `);
        if (url) out.append(el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Otevřít na GitHubu'));
        return;
    }
    if (status === 429) {
        out.append(`Sběr byl spuštěn nedávno. Další je možný za ${formatMinutes((body.retryAfterSec || 60) / 60)}.`);
    } else if (status === 503) {
        out.append(`Spouštění není nastavené – chybí: ${(body.missing || []).join(', ') || '?'}.`);
    } else {
        out.append(`GitHub požadavek odmítl${body.githubStatus ? ` (HTTP ${body.githubStatus})` : ''}${body.message ? `: ${body.message}` : ''}.`);
    }
}

async function dispatch() {
    const btn = $('dispatchBtn');
    btn.disabled = true;
    $('dispatchResult').textContent = 'Odesílám…';
    try {
        const body = await apiPost('/prefetch/dispatch');
        renderDispatchResult(body, 200);
    } catch (error) {
        if (error instanceof AdminApiError && [429, 502, 503].includes(error.status) && error.body && error.body.result) {
            renderDispatchResult(error.body, error.status);
        } else if (error instanceof AdminApiError && error.status === 401) {
            handleAuthError(error);
        } else {
            $('dispatchResult').textContent = `Chyba: ${error.message}`;
        }
    } finally {
        btn.disabled = false;
        section('Audit', '/audit?limit=50', renderAudit).catch(() => {});
    }
}

// ─── wiring ────────────────────────────────────────────────────────────────

function init() {
    applyTheme();

    $('loginForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const value = $('secretInput').value.trim();
        if (!value) return;
        setSecret(value);
        showDashboard();
    });
    $('logoutBtn').addEventListener('click', () => {
        clearSecret();
        showLogin('Odhlášeno.');
    });
    $('refreshBtn').addEventListener('click', () => loadAll());
    $('jobFilter').addEventListener('change', () => loadRuns());

    const dialog = $('dispatchDialog');
    $('dispatchBtn').addEventListener('click', () => dialog.showModal());
    dialog.addEventListener('close', () => {
        const choice = dialog.returnValue;
        dialog.returnValue = ''; // Esc sets no value; don't let an old one leak
        if (choice === 'confirm') dispatch();
    });

    if (getSecret()) showDashboard();
    else showLogin();
}

init();
