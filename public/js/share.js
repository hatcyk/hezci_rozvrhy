/**
 * "Sdílet": the system share sheet (Web Share API) where it exists, otherwise
 * copy the link and say so in a toast. Must be called from a click handler:
 * both navigator.share() and clipboard.writeText() need a user gesture
 * (transient activation) and are rejected without one.
 */

import { showToast } from './toast.js';

/**
 * @param {{ title: string, text?: string, url: string }} data - url may be relative
 * @returns {Promise<'shared'|'aborted'|'copied'|'failed'>}
 */
export async function shareLink({ title, text = '', url }) {
    const absolute = new URL(url, location.origin).href;
    const data = { title, text, url: absolute };

    if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
        try {
            await navigator.share(data);
            return 'shared';
        } catch (err) {
            // The user closed the share sheet: nothing to do, no fallback toast
            if (err && err.name === 'AbortError') return 'aborted';
            // NotAllowedError / unsupported data: fall back to the clipboard
        }
    }

    try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
        await navigator.clipboard.writeText(absolute);
        showToast({ title: 'Odkaz zkopírován do schránky', body: absolute, icon: '🔗', variant: 'info', timeout: 4000 });
        return 'copied';
    } catch {
        // Last resort: show the link so it can be copied by hand
        showToast({ title: 'Odkaz se nepodařilo zkopírovat – zkopírujte ho ručně:', body: absolute, icon: '🔗', variant: 'info', timeout: 0 });
        return 'failed';
    }
}
