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

/**
 * Text of the "data are stale" banner from /api/status (contract S4).
 * Says how old the data are instead of a vague "outage": the backend now
 * reports when the last successful download happened.
 * @param {{ dataAgeMin?: number|null, lastSuccessAt?: string|null }} status
 * @param {Date} [now]
 * @returns {string}
 */
export function outageBannerText(status = {}, now = new Date()) {
    const base = 'Data z Bakalářů se teď nedaří aktualizovat';
    const ageMin = Number.isFinite(status.dataAgeMin) ? status.dataAgeMin : null;
    const at = status.lastSuccessAt ? new Date(status.lastSuccessAt) : null;
    const validAt = at && !Number.isNaN(at.getTime()) ? at : null;

    if (ageMin === null && !validAt) {
        return `${base} – zobrazuji poslední stažená.`;
    }
    const ageText = formatAge((ageMin !== null ? ageMin : Math.max(0, Math.floor((now - validAt) / 60000))) * 60000);
    if (!validAt) return `${base} – zobrazená data jsou stažena ${ageText}.`;

    const hhmm = `${validAt.getHours()}:${String(validAt.getMinutes()).padStart(2, '0')}`;
    const sameDay = validAt.toDateString() === now.toDateString();
    const when = sameDay ? `dnes v ${hhmm}` : `${validAt.getDate()}. ${validAt.getMonth() + 1}. v ${hhmm}`;
    return `${base} – zobrazená data jsou z ${when} (${ageText}).`;
}

function renderBanner(ageMs) {
    if (!dom.offlineBanner) return;
    const span = dom.offlineBanner.querySelector('.offline-banner-content span');
    if (!span) return;
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

export function initOfflineDetection() {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (!navigator.onLine) {
        handleOffline();
    }
}
