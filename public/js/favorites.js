/**
 * Favorites Module
 * Handles favorite timetables – loading, saving, toggling
 */

import { state, updateState } from './state.js';

export const HEART_FILLED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
export const HEART_OUTLINE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;

export function isFavorite(type, id) {
    return state.favoriteTimetables.some(f => f.type === type && f.id === id);
}

export async function loadFavorites() {
    try {
        const userId = localStorage.getItem('userId');
        if (!userId) return;

        const response = await fetch(`/api/favorites/${userId}`);
        if (!response.ok) throw new Error('Failed to load favorites');

        const data = await response.json();
        updateState('favoriteTimetables', data.favoriteTimetables || []);
    } catch (error) {
        console.error('Failed to load favorites:', error);
    }
}

function getOrCreateUserId() {
    let userId = localStorage.getItem('userId');
    if (!userId) {
        userId = 'anonymous-' + Date.now();
        localStorage.setItem('userId', userId);
    }
    return userId;
}

export async function saveFavorites(list) {
    try {
        const userId = getOrCreateUserId();

        const response = await fetch(`/api/favorites/${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favoriteTimetables: list })
        });

        if (!response.ok) throw new Error('Failed to save favorites');

        updateState('favoriteTimetables', list);
    } catch (error) {
        console.error('Failed to save favorites:', error);
    }
}

export async function toggleFavorite(type, id) {
    const current = [...state.favoriteTimetables];
    const existingIndex = current.findIndex(f => f.type === type && f.id === id);

    let updated;
    if (existingIndex >= 0) {
        updated = current.filter((_, i) => i !== existingIndex);
    } else {
        updated = [...current, { type, id }];
    }

    await saveFavorites(updated);
    return updated;
}
