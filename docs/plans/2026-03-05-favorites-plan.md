# Oblíbené rozvrhy – Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Umožnit uživatelům označovat rozvrhy jako oblíbené (srdíčko v dropdownu), ukládat je do Firestore a mít rychlý přístup přes nové tlačítko v hlavičce.

**Architecture:** Nový backend route `/api/favorites` (vzor jako `fcm.js`), ukládá `preferences.favoriteTimetables` v Firestore user dokumentu. Frontend modul `favorites.js` řídí stav a API volání. Dropdown.js rozšířen o srdíčka u každé možnosti. Nový bottom sheet `#favoritesModal` pro rychlý přístup.

**Tech Stack:** Node.js/Express backend, Firebase Firestore, vanilla JS ES modules, CSS bottom sheets

---

### Task 1: Backend route – favorites

**Files:**
- Create: `routes/favorites.js`
- Modify: `index.js` (registrace route)

**Step 1: Vytvoř `routes/favorites.js`**

```js
/**
 * Favorites Routes
 * GET  /api/favorites/:userId  — vrátí favoriteTimetables[]
 * POST /api/favorites/:userId  — uloží celý seznam
 */

const express = require('express');
const { getFirestore } = require('../backend/firebase-admin-init');

const router = express.Router();

router.get('/favorites/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const db = getFirestore();
        const userDoc = await db.collection('users').doc(userId).get();

        if (userDoc.exists) {
            const prefs = userDoc.data().preferences || {};
            res.json({ favoriteTimetables: prefs.favoriteTimetables || [] });
        } else {
            res.json({ favoriteTimetables: [] });
        }
    } catch (error) {
        console.error('Favorites GET error:', error);
        res.status(500).json({ error: 'Failed to get favorites' });
    }
});

router.post('/favorites/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { favoriteTimetables } = req.body;

        if (!Array.isArray(favoriteTimetables)) {
            return res.status(400).json({ error: 'favoriteTimetables must be an array' });
        }

        const db = getFirestore();
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();

        if (userDoc.exists) {
            await userRef.update({
                'preferences.favoriteTimetables': favoriteTimetables,
                lastUpdated: new Date().toISOString()
            });
        } else {
            await userRef.set({
                preferences: { favoriteTimetables },
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString()
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Favorites POST error:', error);
        res.status(500).json({ error: 'Failed to save favorites' });
    }
});

module.exports = router;
```

**Step 2: Registruj route v `index.js`**

Za řádek `const cronRoutes = require('./routes/cron');` přidej:
```js
const favoritesRoutes = require('./routes/favorites');
```

Za řádek `app.use('/api/cron', cronRoutes);` přidej:
```js
app.use('/api', favoritesRoutes);
```

**Step 3: Manuálně ověř**

Spusť server (`node index.js`) a vyzkoušej:
```bash
curl -X GET http://localhost:3000/api/favorites/test-user-123
# Očekáváno: {"favoriteTimetables":[]}

curl -X POST http://localhost:3000/api/favorites/test-user-123 \
  -H "Content-Type: application/json" \
  -d '{"favoriteTimetables":[{"type":"Class","id":"3.A"}]}'
# Očekáváno: {"success":true}

curl -X GET http://localhost:3000/api/favorites/test-user-123
# Očekáváno: {"favoriteTimetables":[{"type":"Class","id":"3.A"}]}
```

**Step 4: Commit**

```bash
git add routes/favorites.js index.js
git commit -m "feat: add favorites backend route"
```

---

### Task 2: Frontend stav a modul `favorites.js`

**Files:**
- Modify: `public/js/state.js`
- Create: `public/js/favorites.js`

**Step 1: Přidej `favoriteTimetables` do stavu v `state.js`**

V objektu `state` za `watchedTimetables: []` přidej:
```js
favoriteTimetables: [],
```

**Step 2: Vytvoř `public/js/favorites.js`**

```js
/**
 * Favorites Module
 * Handles favorite timetables – loading, saving, toggling
 */

import { state, updateState } from './state.js';

const HEART_FILLED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
const HEART_OUTLINE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;

export { HEART_FILLED_SVG, HEART_OUTLINE_SVG };

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

export async function saveFavorites(list) {
    try {
        const userId = localStorage.getItem('userId');
        if (!userId) return;

        await fetch(`/api/favorites/${userId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favoriteTimetables: list })
        });

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
```

**Step 3: Commit**

```bash
git add public/js/state.js public/js/favorites.js
git commit -m "feat: add favorites state and JS module"
```

---

### Task 3: CSS pro srdíčka a favorites modal

**Files:**
- Create: `public/css/favorites.css`
- Modify: `public/index.html` (link na CSS)

**Step 1: Vytvoř `public/css/favorites.css`**

```css
/* ===== Favorites – Heart buttons in dropdown ===== */

.custom-dropdown-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.custom-dropdown-option .option-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.favorite-btn {
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s, transform 0.15s;
    -webkit-tap-highlight-color: transparent;
}

.favorite-btn:hover {
    color: #ef4444;
    transform: scale(1.15);
}

.favorite-btn.is-favorite {
    color: #ef4444;
}

/* Mobile sheet – same heart button */
.dropdown-sheet-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
}

.dropdown-sheet-option .option-label {
    flex: 1;
}

/* Heart indicator in dropdown trigger */
.dropdown-trigger-heart {
    display: none;
    color: #ef4444;
    flex-shrink: 0;
    margin-right: 4px;
}

.dropdown-trigger-heart.visible {
    display: flex;
    align-items: center;
}

/* Favorites access button in header */
.favorites-access-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    border-radius: 8px;
    transition: color 0.15s, background 0.15s;
    flex-shrink: 0;
}

.favorites-access-btn:hover {
    color: #ef4444;
    background: var(--hover-bg, rgba(0,0,0,0.06));
}

.favorites-access-btn.has-favorites {
    color: #ef4444;
}

/* Favorites bottom sheet list */
.favorites-sheet-list {
    padding: 8px 0 16px;
}

.favorites-sheet-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-main);
    text-align: left;
    border-bottom: 1px solid var(--border);
    transition: background 0.12s;
    -webkit-tap-highlight-color: transparent;
}

.favorites-sheet-item:last-child {
    border-bottom: none;
}

.favorites-sheet-item:active {
    background: var(--hover-bg, rgba(0,0,0,0.05));
}

.favorites-sheet-empty {
    padding: 32px 20px;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.9rem;
}

.favorites-sheet-type-badge {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--border);
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;
}
```

**Step 2: Přidej link v `public/index.html`**

Za ostatní CSS linky v `<head>` přidej:
```html
<link rel="stylesheet" href="css/favorites.css">
```

**Step 3: Commit**

```bash
git add public/css/favorites.css public/index.html
git commit -m "feat: add favorites CSS styles"
```

---

### Task 4: HTML – tlačítko rychlého přístupu + favorites modal

**Files:**
- Modify: `public/index.html`

**Step 1: Přidej `#favoritesBtn` do `.dropdown-row`**

Najdi v `index.html` blok `.dropdown-row` (obsahuje `#valueDropdown`, `#refreshBtn`, `#notificationBell`, `#themeToggle`, `#settingsToggle`).

Přidej nové tlačítko **před** `<div class="custom-dropdown" id="valueDropdown">`:

```html
<button class="favorites-access-btn" id="favoritesBtn" aria-label="Oblíbené rozvrhy" title="Oblíbené rozvrhy">
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
</button>
```

**Step 2: Přidej `#favoritesModal` bottom sheet**

Za closing `</div>` settingsModal sheetu přidej:

```html
<!-- Favorites Bottom Sheet -->
<div class="bottom-sheet" id="favoritesModal">
    <div class="bottom-sheet-handle"></div>
    <div class="modal-header">
        <h2>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#ef4444"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
            Oblíbené
        </h2>
        <button class="modal-close" id="favoritesModalClose">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
    </div>
    <div class="favorites-sheet-list" id="favoritesSheetList">
        <!-- Dynamically populated -->
    </div>
</div>
```

**Step 3: Přidej heart indicator do `#valueDropdownTrigger`**

Najdi v `index.html`:
```html
<button class="custom-dropdown-trigger" id="valueDropdownTrigger">
    <span id="valueDropdownLabel">Načítám...</span>
```

Změň na:
```html
<button class="custom-dropdown-trigger" id="valueDropdownTrigger">
    <span class="dropdown-trigger-heart" id="dropdownTriggerHeart">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
    </span>
    <span id="valueDropdownLabel">Načítám...</span>
```

**Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: add favorites button and modal to HTML"
```

---

### Task 5: Dropdown – srdíčka u každé položky

**Files:**
- Modify: `public/js/dropdown.js`

**Step 1: Importuj favorites modul na začátek `dropdown.js`**

Za existující importy přidej:
```js
import { isFavorite, toggleFavorite, HEART_FILLED_SVG, HEART_OUTLINE_SVG } from './favorites.js';
import { state } from './state.js';
```

**Step 2: Uprav `populateDropdown()` – desktop**

Najdi v `populateDropdown()` blok kde se vytváří `option` element a kde se nastavuje `option.textContent = item.label`.

Nahraď celý blok vytváření option elementu:
```js
    items.forEach(item => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option';
        option.dataset.value = item.value;
        option.dataset.searchText = item.label.toLowerCase();

        const isFav = isFavorite(state.selectedType, item.value);
        option.innerHTML = `
            <span class="option-label">${item.label}</span>
            <button class="favorite-btn${isFav ? ' is-favorite' : ''}" data-fav-value="${item.value}" aria-label="${isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}" title="${isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}">
                ${isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG}
            </button>
        `;

        if (item.value === currentValue) {
            option.classList.add('selected');
        }

        dom.valueDropdownMenu.appendChild(option);
    });
```

**Step 3: Oprav click handler v `initCustomDropdown()` – desktop**

Najdi handler:
```js
    dom.valueDropdownMenu.addEventListener('click', (e) => {
        if (e.target.classList.contains('custom-dropdown-option')) {
```

Nahraď celý callback:
```js
    dom.valueDropdownMenu.addEventListener('click', async (e) => {
        // Heart button click
        const favBtn = e.target.closest('.favorite-btn');
        if (favBtn) {
            e.stopPropagation();
            const value = favBtn.dataset.favValue;
            await toggleFavorite(state.selectedType, value);
            const isFav = isFavorite(state.selectedType, value);
            favBtn.classList.toggle('is-favorite', isFav);
            favBtn.innerHTML = isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG;
            favBtn.title = isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených';
            updateTriggerHeartIndicator();
            updateFavoritesAccessBtn();
            return;
        }
        // Option click – select schedule
        const option = e.target.closest('.custom-dropdown-option');
        if (option && !option.classList.contains('custom-dropdown-search')) {
            const value = option.dataset.value;
            const label = option.querySelector('.option-label').textContent;
            selectOption(value, label);
            closeDropdown();
            if (changeCallback) {
                changeCallback();
            }
        }
    });
```

**Step 4: Uprav `selectOption()` – přidej heart indikátor v triggeru**

Na konec funkce `selectOption(value, label)` přidej:
```js
    updateTriggerHeartIndicator();
```

**Step 5: Přidej helper `updateTriggerHeartIndicator()`**

Za funkci `selectOption()` přidej:
```js
function updateTriggerHeartIndicator() {
    const heartEl = document.getElementById('dropdownTriggerHeart');
    if (!heartEl) return;
    const fav = currentValue && isFavorite(state.selectedType, currentValue);
    heartEl.classList.toggle('visible', !!fav);
}

export function refreshDropdownHeartIndicator() {
    updateTriggerHeartIndicator();
}
```

**Step 6: Uprav mobile sheet – srdíčka v `openMobileSheet()`**

Najdi v `openMobileSheet()` řádek kde se generuje HTML pro jednotlivé options (`.map(item => ...)`).

Nahraď celý `.map()` blok:
```js
    list.innerHTML = allOptions.map(item => {
        const isFav = isFavorite(state.selectedType, item.value);
        return `
        <button class="dropdown-sheet-option${item.value === currentValue ? ' selected' : ''}" data-value="${item.value}">
            <span class="option-label">${item.label}</span>
            <span class="favorite-btn${isFav ? ' is-favorite' : ''}" data-fav-value="${item.value}" role="button" aria-label="${isFav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}">
                ${isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG}
            </span>
            ${item.value === currentValue ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>` : ''}
        </button>
        `;
    }).join('');
```

Pak v bloku kde se přidávají click listenery na `.dropdown-sheet-option`, nahraď existující forEach:
```js
    list.querySelectorAll('.dropdown-sheet-option').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            // Heart button
            const favSpan = e.target.closest('.favorite-btn');
            if (favSpan) {
                e.stopPropagation();
                const value = favSpan.dataset.favValue;
                await toggleFavorite(state.selectedType, value);
                const isFav = isFavorite(state.selectedType, value);
                favSpan.classList.toggle('is-favorite', isFav);
                favSpan.innerHTML = isFav ? HEART_FILLED_SVG : HEART_OUTLINE_SVG;
                updateFavoritesAccessBtn();
                return;
            }
            // Option select
            const value = btn.dataset.value;
            const label = btn.querySelector('.option-label').textContent.trim();
            selectOption(value, label);
            closeBottomSheet('dropdownMobileSheet');
            if (changeCallback) changeCallback();
        });
    });
```

**Step 7: Commit**

```bash
git add public/js/dropdown.js
git commit -m "feat: add heart buttons to dropdown options"
```

---

### Task 6: Favorites modal – rychlý přístup

**Files:**
- Create: `public/js/favorites-modal.js`
- Modify: `public/js/main.js`

**Step 1: Vytvoř `public/js/favorites-modal.js`**

```js
/**
 * Favorites Modal Module
 * Quick access sheet showing all favorite timetables flat list
 */

import { state, updateState } from './state.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';
import { setDropdownValue } from './dropdown.js';
import { HEART_FILLED_SVG } from './favorites.js';
import { refreshDropdownHeartIndicator } from './dropdown.js';

const TYPE_LABELS = {
    Class: 'Třída',
    Teacher: 'Učitel',
    Room: 'Učebna'
};

export function updateFavoritesAccessBtn() {
    const btn = document.getElementById('favoritesBtn');
    if (!btn) return;
    const hasFavs = state.favoriteTimetables.length > 0;
    btn.classList.toggle('has-favorites', hasFavs);
    if (hasFavs) {
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#ef4444"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    } else {
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    }
}

function populateFavoritesSheet() {
    const list = document.getElementById('favoritesSheetList');
    if (!list) return;

    const favs = state.favoriteTimetables;

    if (favs.length === 0) {
        list.innerHTML = `<p class="favorites-sheet-empty">Zatím žádné oblíbené.<br>Klikni na srdíčko u rozvrhu v seznamu.</p>`;
        return;
    }

    list.innerHTML = favs.map(fav => `
        <button class="favorites-sheet-item" data-type="${fav.type}" data-id="${fav.id}">
            ${HEART_FILLED_SVG}
            <span>${fav.id}</span>
            <span class="favorites-sheet-type-badge">${TYPE_LABELS[fav.type] || fav.type}</span>
        </button>
    `).join('');

    list.querySelectorAll('.favorites-sheet-item').forEach(item => {
        item.addEventListener('click', () => {
            const type = item.dataset.type;
            const id = item.dataset.id;

            // Switch type if needed
            if (state.selectedType !== type) {
                updateState('selectedType', type);
                // Update type buttons
                document.querySelectorAll('.type-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.type === type);
                });
                // Repopulate dropdown for new type
                import('./timetable.js').then(({ populateValueSelect }) => {
                    populateValueSelect();
                    setDropdownValue(id, id);
                    refreshDropdownHeartIndicator();
                    closeBottomSheet('favoritesModal');
                    import('./timetable.js').then(({ loadTimetable }) => loadTimetable());
                });
            } else {
                setDropdownValue(id, id);
                refreshDropdownHeartIndicator();
                closeBottomSheet('favoritesModal');
                import('./timetable.js').then(({ loadTimetable }) => loadTimetable());
            }
        });
    });
}

export function initFavoritesModal() {
    const btn = document.getElementById('favoritesBtn');
    const closeBtn = document.getElementById('favoritesModalClose');

    if (btn) {
        btn.addEventListener('click', () => {
            populateFavoritesSheet();
            openBottomSheet('favoritesModal');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => closeBottomSheet('favoritesModal'));
    }

    updateFavoritesAccessBtn();
}
```

**Step 2: Exportuj `updateFavoritesAccessBtn` z `favorites-modal.js` a importuj ho v `dropdown.js`**

V `dropdown.js` za existující importy přidej:
```js
import { updateFavoritesAccessBtn } from './favorites-modal.js';
```

**Step 3: Uprav `main.js` – volej `loadFavorites` a `initFavoritesModal` při init**

Přidej importy na začátek `main.js`:
```js
import { loadFavorites } from './favorites.js';
import { initFavoritesModal } from './favorites-modal.js';
```

V `init()` funkci, za `await authenticateWithFirebase()` (nebo paralelně s `fetchDefinitions`), přidej:
```js
        // Load favorites in parallel with definitions
        const [definitions] = await Promise.all([
            fetchDefinitions(),
            loadFavorites()
        ]);
```

Poznámka: Pokud `fetchDefinitions()` není zatím v `Promise.all`, najdi kde se volá a obals ho. Pokud už je v Promise.all s jiným voláním, přidej `loadFavorites()` do pole.

Za `initSettings()` přidej:
```js
        initFavoritesModal();
```

**Step 4: Commit**

```bash
git add public/js/favorites-modal.js public/js/dropdown.js public/js/main.js
git commit -m "feat: add favorites quick-access modal and wire up init"
```

---

### Task 7: Manuální ověření celé feature

**Checklist:**
1. Spusť server a otevři appku v prohlížeči
2. Vyber typ "Třídy", otevři dropdown — každá třída má outline srdíčko vpravo
3. Klikni na srdíčko u "3.A" — srdíčko se vybarví červeně, dropdown zůstane otevřený
4. Vyber "3.A" ze seznamu — v dropdown triggeru se zobrazí malé červené srdíčko
5. Obnovit stránku — srdíčko v triggeru stále viditelné (načetlo se z Firestore)
6. Klikni na tlačítko `#favoritesBtn` (srdíčko v header) — otevře se modal s "3.A"
7. Klikni na "3.A" v modalu — modal se zavře, načte se rozvrh 3.A
8. Přidej další oblíbené (učitel, učebna) — v modalu se zobrazí flat bez kategorií
9. Odeber oblíbený (klikni znovu na srdíčko) — zmizí z listu oblíbených

**Step 2: Commit (pokud jsou potřeba drobné opravy)**

```bash
git add -p
git commit -m "fix: favorites UX polish"
```
