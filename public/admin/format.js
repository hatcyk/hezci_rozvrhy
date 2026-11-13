/**
 * Formatting helpers of the admin page (pure functions, no DOM), so they can
 * be tested in Node (test/admin-page.test.js).
 */

const TZ = 'Europe/Prague';

export const JOB_LABELS = {
    prefetch: 'Sběr rozvrhů',
    notify: 'Notifikace o změnách',
    reminders: 'Upomínky hodin',
    cleanup: 'Úklid',
};

export const TRIGGER_LABELS = {
    schedule: 'plán GitHubu',
    dispatch: 'ruční / cron-job.org',
    manual: 'ručně',
    cron: 'crontab',
    http: 'HTTP cron',
};

export const STATUS_LABELS = {
    ok: 'v pořádku',
    guard_no_definitions: 'pojistka: žádné definice',
    guard_no_lessons: 'pojistka: žádné hodiny',
    login_failed: 'přihlášení selhalo',
    network: 'chyba sítě',
    error: 'chyba',
};

export const DELIVERY_LABELS = {
    pending: 'čeká na odeslání',
    sending: 'odesílá se',
    no_watchers: 'nikdo nesleduje',
    sent: 'odesláno',
};

export const SCHEDULE_LABELS = { Actual: 'aktuální', Next: 'příští', Permanent: 'stálý' };

export const CHANGE_TYPE_LABELS = {
    substitution: 'suplování',
    room_change: 'učebna',
    lesson_removed: 'odpadlo',
    lesson_added: 'přidáno',
    subject_change: 'předmět',
    type_change: 'zrušeno',
};

const dateTimeFormat = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: TZ, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
});
const dayFormat = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' });

/** "4. 11. 10:15" in Prague time, '–' for nothing. */
export function formatDateTime(iso) {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? dateTimeFormat.format(new Date(ms)) : '–';
}

/** "st 4. 11." */
export function formatDay(iso) {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? dayFormat.format(new Date(ms)) : '–';
}

/** Minutes → "45 min", "2 h 5 min", "3 dny 4 h". */
export function formatMinutes(minutes) {
    if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return '–';
    const m = Math.round(Number(minutes));
    if (m < 60) return `${m} min`;
    const days = Math.floor(m / 1440);
    const hours = Math.floor((m % 1440) / 60);
    const rest = m % 60;
    if (days > 0) {
        const dayWord = days === 1 ? 'den' : days < 5 ? 'dny' : 'dní';
        return `${days} ${dayWord}${hours ? ` ${hours} h` : ''}`;
    }
    return `${hours} h${rest ? ` ${rest} min` : ''}`;
}

/** Duration of a run: "850 ms", "12 s", "3 min 5 s". */
export function formatDuration(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '–';
    const n = Number(ms);
    if (n < 1000) return `${Math.round(n)} ms`;
    const s = Math.round(n / 1000);
    if (s < 60) return `${s} s`;
    return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
}

/** {sent: 4, users: 3} → "sent 4, users 3" (counters are technical names). */
export function formatCounts(counts) {
    if (!counts || typeof counts !== 'object') return '';
    return Object.entries(counts)
        .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
}

/**
 * Traffic light of the data age (S4 /api/status fields):
 *  ok   – data fresh and the last run succeeded,
 *  warn – data still fresh but the last run failed, or older than the limit
 *         but less than twice the limit,
 *  bad  – no successful run at all, or older than twice the limit.
 * Each state has a text and a symbol, not just a colour (WCAG 1.4.1).
 */
export function semaphoreState(status) {
    const s = status || {};
    const age = s.dataAgeMin;
    const limit = Number(s.maxAgeMin) || 120;
    if (age === null || age === undefined) {
        return { level: 'bad', symbol: '■', label: 'Žádný úspěšný sběr', detail: 'Server nemá záznam o úspěšném stažení dat.' };
    }
    if (s.isHealthy) {
        if (Number(s.consecutiveFailures) > 0) {
            return { level: 'warn', symbol: '▲', label: 'Data aktuální, poslední běh selhal', detail: `Stáří ${formatMinutes(age)}, neúspěšných běhů za sebou: ${s.consecutiveFailures}.` };
        }
        return { level: 'ok', symbol: '●', label: 'V pořádku', detail: `Data jsou stará ${formatMinutes(age)} (limit ${formatMinutes(limit)}).` };
    }
    if (age < 2 * limit) {
        return { level: 'warn', symbol: '▲', label: 'Data stárnou', detail: `Stáří ${formatMinutes(age)}, limit ${formatMinutes(limit)}.` };
    }
    return { level: 'bad', symbol: '■', label: 'Data jsou stará', detail: `Stáří ${formatMinutes(age)}, limit ${formatMinutes(limit)}.` };
}

/** Only links to GitHub become clickable (the value comes from the API). */
export function safeGithubUrl(url) {
    return typeof url === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(url) ? url : null;
}
