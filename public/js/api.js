/**
 * API Layer - reads from Firebase instead of Bakalari API directly
 */

import { fetchDefinitionsFromFirebase, fetchTimetableFromFirebase } from './firebase-client.js';
import { setCache, getCacheEvenExpired, getCacheAge, TTL } from './cache.js';
import { setOfflineMode, isOffline } from './offline.js';

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
    console.log('Session cache cleared');
}

/**
 * Check if Bakalari API is available by asking our backend
 */
export async function checkBakalariStatus() {
    try {
        const response = await fetch('/api/status', {
            method: 'GET',
            cache: 'no-cache'
        });

        if (!response.ok) {
            console.error('⚠️ Failed to fetch backend status');
            return true; // Assume it's working if we can't check
        }

        const data = await response.json();

        if (!data.isHealthy) {
            console.warn('⚠️ Bakaláři API is down or returning empty data');
            return false;
        }

        console.log('✅ Bakaláři API is healthy');
        return true;
    } catch (error) {
        console.error('⚠️ Backend status check failed:', error.message);
        return true; // Assume it's working if we can't check
    }
}
