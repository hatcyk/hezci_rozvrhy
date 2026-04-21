/**
 * API Layer - reads from Firebase instead of Bakalari API directly
 */

import { fetchDefinitionsFromFirebase, fetchTimetableFromFirebase } from './firebase-client.js';

// Session cache for faster repeated access
const sessionCache = {
    definitions: null,
    timetables: new Map(),
};

/**
 * Fetch definitions (classes, teachers, rooms) from Firebase
 */
export async function fetchDefinitions() {
    // Check session cache first
    if (sessionCache.definitions) {
        console.log('Using session-cached definitions');
        return sessionCache.definitions;
    }

    try {
        const definitions = await fetchDefinitionsFromFirebase();

        // Cache in session
        sessionCache.definitions = definitions;

        console.log(`Loaded definitions from Firebase: ${definitions.classes.length} classes, ${definitions.teachers.length} teachers, ${definitions.rooms.length} rooms`);

        return definitions;
    } catch (error) {
        console.error('Failed to fetch definitions:', error);
        throw new Error('Nepodařilo se načíst seznamy z Firebase');
    }
}

/**
 * Fetch timetable from Firebase
 */
export async function fetchTimetable(type, id, scheduleType, date = null) {
    const cacheKey = `${type}_${id}_${scheduleType}_${date || 'current'}`;

    // Check session cache first
    if (sessionCache.timetables.has(cacheKey)) {
        console.log(`Using session-cached timetable: ${cacheKey}`);
        return sessionCache.timetables.get(cacheKey);
    }

    try {
        // Note: Firebase stores data by scheduleType (Actual/Permanent/Next),
        // not by date. The backend prefetches all schedule types.
        const data = await fetchTimetableFromFirebase(type, id, scheduleType);

        // Cache in session
        sessionCache.timetables.set(cacheKey, data);

        console.log(`Loaded timetable from Firebase: ${cacheKey} (${data.length} lessons)`);

        return data;
    } catch (error) {
        console.error(`Failed to fetch timetable:`, error);
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
