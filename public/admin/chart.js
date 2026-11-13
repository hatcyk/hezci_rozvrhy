/**
 * Interval chart: one point per prefetch run, x = when it started, y = the
 * gap since the previous run (minutes). Plain SVG, no library.
 * chartModel() is pure (tested in Node); renderChart() draws it.
 */

import { formatDateTime, formatDay, formatMinutes, TRIGGER_LABELS } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {Array<{startedAt: string, trigger?: string, status?: string}>} runs - ascending
 * @param {{ since: string, now: string, width?: number, height?: number }} range
 */
export function chartModel(runs, { since, now, width = 720, height = 260 }) {
    const pad = { left: 52, right: 16, top: 16, bottom: 40 };
    const x0 = Date.parse(since);
    const x1 = Date.parse(now);
    const points = [];
    for (let i = 1; i < runs.length; i++) {
        const t = Date.parse(runs[i].startedAt);
        const prev = Date.parse(runs[i - 1].startedAt);
        if (!Number.isFinite(t) || !Number.isFinite(prev)) continue;
        points.push({ t, gap: (t - prev) / 60000, run: runs[i] });
    }
    // Linear scale capped so one long night gap does not flatten the rest;
    // capped points are drawn at the top as triangles with their real value.
    const sorted = points.map(p => p.gap).sort((a, b) => a - b);
    const p90 = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.9)] : 60;
    const yMax = Math.min(240, Math.max(60, Math.ceil((p90 * 1.3) / 15) * 15));
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const sx = (t) => pad.left + ((t - x0) / Math.max(1, x1 - x0)) * plotW;
    const sy = (m) => pad.top + plotH - (Math.min(m, yMax) / yMax) * plotH;

    const yTicks = [0, 15, 30, 60, 120, 180, 240].filter(v => v <= yMax);
    const xTicks = [];
    const firstDay = new Date(x0);
    firstDay.setUTCHours(23, 0, 0, 0); // ~midnight in Prague (CET) - only a tick position
    let firstTick = firstDay.getTime();
    if (firstTick <= x0) firstTick += 86400000;
    for (let t = firstTick; t < x1; t += 86400000) xTicks.push({ x: sx(t), label: formatDay(new Date(t + 3600000).toISOString()) });

    return {
        width, height, pad, yMax,
        yTicks: yTicks.map(v => ({ y: sy(v), label: `${v}` })),
        xTicks,
        points: points.map(p => ({
            x: sx(p.t),
            y: sy(p.gap),
            capped: p.gap > yMax,
            kind: p.run.status && p.run.status !== 'ok' ? 'failed' : (p.run.trigger === 'schedule' ? 'schedule' : 'other'),
            title: `${formatDateTime(p.run.startedAt)} – rozestup ${formatMinutes(p.gap)}, ${TRIGGER_LABELS[p.run.trigger] || p.run.trigger || '?'}` +
                (p.run.status && p.run.status !== 'ok' ? `, stav ${p.run.status}` : ''),
        })),
        refLines: [15, 60].filter(v => v <= yMax).map(v => ({ y: sy(v), label: `${v} min` })),
    };
}

function svg(tag, attrs = {}, text = null) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text !== null) node.textContent = text;
    return node;
}

/** Draw the model into `container` (replaces its content). */
export function renderChart(container, model, { title, description }) {
    const root = svg('svg', {
        viewBox: `0 0 ${model.width} ${model.height}`,
        role: 'img',
        'aria-labelledby': 'chartTitle chartDesc',
        class: 'interval-chart',
    });
    root.append(svg('title', { id: 'chartTitle' }, title), svg('desc', { id: 'chartDesc' }, description));

    const { pad, width, height } = model;
    const axis = svg('g', { class: 'chart-axis', 'aria-hidden': 'true' });
    for (const tick of model.yTicks) {
        axis.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: tick.y, y2: tick.y, class: 'chart-grid' }));
        axis.append(svg('text', { x: pad.left - 8, y: tick.y + 4, 'text-anchor': 'end' }, tick.label));
    }
    for (const tick of model.xTicks) {
        axis.append(svg('line', { x1: tick.x, x2: tick.x, y1: pad.top, y2: height - pad.bottom, class: 'chart-grid' }));
        axis.append(svg('text', { x: tick.x + 4, y: height - pad.bottom + 16 }, tick.label));
    }
    axis.append(svg('text', { x: 4, y: pad.top - 4 }, 'min'));
    for (const ref of model.refLines) {
        axis.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: ref.y, y2: ref.y, class: 'chart-ref' }));
    }
    root.append(axis);

    const dots = svg('g', { class: 'chart-points' });
    for (const p of model.points) {
        // Shape as well as colour tells the kinds apart.
        let mark;
        if (p.capped) {
            mark = svg('path', { d: `M${p.x - 5},${p.y + 6} L${p.x + 5},${p.y + 6} L${p.x},${p.y - 3} Z`, class: `pt pt-${p.kind}` });
        } else if (p.kind === 'failed') {
            mark = svg('path', { d: `M${p.x - 4},${p.y - 4} L${p.x + 4},${p.y + 4} M${p.x + 4},${p.y - 4} L${p.x - 4},${p.y + 4}`, class: 'pt pt-failed' });
        } else if (p.kind === 'schedule') {
            mark = svg('circle', { cx: p.x, cy: p.y, r: 3.5, class: 'pt pt-schedule' });
        } else {
            mark = svg('rect', { x: p.x - 3.5, y: p.y - 3.5, width: 7, height: 7, class: 'pt pt-other' });
        }
        mark.append(svg('title', {}, p.title));
        dots.append(mark);
    }
    root.append(dots);
    container.replaceChildren(root);
}
