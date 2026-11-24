// Passwords, sessions, CSRF and HTTP security headers.
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 30;

export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const tokenHash = (t) => createHash('sha256').update(String(t)).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scryptAsync(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(expected, got);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* ignore malformed cookie */
      }
    }
  }
  return out;
}

export function createSessions(db, { secure }) {
  const cookie = (name, value, maxAgeSec) =>
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;

  const purge = () => {
    const t = Date.now();
    db.run('DELETE FROM sessions WHERE expires_at < ?', t);
    db.run('DELETE FROM password_resets WHERE expires_at < ?', t);
  };
  setInterval(purge, 60 * 60 * 1000).unref();

  return {
    /** Loads req.user from the session cookie and ensures a CSRF cookie exists. */
    middleware(req, res, next) {
      const cookies = parseCookies(req.headers.cookie);
      req.user = null;
      if (cookies.sid) {
        const row = db.one(
          `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.suspended_at IS NULL`,
          tokenHash(cookies.sid),
          Date.now(),
        );
        if (row) req.user = row;
      }
      req.csrf = cookies.csrf && /^[\w-]{20,}$/.test(cookies.csrf) ? cookies.csrf : null;
      if (!req.csrf) {
        req.csrf = newToken(24);
        res.append('Set-Cookie', cookie('csrf', req.csrf, 60 * 60 * 24 * 365));
      }
      res.locals.user = req.user;
      res.locals.csrf = req.csrf;
      next();
    },
    login(res, userId) {
      const token = newToken();
      db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', tokenHash(token), userId, Date.now() + SESSION_DAYS * 864e5);
      res.append('Set-Cookie', cookie('sid', token, SESSION_DAYS * 86400));
    },
    logout(req, res) {
      const { sid } = parseCookies(req.headers.cookie);
      if (sid) db.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash(sid));
      res.append('Set-Cookie', cookie('sid', '', 0));
    },
    logoutEverywhere(userId) {
      db.run('DELETE FROM sessions WHERE user_id = ?', userId);
    },
  };
}

/**
 * Double-submit CSRF check. Must run after the body has been parsed
 * (urlencoded or multipart). Also rejects cross-origin Origin headers.
 */
export function csrfCheck(cfg) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && origin !== 'null') {
      let host;
      try {
        host = new URL(origin).host;
      } catch {
        host = null;
      }
      if (host !== req.get('host') && host !== cfg.host) return res.status(403).type('text').send('Cross-origin request blocked.');
    }
    const sent = req.body?._csrf || req.get('x-csrf-token');
    if (!sent || !safeEqual(sent, req.csrf)) {
      return res.status(403).type('text').send('Your session expired or the form was tampered with. Go back, reload the page and try again.');
    }
    next();
  };
}

export function securityHeaders(cfg) {
  return (_req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; " +
        "connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
    if (cfg.production) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export function requireUser(req, res, next) {
  if (req.user) return next();
  res.redirect(303, `/login?next=${encodeURIComponent(req.originalUrl)}`);
}

/** Only allow local redirect targets. */
export function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect(303, `/login?next=${encodeURIComponent(req.originalUrl)}`);
  if (!req.user.is_admin) return res.status(404).type('text').send('Not found');
  next();
}

export const safeNext = (n) => (typeof n === 'string' && /^\/(?![/\\])/.test(n) ? n : '/dashboard');
