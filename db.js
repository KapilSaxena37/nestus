// NestUs database layer — zero external dependencies.
//
// Two modes, chosen automatically:
//   • Supabase mode  — used when SUPABASE_URL and SUPABASE_KEY are set (production).
//                      Permanent Postgres storage via Supabase's REST API (plain fetch).
//   • Local file mode — used otherwise (your computer). Saves to data/db.json.
//
// All functions are async so both modes share the same interface.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_FILE = join(DATA_DIR, 'db.json');
const SEED_FILE = join(DATA_DIR, 'seed.json');

// Sanitize the URL: strip trailing slashes and an accidental /rest/v1 suffix,
// so the value is just https://<project>.supabase.co
const SB_URL = (process.env.SUPABASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/, '');
const SB_KEY = (process.env.SUPABASE_KEY || '').trim();
export const USE_SUPABASE = !!(SB_URL && SB_KEY);

function loadSeed() {
  if (!existsSync(SEED_FILE)) return [];
  // Strip the seed "id" — the database assigns its own.
  return JSON.parse(readFileSync(SEED_FILE, 'utf8')).map(({ id, ...rest }) => rest);
}

// ---- shared filtering / sorting (works on plain listing objects) ----
function applyFilters(rows, f = {}) {
  let out = rows.filter(l => l.status === 'approved');
  if (f.city)   out = out.filter(l => (l.city || '').toLowerCase() === f.city.toLowerCase());
  if (f.gender && f.gender !== 'Any')
    out = out.filter(l => (l.gender || '').toLowerCase().startsWith(f.gender.toLowerCase().replace(' only', '')));
  if (f.college)
    out = out.filter(l => (l.nearCollege || '').toLowerCase().includes(f.college.toLowerCase())
                       || (l.area || '').toLowerCase().includes(f.college.toLowerCase()));
  if (f.maxRent) out = out.filter(l => l.startingRent <= Number(f.maxRent));
  if (f.food === 'true') out = out.filter(l => l.foodIncluded);
  if (f.ac === 'true') out = out.filter(l => l.hasAC);
  if (f.verified === 'true') out = out.filter(l => l.verified);
  switch (f.sort) {
    case 'rent_asc':  out.sort((a, b) => a.startingRent - b.startingRent); break;
    case 'rent_desc': out.sort((a, b) => b.startingRent - a.startingRent); break;
    case 'rating':    out.sort((a, b) => b.rating - a.rating); break;
  }
  return out;
}

export function normalizePhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d; // compare last 10 digits (India mobile)
}

// Strip a trailing distance (e.g. "Allen Career Institute 1.5 km") out of nearCollege
// so landing pages group by the clean landmark name; move the distance into `distance`.
export function cleanNearCollege(near, distance) {
  let nc = String(near || '').trim();
  let dist = String(distance || '').trim();
  const m = nc.match(/^(.*?)[\s,\-–—(]+(\d+(?:\.\d+)?)\s*(kms?|m|mtrs?|meters?)\b\)?\s*$/i);
  if (m && m[1].trim()) {
    const name = m[1].trim();
    const unit = m[3].toLowerCase().startsWith('k') ? 'km' : 'm';
    nc = name;
    if (!dist) dist = `${m[2]} ${unit} from ${name}`;
  }
  return { nearCollege: nc, distance: dist };
}

function newListing(data) {
  const c = cleanNearCollege(data.nearCollege, data.distance);
  return {
    status: 'pending', verified: false, rating: 0, reviews: 0,
    createdAt: new Date().toISOString(), ...data,
    nearCollege: c.nearCollege, distance: c.distance,
  };
}

// =====================================================================
// SUPABASE MODE
// =====================================================================
async function sb(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

const PHOTO_BUCKET = 'photos';
async function sbUpload(name, buffer, contentType) {
  const res = await fetch(`${SB_URL}/storage/v1/object/${PHOTO_BUCKET}/${name}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Storage ${res.status}: ${await res.text()}`);
  return `${SB_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${name}`;
}
const rowToListing = (r) => ({ id: r.id, ...r.data });

const SB = {
  async ensureSeed() {
    const existing = await sb('listings?select=id&limit=1');
    if (existing.length) return;
    const seed = loadSeed();
    if (seed.length) await sb('listings', { method: 'POST', body: JSON.stringify(seed.map(s => ({ data: s }))) });
  },
  async getListings(f) {
    const rows = await sb('listings?select=id,data');
    return applyFilters(rows.map(rowToListing), f);
  },
  async getListing(id) {
    const rows = await sb(`listings?id=eq.${Number(id)}&select=id,data`);
    return rows.length ? rowToListing(rows[0]) : null;
  },
  async addListing(data) {
    const row = (await sb('listings', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ data: newListing(data) }),
    }))[0];
    return rowToListing(row);
  },
  async setStatus(id, status) {
    const current = await SB.getListing(id);
    if (!current) return null;
    const { id: _omit, ...data } = current;
    data.status = status;
    if (status === 'approved') { data.verified = true; data.verifiedAt = new Date().toISOString(); }
    await sb(`listings?id=eq.${Number(id)}`, { method: 'PATCH', body: JSON.stringify({ data }) });
    return { id: Number(id), ...data };
  },
  async getPending() {
    const rows = await sb('listings?select=id,data');
    return rows.map(rowToListing).filter(l => l.status === 'pending');
  },
  async getAllListings() {
    const rows = await sb('listings?select=id,data');
    return rows.map(rowToListing);
  },
  async addEnquiry(data) {
    const row = (await sb('enquiries', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ data: { createdAt: new Date().toISOString(), ...data } }),
    }))[0];
    return { id: row.id, ...row.data };
  },
  async getEnquiries() {
    const rows = await sb('enquiries?select=id,data');
    return rows.map(r => ({ id: r.id, ...r.data }));
  },
  // ---- Users ----
  async findUserByEmail(email) {
    const rows = await sb(`users?email=eq.${encodeURIComponent(email.toLowerCase())}&select=id,email,data`);
    return rows.length ? { id: rows[0].id, email: rows[0].email, ...rows[0].data } : null;
  },
  async addUser({ email, name, salt, hash, role = 'student', phone = '' }) {
    try {
      const row = (await sb('users', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          email: email.toLowerCase(),
          data: { name, salt, hash, role, phone, shortlist: [], createdAt: new Date().toISOString() },
        }),
      }))[0];
      return { id: row.id, email: row.email, ...row.data };
    } catch (e) {
      if (/409|duplicate|unique/i.test(String(e))) return null; // email taken
      throw e;
    }
  },
  async findUserByPhone(phone) {
    const norm = normalizePhone(phone);
    if (!norm) return null;
    const rows = await sb('users?select=id,email,data');
    const row = rows.find(r => normalizePhone(r.data && r.data.phone) === norm);
    return row ? { id: row.id, email: row.email, ...row.data } : null;
  },
  async getAllUsers() {
    const rows = await sb('users?select=id,email,data');
    return rows.map(r => ({ id: r.id, email: r.email, name: r.data.name, phone: r.data.phone || '', role: r.data.role || 'student' }));
  },
  async deleteListing(id) {
    await sb(`listings?id=eq.${Number(id)}`, { method: 'DELETE' });
    return true;
  },
  async getListingsByOwner(ownerId) {
    const rows = await sb('listings?select=id,data');
    return rows.map(rowToListing).filter(l => l.ownerId === Number(ownerId));
  },
  async updateListing(id, patch) {
    const current = await SB.getListing(id);
    if (!current) return null;
    const { id: _i, ...data } = { ...current, ...patch };
    await sb(`listings?id=eq.${Number(id)}`, { method: 'PATCH', body: JSON.stringify({ data }) });
    return { id: Number(id), ...data };
  },
  async getUserById(id) {
    const rows = await sb(`users?id=eq.${Number(id)}&select=id,email,data`);
    return rows.length ? { id: rows[0].id, email: rows[0].email, ...rows[0].data } : null;
  },
  async setShortlist(id, shortlist) {
    const u = await SB.getUserById(id);
    if (!u) return null;
    const { id: _i, email, ...data } = u;
    data.shortlist = shortlist;
    await sb(`users?id=eq.${Number(id)}`, { method: 'PATCH', body: JSON.stringify({ data }) });
    return { id: Number(id), email, ...data };
  },
  async updateUserData(id, patch) {
    const u = await SB.getUserById(id);
    if (!u) return null;
    const { id: _i, email, ...data } = { ...u, ...patch };
    await sb(`users?id=eq.${Number(id)}`, { method: 'PATCH', body: JSON.stringify({ data }) });
    return { id: Number(id), email, ...data };
  },
  async uploadPhoto(buffer, contentType, ext) {
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    return await sbUpload(name, buffer, contentType);
  },
  async addMessage(data) {
    const row = (await sb('messages', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ data: { createdAt: new Date().toISOString(), ...data } }),
    }))[0];
    return { id: row.id, ...row.data };
  },
  async getMessages() {
    const rows = await sb('messages?select=id,data');
    return rows.map(r => ({ id: r.id, ...r.data }));
  },
};

// =====================================================================
// LOCAL FILE MODE
// =====================================================================
function fileEnsure() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) {
    const listings = loadSeed().map((s, i) => ({ id: i + 1, ...s }));
    writeFileSync(DB_FILE, JSON.stringify({ listings, enquiries: [], users: [], messages: [], nextId: listings.length + 1 }, null, 2));
  }
}
const fileRead = () => {
  fileEnsure();
  const db = JSON.parse(readFileSync(DB_FILE, 'utf8'));
  if (!db.users) db.users = []; // migrate older db.json files
  if (!db.messages) db.messages = [];
  return db;
};
const fileWrite = (db) => writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

const FILE = {
  async ensureSeed() { fileEnsure(); },
  async getListings(f) { return applyFilters(fileRead().listings, f); },
  async getListing(id) { return fileRead().listings.find(l => l.id === Number(id)) || null; },
  async addListing(data) {
    const db = fileRead();
    const listing = { id: db.nextId++, ...newListing(data) };
    db.listings.push(listing); fileWrite(db); return listing;
  },
  async setStatus(id, status) {
    const db = fileRead();
    const l = db.listings.find(x => x.id === Number(id));
    if (!l) return null;
    l.status = status;
    if (status === 'approved') { l.verified = true; l.verifiedAt = new Date().toISOString(); }
    fileWrite(db); return l;
  },
  async getPending() { return fileRead().listings.filter(l => l.status === 'pending'); },
  async getAllListings() { return fileRead().listings; },
  async addEnquiry(data) {
    const db = fileRead();
    const e = { id: db.enquiries.length + 1, createdAt: new Date().toISOString(), ...data };
    db.enquiries.push(e); fileWrite(db); return e;
  },
  async getEnquiries() { return fileRead().enquiries; },
  // ---- Users ----
  async findUserByEmail(email) {
    return fileRead().users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
  },
  async addUser({ email, name, salt, hash, role = 'student', phone = '' }) {
    const db = fileRead();
    if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) return null;
    const id = db.users.reduce((m, u) => Math.max(m, u.id), 0) + 1;
    const user = { id, email: email.toLowerCase(), name, salt, hash, role, phone, shortlist: [], createdAt: new Date().toISOString() };
    db.users.push(user); fileWrite(db); return user;
  },
  async findUserByPhone(phone) {
    const norm = normalizePhone(phone);
    if (!norm) return null;
    return fileRead().users.find(u => normalizePhone(u.phone) === norm) || null;
  },
  async getAllUsers() {
    return fileRead().users.map(u => ({ id: u.id, email: u.email, name: u.name, phone: u.phone || '', role: u.role || 'student' }));
  },
  async deleteListing(id) {
    const db = fileRead();
    const before = db.listings.length;
    db.listings = db.listings.filter(l => l.id !== Number(id));
    fileWrite(db); return db.listings.length < before;
  },
  async getListingsByOwner(ownerId) {
    return fileRead().listings.filter(l => l.ownerId === Number(ownerId));
  },
  async updateListing(id, patch) {
    const db = fileRead();
    const idx = db.listings.findIndex(l => l.id === Number(id));
    if (idx === -1) return null;
    db.listings[idx] = { ...db.listings[idx], ...patch, id: Number(id) };
    fileWrite(db); return db.listings[idx];
  },
  async getUserById(id) { return fileRead().users.find(u => u.id === Number(id)) || null; },
  async setShortlist(id, shortlist) {
    const db = fileRead();
    const u = db.users.find(x => x.id === Number(id));
    if (!u) return null;
    u.shortlist = shortlist; fileWrite(db); return u;
  },
  async updateUserData(id, patch) {
    const db = fileRead();
    const u = db.users.find(x => x.id === Number(id));
    if (!u) return null;
    Object.assign(u, patch); fileWrite(db); return u;
  },
  async uploadPhoto(buffer, contentType, ext) {
    const uploadDir = join(__dirname, 'public', 'uploads');
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    writeFileSync(join(uploadDir, name), buffer);
    return `/uploads/${name}`;
  },
  async addMessage(data) {
    const db = fileRead();
    const m = { id: db.messages.reduce((mx, x) => Math.max(mx, x.id), 0) + 1, createdAt: new Date().toISOString(), ...data };
    db.messages.push(m); fileWrite(db); return m;
  },
  async getMessages() { return fileRead().messages; },
};

// =====================================================================
// PUBLIC INTERFACE (picks the right mode)
// =====================================================================
const impl = USE_SUPABASE ? SB : FILE;

export const ensureSeed   = (...a) => impl.ensureSeed(...a);
export const getListings  = (...a) => impl.getListings(...a);
export const getListing   = (...a) => impl.getListing(...a);
export const addListing    = (...a) => impl.addListing(...a);
export const setStatus    = (...a) => impl.setStatus(...a);
export const getPending   = (...a) => impl.getPending(...a);
export const addEnquiry   = (...a) => impl.addEnquiry(...a);
export const getEnquiries = (...a) => impl.getEnquiries(...a);
export const findUserByEmail = (...a) => impl.findUserByEmail(...a);
export const findUserByPhone = (...a) => impl.findUserByPhone(...a);
export const getAllUsers  = (...a) => impl.getAllUsers(...a);
export const deleteListing = (...a) => impl.deleteListing(...a);
export const addUser      = (...a) => impl.addUser(...a);
export const getUserById  = (...a) => impl.getUserById(...a);
export const setShortlist = (...a) => impl.setShortlist(...a);
export const uploadPhoto  = (...a) => impl.uploadPhoto(...a);
export const getListingsByOwner = (...a) => impl.getListingsByOwner(...a);
export const updateListing = (...a) => impl.updateListing(...a);
export const getAllListings = (...a) => impl.getAllListings(...a);
export const addMessage   = (...a) => impl.addMessage(...a);
export const getMessages  = (...a) => impl.getMessages(...a);
export const updateUserData = (...a) => impl.updateUserData(...a);

export async function cities() {
  const list = await impl.getListings({});
  const out = {};
  list.forEach(l => { out[l.city] = (out[l.city] || 0) + 1; });
  return out;
}
