// Authentication helpers — zero dependencies, uses Node's built-in crypto.
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

// Secret used to sign session cookies. Set SESSION_SECRET in production so
// sessions survive restarts; otherwise a default is used (users just re-login).
const SESSION_SECRET = process.env.SESSION_SECRET || 'nestus-dev-secret-change-me';
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(test, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signSession(userId) {
  const payload = `${userId}.${Date.now()}`;
  const sig = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifySession(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userId, ts, sig] = parts;
  const expected = createHmac('sha256', SESSION_SECRET).update(`${userId}.${ts}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() - Number(ts) > SESSION_DAYS * 24 * 3600 * 1000) return null; // expired
  return Number(userId);
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 3600;
