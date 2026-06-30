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

function shell({ title, desc, h1, intro, cardsHTML, crossHTML, count, canonical }) {
  // Pages with fewer than 3 listings are 'thin' — tell Google not to index them
  // (avoids doorway/thin-content penalties), but still let it follow the links.
  const robots = count >= 3 ? 'index,follow' : 'noindex,follow';
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${esc(canonical || '')}">
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
  <footer>© ${new Date().getFullYear()} NestUs · nestus.in · <a href="/privacy" style="color:var(--mut)">Privacy</a> · <a href="/terms" style="color:var(--mut)">Terms</a></footer>
</div>
</body></html>`;
}

export async function renderLanding(kind, slug, canonical) {
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

  return shell({ title, desc, h1, intro, cardsHTML: matched.map(cardHTML).join(''), crossHTML, count: matched.length, canonical });
}

function policyShell(title, heading, bodyHTML, canonical) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title><meta name="robots" content="index,follow">
<link rel="canonical" href="${esc(canonical || '')}">
<style>
:root{--p:#3C3489;--p2:#534AB7;--line:#e7e6f0;--mut:#777;}
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
body{background:#f4f4f8;color:#1c1b2e;line-height:1.6;}
.nav{background:var(--p);color:#fff;padding:14px 22px;}.nav a{color:#fff;text-decoration:none;font-weight:800;font-size:20px;}
.wrap{max-width:780px;margin:0 auto;padding:30px 18px 60px;background:#fff;}
h1{font-size:26px;color:var(--p);margin:10px 0 6px;}h2{font-size:17px;color:var(--p2);margin:22px 0 8px;}
p,li{font-size:14px;color:#333;margin-bottom:8px;}ul{padding-left:20px;}
.upd{color:var(--mut);font-size:13px;margin-bottom:18px;}
.note{background:#FFF7E6;border:1px solid #f0d9a0;border-radius:10px;padding:12px;font-size:13px;color:#7a5a00;margin:18px 0;}
a.in{color:var(--p2);font-weight:600;}
footer{text-align:center;color:var(--mut);font-size:12px;margin-top:24px;}
</style></head><body>
<div class="nav"><a href="/">Nest<span style="color:#c9c3f7">Us</span></a></div>
<div class="wrap">
<h1>${esc(heading)}</h1>
<div class="upd">Last updated: 30 June 2026</div>
<div class="note">This is a starting template provided for convenience. Please have it reviewed by a qualified lawyer before relying on it, and adapt it to your actual practices.</div>
${bodyHTML}
<footer><a class="in" href="/">← Back to NestUs</a> · <a class="in" href="/privacy">Privacy</a> · <a class="in" href="/terms">Terms</a></footer>
</div></body></html>`;
}

function privacyBody() {
  return `
<p>NestUs ("we", "us") operates the website nestus.in, which helps students discover hostels and paying-guest (PG) accommodation and lets property owners list their properties. This policy explains what personal data we collect, why, and your rights under India's Digital Personal Data Protection Act, 2023 (DPDP Act).</p>
<h2>1. Information we collect</h2>
<ul>
<li><b>Account data:</b> your name, email address, mobile number and password (stored securely, hashed) when you sign up as a student or owner.</li>
<li><b>Listing data (owners):</b> property details, address, photos, pricing, contact number and amenities you submit.</li>
<li><b>Enquiries & messages:</b> details you send when contacting an owner or messaging through the platform.</li>
<li><b>Usage data:</b> basic technical information such as your IP address and device/browser type.</li>
</ul>
<h2>2. How we use your data</h2>
<ul>
<li>To create and manage your account and show you relevant hostels/PGs.</li>
<li>To connect students with owners (your enquiry/contact details are shared with the relevant owner, and vice-versa).</li>
<li>To verify and display property listings.</li>
<li>To keep the service secure and to respond to support requests.</li>
</ul>
<h2>3. Sharing</h2>
<p>We do not sell your personal data. Owner contact details on a published listing are visible to users so they can get in touch. When you send an enquiry or message, the recipient receives your name and contact details. We use trusted service providers (such as our hosting and database providers) to operate the platform.</p>
<h2>4. Your rights</h2>
<p>Under the DPDP Act you may request access to, correction of, or deletion of your personal data, and you may withdraw consent at any time. To exercise these rights, email <a class="in" href="mailto:nestus.care@gmail.com">nestus.care@gmail.com</a>.</p>
<h2>5. Data retention & security</h2>
<p>We keep your data only as long as needed to provide the service or as required by law, and we take reasonable measures to protect it. No method of transmission over the internet is completely secure.</p>
<h2>6. Children</h2>
<p>NestUs is intended for users aged 18 and above. If you are a minor, please use the platform with a parent or guardian.</p>
<h2>7. Grievances & contact</h2>
<p>For any privacy questions or complaints, contact our grievance contact at <a class="in" href="mailto:nestus.care@gmail.com">nestus.care@gmail.com</a>. We will respond within a reasonable time.</p>`;
}

function termsBody() {
  return `
<p>These Terms of Use govern your use of nestus.in ("NestUs"). By using the platform you agree to these terms.</p>
<h2>1. What NestUs is</h2>
<p>NestUs is a discovery platform that connects students looking for hostels/PGs with property owners. We are <b>not</b> the owner, operator, landlord or agent of any property listed, and we do not handle rent or bookings. Any agreement is strictly between the student and the owner.</p>
<h2>2. Eligibility</h2>
<p>You must be 18 or older (or use the platform with a parent/guardian) and provide accurate information.</p>
<h2>3. For owners</h2>
<ul>
<li>You must own or be authorised to list the property, and provide accurate, current details, pricing and photos you have the right to use.</li>
<li>You consent to your listing and contact details being shown publicly so students can contact you.</li>
<li>Listing on NestUs is currently free; we may verify listings before publishing them.</li>
</ul>
<h2>4. For students</h2>
<p>Verify details directly with the owner and inspect the property before making any payment. NestUs does not guarantee availability, accuracy, quality or safety of any listing, and is not responsible for dealings between you and an owner.</p>
<h2>5. Acceptable use</h2>
<p>Do not post false, misleading, unlawful or offensive content, attempt to disrupt the service, or misuse other users' contact details.</p>
<h2>6. Content & intellectual property</h2>
<p>Content you submit remains yours, but you grant NestUs a licence to display it on the platform. The NestUs name, design and software are ours.</p>
<h2>7. Disclaimer & liability</h2>
<p>The service is provided "as is" without warranties. To the extent permitted by law, NestUs is not liable for any loss arising from listings, dealings between users, or use of the platform.</p>
<h2>8. Governing law</h2>
<p>These terms are governed by the laws of India. Questions: <a class="in" href="mailto:nestus.care@gmail.com">nestus.care@gmail.com</a>.</p>`;
}

export function renderPolicy(kind, canonical) {
  return kind === 'privacy'
    ? policyShell('Privacy Policy — NestUs', 'Privacy Policy', privacyBody(), canonical)
    : policyShell('Terms of Use — NestUs', 'Terms of Use', termsBody(), canonical);
}

export async function renderSitemap(origin) {
  const all = await getListings({});
  const urls = new Set([origin + '/', origin + '/privacy', origin + '/terms']);
  const tally = (key) => {
    const m = {}; all.forEach(l => { const v = l[key]; if (v) m[v] = (m[v] || 0) + 1; }); return m;
  };
  // Cities are broad — always include. Near/area only when substantial (3+) to avoid thin pages.
  Object.keys(tally('city')).forEach(c => urls.add(`${origin}/hostels/${slugify(c)}`));
  Object.entries(tally('nearCollege')).forEach(([c, n]) => { if (n >= 3) urls.add(`${origin}/near/${slugify(c)}`); });
  Object.entries(tally('area')).forEach(([a, n]) => { if (n >= 3) urls.add(`${origin}/area/${slugify(a)}`); });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [...urls].map(u => `  <url><loc>${u}</loc></url>`).join('\n') + `\n</urlset>`;
}
