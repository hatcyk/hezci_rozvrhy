/**
 * Refresh functionality for timetable data
 */

import { clearSessionCache } from './api.js';
import { loadTimetable } from './timetable.js';
import { dom } from './dom.js';
import { debug } from './debug.js';

// Track last refresh time
let lastRefreshTime = Date.now();
let autoRefreshInterval = null;

/**
 * Manually refresh the timetable
 */
export async function manualRefresh() {
    if (!dom.refreshBtn) return;

    debug.log('🔄 Manual refresh triggered');

    // Add refreshing state
    dom.refreshBtn.classList.add('refreshing');
    dom.refreshBtn.disabled = true;

    try {
        // Clear session cache to force fresh data fetch
        clearSessionCache();

        // Reload current timetable
        await loadTimetable();

        lastRefreshTime = Date.now();
        debug.log('✅ Manual refresh completed');
    } catch (error) {
        console.error('❌ Manual refresh failed:', error);
    } finally {
        // Remove refreshing state
        dom.refreshBtn.classList.remove('refreshing');
        dom.refreshBtn.disabled = false;
    }
}

/**
 * Auto-refresh the timetable every 10 minutes
 */
function autoRefresh() {
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshTime;
    const tenMinutes = 10 * 60 * 1000; // 10 minutes in milliseconds

    debug.log(`⏰ Auto-refresh check: ${Math.floor(timeSinceLastRefresh / 1000 / 60)} minutes since last refresh`);

    if (timeSinceLastRefresh >= tenMinutes) {
        debug.log('🔄 Auto-refreshing timetable data...');

        // Clear session cache and reload
        clearSessionCache();
        loadTimetable().then(() => {
            lastRefreshTime = Date.now();
            debug.log('✅ Auto-refresh completed');
        }).catch(error => {
            console.error('❌ Auto-refresh failed:', error);
        });
    }
}

/**
 * Initialize refresh functionality
 */
export function initRefresh() {
    // Set up manual refresh button
    if (dom.refreshBtn) {
        dom.refreshBtn.addEventListener('click', manualRefresh);
        debug.log('✅ Manual refresh button initialized');
    }

    // Set up auto-refresh every 10 minutes
    // Check every minute, but only refresh if 10 minutes have passed
    autoRefreshInterval = setInterval(autoRefresh, 60 * 1000); // Check every 1 minute
    debug.log('✅ Auto-refresh initialized (checks every minute, refreshes every 10 minutes)');
}

/**
 * Clean up refresh intervals (for cleanup/testing)
 */
export function cleanupRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        debug.log('🧹 Auto-refresh interval cleaned up');
    }
}
