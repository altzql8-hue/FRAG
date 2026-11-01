import { AppError, assert } from './errors.js';

// Free website keys: always 24 hours, always one device slot.
// These are fixed on purpose and are NOT configurable from the request or from env.
export const FREE_KEY_HOURS = 24;
export const FREE_KEY_MAX_DEVICES = 1;

/**
 * Public, unauthenticated endpoint used by the AltF5 key website:
 *
 *   POST /api/public/free-key
 *
 * It calls the existing Licenses.create() so the key is a real record in the same
 * Firebase `keys/{key}` store that /api/license/authenticate validates. Nothing is
 * duplicated: key format, collision handling, audit events and the SQLite projection
 * all come from licenses.js.
 *
 * Implemented as a plain (req,res,next) middleware, so it needs no new dependency
 * and is mounted once in app.js, before the origin/auth guards.
 */
export function publicKeyMiddleware({ licenses, ready = () => true, env = process.env }) {
  const allowedOrigins = new Set(
    String(env.FREE_KEY_ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)
  );
  const type = env.FREE_KEY_TYPE || 'FREE';
  const prefix = env.FREE_KEY_PREFIX || 'AltF5';

  return async function publicKey(req, res, next) {
    try {
      const route = req.path.replace(/\/+$/, '') || '/';
      if (route !== '/free-key') return next();

      // CORS: only the website origins listed in FREE_KEY_ALLOWED_ORIGINS may read the response.
      const origin = req.get('origin');
      res.set('Vary', 'Origin');
      if (origin && allowedOrigins.has(origin)) {
        res.set({
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
          // helmet sends same-origin by default; this response is meant for the website.
          'Cross-Origin-Resource-Policy': 'cross-origin'
        });
      }
      if (req.method === 'OPTIONS') { res.status(204).end(); return; }
      res.set('Cache-Control', 'no-store');
      if (req.method !== 'POST') { res.set('Allow', 'POST, OPTIONS'); throw new AppError(405, 'METHOD', 'Use POST for this endpoint.'); }
      assert(ready(), 503, 'DATABASE_UNAVAILABLE', 'Database connection is unavailable. Please retry.');

      const ctx = { adminId: 'public-free-key', username: 'public-free-key', ip: req.ip || '', sessionId: '' };
      let record;
      try {
        record = await licenses.create({
          type,
          prefix,
          days: FREE_KEY_HOURS / 24,          // expiresAt = creation time + exactly 24h
          maxDevices: FREE_KEY_MAX_DEVICES,   // exactly one device slot
          bindingEnabled: true,               // slot limit is only enforced when binding is on
          label: 'AltF5 website free key'
        }, ctx);
      } catch (e) {
        if (e instanceof AppError && e.code === 'TYPE') {
          throw new AppError(503, 'FREE_TYPE_MISSING', `Key type "${type}" is not configured in the dashboard settings.`);
        }
        throw e;
      }

      // Explicit allowlist: nothing internal (id, createdBy, hwids, metadata) is returned.
      res.status(201).json({
        success: true,
        data: {
          key: record.key,
          type: record.type,
          expiresAt: record.expiresAt,
          maxDevices: record.maxDevices,
          durationHours: FREE_KEY_HOURS,
          serverTime: Date.now()
        }
      });
    } catch (e) { next(e); }
  };
}
