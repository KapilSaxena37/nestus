// NestUs server — zero external dependencies, uses only Node built-ins.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getListings, getListing, addListing, setStatus, getPending,
  addEnquiry, getEnquiries, cities, ensureSeed, USE_SUPABASE,
  findUserByEmail, addUser, getUserById, setShortlist, uploadPhoto,
  getListingsByOwner, updateListing, addMessage, getMessages, updateUserData,
  getAllListings,
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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv',
};

const EXT_BY_TYPE = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
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
  return { id: u.id, name: u.name, email: u.email, role: u.role || 'student', shortlist: u.shortlist || [] };
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 12e6) req.destroy(); }); // ~12MB cap (covers base64 photos)
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
        const me = await currentUser(req);
        if (me) { b.ownerId = me.id; b.ownerName = me.name; }
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

      // POST /api/upload  (image as base64 -> stored, returns public URL)
      if (path === '/api/upload' && req.method === 'POST') {
        const b = await readBody(req);
        const ext = EXT_BY_TYPE[b.contentType];
        if (!b.dataBase64 || !ext) return send(res, 400, { error: 'Please upload a JPG, PNG, WEBP or GIF image' });
        const buffer = Buffer.from(b.dataBase64, 'base64');
        if (buffer.length > 5 * 1024 * 1024) return send(res, 413, { error: 'Image too large (max 5 MB)' });
        const url = await uploadPhoto(buffer, b.contentType, ext);
        return send(res, 201, { url });
      }

      // ----- Auth -----
      if (path === '/api/auth/signup' && req.method === 'POST') {
        const b = await readBody(req);
        const name = (b.name || '').trim(), email = (b.email || '').trim();
        if (!name || !email || !b.password) return send(res, 400, { error: 'Name, email and password are required' });
        if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Please enter a valid email' });
        if (String(b.password).length < 6) return send(res, 400, { error: 'Password must be at least 6 characters' });
        if (await findUserByEmail(email)) return send(res, 409, { error: 'That email is already registered — try logging in.' });
        const role = b.role === 'owner' ? 'owner' : 'student';
        const { salt, hash } = hashPassword(String(b.password));
        const user = await addUser({ email, name, salt, hash, role });
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

      // ----- Owner area (requires owner login) -----
      if (path === '/api/me/listings' && req.method === 'GET') {
        const u = await currentUser(req);
        if (!u) return send(res, 401, { error: 'Please sign in' });
        return send(res, 200, await getListingsByOwner(u.id));
      }
      if (path === '/api/me/owner-enquiries' && req.method === 'GET') {
        const u = await currentUser(req);
        if (!u) return send(res, 401, { error: 'Please sign in' });
        const mine = await getListingsByOwner(u.id);
        const ids = new Set(mine.map(l => l.id));
        const all = await getEnquiries();
        return send(res, 200, all.filter(e => ids.has(Number(e.listingId))));
      }
      // PATCH /api/listings/:id  (owner edits their own listing)
      const em = path.match(/^\/api\/listings\/(\d+)$/);
      if (em && req.method === 'PATCH') {
        const u = await currentUser(req);
        if (!u) return send(res, 401, { error: 'Please sign in' });
        const listing = await getListing(em[1]);
        if (!listing) return send(res, 404, { error: 'Not found' });
        if (listing.ownerId !== u.id) return send(res, 403, { error: 'This is not your listing' });
        const b = await readBody(req);
        // Only allow these fields to be changed by the owner.
        const allowed = ['name', 'area', 'nearCollege', 'distance', 'gender', 'startingRent',
          'foodIncluded', 'foodDetail', 'hasAC', 'availableFrom', 'description', 'amenities',
          'rooms', 'rules', 'contactPhone', 'contactWhatsApp', 'photos', 'available', 'lat', 'lng',
          'safety', 'mapLink'];
        const patch = {};
        for (const k of allowed) if (k in b) patch[k] = b[k];
        // A pure availability toggle stays live; real content edits go back for re-verification.
        const contentChanged = Object.keys(patch).some(k => k !== 'available');
        if (contentChanged) { patch.status = 'pending'; patch.verified = false; }
        const updated = await updateListing(em[1], patch);
        return send(res, 200, updated);
      }

      // POST /api/listings/:id/reviews  (logged-in users leave a review)
      const rm = path.match(/^\/api\/listings\/(\d+)\/reviews$/);
      if (rm && req.method === 'POST') {
        const u = await currentUser(req);
        if (!u) return send(res, 401, { error: 'Please sign in to leave a review' });
        const b = await readBody(req);
        const rating = Number(b.rating);
        if (!(rating >= 1 && rating <= 5)) return send(res, 400, { error: 'Please give a rating from 1 to 5 stars' });
        const listing = await getListing(rm[1]);
        if (!listing) return send(res, 404, { error: 'Not found' });
        const reviewList = listing.reviewList || [];
        const review = { userId: u.id, name: u.name, rating, text: (b.text || '').trim(), createdAt: new Date().toISOString() };
        const existing = reviewList.find(r => r.userId === u.id);
        if (existing) Object.assign(existing, review); else reviewList.push(review);
        const avg = reviewList.reduce((s, r) => s + r.rating, 0) / reviewList.length;
        const updated = await updateListing(rm[1], {
          reviewList, rating: Math.round(avg * 10) / 10, reviews: reviewList.length,
        });
        return send(res, 200, updated);
      }

      // ----- Messaging (requires login) -----
      if (path === '/api/messages' && req.method === 'POST') {
        const me = await currentUser(req);
        if (!me) return send(res, 401, { error: 'Please sign in to message' });
        const b = await readBody(req);
        const text = (b.text || '').trim();
        if (!text) return send(res, 400, { error: 'Message is empty' });
        const listing = await getListing(b.listingId);
        if (!listing) return send(res, 404, { error: 'Listing not found' });
        if (!listing.ownerId) return send(res, 400, { error: 'This listing is not accepting messages yet.' });
        // Work out the recipient.
        let toId;
        if (me.id === listing.ownerId) toId = Number(b.toId); // owner replying to a student
        else toId = listing.ownerId;                          // student messaging the owner
        if (!toId) return send(res, 400, { error: 'No recipient' });
        const to = await getUserById(toId);
        if (!to) return send(res, 404, { error: 'Recipient not found' });
        const msg = await addMessage({
          listingId: Number(b.listingId), listingName: listing.name,
          fromId: me.id, fromName: me.name, toId, toName: to.name, text,
        });
        return send(res, 201, msg);
      }
      if (path === '/api/messages' && req.method === 'GET') {
        const me = await currentUser(req);
        if (!me) return send(res, 401, { error: 'Please sign in' });
        const all = await getMessages();
        const mine = all.filter(m => m.fromId === me.id || m.toId === me.id);
        // Group into conversations keyed by listing + the other person.
        const convos = {};
        for (const m of mine) {
          const otherId = m.fromId === me.id ? m.toId : m.fromId;
          const otherName = m.fromId === me.id ? m.toName : m.fromName;
          const key = `${m.listingId}:${otherId}`;
          if (!convos[key] || m.createdAt > convos[key].lastAt) {
            convos[key] = {
              listingId: m.listingId, listingName: m.listingName,
              otherId, otherName, lastText: m.text, lastAt: m.createdAt,
            };
          }
        }
        const list = Object.values(convos).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
        // Opening the inbox marks everything as seen (clears the bell).
        await updateUserData(me.id, { messagesSeenAt: new Date().toISOString() });
        return send(res, 200, list);
      }
      if (path === '/api/messages/unread' && req.method === 'GET') {
        const me = await currentUser(req);
        if (!me) return send(res, 200, { count: 0 });
        const since = me.messagesSeenAt || '1970-01-01';
        const all = await getMessages();
        const count = all.filter(m => m.toId === me.id && m.createdAt > since).length;
        return send(res, 200, { count });
      }
      if (path === '/api/messages/thread' && req.method === 'GET') {
        const me = await currentUser(req);
        if (!me) return send(res, 401, { error: 'Please sign in' });
        const listingId = Number(q.listingId), withId = Number(q.withId);
        const all = await getMessages();
        const thread = all.filter(m => Number(m.listingId) === listingId &&
          ((m.fromId === me.id && m.toId === withId) || (m.fromId === withId && m.toId === me.id)))
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
          .map(m => ({ ...m, mine: m.fromId === me.id }));
        return send(res, 200, thread);
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
      if (path === '/api/admin/listings' && req.method === 'GET') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        const all = await getAllListings();
        all.sort((a, b) => (b.id - a.id));
        return send(res, 200, all);
      }
      if (path === '/api/admin/stats' && req.method === 'GET') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        const all = await getAllListings();
        const by = s => all.filter(l => (l.status || 'pending') === s);
        const approved = by('approved'), pending = by('pending'), rejected = by('rejected');
        const verifiedDates = approved.map(l => l.verifiedAt).filter(Boolean).sort();
        const lastVerifiedAt = verifiedDates.length ? verifiedDates[verifiedDates.length - 1] : null;
        const oldestVerifiedAt = verifiedDates.length ? verifiedDates[0] : null;
        const byCity = {};
        all.forEach(l => { byCity[l.city] = (byCity[l.city] || 0) + 1; });
        return send(res, 200, {
          total: all.length, approved: approved.length, pending: pending.length, rejected: rejected.length,
          available: approved.filter(l => l.available !== false).length,
          full: approved.filter(l => l.available === false).length,
          lastVerifiedAt, oldestVerifiedAt, byCity,
          pendingList: pending.map(l => ({ id: l.id, name: l.name, city: l.city, createdAt: l.createdAt })),
        });
      }
      // Admin edits any listing (no re-verification forced).
      const aum = path.match(/^\/api\/admin\/listings\/(\d+)\/update$/);
      if (aum && req.method === 'POST') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        const b = await readBody(req);
        const allowed = ['name', 'area', 'nearCollege', 'distance', 'city', 'gender', 'startingRent',
          'foodIncluded', 'foodDetail', 'hasAC', 'availableFrom', 'description', 'amenities',
          'rooms', 'rules', 'contactPhone', 'contactWhatsApp', 'photos', 'available', 'lat', 'lng',
          'safety', 'mapLink'];
        const patch = {};
        for (const k of allowed) if (k in b) patch[k] = b[k];
        const updated = await updateListing(aum[1], patch);
        return updated ? send(res, 200, updated) : send(res, 404, { error: 'Not found' });
      }
      // Bulk import (rows already parsed to objects by the admin page).
      if (path === '/api/admin/import' && req.method === 'POST') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        const b = await readBody(req);
        const rows = Array.isArray(b.rows) ? b.rows : [];
        let created = 0, skipped = 0;
        for (const r of rows) {
          if (!r.name || !r.city) { skipped++; continue; }
          const listing = await addListing(r);
          if (b.publish) await setStatus(listing.id, 'approved');
          created++;
        }
        return send(res, 200, { created, skipped });
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
