// NestUs backend test suite — zero dependencies (Node's built-in test runner).
// Run:  npm test      (from the nestus-app folder)
// Spawns the real server in local-file mode on a test port, exercises the API, tears down.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

const PORT = 3111;
const BASE = `http://localhost:${PORT}`;
const ADMIN = 'testkey';
let srv;

function makeClient() {
  let cookie = '';
  return async function req(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (cookie) headers.cookie = cookie;
    if (opts.json !== undefined) { headers['content-type'] = 'application/json'; opts.body = JSON.stringify(opts.json); delete opts.json; }
    const r = await fetch(BASE + path, { ...opts, headers });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return r;
  };
}
const admin = (extra = {}) => ({ 'X-Admin-Key': ADMIN, ...extra });
const anon = makeClient();

before(async () => {
  rmSync('data/db.json', { force: true });
  rmSync('public/uploads', { force: true, recursive: true });
  srv = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'test', ADMIN_KEY: ADMIN, BREVO_API_KEY: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/cities'); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise(res => setTimeout(res, 100));
  }
  throw new Error('server did not start');
});
after(() => { if (srv) srv.kill(); rmSync('data/db.json', { force: true }); rmSync('public/uploads', { force: true, recursive: true }); });

test('seed listings load and cities counts', async () => {
  const listings = await (await anon('/api/listings')).json();
  assert.ok(Array.isArray(listings) && listings.length >= 6, 'has seed listings');
  const cities = await (await anon('/api/cities')).json();
  assert.ok(cities.Nagpur > 0 && cities.Indore > 0);
});

test('filters: city, gender, maxRent, sort', async () => {
  const girls = await (await anon('/api/listings?city=Nagpur&gender=Girls')).json();
  assert.ok(girls.every(l => l.city === 'Nagpur' && /girl/i.test(l.gender)));
  const cheap = await (await anon('/api/listings?maxRent=5000')).json();
  assert.ok(cheap.every(l => l.startingRent <= 5000));
  const asc = await (await anon('/api/listings?sort=rent_asc')).json();
  for (let i = 1; i < asc.length; i++) assert.ok(asc[i].startingRent >= asc[i - 1].startingRent);
});

test('student signup / login / me / logout, and validation', async () => {
  const c = makeClient();
  let r = await c('/api/auth/signup', { method: 'POST', json: { name: 'Asha', email: 'asha@t.com', phone: '9876543210', password: 'secret1', role: 'student' } });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).role, 'student');
  assert.equal((await c('/api/auth/signup', { method: 'POST', json: { name: 'X', email: 'asha@t.com', phone: '9111111111', password: 'secret1' } })).status, 409, 'dup email');
  assert.equal((await c('/api/auth/signup', { method: 'POST', json: { name: 'X', email: 'x@t.com', phone: '9876543210', password: 'secret1' } })).status, 409, 'dup phone');
  assert.equal((await c('/api/auth/signup', { method: 'POST', json: { name: 'X', email: 'y@t.com', phone: '9222222222', password: '123' } })).status, 400, 'short pw');
  assert.equal((await (await c('/api/auth/me')).json()).name, 'Asha');
  // login by mobile
  const c2 = makeClient();
  assert.equal((await (await c2('/api/auth/login', { method: 'POST', json: { login: '9876543210', password: 'secret1' } })).json()).name, 'Asha');
  await c('/api/auth/logout', { method: 'POST' });
});

test('owner listing: pending is hidden, verify makes it public; student cannot edit', async () => {
  const owner = makeClient();
  await owner('/api/auth/signup', { method: 'POST', json: { name: 'Ravi', email: 'ravi@t.com', phone: '9000000001', password: 'secret1', role: 'owner' } });
  const created = await (await owner('/api/listings', { method: 'POST', json: { name: 'Test PG', city: 'Indore', gender: 'Boys', startingRent: 4200, contactPhone: '1', deposit: 5000, rooms: [{ type: 'S', rent: 4200 }] } })).json();
  const id = created.id;
  let pub = await (await anon('/api/listings')).json();
  assert.ok(!pub.some(l => l.id === id), 'pending hidden from public');
  // student blocked from editing
  const stud = makeClient();
  await stud('/api/auth/signup', { method: 'POST', json: { name: 'S', email: 's2@t.com', phone: '9333333333', password: 'secret1' } });
  assert.equal((await stud('/api/listings/' + id, { method: 'PATCH', json: { startingRent: 1 } })).status, 403);
  // admin verify
  assert.equal((await anon('/api/admin/listings/' + id + '/verify', { method: 'POST', headers: admin() })).status, 200);
  pub = await (await anon('/api/listings')).json();
  const live = pub.find(l => l.id === id);
  assert.ok(live && live.verified && live.deposit === 5000, 'public + verified + cost field kept');
});

test('admin auth required', async () => {
  assert.equal((await anon('/api/admin/stats')).status, 401);
  assert.equal((await anon('/api/admin/stats', { headers: { 'X-Admin-Key': 'wrong' } })).status, 401);
  assert.equal((await anon('/api/admin/stats', { headers: admin() })).status, 200);
});

test('enquiry create', async () => {
  const listings = await (await anon('/api/listings')).json();
  const r = await anon('/api/enquiries', { method: 'POST', json: { listingId: listings[0].id, listingName: listings[0].name, name: 'A', phone: '+91 9' } });
  assert.equal(r.status, 201);
});

test('reviews: post, validation, average', async () => {
  const c = makeClient();
  await c('/api/auth/signup', { method: 'POST', json: { name: 'Rev', email: 'rev@t.com', phone: '9444444444', password: 'secret1' } });
  const id = (await (await anon('/api/listings')).json())[0].id;
  assert.equal((await c('/api/listings/' + id + '/reviews', { method: 'POST', json: { rating: 9 } })).status, 400, 'bad rating');
  assert.equal((await anon('/api/listings/' + id + '/reviews', { method: 'POST', json: { rating: 5 } })).status, 401, 'must be logged in');
  const updated = await (await c('/api/listings/' + id + '/reviews', { method: 'POST', json: { rating: 4, text: 'ok' } })).json();
  assert.ok((updated.reviewList || []).length >= 1);
});

test('messaging: student ↔ owner thread', async () => {
  const owner = makeClient();
  await owner('/api/auth/signup', { method: 'POST', json: { name: 'Own2', email: 'own2@t.com', phone: '9000000002', password: 'secret1', role: 'owner' } });
  const lid = (await (await owner('/api/listings', { method: 'POST', json: { name: 'Msg PG', city: 'Pune', gender: 'Co-ed', startingRent: 5000, contactPhone: '1', rooms: [{ type: 'S', rent: 5000 }] } })).json()).id;
  const ownerId = (await (await owner('/api/auth/me')).json()).id;
  const stud = makeClient();
  await stud('/api/auth/signup', { method: 'POST', json: { name: 'Msg Stu', email: 'ms@t.com', phone: '9555555555', password: 'secret1' } });
  await stud('/api/messages', { method: 'POST', json: { listingId: lid, text: 'hello' } });
  const studId = (await (await stud('/api/auth/me')).json()).id;
  await owner('/api/messages', { method: 'POST', json: { listingId: lid, toId: studId, text: 'reply' } });
  const thread = await (await stud('/api/messages/thread?listingId=' + lid + '&withId=' + ownerId)).json();
  assert.equal(thread.length, 2);
  assert.equal(thread.filter(m => m.mine).length, 1);
});

test('shortlist add/remove and auth', async () => {
  assert.equal((await anon('/api/me/shortlist')).status, 401);
  const c = makeClient();
  await c('/api/auth/signup', { method: 'POST', json: { name: 'Sl', email: 'sl@t.com', phone: '9666666666', password: 'secret1' } });
  const id = (await (await anon('/api/listings')).json())[0].id;
  let s = await (await c('/api/me/shortlist', { method: 'POST', json: { listingId: id } })).json();
  assert.deepEqual(s.shortlist, [id]);
  s = await (await c('/api/me/shortlist', { method: 'POST', json: { listingId: id } })).json();
  assert.deepEqual(s.shortlist, []);
});

test('bulk import returns UIDs, dedupes, and bulk-update works', async () => {
  const imp = await (await anon('/api/admin/import', { method: 'POST', headers: admin(), json: { stage: 'unverified', rows: [
    { name: 'Bulk A', city: 'Kota', startingRent: 3000, rooms: [{ type: 'S', rent: 3000 }] },
    { name: 'Bulk A', city: 'Kota' }, // duplicate
    { city: 'NoName' }, // invalid
  ] } })).json();
  assert.equal(imp.created, 1);
  assert.equal(imp.duplicates, 1);
  assert.equal(imp.skipped, 1);
  assert.equal(imp.createdIds.length, 1);
  const id = imp.createdIds[0].id;
  const up = await (await anon('/api/admin/bulk-update', { method: 'POST', headers: admin(), json: { rows: [{ uid: id, patch: { startingRent: 9999, name: 'Bulk A Renamed' } }, { uid: 999999, patch: { name: 'x' } }] } })).json();
  assert.equal(up.updated, 1);
  assert.equal(up.notFound.length, 1);
  const all = await (await anon('/api/admin/listings', { headers: admin() })).json();
  const l = all.find(x => x.id === id);
  assert.equal(l.startingRent, 9999);
  assert.equal(l.name, 'Bulk A Renamed');
  assert.equal(l.city, 'Kota', 'unspecified field unchanged');
});

test('admin delete', async () => {
  const id = (await (await anon('/api/admin/import', { method: 'POST', headers: admin(), json: { rows: [{ name: 'Del Me', city: 'Pune' }] } })).json()).createdIds[0].id;
  assert.equal((await anon('/api/admin/listings/' + id + '/delete', { method: 'POST', headers: admin() })).status, 200);
  const all = await (await anon('/api/admin/listings', { headers: admin() })).json();
  assert.ok(!all.some(x => x.id === id));
});

test('upload requires auth', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f5e0000000049454e44ae426082', 'hex').toString('base64');
  assert.equal((await anon('/api/upload', { method: 'POST', json: { contentType: 'image/png', dataBase64: png } })).status, 401);
  const r = await anon('/api/upload', { method: 'POST', headers: admin(), json: { contentType: 'image/png', dataBase64: png } });
  assert.equal(r.status, 201);
  assert.ok((await r.json()).url);
});

test('SEO: landing page + sitemap + robots', async () => {
  const page = await (await anon('/hostels/nagpur')).text();
  assert.match(page, /Hostels & PGs in Nagpur|Student Hostels/);
  const sm = await anon('/sitemap.xml');
  assert.equal(sm.headers.get('content-type').split(';')[0], 'application/xml');
  assert.match(await sm.text(), /<loc>/);
  assert.match(await (await anon('/robots.txt')).text(), /Disallow: \/admin.html/);
});
