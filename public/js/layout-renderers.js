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

    const currentCardIndex = state.layoutPreferences['card-view'].cardIndex || 0;

    let html = `<div class="card-view-wrapper" style="transform: translateX(-${currentCardIndex * 100}%)">`;

    dayLessons.forEach((lesson, index) => {
        const timeInfo = lessonTimes.find(t => t.hour === lesson.hour);
        const timeLabel = timeInfo ? timeInfo.label : '';

        const isRemoved = lesson.type === 'removed' || lesson.type === 'absent';
        const isChanged = lesson.changed;

        html += `
            <div class="lesson-card-full" data-card-index="${index}" data-lesson-id="${lesson.day}-${lesson.hour}">
                <div class="lesson-time">${lesson.hour}. hodina - ${timeLabel}</div>
                <div class="lesson-subject ${isRemoved ? 'removed' : ''}">${lesson.subject}</div>
                <div class="lesson-details">
                    ${lesson.teacher ? `<div><strong>Učitel:</strong> ${lesson.teacher}</div>` : ''}
                    ${lesson.room ? `<div><strong>Místnost:</strong> ${lesson.room}</div>` : ''}
                    ${lesson.group ? `<div><strong>Skupina:</strong> ${lesson.group}</div>` : ''}
                </div>
                ${isChanged ? '<div class="card-badge changed">⚠️ Změna v rozvrhu</div>' : ''}
                ${isRemoved ? '<div class="card-badge removed">🚫 Hodina zrušena</div>' : ''}
            </div>
        `;
    });

    html += '</div>';

    // Add navigation dots
    html += '<div class="card-view-dots">';
    dayLessons.forEach((_, index) => {
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
            <button class="card-view-nav-btn" id="cardNextBtn" ${currentCardIndex === dayLessons.length - 1 ? 'disabled' : ''}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        </div>
    `;

    container.innerHTML = html;

    // Add event listeners
    initCardViewNavigation(dayLessons.length);
    initCardViewSwipe(container, dayLessons.length);
    addCardClickListeners(dayLessons);
}

/**
 * Initialize card view navigation buttons and dots
 */
function initCardViewNavigation(totalCards) {
    const prevBtn = document.getElementById('cardPrevBtn');
    const nextBtn = document.getElementById('cardNextBtn');
    const dots = document.querySelectorAll('.card-view-dot');

    if (prevBtn) {
        prevBtn.addEventListener('click', () => navigateCard(-1, totalCards));
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => navigateCard(1, totalCards));
    }

    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => navigateToCard(index, totalCards));
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
function initCardViewSwipe(container, totalCards) {
    let startX = 0;
    let currentX = 0;
    let isDragging = false;

    container.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        isDragging = true;
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        currentX = e.touches[0].clientX;
    }, { passive: true });

    container.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;

        const diff = startX - currentX;
        const threshold = 50;

        if (Math.abs(diff) > threshold) {
            if (diff > 0) {
                // Swipe left - next card
                navigateCard(1, totalCards);
            } else {
                // Swipe right - previous card
                navigateCard(-1, totalCards);
            }
        }
    }, { passive: true });
}

/**
 * Add click listeners to cards to open modal
 */
function addCardClickListeners(dayLessons) {
    document.querySelectorAll('.lesson-card-full').forEach((card, index) => {
        card.addEventListener('click', () => {
            showLessonModal(dayLessons[index]);
        });
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
