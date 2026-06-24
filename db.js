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

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
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

function newListing(data) {
  return {
    status: 'pending', verified: false, rating: 0, reviews: 0,
    createdAt: new Date().toISOString(), ...data,
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
    if (status === 'approved') data.verified = true;
    await sb(`listings?id=eq.${Number(id)}`, { method: 'PATCH', body: JSON.stringify({ data }) });
    return { id: Number(id), ...data };
  },
  async getPending() {
    const rows = await sb('listings?select=id,data');
    return rows.map(rowToListing).filter(l => l.status === 'pending');
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
};

// =====================================================================
// LOCAL FILE MODE
// =====================================================================
function fileEnsure() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) {
    const listings = loadSeed().map((s, i) => ({ id: i + 1, ...s }));
    writeFileSync(DB_FILE, JSON.stringify({ listings, enquiries: [], nextId: listings.length + 1 }, null, 2));
  }
}
const fileRead = () => { fileEnsure(); return JSON.parse(readFileSync(DB_FILE, 'utf8')); };
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
    l.status = status; if (status === 'approved') l.verified = true;
    fileWrite(db); return l;
  },
  async getPending() { return fileRead().listings.filter(l => l.status === 'pending'); },
  async addEnquiry(data) {
    const db = fileRead();
    const e = { id: db.enquiries.length + 1, createdAt: new Date().toISOString(), ...data };
    db.enquiries.push(e); fileWrite(db); return e;
  },
  async getEnquiries() { return fileRead().enquiries; },
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

export async function cities() {
  const list = await impl.getListings({});
  const out = {};
  list.forEach(l => { out[l.city] = (out[l.city] || 0) + 1; });
  return out;
}
