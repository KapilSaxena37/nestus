// Server-rendered SEO landing pages: /hostels/:city, /near/:college, /area/:area
// These are real HTML (crawlable by Google) and link into the SPA via /?listing=ID.
import { getListings } from './db.js';

const slugify = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const deslug = s => String(s || '').split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');

function cardHTML(l) {
  const photo = l.photos && l.photos[0];
  const img = photo
    ? `<div class="cimg" style="background-image:url('${esc(photo)}')"></div>`
    : `<div class="cimg ph">🏠</div>`;
  const badge = l.verified ? '<span class="vb">✓ Verified</span>' : '';
  return `<a class="card" href="/?listing=${l.id}">
    ${img}
    <div class="cb">
      <div class="cn">${esc(l.name)} ${badge}</div>
      <div class="cm">📍 ${esc(l.distance || (l.area + ', ' + l.city))}</div>
      <div class="cp">${money(l.startingRent)} <span>/mo onwards</span></div>
    </div></a>`;
}

function shell({ title, desc, h1, intro, cardsHTML, crossHTML, count }) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="">
<style>
:root{--p:#3C3489;--p2:#534AB7;--l:#EEEDFE;--g:#0F6E56;--line:#e7e6f0;--mut:#777;}
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
body{background:#f4f4f8;color:#1c1b2e;}
.nav{background:var(--p);color:#fff;padding:14px 22px;display:flex;justify-content:space-between;align-items:center;}
.nav a{color:#fff;text-decoration:none;}.brand{font-weight:800;font-size:20px;}
.wrap{max-width:1040px;margin:0 auto;padding:26px 18px 60px;}
h1{font-size:27px;color:var(--p);margin-bottom:10px;letter-spacing:-.5px;}
.intro{color:#444;line-height:1.6;margin-bottom:22px;max-width:760px;}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;display:block;transition:.15s;}
.card:hover{box-shadow:0 10px 26px rgba(83,74,183,.14);transform:translateY(-3px);}
.cimg{height:140px;background:var(--l) center/cover;display:flex;align-items:center;justify-content:center;font-size:40px;}
.cb{padding:14px;}.cn{font-weight:800;font-size:16px;}.cm{font-size:12px;color:var(--mut);margin:5px 0;}
.cp{font-size:17px;font-weight:800;color:var(--p2);}.cp span{font-size:12px;color:var(--mut);font-weight:600;}
.vb{font-size:11px;font-weight:700;color:#fff;background:var(--g);padding:2px 7px;border-radius:10px;}
.sec{font-size:18px;font-weight:800;margin:34px 0 12px;}
.cross{display:flex;flex-wrap:wrap;gap:8px;}
.cross a{background:#fff;border:1px solid var(--line);border-radius:20px;padding:7px 14px;font-size:13px;color:var(--p);text-decoration:none;font-weight:600;}
.cta{background:linear-gradient(135deg,var(--p),#7a6fd6);color:#fff;border-radius:16px;padding:26px;text-align:center;margin-top:34px;}
.cta a{display:inline-block;margin-top:12px;background:#fff;color:var(--p);padding:11px 24px;border-radius:10px;font-weight:800;text-decoration:none;}
.empty{background:#fff;border:1px solid var(--line);border-radius:14px;padding:30px;text-align:center;color:var(--mut);}
footer{text-align:center;color:var(--mut);font-size:12px;margin-top:30px;}
</style>
</head><body>
<div class="nav"><a href="/" class="brand">Nest<span style="color:#c9c3f7">Us</span></a><a href="/">Search all →</a></div>
<div class="wrap">
  <h1>${esc(h1)}</h1>
  <p class="intro">${esc(intro)}</p>
  ${count ? `<div class="cards">${cardsHTML}</div>` : `<div class="empty">No listings here yet. <a href="/" style="color:var(--p2);font-weight:700">Browse all hostels &amp; PGs →</a></div>`}
  <div class="sec">Explore more</div>
  <div class="cross">${crossHTML}</div>
  <div class="cta"><div style="font-size:20px;font-weight:800">List your property on NestUs — free</div><div style="opacity:.9;margin-top:6px">Reach students searching in your area.</div><a href="/">Get started →</a></div>
  <footer>© ${new Date().getFullYear()} NestUs · nestus.in</footer>
</div>
</body></html>`;
}

export async function renderLanding(kind, slug) {
  const all = await getListings({});
  let matched, h1, title, desc, intro, label;
  if (kind === 'city') {
    matched = all.filter(l => slugify(l.city) === slug);
    label = matched[0] ? matched[0].city : deslug(slug);
    h1 = `Student Hostels & PGs in ${label}`;
    title = `Hostels & PGs in ${label} | Boys & Girls | NestUs`;
    desc = `Find verified student hostels and PGs in ${label}. Compare rent, food, AC and safety, and contact owners directly on NestUs.`;
    intro = `Browse ${matched.length} verified hostels and PGs in ${label} for students — with photos, room types, rent and safety details. No brokers, contact owners directly.`;
  } else if (kind === 'near') {
    matched = all.filter(l => slugify(l.nearCollege) === slug);
    label = matched[0] ? matched[0].nearCollege : deslug(slug);
    h1 = `Hostels & PGs near ${label}`;
    title = `Hostels & PGs near ${label} | NestUs`;
    desc = `Verified student hostels and PGs near ${label}. Walk to class — compare options, prices and safety on NestUs.`;
    intro = `Hostels and PGs close to ${label}, so you spend less time commuting and more on studies. ${matched.length} option(s) with verified details.`;
  } else {
    matched = all.filter(l => slugify(l.area) === slug);
    label = matched[0] ? matched[0].area : deslug(slug);
    h1 = `Hostels & PGs in ${label}`;
    title = `Hostels & PGs in ${label} | NestUs`;
    desc = `Student hostels and PGs in ${label}. Compare rent, food and amenities and contact owners directly on NestUs.`;
    intro = `Student accommodation in ${label} — ${matched.length} verified hostels and PGs with photos, pricing and safety info.`;
  }

  // Cross-links from distinct values across all listings.
  const cities = [...new Set(all.map(l => l.city).filter(Boolean))];
  const colleges = [...new Set(all.map(l => l.nearCollege).filter(Boolean))];
  const areas = [...new Set(all.map(l => l.area).filter(Boolean))];
  const crossHTML =
    cities.map(c => `<a href="/hostels/${slugify(c)}">Hostels in ${esc(c)}</a>`).join('') +
    colleges.slice(0, 15).map(c => `<a href="/near/${slugify(c)}">Near ${esc(c)}</a>`).join('') +
    areas.slice(0, 15).map(a => `<a href="/area/${slugify(a)}">${esc(a)} area</a>`).join('');

  return shell({ title, desc, h1, intro, cardsHTML: matched.map(cardHTML).join(''), crossHTML, count: matched.length });
}

export async function renderSitemap(origin) {
  const all = await getListings({});
  const urls = new Set([origin + '/']);
  [...new Set(all.map(l => l.city).filter(Boolean))].forEach(c => urls.add(`${origin}/hostels/${slugify(c)}`));
  [...new Set(all.map(l => l.nearCollege).filter(Boolean))].forEach(c => urls.add(`${origin}/near/${slugify(c)}`));
  [...new Set(all.map(l => l.area).filter(Boolean))].forEach(a => urls.add(`${origin}/area/${slugify(a)}`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [...urls].map(u => `  <url><loc>${u}</loc></url>`).join('\n') + `\n</urlset>`;
}
