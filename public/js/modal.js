import { dom } from './dom.js';
import { days, lessonTimes } from './constants.js';
import { state, updateState } from './state.js';
import { loadTimetable, populateValueSelect } from './timetable.js';
import { parseChangeInfo, getChangeIcon, getChangeTypeInfo } from './utils.js';
import { setDropdownValue } from './dropdown.js';
import { openBottomSheet, closeBottomSheet } from './bottom-sheet.js';

// Modal functions
export function showLessonModal(lesson) {
    if (!dom.lessonModal) {
        console.error('Modal not initialized!');
        return;
    }

    // Set subject name (full name, not abbreviated)
    document.getElementById('modalSubject').textContent = lesson.subject || 'Neznámá hodina';

    // Set teacher (full name) with clickable link
    const teacherEl = document.getElementById('modalTeacher');
    const teacherContainer = teacherEl.parentElement;

    // Hide teacher row completely when viewing a teacher's timetable
    if (state.selectedType === 'Teacher') {
        teacherContainer.style.display = 'none';
    } else {
        teacherContainer.style.display = 'flex';

        if (lesson.teacher) {
            teacherEl.innerHTML = `<a href="#" class="modal-link" data-type="Teacher" data-name="${lesson.teacher}">${lesson.teacher}</a>`;
        } else {
            teacherEl.textContent = 'Není zadáno';
        }
    }


    // Set room (with clickable link if room exists)
    const roomEl = document.getElementById('modalRoom');
    if (lesson.room && state.selectedType !== 'Room') {
        roomEl.innerHTML = `<a href="#" class="modal-link" data-type="Room" data-name="${lesson.room}">${lesson.room}</a>`;
    } else {
        roomEl.textContent = lesson.room || 'Není zadáno';
    }

    // Set hour with time range
    const timeInfo = lessonTimes.find(t => t.hour === lesson.hour);
    const hourText = timeInfo ? `${lesson.hour}. hodina (${timeInfo.label})` : `${lesson.hour}. hodina`;
    document.getElementById('modalHour').textContent = hourText;

    // Set group (if exists) and extract class name for link
    const modalGroupContainer = document.getElementById('modalGroupContainer');
    if (lesson.group) {
        // Parse group to get class name
        const groupMatch = lesson.group.match(/^([^\s]+)\s+/);
        const className = groupMatch ? groupMatch[1] : null;

        if (className && state.selectedType === 'Class') {
            // If viewing a class, just show group name
            document.getElementById('modalGroup').textContent = lesson.group;
        } else if (className) {
            // If viewing teacher/room, make class name clickable
            const groupEl = document.getElementById('modalGroup');
            groupEl.innerHTML = `<a href="#" class="modal-link" data-type="Class" data-name="${className}">${lesson.group}</a>`;
        } else {
            document.getElementById('modalGroup').textContent = lesson.group;
        }
        modalGroupContainer.style.display = 'flex';
    } else {
        modalGroupContainer.style.display = 'none';
    }

    // Set theme (if exists)
    const modalThemeContainer = document.getElementById('modalThemeContainer');
    if (lesson.theme) {
        document.getElementById('modalTheme').textContent = lesson.theme;
        modalThemeContainer.style.display = 'flex';
    } else {
        modalThemeContainer.style.display = 'none';
    }

    // Set changes (if exists)
    const modalChanges = document.getElementById('modalChanges');
    const modalChangesContent = document.getElementById('modalChangesContent');
    const modalChangesIcon = document.getElementById('modalChangesIcon');
    const modalChangesHeader = document.getElementById('modalChangesHeader');

    if (lesson.changed && lesson.changeInfo) {
        modalChanges.classList.remove('hidden');

        // Parse change info for better understanding
        const parsed = parseChangeInfo(lesson.changeInfo.description);

        // Determine change type and get appropriate icon
        const typeInfo = getChangeTypeInfo(parsed?.type, lesson.changeInfo.description);
        const iconSvg = getChangeIcon(typeInfo.icon);

        // Set icon
        modalChangesIcon.innerHTML = iconSvg;

        // Set header
        modalChangesHeader.textContent = typeInfo.header;

        // Remove all type-* classes first
        modalChanges.className = 'modal-changes';

        // Add appropriate type class
        modalChanges.classList.add(`type-${typeInfo.type}`);

        // Set content
        if (parsed && parsed.formatted) {
            modalChangesContent.innerHTML = parsed.formatted;
        } else {
            modalChangesContent.innerHTML = '<div class="change-detail"><span class="change-value">Tato hodina byla změněna oproti stálému rozvrhu.</span></div>';
        }
    } else if (lesson.changed) {
        modalChanges.classList.remove('hidden');

        // Default generic change
        const typeInfo = getChangeTypeInfo(null, null);
        const iconSvg = getChangeIcon(typeInfo.icon);

        modalChangesIcon.innerHTML = iconSvg;
        modalChangesHeader.textContent = typeInfo.header;
        modalChanges.className = 'modal-changes';
        modalChanges.classList.add(`type-${typeInfo.type}`);
        modalChangesContent.innerHTML = '<div class="change-detail"><span class="change-value">Tato hodina byla změněna oproti stálému rozvrhu.</span></div>';
    } else {
        modalChanges.classList.add('hidden');
    }

    // Open as bottom sheet
    openBottomSheet('lessonModal');

    // Add click listeners to modal links
    setupModalLinks();
}

export function closeLessonModal() {
    closeBottomSheet('lessonModal');
}

// Helper function to normalize teacher names for matching
function normalizeTeacherName(name) {
    if (!name) return '';

    // Remove titles
    let normalized = name.replace(/^(Mgr\.|Ing\.|Bc\.|Dr\.|Ph\.D\.|RNDr\.|PaedDr\.)\s*/gi, '')
        .replace(/,?\s*(Ph\.D\.|CSc\.)$/gi, '')
        .trim();

    // Split into parts and sort alphabetically to handle different orders
    const parts = normalized.split(/\s+/).filter(p => p.length > 0);
    return parts.sort().join(' ').toLowerCase();
}

// Setup click listeners for modal links (teacher, room, class)
function setupModalLinks() {
    const links = dom.lessonModal.querySelectorAll('.modal-link');
    links.forEach(link => {
        link.addEventListener('click', async (e) => {
            e.preventDefault();
            const type = link.dataset.type;
            const name = link.dataset.name;

            // Close modal
            closeLessonModal();

            // Find the ID for this teacher/room/class
            const definitions = state.definitions;
            let targetId = null;

            if (type === 'Teacher') {
                // Normalize the search name
                const normalizedSearchName = normalizeTeacherName(name);

                // Try exact match first
                let teacher = definitions.teachers?.find(t => t.name === name);

                // If no exact match, try normalized name matching
                if (!teacher) {
                    teacher = definitions.teachers?.find(t => {
                        const normalizedDefName = normalizeTeacherName(t.name);
                        return normalizedDefName === normalizedSearchName;
                    });
                }

                // If still no match, try matching with initials
                if (!teacher) {
                    const searchParts = normalizedSearchName.split(/\s+/);
                    teacher = definitions.teachers?.find(t => {
                        const defParts = normalizeTeacherName(t.name).split(/\s+/);

                        // Check if parts match (handling initials like "r." matching "radek")
                        if (searchParts.length !== defParts.length) return false;

                        return searchParts.every((searchPart, i) => {
                            const defPart = defParts[i];
                            // Remove dots for comparison
                            const cleanSearch = searchPart.replace(/\./g, '');
                            const cleanDef = defPart.replace(/\./g, '');

                            // If search is shorter (likely initial), check if def starts with it
                            if (cleanSearch.length < cleanDef.length) {
                                return cleanDef.startsWith(cleanSearch);
                            }
                            // If def is shorter (likely initial), check if search starts with it
                            if (cleanDef.length < cleanSearch.length) {
                                return cleanSearch.startsWith(cleanDef);
                            }
                            // Otherwise must be exact match
                            return cleanSearch === cleanDef;
                        });
                    });
                }

                // If still no match, try to find by ID
                if (!teacher) {
                    teacher = definitions.teachers?.find(t => t.id === name);
                }

                // Last resort: partial matching
                if (!teacher) {
                    teacher = definitions.teachers?.find(t =>
                        t.name.includes(name) || name.includes(t.name) || t.id.includes(name)
                    );
                }

                targetId = teacher?.id;
                console.log('Teacher lookup:', {
                    name,
                    normalizedSearchName,
                    teacher,
                    targetId,
                    sampleTeachers: definitions.teachers?.slice(0, 3).map(t => ({
                        ...t,
                        normalized: normalizeTeacherName(t.name)
                    }))
                });
            } else if (type === 'Room') {
                const room = definitions.rooms?.find(r => r.name === name);
                targetId = room?.id;
            } else if (type === 'Class') {
                const cls = definitions.classes?.find(c => c.name === name);
                targetId = cls?.id;
            }


            if (targetId) {
                // Update state
                updateState('selectedType', type);

                // Update UI buttons
                const typeButtons = document.querySelectorAll('.type-btn');
                typeButtons.forEach(btn => {
                    if (btn.dataset.type === type) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });

                // Populate and select
                populateValueSelect();
                setDropdownValue(targetId);

                // Load timetable
                await loadTimetable();
            } else {
                console.error(`Failed to find ${type} with name: "${name}"`);
                console.error('Available options:', type === 'Teacher' ? definitions.teachers :
                    type === 'Room' ? definitions.rooms : definitions.classes);

                // Show user-friendly error
                alert(`Nepodařilo se najít rozvrh pro ${type === 'Teacher' ? 'učitele' : type === 'Room' ? 'učebnu' : 'třídu'}: "${name}"\n\nKlikněte na tlačítko Console (F12) pro více informací.`);
            }
        });
    });
}

// Initialize modal event listeners
export function initModalListeners() {
    if (!dom.lessonModal || !dom.modalClose) {
        console.error('Modal elements not found during initialization');
        return;
    }

    // Close button
    dom.modalClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeLessonModal();
    });

    // Overlay click + Escape key are handled by bottom-sheet.js

    console.log('Modal listeners initialized successfully');
}
