/**
 * Admin API client. The secret lives only in sessionStorage: it is gone when
 * the tab closes and other tabs / sites cannot read it. It is sent only as
 * the Authorization header to our own /api/admin/* (same origin).
 */

const KEY = 'adminSecret';

export function getSecret() {
    try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function setSecret(value) {
    try { sessionStorage.setItem(KEY, value); } catch { /* storage blocked: kept for this page only */ }
    memorySecret = value;
}

export function clearSecret() {
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    memorySecret = '';
}

let memorySecret = '';

export class AdminApiError extends Error {
    constructor(status, body) {
        super((body && body.error) || `HTTP ${status}`);
        this.status = status;
        this.body = body || {};
    }
}

async function request(method, path) {
    const secret = getSecret() || memorySecret;
    const res = await fetch(`/api/admin${path}`, {
        method,
        headers: { Authorization: `Bearer ${secret}` },
        cache: 'no-store',
        credentials: 'omit',
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    // 2xx, and the dispatch answers 429/502/503 that carry a result to show
    if (res.ok) return body;
    throw new AdminApiError(res.status, body);
}

export const apiGet = (path) => request('GET', path);
export const apiPost = (path) => request('POST', path);
