/**
 * Layout Renderers
 * Rendering functions for each timetable layout
 */

import { state } from './state.js';
import { dom } from './dom.js';
import { days, lessonTimes } from './constants.js';
import { showLessonModal } from './modal.js';
import { updateLayoutPreference } from './layout-manager.js';
import { renderTimetable } from './timetable.js';

// AbortControllers for cleanup of event listeners
let swipeController = null;
let navigationController = null;

/**
 * Render Single Day Layout (original behavior)
 * Shows only the selected day's lessons in table format
 */
export async function renderSingleDayLayout() {
    let rows = document.querySelectorAll('.timetable-row');

    // If no rows exist, regenerate the timetable
    if (rows.length === 0) {
        // Card/compact layouts destroy #timetable element, need to recreate it
        const container = document.querySelector('.timetable-container');
        container.innerHTML = '<div class="timetable-grid" id="timetable"></div>';

        // Update dom reference to new element
        dom.timetableGrid = document.getElementById('timetable');

        // Regenerovat tabulku
        renderTimetable(state.currentTimetableData);

        // Query again after regeneration
        rows = document.querySelectorAll('.timetable-row');
    }

    rows.forEach((row, index) => {
        if (index === state.selectedDayIndex) {
            row.classList.add('active');
        } else {
            row.classList.remove('active');
        }
    });
}

/**
 * Render Week View Layout (show all days)
 * Shows all 5 working days in table format
 */
export async function renderWeekLayout() {
    let rows = document.querySelectorAll('.timetable-row');

    // If no rows exist, regenerate the timetable
    if (rows.length === 0) {
        // Card/compact layouts destroy #timetable element, need to recreate it
        const container = document.querySelector('.timetable-container');
        container.innerHTML = '<div class="timetable-grid" id="timetable"></div>';

        // Update dom reference to new element
        dom.timetableGrid = document.getElementById('timetable');

        // Regenerovat tabulku
        renderTimetable(state.currentTimetableData);

        // Query again after regeneration
        rows = document.querySelectorAll('.timetable-row');
    }

    rows.forEach(row => row.classList.add('active'));
}

/**
 * Render single lesson content
 */
function renderSingleLesson(lesson) {
    const isRemoved = lesson.type === 'removed' || lesson.type === 'absent';
    const isChanged = lesson.changed;

    return `
        <div class="card-lessons-split">
            <div class="card-lesson-half ${isRemoved ? 'lesson-removed' : ''}">
                ${lesson.group ? `<div class="lesson-group-badge">${lesson.group}</div>` : ''}

                <div class="lesson-subject-name">${lesson.subject}</div>

                <!-- Details with SVG Icons -->
                <div class="card-details">
                    ${lesson.teacher ? `
                        <div class="card-detail-item">
                            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                <circle cx="12" cy="7" r="4"/>
                            </svg>
                            <span>${lesson.teacher}</span>
                        </div>
                    ` : ''}
                    ${lesson.room ? `
                        <div class="card-detail-item">
                            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <circle cx="10" cy="13" r="2"/>
                                <path d="M10 17v-2"/>
                            </svg>
                            <span>${lesson.room}</span>
                        </div>
                    ` : ''}
                </div>

                <!-- Status Badges -->
                ${isChanged || isRemoved ? `
                    <div class="card-badges">
                        ${isChanged ? `
                            <div class="card-badge changed">
                                <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                                <span>Změna v rozvrhu</span>
                            </div>
                        ` : ''}
                        ${isRemoved ? `
                            <div class="card-badge removed">
                                <svg class="badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="15" y1="9" x2="9" y2="15"/>
                                    <line x1="9" y1="9" x2="15" y2="15"/>
                                </svg>
                                <span>Hodina zrušena</span>
                            </div>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * Render split lessons (multiple groups in same time slot)
 */
function renderSplitLessons(lessons) {
    let html = '<div class="card-lessons-split">';

    lessons.forEach(lesson => {
        const isRemoved = lesson.type === 'removed' || lesson.type === 'absent';

        html += `
            <div class="card-lesson-half ${isRemoved ? 'lesson-removed' : ''}">
                ${lesson.group ? `<div class="lesson-group-badge">${lesson.group}</div>` : ''}
                <div class="lesson-subject-name">${lesson.subject}</div>

                <div class="card-details">
                    ${lesson.teacher ? `
                        <div class="card-detail-item">
                            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                <circle cx="12" cy="7" r="4"/>
                            </svg>
                            <span>${lesson.teacher}</span>
                        </div>
                    ` : ''}
                    ${lesson.room ? `
                        <div class="card-detail-item">
                            <svg class="detail-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                <polyline points="14 2 14 8 20 8"/>
                                <circle cx="10" cy="13" r="2"/>
                                <path d="M10 17v-2"/>
                            </svg>
                            <span>${lesson.room}</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    });

    html += '</div>';
    return html;
}

/**
 * Render Card View Layout (swipeable cards)
 * Shows lessons as swipeable cards
 */
export function renderCardLayout() {
    const container = document.querySelector('.timetable-container');
    if (!container) return;

    const data = state.currentTimetableData;
    const selectedDay = state.selectedDayIndex;

    // Get all lessons for selected day, sorted by hour
    const dayLessons = data
        .filter(lesson => lesson.day === selectedDay)
        .sort((a, b) => a.hour - b.hour);

    if (dayLessons.length === 0) {
        container.innerHTML = `
            <div class="card-view-wrapper">
                <div class="lesson-card-full">
                    <div style="text-align: center; padding: 40px; color: var(--text-dim);">
                        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto;">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="16" y1="2" x2="16" y2="6"></line>
                            <line x1="8" y1="2" x2="8" y2="6"></line>
                            <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                        <p style="margin-top: 16px; font-size: 1.2rem;">Žádná výuka</p>
                    </div>
                </div>
            </div>
        `;
        return;
    }

    // Group lessons by hour (for handling multiple groups in same time slot)
    const lessonsByHour = {};
    dayLessons.forEach(lesson => {
        if (!lessonsByHour[lesson.hour]) {
            lessonsByHour[lesson.hour] = [];
        }
        lessonsByHour[lesson.hour].push(lesson);
    });

    const hours = Object.keys(lessonsByHour).sort((a, b) => parseInt(a) - parseInt(b));

    // Validate cardIndex against actual card count
    const rawCardIndex = state.layoutPreferences['card-view'].cardIndex || 0;
    const maxCardIndex = Math.max(0, hours.length - 1);
    const currentCardIndex = Math.max(0, Math.min(rawCardIndex, maxCardIndex));

    // Reset cardIndex in state if it was clamped
    if (rawCardIndex !== currentCardIndex) {
        updateLayoutPreference('card-view', { cardIndex: currentCardIndex });
    }

    let html = `<div class="card-view-wrapper" style="transform: translateX(-${currentCardIndex * 100}%)">`;

    hours.forEach((hour, cardIndex) => {
        const lessons = lessonsByHour[hour];
        const timeInfo = lessonTimes.find(t => t.hour === parseInt(hour));
        const timeLabel = timeInfo ? timeInfo.label : '';

        // Check if any lesson has change/removed status
        const hasChanged = lessons.some(l => l.changed);
        const hasRemoved = lessons.some(l => l.type === 'removed' || l.type === 'absent');

        html += `
            <div class="lesson-card-full" data-card-index="${cardIndex}" data-lesson-id="${lessons[0].day}-${hour}">
                <!-- Header: Hour + Time -->
                <div class="card-header-row">
                    <div class="card-subject">${hour}. hodina</div>
                    <div class="card-time-meta">
                        ${timeLabel}
                        ${hasRemoved || hasChanged ? `<span class="card-status-dot ${hasRemoved ? 'removed' : 'changed'}"></span>` : ''}
                    </div>
                </div>

                <!-- Lessons (split if multiple groups) -->
                ${lessons.length === 1 ? renderSingleLesson(lessons[0]) : renderSplitLessons(lessons)}
            </div>
        `;
    });

    html += '</div>';

    // Add navigation dots
    html += '<div class="card-view-dots">';
    hours.forEach((_, index) => {
        html += `<div class="card-view-dot ${index === currentCardIndex ? 'active' : ''}" data-dot-index="${index}"></div>`;
    });
    html += '</div>';

    // Add navigation buttons
    html += `
        <div class="card-view-navigation">
            <button class="card-view-nav-btn" id="cardPrevBtn" ${currentCardIndex === 0 ? 'disabled' : ''}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
            <button class="card-view-nav-btn" id="cardNextBtn" ${currentCardIndex >= hours.length - 1 ? 'disabled' : ''}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        </div>
    `;

    container.innerHTML = html;

    // Add event listeners
    initCardViewNavigation(hours.length);
    initCardViewSwipe(hours.length);
    addCardClickListeners(lessonsByHour);
}

/**
 * Initialize card view navigation buttons and dots
 */
function initCardViewNavigation(totalCards) {
    // Abort previous navigation listeners if they exist
    if (navigationController) {
        navigationController.abort();
    }

    // Create new AbortController
    navigationController = new AbortController();
    const signal = navigationController.signal;

    const prevBtn = document.getElementById('cardPrevBtn');
    const nextBtn = document.getElementById('cardNextBtn');
    const dots = document.querySelectorAll('.card-view-dot');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => navigateCard(-1, totalCards), { signal });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => navigateCard(1, totalCards), { signal });
    }

    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => navigateToCard(index, totalCards), { signal });
    });
}

/**
 * Navigate to next/previous card
 */
function navigateCard(direction, totalCards) {
    const currentIndex = state.layoutPreferences['card-view'].cardIndex || 0;
    const newIndex = Math.max(0, Math.min(totalCards - 1, currentIndex + direction));
    navigateToCard(newIndex, totalCards);
}

/**
 * Navigate to specific card by index
 */
function navigateToCard(index, totalCards) {
    // Update state
    updateLayoutPreference('card-view', { cardIndex: index });

    // Update wrapper transform
    const wrapper = document.querySelector('.card-view-wrapper');
    if (wrapper) {
        wrapper.style.transform = `translateX(-${index * 100}%)`;
    }

    // Update dots
    document.querySelectorAll('.card-view-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
    });

    // Update buttons
    const prevBtn = document.getElementById('cardPrevBtn');
    const nextBtn = document.getElementById('cardNextBtn');

    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === totalCards - 1;
}

/**
 * Initialize card view swipe gestures
 */
function initCardViewSwipe(totalCards) {
    const container = document.querySelector('.timetable-container.card-view-mode');
    if (!container) return;

    // Abort previous swipe listeners if they exist
    if (swipeController) {
        swipeController.abort();
    }

    // Create new AbortController
    swipeController = new AbortController();
    const signal = swipeController.signal;

    let startX = 0;
    let startY = 0;
    let isDragging = false;

    container.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isDragging = true;
    }, { passive: true, signal });

    container.addEventListener('touchmove', (e) => {
        if (!isDragging) return;

        // Prevent vertical scroll while swiping horizontally
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const diffX = Math.abs(currentX - startX);
        const diffY = Math.abs(currentY - startY);

        if (diffX > diffY) {
            e.preventDefault();
        }
    }, { passive: false, signal });

    container.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;

        const endX = e.changedTouches[0].clientX;
        const diff = startX - endX;
        const threshold = 30; // Lower threshold for easier swiping

        if (Math.abs(diff) > threshold) {
            const currentIndex = state.layoutPreferences['card-view'].cardIndex || 0;

            if (diff > 0 && currentIndex < totalCards - 1) {
                // Swipe left - next card
                navigateToCard(currentIndex + 1, totalCards);
            } else if (diff < 0 && currentIndex > 0) {
                // Swipe right - previous card
                navigateToCard(currentIndex - 1, totalCards);
            }
        }
    }, { passive: true, signal });
}

/**
 * Add click listeners to cards to open modal
 */
function addCardClickListeners(lessonsByHour) {
    document.querySelectorAll('.lesson-card-full').forEach((card) => {
        // For single lesson cards
        const singleLesson = card.querySelector('.card-lesson-single');
        if (singleLesson) {
            card.addEventListener('click', () => {
                const lessonId = card.dataset.lessonId;
                const [day, hour] = lessonId.split('-');
                const lessons = lessonsByHour[hour];
                if (lessons && lessons[0]) {
                    showLessonModal(lessons[0]);
                }
            });
        }

        // For split lesson cards - click on individual halves
        const lessonHalves = card.querySelectorAll('.card-lesson-half');
        if (lessonHalves.length > 0) {
            const lessonId = card.dataset.lessonId;
            const [day, hour] = lessonId.split('-');
            const lessons = lessonsByHour[hour];

            lessonHalves.forEach((half, index) => {
                half.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent card click
                    if (lessons && lessons[index]) {
                        showLessonModal(lessons[index]);
                    }
                });
            });
        }
    });
}

/**
 * Render Compact List Layout
 * Shows lessons as a vertical list
 */
export function renderCompactListLayout() {
    const container = document.querySelector('.timetable-container');
    if (!container) return;

    const data = state.currentTimetableData;
    const selectedDay = state.selectedDayIndex;

    // Get all lessons for selected day, sorted by hour
    const dayLessons = data
        .filter(lesson => lesson.day === selectedDay)
        .sort((a, b) => a.hour - b.hour);

    if (dayLessons.length === 0) {
        container.innerHTML = `
            <div class="compact-list-wrapper">
                <div class="compact-empty-day">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto;">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    <p style="margin-top: 12px;">Žádná výuka</p>
                </div>
            </div>
        `;
        return;
    }

    // Get day name
    const dayName = days[selectedDay];

    // Start HTML
    let html = '<div class="compact-list-wrapper">';
    html += `
        <div class="compact-day-header">
            <span>${dayName}</span>
        </div>
    `;

    // Add lessons
    dayLessons.forEach(lesson => {
        const timeInfo = lessonTimes.find(t => t.hour === lesson.hour);
        const timeLabel = timeInfo ? timeInfo.label : '';

        const isRemoved = lesson.type === 'removed' || lesson.type === 'absent';
        const isChanged = lesson.changed;

        let itemClasses = 'compact-lesson-item';
        if (isRemoved) itemClasses += ' removed';
        if (isChanged) itemClasses += ' changed';

        html += `
            <div class="${itemClasses}" data-lesson-id="${lesson.day}-${lesson.hour}">
                <div class="compact-lesson-badge">${lesson.hour}</div>
                <div class="compact-lesson-time">
                    <div style="font-size: 0.9rem;">${lesson.hour}.</div>
                    <div class="compact-lesson-time-label">${timeLabel}</div>
                </div>
                <div class="compact-lesson-content">
                    <div class="compact-lesson-subject">${lesson.subject}</div>
                    <div class="compact-lesson-details">
                        ${lesson.teacher ? `<span>${lesson.teacher}</span>` : ''}
                        ${lesson.room ? `<span>📍 ${lesson.room}</span>` : ''}
                        ${lesson.group ? `<span>👥 ${lesson.group}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';

    container.innerHTML = html;

    // Add click listeners to open modal
    document.querySelectorAll('.compact-lesson-item').forEach((item, index) => {
        item.addEventListener('click', () => {
            showLessonModal(dayLessons[index]);
        });
    });

    // Restore scroll position
    const savedScrollPosition = state.layoutPreferences['compact-list'].scrollPosition || 0;
    container.scrollTop = savedScrollPosition;

    // Save scroll position on scroll
    let scrollTimeout;
    container.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            updateLayoutPreference('compact-list', { scrollPosition: container.scrollTop });
        }, 100);
    });
}
