/**
 * Offline Mode Module
 * Detects offline state and controls the offline banner.
 */

import { dom } from './dom.js';

let offlineMode = false;

function formatAge(ageMs) {
    if (ageMs == null) return null;
    const minutes = Math.floor(ageMs / 60000);
    if (minutes < 1) return 'právě teď';
    if (minutes < 60) return `před ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `před ${hours} h`;
    const days = Math.floor(hours / 24);
    return `před ${days} d`;
}

/** "dnes v 14:03" or "18. 11. v 14:03" - when saved or downloaded data are from. */
export function whenText(at, now = new Date()) {
    const hhmm = `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`;
    return at.toDateString() === now.toDateString() ? `dnes v ${hhmm}` : `${at.getDate()}. ${at.getMonth() + 1}. v ${hhmm}`;
}

/**
 * Text of the "data are stale" banner from /api/status (contract S4).
 * Says how old the data are instead of a vague "outage": the backend now
 * reports when the last successful download happened.
 * After a partial prefetch (lastStatus 'partial') only a part of the
 * timetables is older; the time is that of the last complete download.
 * @param {{ dataAgeMin?: number|null, lastSuccessAt?: string|null, lastStatus?: string|null }} status
 * @param {Date} [now]
 * @returns {string}
 */
export function outageBannerText(status = {}, now = new Date()) {
    const partial = status.lastStatus === 'partial';
    const base = partial
        ? 'Část rozvrhů se z Bakalářů nepodařilo aktualizovat – některé mohou být starší.'
        : 'Data z Bakalářů se teď nedaří aktualizovat';
    const ageMin = Number.isFinite(status.dataAgeMin) ? status.dataAgeMin : null;
    const at = status.lastSuccessAt ? new Date(status.lastSuccessAt) : null;
    const validAt = at && !Number.isNaN(at.getTime()) ? at : null;

    if (ageMin === null && !validAt) {
        return partial ? base : `${base} – zobrazuji poslední stažená.`;
    }
    const ageText = formatAge((ageMin !== null ? ageMin : Math.max(0, Math.floor((now - validAt) / 60000))) * 60000);
    if (!validAt) return partial ? `${base} Všechny byly naposledy staženy ${ageText}.` : `${base} – zobrazená data jsou stažena ${ageText}.`;

    const when = whenText(validAt, now);
    if (partial) return `${base} Všechny byly naposledy staženy ${when} (${ageText}).`;
    return `${base} – zobrazená data jsou z ${when} (${ageText}).`;
}

/**
 * Banner text when the browser is online but the fresh data did not come (no
 * answer within the limit, an error) and the saved copy is shown instead.
 * @param {number|null} ageMs  age of the saved copy
 */
export function savedCopyText(ageMs, now = new Date()) {
    const base = 'Aktuální data se nepodařilo načíst – zobrazuji uložený rozvrh';
    if (ageMs == null) return `${base}.`;
    return `${base} z ${whenText(new Date(now.getTime() - ageMs), now)}.`;
}

function renderBanner(ageMs) {
    if (!dom.offlineBanner) return;
    const span = dom.offlineBanner.querySelector('.offline-banner-content span');
    if (!span) return;
    // Online, yet the data did not come: say from when the shown copy is and offer another try
    const failed = navigator.onLine !== false;
    const retry = document.getElementById('offlineRetry');
    if (retry) retry.hidden = !failed;
    if (failed) {
        span.textContent = savedCopyText(ageMs);
        return;
    }
    const ageText = formatAge(ageMs);
    span.textContent = ageText
        ? `Režim offline — data aktualizována ${ageText}`
        : 'Režim offline — zobrazuji uložená data';
}

export function showOfflineBanner(ageMs = null) {
    if (!dom.offlineBanner) return;
    renderBanner(ageMs);
    dom.offlineBanner.classList.remove('hidden');
}

export function hideOfflineBanner() {
    if (!dom.offlineBanner) return;
    dom.offlineBanner.classList.add('hidden');
}

export function setOfflineMode(active, ageMs = null) {
    offlineMode = !!active;
    if (offlineMode) {
        showOfflineBanner(ageMs);
    } else {
        hideOfflineBanner();
    }
}

export function isOffline() {
    return offlineMode || !navigator.onLine;
}

async function handleOnline() {
    if (!offlineMode && navigator.onLine) return;
    console.log('🌐 Back online — refreshing data');
    setOfflineMode(false);
    try {
        const [{ clearSessionCache }, { loadTimetable }] = await Promise.all([
            import('./api.js'),
            import('./timetable.js'),
        ]);
        clearSessionCache();
        await loadTimetable();
    } catch (err) {
        console.error('Failed to refresh after reconnect:', err);
    }
}

function handleOffline() {
    console.warn('📴 Browser went offline');
    setOfflineMode(true);
}

/**
 * "Zkusit znovu" (saved copy banner, error box): start over. The saved
 * timetable is back on screen at once, so a reload costs no blank page.
 */
function initRetryButtons() {
    for (const id of ['offlineRetry', 'errorRetry']) {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', () => window.location.reload());
    }
}

export function initOfflineDetection() {
    initRetryButtons();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (!navigator.onLine) {
        handleOffline();
    }
}
