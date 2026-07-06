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
  getAllListings, findUserByPhone, getAllUsers, deleteListing, normalizePhone,
  cleanNearCollege,
} from './db.js';
import {
  hashPassword, verifyPassword, signSession, verifySession,
  parseCookies, SESSION_MAX_AGE, rateLimit,
} from './auth.js';
import { renderLanding, renderSitemap, renderPolicy } from './landing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// Simple admin key. Change ADMIN_KEY before deploying.
const ADMIN_KEY = process.env.ADMIN_KEY || 'nestus-admin';

// --- Email notifications (Brevo). Set these env vars in the host to enable. ---
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'nestus.care@gmail.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'nestus.care@gmail.com';
const escHtml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function sendEmail(to, subject, html) {
  if (!BREVO_API_KEY || !to) return; // silently skip if email not configured
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: MAIL_FROM, name: 'NestUs' }, to: [{ email: to }], subject, htmlContent: html }),
    });
    if (!r.ok) console.warn('Brevo email non-OK:', r.status, await r.text());
  } catch (e) { console.warn('Email send failed:', e.message); }
}
async function notifyEnquiry(b) {
  const subject = `New NestUs enquiry: ${b.listingName || 'a listing'}`;
  const html = `<p>You have a new enquiry on NestUs.</p>
    <p><b>Property:</b> ${escHtml(b.listingName || ('#' + b.listingId))}<br>
    <b>From:</b> ${escHtml(b.name)}<br>
    <b>Phone:</b> ${escHtml(b.phone)}<br>
    <b>Message:</b> ${escHtml(b.message || '—')}</p>
    <p>Reply to the student directly at ${escHtml(b.phone)}.</p>`;
  await sendEmail(ADMIN_EMAIL, subject, html);                 // always notify NestUs admin
  const listing = await getListing(b.listingId).catch(() => null);
  if (listing && listing.ownerId) {
    const owner = await getUserById(listing.ownerId).catch(() => null);
    if (owner && owner.email && owner.email !== ADMIN_EMAIL) await sendEmail(owner.email, subject, html);
  }
}

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
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone || '', role: u.role || 'student', shortlist: u.shortlist || [] };
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
        const enquiry = await addEnquiry(b);
        send(res, 201, enquiry);
        notifyEnquiry(b).catch(() => {}); // fire-and-forget email to admin + owner
        return;
      }
      // GET /api/cities
      if (path === '/api/cities' && req.method === 'GET') {
        return send(res, 200, await cities());
      }

      // POST /api/upload  (image as base64 -> stored, returns public URL)
      if (path === '/api/upload' && req.method === 'POST') {
        // Require a logged-in user OR the admin key (blocks anonymous storage abuse).
        const uploader = await currentUser(req);
        const akey = url.searchParams.get('key') || req.headers['x-admin-key'];
        if (!uploader && akey !== ADMIN_KEY) return send(res, 401, { error: 'Please sign in to upload photos' });
        const b = await readBody(req);
        const ext = EXT_BY_TYPE[b.contentType];
        if (!b.dataBase64 || !ext) return send(res, 400, { error: 'Please upload a JPG, PNG, WEBP or GIF image' });
        const buffer = Buffer.from(b.dataBase64, 'base64');
        if (buffer.length > 5 * 1024 * 1024) return send(res, 413, { error: 'Image too large (max 5 MB)' });
        const photoUrl = await uploadPhoto(buffer, b.contentType, ext);
        return send(res, 201, { url: photoUrl });
      }

      // ----- Auth -----
      if (path === '/api/auth/signup' && req.method === 'POST') {
        if (!rateLimit(clientIp(req), 'signup', 10)) return send(res, 429, { error: 'Too many attempts — please wait a few minutes.' });
        const b = await readBody(req);
        const name = (b.name || '').trim(), email = (b.email || '').trim(), phone = (b.phone || '').trim();
        if (!name || !email || !b.password) return send(res, 400, { error: 'Name, email and password are required' });
        if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Please enter a valid email' });
        if (normalizePhone(phone).length !== 10) return send(res, 400, { error: 'Please enter a valid 10-digit mobile number' });
        if (String(b.password).length < 6) return send(res, 400, { error: 'Password must be at least 6 characters' });
        if (await findUserByEmail(email)) return send(res, 409, { error: 'That email is already registered — try logging in.' });
        if (await findUserByPhone(phone)) return send(res, 409, { error: 'That mobile number is already registered — try logging in.' });
        const role = b.role === 'owner' ? 'owner' : 'student';
        const { salt, hash } = hashPassword(String(b.password));
        const user = await addUser({ email, name, phone, salt, hash, role });
        if (!user) return send(res, 409, { error: 'That email is already registered.' });
        setSessionCookie(res, signSession(user.id));
        return send(res, 201, publicUser(user));
      }
      if (path === '/api/auth/login' && req.method === 'POST') {
        if (!rateLimit(clientIp(req), 'login', 12)) return send(res, 429, { error: 'Too many login attempts — please wait a few minutes.' });
        const b = await readBody(req);
        const id = (b.login || b.email || '').trim();
        let user = await findUserByEmail(id);
        if (!user && normalizePhone(id).length === 10) user = await findUserByPhone(id);
        if (!user || !verifyPassword(String(b.password || ''), user.salt, user.hash))
          return send(res, 401, { error: 'Wrong login or password' });
        setSessionCookie(res, signSession(user.id));
        return send(res, 200, publicUser(user));
      }
      if (path === '/api/auth/forgot' && req.method === 'POST') {
        if (!rateLimit(clientIp(req), 'forgot', 6)) return send(res, 429, { error: 'Too many attempts — please wait a few minutes.' });
        const b = await readBody(req);
        const user = await findUserByEmail((b.email || '').trim());
        if (!user || normalizePhone(user.phone) !== normalizePhone(b.phone))
          return send(res, 400, { error: 'No account matches that email and mobile number.' });
        if (String(b.newPassword || '').length < 6) return send(res, 400, { error: 'New password must be at least 6 characters' });
        const { salt, hash } = hashPassword(String(b.newPassword));
        await updateUserData(user.id, { salt, hash });
        return send(res, 200, { ok: true });
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
        const allowed = ['name', 'area', 'nearCollege', 'address', 'distance', 'gender', 'startingRent',
          'foodIncluded', 'foodDetail', 'hasAC', 'availableFrom', 'description', 'amenities',
          'rooms', 'rules', 'contactPhone', 'contactWhatsApp', 'photos', 'available', 'lat', 'lng',
          'safety', 'mapLink', 'deposit', 'depositRefund', 'noticePeriod', 'electricity', 'extraCharges'];
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
        const approved = by('approved'), pending = by('pending'), rejected = by('rejected'), draft = by('draft');
        const verifiedLive = approved.filter(l => l.verified);
        const unverifiedLive = approved.filter(l => !l.verified);
        const verifiedDates = approved.map(l => l.verifiedAt).filter(Boolean).sort();
        const lastVerifiedAt = verifiedDates.length ? verifiedDates[verifiedDates.length - 1] : null;
        const oldestVerifiedAt = verifiedDates.length ? verifiedDates[0] : null;
        const byCity = {};
        all.forEach(l => { byCity[l.city] = (byCity[l.city] || 0) + 1; });
        // Duplicate detection: same name+city.
        const groups = {};
        all.forEach(l => {
          const key = `${(l.name || '').toLowerCase().trim()}|${(l.city || '').toLowerCase().trim()}`;
          (groups[key] = groups[key] || []).push({ id: l.id, name: l.name, city: l.city, status: l.status });
        });
        const duplicates = Object.values(groups).filter(g => g.length > 1);
        return send(res, 200, {
          total: all.length, approved: approved.length, pending: pending.length, rejected: rejected.length,
          raw: draft.length, verified: verifiedLive.length, unverified: unverifiedLive.length,
          available: approved.filter(l => l.available !== false).length,
          full: approved.filter(l => l.available === false).length,
          lastVerifiedAt, oldestVerifiedAt, byCity,
          duplicates,
          pendingList: pending.map(l => ({ id: l.id, name: l.name, city: l.city, createdAt: l.createdAt })),
        });
      }
      // Admin edits any listing (no re-verification forced).
      const aum = path.match(/^\/api\/admin\/listings\/(\d+)\/update$/);
      if (aum && req.method === 'POST') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        const b = await readBody(req);
        const allowed = ['name', 'area', 'nearCollege', 'address', 'distance', 'city', 'gender', 'startingRent',
          'foodIncluded', 'foodDetail', 'hasAC', 'availableFrom', 'description', 'amenities',
          'rooms', 'rules', 'contactPhone', 'contactWhatsApp', 'photos', 'available', 'lat', 'lng',
          'safety', 'mapLink', 'deposit', 'depositRefund', 'noticePeriod', 'electricity', 'extraCharges'];
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
        const existing = await getAllListings();
        const seen = new Set(existing.map(l => `${(l.name || '').toLowerCase().trim()}|${(l.city || '').toLowerCase().trim()}`));
        const stage = b.stage || 'draft'; // raw drafts by default
        let created = 0, skipped = 0, duplicates = 0;
        const createdIds = [], duplicateList = [], invalidList = [];
        for (const r of rows) {
          if (!r.name || !r.city) { skipped++; invalidList.push((r.name || '(no name)') + (r.city ? ' — ' + r.city : ' — no city')); continue; }
          const key = `${r.name.toLowerCase().trim()}|${r.city.toLowerCase().trim()}`;
          if (seen.has(key)) { duplicates++; duplicateList.push(`${r.name} (${r.city})`); continue; } // skip duplicates
          seen.add(key);
          const listing = await addListing(r);
          if (stage === 'verified') await updateListing(listing.id, { status: 'approved', verified: true, verifiedAt: new Date().toISOString() });
          else if (stage === 'unverified') await updateListing(listing.id, { status: 'approved', verified: false });
          else await updateListing(listing.id, { status: 'draft' }); // raw, not public
          created++;
          createdIds.push({ id: listing.id, name: r.name, city: r.city });
        }
        return send(res, 200, { created, skipped, duplicates, createdIds, duplicateList, invalidList });
      }
      // Bulk update existing listings (match by UID/id). Only provided fields change.
      if (path === '/api/admin/bulk-update' && req.method === 'POST') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        const b = await readBody(req);
        const rows = Array.isArray(b.rows) ? b.rows : [];
        const allowed = ['name', 'area', 'nearCollege', 'address', 'city', 'gender', 'startingRent',
          'foodIncluded', 'foodDetail', 'hasAC', 'availableFrom', 'description', 'amenities',
          'rooms', 'rules', 'contactPhone', 'contactWhatsApp', 'photos', 'lat', 'lng',
          'deposit', 'depositRefund', 'noticePeriod', 'electricity', 'extraCharges', 'mapLink'];
        let updated = 0; const notFound = [];
        for (const row of rows) {
          const id = Number(row.uid);
          if (!id) { notFound.push('(no uid)'); continue; }
          const patch = {};
          for (const k of allowed) if (row.patch && k in row.patch) patch[k] = row.patch[k];
          const r = await updateListing(id, patch);
          if (r) updated++; else notFound.push('NES-' + String(id).padStart(5, '0'));
        }
        return send(res, 200, { updated, notFound });
      }
      // Delete a single listing.
      const adm = path.match(/^\/api\/admin\/listings\/(\d+)\/delete$/);
      if (adm && req.method === 'POST') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        await deleteListing(adm[1]);
        return send(res, 200, { ok: true });
      }
      // Delete multiple listings.
      if (path === '/api/admin/listings/delete' && req.method === 'POST') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        const b = await readBody(req);
        const ids = Array.isArray(b.ids) ? b.ids : [];
        for (const id of ids) await deleteListing(id);
        return send(res, 200, { deleted: ids.length });
      }
      // One-time tidy of existing listings' nearCollege (strip distances).
      if (path === '/api/admin/clean-colleges' && req.method === 'POST') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        const all = await getAllListings();
        let cleaned = 0;
        for (const l of all) {
          const c = cleanNearCollege(l.nearCollege, l.distance);
          if (c.nearCollege !== (l.nearCollege || '') || c.distance !== (l.distance || '')) {
            await updateListing(l.id, { nearCollege: c.nearCollege, distance: c.distance });
            cleaned++;
          }
        }
        return send(res, 200, { cleaned });
      }
      // List users (for admin password reset).
      if (path === '/api/admin/users' && req.method === 'GET') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        return send(res, 200, await getAllUsers());
      }
      // Admin resets a user's password.
      const aup = path.match(/^\/api\/admin\/users\/(\d+)\/password$/);
      if (aup && req.method === 'POST') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        const b = await readBody(req);
        if (String(b.password || '').length < 6) return send(res, 400, { error: 'Password must be at least 6 characters' });
        const { salt, hash } = hashPassword(String(b.password));
        const updated = await updateUserData(aup[1], { salt, hash });
        return updated ? send(res, 200, { ok: true }) : send(res, 404, { error: 'User not found' });
      }
      if (path === '/api/admin/enquiries' && req.method === 'GET') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        return send(res, 200, await getEnquiries());
      }
      const am = path.match(/^\/api\/admin\/listings\/(\d+)\/(approve|verify|publish|unverify|draft|reject)$/);
      if (am && req.method === 'POST') {
        if (!authed) return send(res, 401, { error: 'Unauthorized' });
        const a = am[2];
        let patch;
        if (a === 'reject') patch = { status: 'rejected' };
        else if (a === 'draft') patch = { status: 'draft' };                       // pull back to raw
        else if (a === 'publish') patch = { status: 'approved', verified: false };  // live, unverified
        else if (a === 'unverify') patch = { verified: false };                     // stays live, drop badge
        else patch = { status: 'approved', verified: true, verifiedAt: new Date().toISOString() }; // verify/approve
        const updated = await updateListing(am[1], patch);
        return updated ? send(res, 200, updated) : send(res, 404, { error: 'Not found' });
      }

      return send(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      return send(res, 500, { error: 'Server error', detail: String(err) });
    }
  }

  // ---------- SEO landing pages (server-rendered HTML) ----------
  try {
    let lm;
    const canon = `https://${req.headers.host}${path}`;
    if ((lm = path.match(/^\/hostels\/([a-z0-9-]+)$/)) && req.method === 'GET')
      return send(res, 200, await renderLanding('city', lm[1], canon), 'text/html; charset=utf-8');
    if ((lm = path.match(/^\/near\/([a-z0-9-]+)$/)) && req.method === 'GET')
      return send(res, 200, await renderLanding('near', lm[1], canon), 'text/html; charset=utf-8');
    if ((lm = path.match(/^\/area\/([a-z0-9-]+)$/)) && req.method === 'GET')
      return send(res, 200, await renderLanding('area', lm[1], canon), 'text/html; charset=utf-8');
    if (path === '/privacy' && req.method === 'GET')
      return send(res, 200, renderPolicy('privacy', canon), 'text/html; charset=utf-8');
    if (path === '/terms' && req.method === 'GET')
      return send(res, 200, renderPolicy('terms', canon), 'text/html; charset=utf-8');
    if (path === '/sitemap.xml' && req.method === 'GET')
      return send(res, 200, await renderSitemap(`https://${req.headers.host}`), 'application/xml; charset=utf-8');
    if (path === '/robots.txt' && req.method === 'GET')
      return send(res, 200, `User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /api/\nSitemap: https://${req.headers.host}/sitemap.xml\n`, 'text/plain; charset=utf-8');
  } catch (err) {
    return send(res, 500, 'Server error', 'text/plain');
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
