/**
 * Error for a failed answer of the app's own API, with a message for people.
 *
 * 429 (limits in routes/auth.js and routes/fcm.js): the server answers
 * { error, retryAfterSec } with a Czech `error`; it is shown together with
 * roughly when another try will work. Other failures get the Czech `fallback`
 * of the caller: the server's other messages are English internals.
 *
 * @param {Response} response  a response with !response.ok
 * @param {string} fallback    Czech message for everything but 429
 * @returns {Promise<Error & { status: number, retryAfterSec?: number }>}
 */
export async function apiError(response, fallback) {
    let message = fallback;
    let retryAfterSec;
    if (response.status === 429) {
        let body = null;
        try {
            body = await response.clone().json();
        } catch { /* not JSON */ }
        message = body && typeof body.error === 'string' && body.error
            ? body.error
            : 'Příliš mnoho požadavků, zkuste to prosím později.';
        const seconds = Number(body && body.retryAfterSec != null ? body.retryAfterSec : response.headers.get('Retry-After'));
        if (Number.isFinite(seconds) && seconds > 0) {
            retryAfterSec = seconds;
            message += ` Znovu to půjde zhruba za ${Math.ceil(seconds / 60)} min.`;
        }
    }
    const error = new Error(message);
    error.status = response.status;
    if (retryAfterSec !== undefined) error.retryAfterSec = retryAfterSec;
    return error;
}
