/**
 * Notifications Preferences Module
 * Manages notification type preferences for each watched timetable
 */

import { state } from './state.js';
import { saveWatchedTimetables } from './notifications-core.js';
import { standardizeGroupName } from './utils.js';
import { fetchTimetable } from './api.js';

// Define notification types
export const NOTIFICATION_TYPES = {
    changes: {
        title: 'Změny v rozvrhu',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>',
        options: {
            lesson_removed: {
                label: 'Odpadlé hodiny',
                description: 'Když hodina odpadne nebo je zrušená',
                default: true
            },
            substitution: {
                label: 'Suplování',
                description: 'Když se změní učitel',
                default: true
            },
            room_change: {
                label: 'Změna místnosti',
                description: 'Když se změní učebna',
                default: true
            },
            lesson_added: {
                label: 'Nové hodiny',
                description: 'Když se přidá nová hodina',
                default: false
            },
            subject_change: {
                label: 'Změna předmětu',
                description: 'Když se změní předmět',
                default: false
            }
        }
    },
    reminders: {
        title: 'Upomínky',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
        options: {
            next_lesson_room: {
                label: 'Kam jít na další hodinu',
                description: 'Připomínka s číslem učebny před začátkem hodiny',
                default: false
            },
            next_lesson_teacher: {
                label: 'Koho máte na další hodinu',
                description: 'Připomínka s jménem učitele před začátkem hodiny',
                default: false
            },
            next_lesson_subject: {
                label: 'Co máte další hodinu',
                description: 'Připomínka s názvem předmětu před začátkem hodiny',
                default: false
            }
        }
    }
};

/**
 * Get default notification preferences
 */
export function getDefaultPreferences() {
    const preferences = {};

    for (const [groupKey, group] of Object.entries(NOTIFICATION_TYPES)) {
        preferences[groupKey] = {};
        for (const [optionKey, option] of Object.entries(group.options)) {
            preferences[groupKey][optionKey] = option.default;
        }
    }

    return preferences;
}

/**
 * Render preferences for a single timetable (type+id) into a container element.
 * Used by the in-sheet navigation to show per-item settings.
 * @param {string} type - 'Class' | 'Teacher' | 'Room'
 * @param {string} id - Timetable ID
 * @param {HTMLElement} container - Target container element
 */
export function renderTimetablePreferencesView(type, id, container) {
    container.innerHTML = '';

    const timetables = state.watchedTimetables.filter(t => t.type === type && t.id === id);

    if (timetables.length === 0) {
        container.innerHTML = '<p style="color: var(--text-dim); padding: 20px 0; text-align: center;">Žádné nastavení k zobrazení.</p>';
        return;
    }

    timetables.forEach(timetable => {
        const globalIndex = state.watchedTimetables.indexOf(timetable);
        const item = createTimetablePreferenceItem(timetable, globalIndex);
        container.appendChild(item);
    });
}

/**
 * Render preferences UI for selected timetables
 */
export function renderSelectedTimetablesPreferences() {
    const container = document.getElementById('selectedTimetablesList');
    const section = document.getElementById('selectedTimetablesSection');

    if (!container || !section) return;

    // If no timetables selected, hide section
    if (!state.watchedTimetables || state.watchedTimetables.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    container.innerHTML = '';

    // Render each timetable
    state.watchedTimetables.forEach((timetable, index) => {
        const item = createTimetablePreferenceItem(timetable, index);
        container.appendChild(item);
    });
}

/**
 * Create preference item for a single timetable
 */
function createTimetablePreferenceItem(timetable, index) {
    const item = document.createElement('div');
    item.className = 'timetable-preference-item';

    // Ensure timetable has notificationTypes
    if (!timetable.notificationTypes) {
        timetable.notificationTypes = getDefaultPreferences();
    }

    // Migrate groupFilters if missing (safety net)
    if (!timetable.groupFilters) {
        const oldFilter = timetable.groupFilter || 'all';
        timetable.groupFilters = [oldFilter];

        // Immediately save to persist migration
        saveWatchedTimetables(state.watchedTimetables).catch(err => {
            console.error('Failed to save migrated groupFilters:', err);
        });
    }

    // Header
    const header = document.createElement('div');
    header.className = 'timetable-preference-header';
    header.innerHTML = `
        <div class="timetable-preference-name">
            <span>${timetable.name}</span>
            <span class="timetable-preference-badge">${getScheduleTypeLabel(timetable.scheduleType)}</span>
        </div>
        <svg class="timetable-preference-arrow" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
    `;

    // Body with notification options
    const body = document.createElement('div');
    body.className = 'timetable-preference-body';

    // Inner wrapper required for grid-template-rows animation
    const bodyInner = document.createElement('div');
    bodyInner.className = 'timetable-preference-body-inner';

    // Group filter (pouze pro třídy)
    if (timetable.type === 'Class') {
        const groupFilterSection = document.createElement('div');
        groupFilterSection.className = 'group-filter-section';
        groupFilterSection.innerHTML = `
            <label class="group-filter-label">Filtrovat podle skupiny:</label>
            <div class="multiselect-dropdown" id="group-filter-${index}">
                <div class="multiselect-trigger">
                    <span class="multiselect-label">Načítám...</span>
                    <svg class="multiselect-arrow" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="multiselect-menu">
                    <div class="multiselect-options"></div>
                </div>
            </div>
        `;
        bodyInner.appendChild(groupFilterSection);

        // Async načtení skupin a nastavení
        const multiselectElement = groupFilterSection.querySelector('.multiselect-dropdown');
        populateGroupFilter(multiselectElement, timetable, index);
    }

    // Render each notification type group
    for (const [groupKey, group] of Object.entries(NOTIFICATION_TYPES)) {
        // Skip reminders for Next schedule type
        if (groupKey === 'reminders' && timetable.scheduleType === 'Next') {
            continue;
        }

        const groupDiv = document.createElement('div');
        groupDiv.className = 'notification-type-group';

        // Group title
        const groupTitle = document.createElement('div');
        groupTitle.className = 'notification-type-group-title';
        groupTitle.innerHTML = `${group.icon} ${group.title}`;

        // Add note for reminders that they are only for Actual schedule
        if (groupKey === 'reminders' && timetable.scheduleType === 'Actual') {
            const note = document.createElement('span');
            note.className = 'notification-type-group-note';
            note.textContent = '(pouze pro aktuální týden)';
            groupTitle.appendChild(note);
        }

        groupDiv.appendChild(groupTitle);

        // Options
        for (const [optionKey, option] of Object.entries(group.options)) {
            const optionDiv = document.createElement('div');
            optionDiv.className = 'notification-type-option';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `pref-${index}-${groupKey}-${optionKey}`;
            checkbox.checked = timetable.notificationTypes[groupKey]?.[optionKey] ?? option.default;
            checkbox.addEventListener('change', () => {
                updateTimetablePreference(index, groupKey, optionKey, checkbox.checked);
            });

            const label = document.createElement('label');
            label.htmlFor = checkbox.id;
            label.innerHTML = `
                <div>${option.label}</div>
                <div class="notification-type-option-description">${option.description}</div>
            `;

            optionDiv.appendChild(checkbox);
            optionDiv.appendChild(label);

            // Click on the whole row to toggle
            optionDiv.addEventListener('click', (e) => {
                if (e.target !== checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });

            groupDiv.appendChild(optionDiv);
        }

        bodyInner.appendChild(groupDiv);
    }

    body.appendChild(bodyInner);

    // Toggle expand/collapse
    header.addEventListener('click', () => {
        header.classList.toggle('expanded');
        body.classList.toggle('expanded');
    });

    item.appendChild(header);
    item.appendChild(body);

    return item;
}

/**
 * Update notification preference for a specific timetable
 */
async function updateTimetablePreference(index, groupKey, optionKey, value) {
    const timetable = state.watchedTimetables[index];

    if (!timetable.notificationTypes) {
        timetable.notificationTypes = getDefaultPreferences();
    }

    if (!timetable.notificationTypes[groupKey]) {
        timetable.notificationTypes[groupKey] = {};
    }

    timetable.notificationTypes[groupKey][optionKey] = value;

    // Save to server
    try {
        await saveWatchedTimetables(state.watchedTimetables);
        console.log(`✅ Updated preference: ${groupKey}.${optionKey} = ${value}`);
    } catch (error) {
        console.error('Failed to save preferences:', error);
    }
}

/**
 * Get human-readable label for schedule type
 */
function getScheduleTypeLabel(scheduleType) {
    const labels = {
        'Permanent': 'Stálý',
        'Actual': 'Aktuální',
        'Next': 'Příští'
    };
    return labels[scheduleType] || scheduleType;
}

/**
 * Get available groups for a watched timetable
 * @param {Object} watchedTimetable - { type, id, scheduleType }
 * @returns {Promise<Array<string>>} Array of standardized group names
 */
async function getAvailableGroups(watchedTimetable) {
    console.log('🔍 getAvailableGroups called for:', watchedTimetable);

    // Only classes have groups
    if (watchedTimetable.type !== 'Class') {
        console.log('   Not a class, no groups available');
        return [];
    }

    try {
        // Fetch groups from database cache via API
        console.log('   Fetching groups from database cache...');

        const response = await fetch(`/api/groups/${watchedTimetable.id}`);

        if (!response.ok) {
            throw new Error('Failed to fetch groups from API');
        }

        const data = await response.json();
        const groups = data.groups || [];

        console.log('   ✅ Groups from database:', groups);

        if (groups.length === 0) {
            console.warn('   ⚠️ No groups found for this class');
            return [];
        }

        return groups;
    } catch (error) {
        console.error('   ❌ Failed to get groups from database:', error);
        console.log('   Falling back to fetching from lessons...');

        // Fallback: Extract groups from lessons (old method)
        try {
            const lessons = await fetchTimetable(
                watchedTimetable.type,
                watchedTimetable.id,
                watchedTimetable.scheduleType
            );

            if (!lessons || lessons.length === 0) {
                console.warn('   ⚠️  No lessons in Firebase');
                return [];
            }

            // Extract unique groups
            const groupsSet = new Set();
            lessons.forEach(lesson => {
                if (lesson.group) {
                    const std = standardizeGroupName(lesson.group);
                    if (std) groupsSet.add(std);
                }
            });

            if (groupsSet.size === 0) {
                console.warn('   ⚠️ No groups found in lessons');
                return [];
            }

            // Sort groups alphabetically
            const sorted = Array.from(groupsSet).sort((a, b) => a.localeCompare(b));

            console.log('   ✅ Groups from fallback:', sorted);
            return sorted;
        } catch (fallbackError) {
            console.error('   ❌ Fallback also failed:', fallbackError);
            return [];
        }
    }
}

/**
 * Populate group filter multiselect dropdown and set up listeners
 * @param {HTMLElement} multiselectElement - The multiselect dropdown element
 * @param {Object} watchedTimetable - The timetable object
 * @param {Number} index - Index in watchedTimetables array
 */
async function populateGroupFilter(multiselectElement, watchedTimetable, index) {
    console.log('📋 populateGroupFilter called');
    console.log('   Element:', multiselectElement);
    console.log('   Timetable:', watchedTimetable);
    console.log('   Current groupFilters:', watchedTimetable.groupFilters);

    const trigger = multiselectElement.querySelector('.multiselect-trigger');
    const menu = multiselectElement.querySelector('.multiselect-menu');
    const optionsContainer = multiselectElement.querySelector('.multiselect-options');
    const label = multiselectElement.querySelector('.multiselect-label');

    // Ověř, že všechny DOM elementy existují
    if (!optionsContainer) {
        console.error('❌ optionsContainer not found in multiselect element!');
        return;
    }
    if (!trigger || !menu || !label) {
        console.error('❌ Missing required multiselect elements (trigger/menu/label)!');
        return;
    }

    // Initialize groupFilters if it doesn't exist (backwards compatibility)
    if (!watchedTimetable.groupFilters) {
        // Migrate from old single groupFilter to array
        const oldFilter = watchedTimetable.groupFilter || 'all';
        watchedTimetable.groupFilters = [oldFilter];
    }

    // Migrate old "celá" and "all" filters (hodiny pro celou třídu procházejí vždy automaticky)
    if (watchedTimetable.groupFilters.includes('celá') || watchedTimetable.groupFilters.includes('all')) {
        watchedTimetable.groupFilters = watchedTimetable.groupFilters
            .filter(g => g !== 'celá' && g !== 'all');
        console.log('   Migrated old "celá"/"all" filter to:', watchedTimetable.groupFilters);
    }

    // Pokud je groupFilters prázdný nebo obsahuje jen "all", načti všechny dostupné skupiny
    if (watchedTimetable.groupFilters.length === 0 ||
        (watchedTimetable.groupFilters.length === 1 && watchedTimetable.groupFilters[0] === 'all')) {
        // Načteme skupiny a vybereme všechny jako výchozí
        const availableGroups = await getAvailableGroups(watchedTimetable);
        if (availableGroups.length > 0) {
            watchedTimetable.groupFilters = [...availableGroups]; // Všechny skupiny vybrány
            console.log('   Initialized groupFilters with all available groups:', watchedTimetable.groupFilters);
        } else {
            watchedTimetable.groupFilters = []; // Žádné skupiny k dispozici
        }
    }

    // Load available groups
    const groups = await getAvailableGroups(watchedTimetable);
    console.log('   Got groups:', groups);

    // Group aggregation: combine related groups (e.g., 1.sk, 1.ak, TVk1 → "1.")
    const aggregatedGroups = aggregateGroups(groups);
    console.log('   Aggregated groups:', aggregatedGroups);

    // Render checkbox options
    optionsContainer.innerHTML = '';

    for (const [displayName, subGroups] of Object.entries(aggregatedGroups)) {
        try {
            const option = document.createElement('div');
            option.className = 'multiselect-option';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `group-${index}-${displayName}`;
            checkbox.value = displayName;

            // Check if ALL subgroups are selected
            const allSelected = subGroups.every(sg => watchedTimetable.groupFilters.includes(sg));
            checkbox.checked = allSelected;

            const span = document.createElement('span');
            // Show subgroups in tooltip
            if (subGroups.length > 1) {
                span.textContent = `${displayName} (${subGroups.join(', ')})`;
            } else {
                span.textContent = displayName;
            }

            option.appendChild(checkbox);
            option.appendChild(span);

            // Handle checkbox change - toggle all subgroups
            checkbox.addEventListener('change', async (e) => {
                e.stopPropagation();
                await handleAggregatedGroupChange(checkbox, watchedTimetable, subGroups);
            });

            // Toggle on click on the row (but not on checkbox itself)
            option.addEventListener('click', (e) => {
                if (e.target === checkbox) {
                    return; // Let the checkbox handle it
                }
                e.preventDefault();
                e.stopPropagation();
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change'));
            });

            optionsContainer.appendChild(option);
            console.log(`   Added option: value="${displayName}", subGroups=${subGroups.join(',')}, checked=${checkbox.checked}`);
        } catch (error) {
            console.error(`❌ Failed to render option for group "${displayName}":`, error);
        }
    }

    // Update label based on selection
    updateGroupFilterLabel(label, watchedTimetable.groupFilters);

    // Toggle dropdown on trigger click
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = menu.classList.contains('active');

        if (isActive) {
            closeGroupFilterDropdown(trigger, menu);
        } else {
            openGroupFilterDropdown(trigger, menu);
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!multiselectElement.contains(e.target)) {
            closeGroupFilterDropdown(trigger, menu);
        }
    });

    console.log('✅ populateGroupFilter finished');
}

/**
 * Aggregate groups by number (e.g., 1.sk, 1.ak, TVk1 → "1.")
 * @param {Array<string>} groups - Array of group names
 * @returns {Object} Map of display name to subgroups
 */
function aggregateGroups(groups) {
    const aggregated = {};

    groups.forEach(group => {
        // Extract number from group name
        // 1.sk, 1.ak → 1
        // TVk1 → 1
        // TVDi → TVDi (no number)

        const numMatch = group.match(/^(\d+)\./); // Match "1.sk", "2.ak"
        const tvMatch = group.match(/^TV[kK](\d+)$/); // Match "TVk1", "TVK2"

        if (numMatch) {
            // Standard group: 1.sk, 2.ak
            const num = numMatch[1];
            const displayName = `${num}.`;
            if (!aggregated[displayName]) {
                aggregated[displayName] = [];
            }
            aggregated[displayName].push(group);
        } else if (tvMatch) {
            // TV group with number: TVk1, TVk2
            const num = tvMatch[1];
            const displayName = `${num}.`;
            if (!aggregated[displayName]) {
                aggregated[displayName] = [];
            }
            aggregated[displayName].push(group);
        } else {
            // Special group without number: TVDi, TVCh, etc.
            // Show as-is
            aggregated[group] = [group];
        }
    });

    // Sort by display name (1., 2., TVDi, ...)
    const sorted = {};
    Object.keys(aggregated).sort((a, b) => {
        // Numbers first, then alphabetically
        const aNum = parseInt(a);
        const bNum = parseInt(b);
        if (!isNaN(aNum) && !isNaN(bNum)) {
            return aNum - bNum;
        }
        if (!isNaN(aNum)) return -1;
        if (!isNaN(bNum)) return 1;
        return a.localeCompare(b);
    }).forEach(key => {
        sorted[key] = aggregated[key].sort();
    });

    return sorted;
}

/**
 * Handle aggregated group checkbox change (toggles all subgroups)
 */
async function handleAggregatedGroupChange(checkbox, watchedTimetable, subGroups) {
    const isChecked = checkbox.checked;

    console.log(`🔄 Aggregated group toggled: subGroups=${subGroups.join(',')} = ${isChecked}`);

    if (isChecked) {
        // Add all subgroups
        subGroups.forEach(subGroup => {
            if (!watchedTimetable.groupFilters.includes(subGroup)) {
                watchedTimetable.groupFilters.push(subGroup);
            }
        });
    } else {
        // Remove all subgroups
        watchedTimetable.groupFilters = watchedTimetable.groupFilters.filter(g =>
            !subGroups.includes(g)
        );
    }

    // Update label
    const label = checkbox.closest('.multiselect-dropdown').querySelector('.multiselect-label');
    updateGroupFilterLabel(label, watchedTimetable.groupFilters);

    // Save to server
    try {
        await saveWatchedTimetables(state.watchedTimetables);
        console.log(`✅ Group filters saved successfully:`, watchedTimetable.groupFilters);
    } catch (error) {
        console.error('❌ Failed to save group filters:', error);
    }
}

/**
 * Handle group filter checkbox change
 */
async function handleGroupFilterChange(checkbox, watchedTimetable, allGroups) {
    const value = checkbox.value;
    const isChecked = checkbox.checked;

    console.log(`🔄 Group filter toggled: "${value}" = ${isChecked}`);

    // Handle group checkbox toggle (simple add/remove)
    if (isChecked) {
        // Add group if not already in array
        if (!watchedTimetable.groupFilters.includes(value)) {
            watchedTimetable.groupFilters.push(value);
        }
    } else {
        // Remove the group
        watchedTimetable.groupFilters = watchedTimetable.groupFilters.filter(g => g !== value);
    }

    // Note: Prázdný groupFilters array je OK - backend vždy propustí hodiny bez skupiny (celá třída)

    // Update label
    const label = checkbox.closest('.multiselect-dropdown').querySelector('.multiselect-label');
    updateGroupFilterLabel(label, watchedTimetable.groupFilters);

    // Save to server
    try {
        await saveWatchedTimetables(state.watchedTimetables);
        console.log(`✅ Group filters saved successfully:`, watchedTimetable.groupFilters);
    } catch (error) {
        console.error('❌ Failed to save group filters:', error);
    }
}

/**
 * Update the multiselect label based on selected groups
 * Shows aggregated group names (e.g., "1., 2." instead of "1.sk, 1.ak, TVk1, 2.sk, 2.ak, TVk2")
 */
function updateGroupFilterLabel(label, groupFilters) {
    if (!groupFilters || groupFilters.length === 0) {
        label.textContent = 'Žádná skupina vybrána';
        return;
    }

    // Group selected filters by number
    const aggregated = {};
    const standalone = [];

    groupFilters.forEach(group => {
        const numMatch = group.match(/^(\d+)\./);
        const tvMatch = group.match(/^TV[kK](\d+)$/);

        if (numMatch) {
            const num = numMatch[1];
            if (!aggregated[num]) aggregated[num] = [];
            aggregated[num].push(group);
        } else if (tvMatch) {
            const num = tvMatch[1];
            if (!aggregated[num]) aggregated[num] = [];
            aggregated[num].push(group);
        } else {
            standalone.push(group);
        }
    });

    // Build display text
    const parts = [];

    // Add numbered groups (1., 2., etc.)
    Object.keys(aggregated).sort((a, b) => parseInt(a) - parseInt(b)).forEach(num => {
        parts.push(`${num}.`);
    });

    // Add standalone groups (TVDi, etc.)
    standalone.forEach(group => parts.push(group));

    if (parts.length === 0) {
        label.textContent = 'Žádná skupina vybrána';
    } else if (parts.length <= 3) {
        label.textContent = parts.join(', ');
    } else {
        label.textContent = `${parts.length} skupiny vybrány`;
    }
}

/**
 * Open group filter dropdown (uses CSS positioning now)
 */
function openGroupFilterDropdown(trigger, menu) {
    trigger.classList.add('active');
    menu.classList.add('active');

    // Clear any inline styles that might override CSS
    menu.style.width = '';
    menu.style.left = '';
    menu.style.top = '';
    menu.style.bottom = '';
    menu.style.borderTopLeftRadius = '';
    menu.style.borderTopRightRadius = '';
    menu.style.borderBottomLeftRadius = '';
    menu.style.borderBottomRightRadius = '';
}

/**
 * Close group filter dropdown
 */
function closeGroupFilterDropdown(trigger, menu) {
    trigger.classList.remove('active');
    menu.classList.remove('active');
}
