/**
 * Favorites Module
 * Handles favorite timetables – loading, saving, toggling
 */

import { state, updateState } from './state.js';
import { apiFetch } from './api.js';
import { showToast } from './toast.js';

export const HEART_FILLED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
export const HEART_OUTLINE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;

export function isFavorite(type, id) {
    return state.favoriteTimetables.some(f => f.type === type && f.id === id);
}

export async function loadFavorites() {
    try {
        if (!localStorage.getItem('userId')) return;

        const response = await apiFetch((userId) => [`/api/favorites/${encodeURIComponent(userId)}`]);
        if (!response.ok) throw new Error('Failed to load favorites');

        const data = await response.json();
        updateState('favoriteTimetables', data.favoriteTimetables || []);
    } catch (error) {
        console.error('Failed to load favorites:', error);
    }
}

// The client no longer invents 'anonymous-<ms>' IDs: identities come from
// /api/auth (contract S1) and apiFetch signs in first when needed.
export async function saveFavorites(list) {
    try {
        const response = await apiFetch((userId) => [`/api/favorites/${encodeURIComponent(userId)}`, {
            method: 'POST',
            body: JSON.stringify({ favoriteTimetables: list })
        }]);

        if (!response.ok) throw new Error('Failed to save favorites');

        updateState('favoriteTimetables', list);
    } catch (error) {
        console.error('Failed to save favorites:', error);
        // The heart simply not changing looked like an ignored tap
        showToast({ title: 'Oblíbené se nepodařilo uložit.', body: 'Zkontrolujte připojení a zkuste to znovu.', icon: '⚠️' });
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
