// NestUs server — zero external dependencies, uses only Node built-ins.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getListings, getListing, addListing, setStatus, getPending,
  addEnquiry, getEnquiries, cities, ensureSeed, USE_SUPABASE,
  findUserByEmail, addUser, getUserById, setShortlist,
} from './db.js';
import {
  hashPassword, verifyPassword, signSession, verifySession,
  parseCookies, SESSION_MAX_AGE,
} from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// Simple admin key. Change ADMIN_KEY before deploying.
const ADMIN_KEY = process.env.ADMIN_KEY || 'nestus-admin';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  // Strings and Buffers (static files) go out as-is; objects become JSON.
  if (typeof body === 'string' || Buffer.isBuffer(body)) res.end(body);
  else res.end(JSON.stringify(body));
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `nestus_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `nestus_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}
async function currentUser(req) {
  const uid = verifySession(parseCookies(req).nestus_session);
  if (!uid) return null;
  return await getUserById(uid);
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, shortlist: u.shortlist || [] };
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

async function serveStatic(res, urlPath) {
  let filePath = join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
  if (!existsSync(filePath)) {
    // SPA-style fallbacks
    if (urlPath.startsWith('/admin')) filePath = join(PUBLIC, 'admin.html');
    else filePath = join(PUBLIC, 'index.html');
  }
  try {
    const buf = await readFile(filePath);
    send(res, 200, buf, MIME[extname(filePath)] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const q = Object.fromEntries(url.searchParams);

  // ---------- API ----------
  if (path.startsWith('/api/')) {
    try {
      // GET /api/listings  (+ filters)
      if (path === '/api/listings' && req.method === 'GET') {
        return send(res, 200, await getListings(q));
      }
      // GET /api/listings/:id
      const m = path.match(/^\/api\/listings\/(\d+)$/);
      if (m && req.method === 'GET') {
        const l = await getListing(m[1]);
        return l ? send(res, 200, l) : send(res, 404, { error: 'Not found' });
      }
      // POST /api/listings  (owner submits — goes to pending)
      if (path === '/api/listings' && req.method === 'POST') {
        const b = await readBody(req);
        if (!b.name || !b.city) return send(res, 400, { error: 'Name and city are required' });
        const created = await addListing(b);
        return send(res, 201, created);
      }
      // POST /api/enquiries
      if (path === '/api/enquiries' && req.method === 'POST') {
        const b = await readBody(req);
        if (!b.listingId || !b.name || !b.phone)
          return send(res, 400, { error: 'Name, phone and listing are required' });
        return send(res, 201, await addEnquiry(b));
      }
      // GET /api/cities
      if (path === '/api/cities' && req.method === 'GET') {
        return send(res, 200, await cities());
      }

      // ----- Auth -----
      if (path === '/api/auth/signup' && req.method === 'POST') {
        const b = await readBody(req);
        const name = (b.name || '').trim(), email = (b.email || '').trim();
        if (!name || !email || !b.password) return send(res, 400, { error: 'Name, email and password are required' });
        if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Please enter a valid email' });
        if (String(b.password).length < 6) return send(res, 400, { error: 'Password must be at least 6 characters' });
        if (await findUserByEmail(email)) return send(res, 409, { error: 'That email is already registered — try logging in.' });
        const { salt, hash } = hashPassword(String(b.password));
        const user = await addUser({ email, name, salt, hash });
        if (!user) return send(res, 409, { error: 'That email is already registered.' });
        setSessionCookie(res, signSession(user.id));
        return send(res, 201, publicUser(user));
      }
      if (path === '/api/auth/login' && req.method === 'POST') {
        const b = await readBody(req);
        const user = await findUserByEmail((b.email || '').trim());
        if (!user || !verifyPassword(String(b.password || ''), user.salt, user.hash))
          return send(res, 401, { error: 'Wrong email or password' });
        setSessionCookie(res, signSession(user.id));
        return send(res, 200, publicUser(user));
      }
      if (path === '/api/auth/logout' && req.method === 'POST') {
        clearSessionCookie(res);
        return send(res, 200, { ok: true });
      }
      if (path === '/api/auth/me' && req.method === 'GET') {
        const u = await currentUser(req);
        return send(res, 200, u ? publicUser(u) : { user: null });
      }

      // ----- Shortlist (requires login) -----
      if (path === '/api/me/shortlist' && req.method === 'POST') {
        const u = await currentUser(req);
        if (!u) return send(res, 401, { error: 'Please sign in to save hostels' });
        const b = await readBody(req);
        const lid = Number(b.listingId);
        let sl = u.shortlist || [];
        sl = sl.includes(lid) ? sl.filter(x => x !== lid) : [...sl, lid];
        const updated = await setShortlist(u.id, sl);
        return send(res, 200, { shortlist: updated.shortlist });
      }
      if (path === '/api/me/shortlist' && req.method === 'GET') {
        const u = await currentUser(req);
        if (!u) return send(res, 401, { error: 'Please sign in' });
        const all = await Promise.all((u.shortlist || []).map(id => getListing(id)));
        return send(res, 200, all.filter(Boolean));
      }

      // ----- Admin (requires key) -----
      const key = url.searchParams.get('key') || req.headers['x-admin-key'];
      const authed = key === ADMIN_KEY;

      if (path === '/api/admin/pending' && req.method === 'GET') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        return send(res, 200, await getPending());
      }
      if (path === '/api/admin/enquiries' && req.method === 'GET') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        return send(res, 200, await getEnquiries());
      }
      const am = path.match(/^\/api\/admin\/listings\/(\d+)\/(approve|reject)$/);
      if (am && req.method === 'POST') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        const updated = await setStatus(am[1], am[2] === 'approve' ? 'approved' : 'rejected');
        return updated ? send(res, 200, updated) : send(res, 404, { error: 'Not found' });
      }

      return send(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      return send(res, 500, { error: 'Server error', detail: String(err) });
    }
  }

  // ---------- Static files ----------
  return serveStatic(res, path);
});

ensureSeed()
  .catch(err => console.error('Seed/startup warning:', err.message))
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`NestUs running at http://localhost:${PORT}`);
      console.log(`Storage: ${USE_SUPABASE ? 'Supabase (permanent)' : 'local file (data/db.json)'}`);
      console.log(`Admin page: http://localhost:${PORT}/admin.html  (key: ${ADMIN_KEY})`);
    });
  });
