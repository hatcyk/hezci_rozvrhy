import { fetchSunriseSunset } from './api.js';

// Prague coordinates (default)
const PRAGUE_LAT = 50.0755;
const PRAGUE_LNG = 14.4378;

let sunData = null;

// Parse time string (e.g., "7:29:14 AM" or "6:30 AM") to Date object for today
function parseTimeToDate(timeStr) {
    // Match format: "HH:MM:SS AM/PM" or "HH:MM AM/PM"
    const match = timeStr.match(/(\d+):(\d+)(?::(\d+))?\s*(AM|PM)/i);
    if (!match) return null;

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const seconds = match[3] ? parseInt(match[3]) : 0; // Seconds are optional
    const period = match[4].toUpperCase();

    // Convert 12-hour format to 24-hour format
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    const date = new Date();
    date.setHours(hours, minutes, seconds, 0);
    return date;
}

// Initialize sun data
export async function initSunData() {
    try {
        // Always use Prague coordinates (school location)
        sunData = await fetchSunriseSunset(PRAGUE_LAT, PRAGUE_LNG);
        console.log('Sun data loaded for Prague:', sunData);
    } catch (error) {
        console.error('Failed to load sun data:', error);
    }
}

// Check if it's currently nighttime
export function isNightTime() {
    if (!sunData) {
        console.log('isNightTime: No sun data available, returning false');
        return false;
    }

    const now = new Date();
    const sunrise = parseTimeToDate(sunData.sunrise);
    const sunset = parseTimeToDate(sunData.sunset);

    if (!sunrise || !sunset) {
        console.log('isNightTime: Failed to parse sunrise/sunset times');
        return false;
    }

    const isNight = now < sunrise || now > sunset;

    console.log('isNightTime check:', {
        currentTime: now.toLocaleTimeString('cs-CZ'),
        sunrise: sunrise.toLocaleTimeString('cs-CZ'),
        sunset: sunset.toLocaleTimeString('cs-CZ'),
        isNight: isNight
    });

    // It's night if current time is before sunrise OR after sunset
    return isNight;
}

