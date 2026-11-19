/**
 * Limit on new users per client address.
 *
 * /api/auth gives every visitor an identity, so that everybody can read the
 * timetables: the whole school reaches the app from one public IP, and a
 * limit there let one pupil's script lock every new visitor out of the app.
 * What costs is a users/{uid} document - it can carry reminders and device
 * tokens, which the jobs read every minute. So the write that creates one
 * (notifications, their settings, favourites) is counted per client address
 * (IPv6: per /64, the address as the admin limiter takes it); writes of an
 * existing user never are. Per serverless instance, like the other limits.
 */

const { AttemptLimiter } = require('../backend/admin');
const { clientIp, rateLimitKey } = require('./admin');

const WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT = 60;

/** NEW_USERS_PER_IP_LIMIT: new users documents per client address and 10 minutes. */
function newUsersLimit(env = process.env) {
    const value = Number(env.NEW_USERS_PER_IP_LIMIT);
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_LIMIT;
}

const newUsers = new AttemptLimiter({ max: newUsersLimit(), windowMs: WINDOW_MS, lockMs: WINDOW_MS });

/**
 * Call right before the write that creates users/{uid}. When this address
 * created too many users lately, answers 429 and returns false; otherwise
 * counts one more and returns true.
 */
function admitNewUser(req, res) {
    const key = rateLimitKey(clientIp(req));
    const state = newUsers.status(key);
    if (state.locked) {
        res.setHeader('Retry-After', String(state.retryAfterSec));
        res.status(429).json({
            error: 'Příliš mnoho nových uživatelů z této sítě, zkuste to později.',
            retryAfterSec: state.retryAfterSec,
        });
        return false;
    }
    newUsers.fail(key); // one more new user of this address
    return true;
}

module.exports = { admitNewUser, newUsersLimit };
