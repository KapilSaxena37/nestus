// NestUs server — zero external dependencies, uses only Node built-ins.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getListings, getListing, addListing, setStatus, getPending,
  addEnquiry, getEnquiries, cities, ensureSeed, USE_SUPABASE,
} from './db.js';

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
