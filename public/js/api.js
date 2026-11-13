/**
 * API Layer - reads from Firebase instead of Bakalari API directly
 */

import { fetchDefinitionsFromFirebase, fetchTimetableFromFirebase, fetchAggregateFromFirebase, watchAggregateFromFirebase, authenticateWithFirebase, getIdToken, getCurrentUserId } from './firebase-client.js';
import { setCache, getCacheEvenExpired, getCacheAge, TTL } from './cache.js';
import { setOfflineMode, isOffline } from './offline.js';

/**
 * Call a per-user API endpoint with `Authorization: Bearer <Firebase ID token>`
 * (contract S1: the server verifies the token and rejects a userId that is not
 * the caller's).
 *
 * `build` receives the current userId and returns [url, init], so a retry after
 * a re-sign-in uses the new ID if the server migrated it in between.
 * On 401 (expired/revoked token, unknown user) it signs in again once and
 * retries with a freshly minted token; other statuses are returned as they are.
 *
 * @param {(userId: string) => [string, RequestInit?]} build
 * @returns {Promise<Response>}
 */
export async function apiFetch(build) {
    const send = async (forceRefresh) => {
        const token = await getIdToken(forceRefresh);
        const userId = getCurrentUserId();
        if (!userId) throw new Error('User ID not found');
        const [url, init = {}] = build(userId);
        const headers = new Headers(init.headers || {});
        headers.set('Authorization', `Bearer ${token}`);
        if (init.body !== undefined && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }
        return fetch(url, { ...init, headers });
    };

    const response = await send(false);
    if (response.status !== 401) return response;

    await authenticateWithFirebase({ force: true });
    return send(true);
}

// Session cache for faster repeated access
const sessionCache = {
    definitions: null,
    timetables: new Map(),
};

const DEFINITIONS_KEY = 'definitions';
const timetableKey = (type, id, scheduleType) => `timetable_${type}_${id}_${scheduleType}`;

/**
 * Fetch definitions (classes, teachers, rooms) from Firebase
 * Falls back to localStorage cache when offline.
 */
export async function fetchDefinitions() {
    // Check session cache first
    if (sessionCache.definitions) {
        console.log('Using session-cached definitions');
        return sessionCache.definitions;
    }

    // If browser reports offline, prefer cached data immediately
    if (!navigator.onLine) {
        const cached = getCacheEvenExpired(DEFINITIONS_KEY);
        if (cached) {
            console.log('📴 Offline — using cached definitions');
            sessionCache.definitions = cached;
            setOfflineMode(true, getCacheAge(DEFINITIONS_KEY));
            return cached;
        }
    }

    try {
        const definitions = await fetchDefinitionsFromFirebase();

        sessionCache.definitions = definitions;
        setCache(DEFINITIONS_KEY, definitions, TTL.DEFINITIONS);

        if (isOffline() && navigator.onLine) setOfflineMode(false);

        console.log(`Loaded definitions from Firebase: ${definitions.classes.length} classes, ${definitions.teachers.length} teachers, ${definitions.rooms.length} rooms`);

        return definitions;
    } catch (error) {
        console.error('Failed to fetch definitions:', error);

        // Network/Firebase failure — fall back to any cached copy
        const cached = getCacheEvenExpired(DEFINITIONS_KEY);
        if (cached) {
            console.warn('⚠️ Using cached definitions (fetch failed)');
            sessionCache.definitions = cached;
            setOfflineMode(true, getCacheAge(DEFINITIONS_KEY));
            return cached;
        }

        throw new Error('Nepodařilo se načíst seznamy z Firebase');
    }
}

/**
 * Fetch timetable from Firebase
 * Falls back to localStorage cache when offline.
 */
export async function fetchTimetable(type, id, scheduleType, date = null) {
    const sessionKey = `${type}_${id}_${scheduleType}_${date || 'current'}`;
    const persistKey = timetableKey(type, id, scheduleType);

    // Check session cache first
    if (sessionCache.timetables.has(sessionKey)) {
        console.log(`Using session-cached timetable: ${sessionKey}`);
        return sessionCache.timetables.get(sessionKey);
    }

    // If browser reports offline, prefer cached data immediately
    if (!navigator.onLine) {
        const cached = getCacheEvenExpired(persistKey);
        if (cached) {
            console.log(`📴 Offline — using cached timetable: ${persistKey}`);
            sessionCache.timetables.set(sessionKey, cached);
            setOfflineMode(true, getCacheAge(persistKey));
            return cached;
        }
    }

    try {
        // Note: Firebase stores data by scheduleType (Actual/Permanent/Next),
        // not by date. The backend prefetches all schedule types.
        const data = await fetchTimetableFromFirebase(type, id, scheduleType);

        sessionCache.timetables.set(sessionKey, data);
        setCache(persistKey, data, TTL.TIMETABLE);

        if (isOffline() && navigator.onLine) setOfflineMode(false);

        console.log(`Loaded timetable from Firebase: ${sessionKey} (${data.length} lessons)`);

        return data;
    } catch (error) {
        console.error(`Failed to fetch timetable:`, error);

        // Network/Firebase failure — fall back to any cached copy
        const cached = getCacheEvenExpired(persistKey);
        if (cached) {
            console.warn(`⚠️ Using cached timetable (fetch failed): ${persistKey}`);
            sessionCache.timetables.set(sessionKey, cached);
            setOfflineMode(true, getCacheAge(persistKey));
            return cached;
        }

        throw error;
    }
}

/* ── aggregates (S3) ─────────────────────────────────────────────────── */

const aggregateKey = (id) => `aggregate_${id}`;
const aggregateSession = new Map(); // id -> { value, at }
const AGGREGATE_SESSION_MS = 2 * 60 * 1000;

/**
 * Read aggregates/{id} with the same offline fallback as timetables: the last
 * copy stays in localStorage, so the changes board and free rooms still open
 * without a connection (with a note how old the data are).
 * @param {string} id - changes_Actual | changes_Next | freeRooms_Actual | freeRooms_Next
 * @param {{ fresh?: boolean }} [opts] - skip the 2-minute session cache
 * @returns {Promise<{ data: object|null, fromCache: boolean, cacheAgeMs: number|null }>}
 */
export async function fetchAggregate(id, { fresh = false } = {}) {
    const hit = aggregateSession.get(id);
    if (!fresh && hit && Date.now() - hit.at < AGGREGATE_SESSION_MS) return hit.value;

    const fromCache = () => {
        const cached = getCacheEvenExpired(aggregateKey(id));
        if (cached === null || cached === undefined) return null;
        return { data: cached, fromCache: true, cacheAgeMs: getCacheAge(aggregateKey(id)) };
    };

    if (!navigator.onLine) {
        const cached = fromCache();
        if (cached) return cached;
    }

    try {
        const data = await fetchAggregateFromFirebase(id);
        const value = { data, fromCache: false, cacheAgeMs: null };
        if (data) setCache(aggregateKey(id), data, TTL.TIMETABLE);
        aggregateSession.set(id, { value, at: Date.now() });
        return value;
    } catch (error) {
        console.warn(`Failed to fetch aggregate ${id}:`, error?.message || error);
        const cached = fromCache();
        if (cached) return cached;
        throw error;
    }
}

/**
 * Follow aggregates/{id} live (Firestore onSnapshot). Without Firestore
 * (SDK blocked, offline boot) it falls back to polling every 5 minutes.
 * @param {string} id
 * @param {(value: { data, fromCache, cacheAgeMs }) => void} onUpdate
 * @returns {() => void} stop
 */
export function watchAggregate(id, onUpdate) {
    let stopped = false;
    let timer = null;
    const poll = async () => {
        if (stopped) return;
        try { onUpdate(await fetchAggregate(id, { fresh: true })); } catch { /* keep the last board */ }
        timer = setTimeout(poll, 5 * 60 * 1000);
    };
    let unsubscribe = null;
    try {
        unsubscribe = watchAggregateFromFirebase(id, (data) => {
            if (data) setCache(aggregateKey(id), data, TTL.TIMETABLE);
            const value = { data, fromCache: false, cacheAgeMs: null };
            aggregateSession.set(id, { value, at: Date.now() });
            onUpdate(value);
        }, (err) => {
            console.warn(`Live aggregate ${id} failed, polling instead:`, err?.message || err);
            if (!timer && !stopped) poll();
        });
    } catch {
        poll();
    }
    return () => {
        stopped = true;
        if (unsubscribe) unsubscribe();
        clearTimeout(timer);
    };
}

/**
 * Fetch sunrise/sunset data (kept as-is, not affected by Firebase migration)
 */
export async function fetchSunriseSunset(lat, lng) {
    try {
        // Add timezone parameter to get times in Europe/Prague timezone
        const res = await fetch(`https://api.sunrisesunset.io/json?lat=${lat}&lng=${lng}&timezone=Europe/Prague`);
        const data = await res.json();

        if (data.status !== 'OK') {
            throw new Error('Failed to fetch sunrise/sunset data');
        }

        console.log('Sunrise/Sunset data for Prague:', {
            sunrise: data.results.sunrise,
            sunset: data.results.sunset,
            dawn: data.results.dawn,
            dusk: data.results.dusk
        });

        return {
            sunrise: data.results.sunrise,
            sunset: data.results.sunset,
            dawn: data.results.dawn,
            dusk: data.results.dusk
        };
    } catch (error) {
        console.error('Error fetching sunrise/sunset data:', error);
        return null;
    }
}

/**
 * Clear session cache (useful for forcing refresh)
 */
export function clearSessionCache() {
    sessionCache.definitions = null;
    sessionCache.timetables.clear();
    aggregateSession.clear();
    console.log('Session cache cleared');
}

/**
 * Ask our backend how fresh the timetable data is (contract S4).
 * Unreachable backend → treated as healthy: the offline banner covers that
 * case, and a false outage alarm would only confuse.
 * @returns {Promise<{ isHealthy: boolean, dataAgeMin: number|null, lastSuccessAt: string|null }>}
 */
export async function fetchBackendStatus() {
    try {
        const response = await fetch('/api/status', {
            method: 'GET',
            cache: 'no-store'
        });

        if (!response.ok) {
            console.error('⚠️ Failed to fetch backend status');
            return { isHealthy: true, dataAgeMin: null, lastSuccessAt: null };
        }

        const data = await response.json();
        return {
            isHealthy: data.isHealthy !== false,
            dataAgeMin: Number.isFinite(data.dataAgeMin) ? data.dataAgeMin : null,
            lastSuccessAt: data.lastSuccessAt || null,
        };
    } catch (error) {
        console.error('⚠️ Backend status check failed:', error.message);
        return { isHealthy: true, dataAgeMin: null, lastSuccessAt: null };
    }
}

/**
 * Check if Bakalari API is available by asking our backend
 * @returns {Promise<boolean>}
 */
export async function checkBakalariStatus() {
    const status = await fetchBackendStatus();
    if (!status.isHealthy) console.warn('⚠️ Bakaláři data are stale');
    return status.isHealthy;
}
