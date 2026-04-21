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
