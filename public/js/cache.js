/**
 * Cache Module
 * Provides localStorage caching with TTL (Time To Live) support
 */

const CACHE_PREFIX = 'bakalari_cache_';

/**
 * TTL constants in milliseconds
 */
export const TTL = {
  DEFINITIONS: 7 * 24 * 60 * 60 * 1000, // 7 days
  TIMETABLE: 10 * 60 * 1000, // 10 minutes
};

/**
 * Save data to cache with TTL
 * @param {string} key - Cache key
 * @param {any} data - Data to cache
 * @param {number} ttl - Time to live in milliseconds
 */
export function setCache(key, data, ttl) {
  try {
    const cacheEntry = {
      data,
      timestamp: Date.now(),
      ttl,
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(cacheEntry));
  } catch (error) {
    console.warn('Failed to save to cache:', error);
  }
}

/**
 * Get data from cache even if expired (fallback for offline mode)
 * @param {string} key - Cache key
 * @returns {any|null} Cached data or null if not found
 */
export function getCacheEvenExpired(key) {
  try {
    const item = localStorage.getItem(CACHE_PREFIX + key);
    if (!item) return null;

    const cacheEntry = JSON.parse(item);
    return cacheEntry.data;
  } catch (error) {
    console.warn('Failed to read from cache:', error);
    return null;
  }
}

/**
 * Get cache age in milliseconds
 * @param {string} key - Cache key
 * @returns {number|null} Age in ms or null if not found
 */
export function getCacheAge(key) {
  try {
    const item = localStorage.getItem(CACHE_PREFIX + key);
    if (!item) return null;

    const cacheEntry = JSON.parse(item);
    return Date.now() - cacheEntry.timestamp;
  } catch (error) {
    return null;
  }
}

