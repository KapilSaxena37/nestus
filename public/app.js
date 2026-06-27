// ---- NestUs frontend ----
const state = { filters: {}, chips: new Set(), currentListing: null, selectedRoom: null, user: null, authMode: 'signup', authRole: 'student', ownerPhotos: [], detailPhoto: 0, editId: null, ownerLat: null, ownerLng: null, roomRows: [] };

function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function listingCode(id) { return 'NES-' + String(id).padStart(5, '0'); }

async function searchMapView() {
  const q = $('mapsearch').value.trim();
  if (!q || !_mapView) return;
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
    const d = await r.json();
    if (d.length) _mapView.setView([parseFloat(d[0].lat), parseFloat(d[0].lon)], 14);
    else toast('No match found');
  } catch { toast('Search failed'); }
}

const CITIES = ['Nagpur', 'Indore', 'Pune', 'Bhopal', 'Kota'];
const CITY_COORDS = {
  Nagpur: [21.1458, 79.0882], Indore: [22.7196, 75.8577],
  Pune: [18.5204, 73.8567], Bhopal: [23.2599, 77.4126], Kota: [25.2138, 75.8648],
};
let _mapView = null, _pickMap = null, _pickMarker = null;

const $ = (id) => document.getElementById(id);
const api = (path, opts) => fetch(path, opts).then(r => r.json());
const money = (n) => '₹' + Number(n).toLocaleString('en-IN');
const starStr = (r) => { const f = Math.round(r); return '★★★★★'.slice(0, f) + '☆☆☆☆☆'.slice(0, 5 - f); };

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function route(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('show'));
  $('v-' + view).classList.add('show');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- HOME ----------
async function initHome() {
  const cities = await api('/api/cities');
  $('s-city').innerHTML = CITIES.map(c => `<option>${c}</option>`).join('');

  const total = Object.values(cities).reduce((a, b) => a + b, 0);
  $('home-stats').innerHTML = `
    <div class="stat"><div class="num">${total}+</div><div class="lbl">Verified listings</div></div>
    <div class="stat"><div class="num">${CITIES.length}</div><div class="lbl">Cities</div></div>
    <div class="stat"><div class="num">4.4★</div><div class="lbl">Avg. rating</div></div>`;
  $('home-cities').innerHTML = CITIES.map(c => {
    const n = cities[c] || 0;
    return `<div class="citycard" onclick="quickCity('${c}')">
      <div class="cn">${c}</div><div class="cc">${n ? n + ' listing' + (n > 1 ? 's' : '') + ' available' : 'Coming soon — be the first'}</div>
    </div>`;
  }).join('');
}

function quickCity(c) { $('s-city').value = c; $('s-gender').value = 'Any'; $('s-college').value = ''; doSearch(); }

function doSearch() {
  state.filters = { city: $('s-city').value, gender: $('s-gender').value, college: $('s-college').value.trim() };
  state.chips.clear();
  document.querySelectorAll('#r-chips .chip').forEach(c => c.classList.remove('on'));
  route('results');
  loadResults();
}

// ---------- RESULTS ----------
document.querySelectorAll('#r-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('on');
    chip.classList.contains('on') ? state.chips.add(chip.dataset.f) : state.chips.delete(chip.dataset.f);
    loadResults();
  });
});

async function loadResults() {
  const f = { ...state.filters, sort: $('r-sort').value };
  state.chips.forEach(c => f[c] = 'true');
  const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v && v !== 'Any')).toString();
  const list = await api('/api/listings?' + params);

  $('results-title').textContent =
    `${list.length} hostel${list.length !== 1 ? 's' : ''} & PG${list.length !== 1 ? 's' : ''} in ${state.filters.city || 'all cities'}`;

  if (!list.length) {
    $('results-cards').innerHTML = `<div class="empty">No matches yet. Try removing some filters,<br>or be the first to <a style="color:var(--purple2);font-weight:700" onclick="route('list')">list a property here</a>.</div>`;
    return;
  }
  $('results-cards').innerHTML = list.map(cardHTML).join('');
}

function cardHTML(l) {
  const badge = l.verified
    ? '<span class="badge v">✓ Verified</span>'
    : `<span class="badge">${l.gender}</span>`;
  const tags = [l.gender, l.foodIncluded ? 'Food' : 'No food', l.hasAC ? 'AC' : 'Non-AC']
    .map(t => `<span class="tag">${t}</span>`).join('');
  const photo = l.photos && l.photos[0];
  const imgStyle = photo ? ` has-photo" style="background-image:url('${photo}')` : '';
  return `<div class="card" onclick="openDetail(${l.id})">
    <div class="cimg${imgStyle}">${photo ? '' : '🏠'}${badge}</div>
    <div class="cbody">
      <div class="cname">${l.name}</div>
      <div class="cmeta">📍 ${l.distance || (l.area + ', ' + l.city)}</div>
      <div class="stars">${starStr(l.rating)} <span style="color:var(--muted)">${l.rating || '—'} ${l.reviews ? '(' + l.reviews + ')' : ''}</span></div>
      <div class="tagrow">${tags}</div>
      <div class="price">${money(l.startingRent)} <small>/mo onwards</small></div>
    </div></div>`;
}

// ---------- DETAIL ----------
async function openDetail(id) {
  const l = await api('/api/listings/' + id);
  state.currentListing = l;
  state.selectedRoom = l.rooms && l.rooms[l.rooms.length - 1];
  state.detailPhoto = 0;
  route('detail');
  renderDetail();
}

function renderDetail() {
  const l = state.currentListing;
  const rooms = (l.rooms || []).map((r, i) => {
    const feats = [r.ac ? 'AC' : '', r.washroom ? 'Attached washroom' : '', r.furnished ? 'Furnished' : '']
      .filter(Boolean).map(f => `<span style="font-size:10px;font-weight:700;background:var(--light);color:var(--purple);padding:2px 7px;border-radius:6px">${f}</span>`).join(' ');
    return `<div class="roomrow ${state.selectedRoom && r.type === state.selectedRoom.type ? 'sel' : ''}" onclick="selRoom(${i})">
      <div><span class="rt">${r.type}</span>${feats ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${feats}</div>` : ''}</div>
      <span class="rp">${money(r.rent)}/mo</span>
    </div>`;
  }).join('');
  const amen = (l.amenities || []).map(a => `<span>${a}</span>`).join('');
  const sr = state.selectedRoom || { type: '', rent: l.startingRent };

  const photos = l.photos || [];
  const main = photos[state.detailPhoto] || photos[0];
  const galleryHTML = main
    ? `<div class="gallery has-photo" style="background-image:url('${main}')"></div>` +
      (photos.length > 1 ? `<div class="thumbs">${photos.map((p, i) =>
        `<img src="${p}" class="${i === state.detailPhoto ? 'on' : ''}" onclick="setDetailPhoto(${i})">`).join('')}</div>` : '')
    : `<div class="gallery">🏠</div>`;

  $('detail-content').innerHTML = `
    <div class="detail-grid">
      <div>
        ${galleryHTML}
        <div class="dname">${l.name}</div>
        <div style="font-size:11px;color:var(--muted);letter-spacing:.5px;margin-top:2px">ID: ${listingCode(l.id)}</div>
        <div class="dmeta">📍 ${l.area}, ${l.city}${l.distance ? ' · ' + l.distance : ''}
          ${l.verified ? ' · <b style="color:var(--green)">✓ Verified</b>' : ''}</div>
        ${l.mapLink ? `<div style="margin:-6px 0 10px"><a href="${l.mapLink}" target="_blank" rel="noopener" style="color:var(--purple2);font-weight:700">📍 Open in Google Maps</a></div>` : ''}
        <div class="stars">${starStr(l.rating)} ${l.rating || '—'} <span style="color:var(--muted);font-size:13px">${l.reviews ? l.reviews + ' reviews' : 'No reviews yet'}</span></div>
        <p style="color:var(--muted);line-height:1.6;margin-top:12px">${l.description || ''}</p>
        <div class="metrics">
          <div class="metric"><div class="ml">For</div><div class="mv">${l.gender}</div></div>
          <div class="metric"><div class="ml">Available from</div><div class="mv">${fmtDate(l.availableFrom)}</div></div>
          <div class="metric"><div class="ml">Food</div><div class="mv">${l.foodDetail || (l.foodIncluded ? 'Included' : 'Not included')}</div></div>
          <div class="metric"><div class="ml">Starting rent</div><div class="mv">${money(l.startingRent)}/mo</div></div>
        </div>
        <div class="sec" style="font-size:16px;margin:18px 0 8px">Amenities</div>
        <div class="amen">${amen || '<span>—</span>'}</div>
        ${l.rules ? `<div class="sec" style="font-size:16px;margin:18px 0 8px">House rules</div><div style="color:var(--muted);font-size:13px;line-height:1.7">${l.rules}</div>` : ''}
        ${safetyHTML(l)}
        ${reviewsHTML(l)}
      </div>
      <div>
        <div class="bookbox">
          <div style="font-weight:800;margin-bottom:12px">Room types <span style="font-size:11px;font-weight:400;color:var(--muted)">(tap to select)</span></div>
          ${rooms || '<div style="color:var(--muted);font-size:13px">Contact owner for room details.</div>'}
          <div style="font-size:13px;color:var(--muted);margin:12px 0">Selected: <b id="sel-label">${sr.type ? sr.type + ' — ' + money(sr.rent) + '/mo' : money(l.startingRent) + '/mo'}</b></div>
          <button class="btn" onclick="openContact()">Contact owner</button>
          ${l.ownerId && (!state.user || state.user.id !== l.ownerId) ? `<button class="btn alt" onclick="messageOwner(${l.ownerId}, ${l.id})">💬 Message owner</button>` : ''}
          <button class="btn alt" id="save-btn" onclick="toggleSave(${l.id})">${isSaved(l.id) ? '♥ Saved' : '♡ Save'}</button>
          <div class="note">Phone &amp; WhatsApp · online booking coming soon</div>
        </div>
      </div>
    </div>`;
}

function selRoom(i) {
  state.selectedRoom = state.currentListing.rooms[i];
  renderDetail();
}

function safetyHTML(l) {
  const sf = l.safety || {};
  const badges = [
    sf.guard && 'Security guard', sf.warden && 'Warden on-site',
    sf.biometric && 'Biometric / gated entry', sf.visitorRegister && 'Visitor register',
  ].filter(Boolean);
  const times = [];
  if (sf.checkIn) times.push('Check-in: ' + sf.checkIn);
  if (sf.checkOut) times.push('Check-out / curfew: ' + sf.checkOut);
  if (!badges.length && !times.length) return '';
  return `<div class="sec" style="font-size:16px;margin:18px 0 8px">Safety</div>
    ${badges.length ? `<div class="safetyrow">${badges.map(b => `<span>🛡️ ${b}</span>`).join('')}</div>` : ''}
    ${times.length ? `<div style="font-size:13px;color:var(--muted)">${times.join(' · ')}</div>` : ''}`;
}

function reviewsHTML(l) {
  const rl = l.reviewList || [];
  const form = state.user
    ? `<div class="reviewform">
        <div style="font-size:13px;font-weight:700;margin-bottom:6px">Rate this place</div>
        <select id="rv-rating">
          <option value="5">★★★★★ Excellent</option>
          <option value="4">★★★★ Good</option>
          <option value="3">★★★ Okay</option>
          <option value="2">★★ Poor</option>
          <option value="1">★ Bad</option>
        </select>
        <textarea id="rv-text" placeholder="Share your experience (optional)"></textarea>
        <button class="btn alt" onclick="submitReview(${l.id})">Post review</button>
      </div>`
    : `<div style="font-size:13px;color:var(--muted)">Please <a style="color:var(--purple2);font-weight:700;cursor:pointer" onclick="openAuth('login')">log in</a> to leave a review.</div>`;
  const items = rl.length
    ? rl.slice().reverse().map(r => `<div class="reviewitem">
        <div><b>${r.name}</b> <span class="stars">${starStr(r.rating)}</span></div>
        ${r.text ? `<div style="font-size:13px;margin-top:3px">${r.text}</div>` : ''}
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${fmtDate(r.createdAt)}</div>
      </div>`).join('')
    : `<div style="font-size:13px;color:var(--muted)">No reviews yet — be the first.</div>`;
  return `<div class="sec" style="font-size:16px;margin:22px 0 10px">Reviews ${rl.length ? `(${rl.length})` : ''}</div>${form}${items}`;
}

async function submitReview(id) {
  const rating = $('rv-rating').value;
  const text = $('rv-text').value.trim();
  const res = await fetch('/api/listings/' + id + '/reviews', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, text }),
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || 'Could not post review');
  state.currentListing = data;
  renderDetail();
  toast('Thanks for your review!');
}
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return d; }
}

// ---------- CONTACT MODAL ----------
function openContact() {
  const l = state.currentListing;
  $('modal-form').style.display = 'block';
  $('modal-ok').style.display = 'none';
  $('modal-sub').textContent = `Send your details to ${l.name}, or reach them directly.`;
  $('modal-phone').textContent = l.contactPhone ? '📞 ' + l.contactPhone : '';
  const wa = $('wa-btn');
  if (l.contactWhatsApp) {
    wa.style.display = 'block';
    wa.onclick = () => window.open(`https://wa.me/${l.contactWhatsApp}?text=${encodeURIComponent('Hi, I found ' + l.name + ' on NestUs and I\'m interested.')}`, '_blank');
  } else wa.style.display = 'none';
  $('modal').classList.add('show');
}
function closeModal() { $('modal').classList.remove('show'); }

async function sendEnquiry() {
  const name = $('e-name').value.trim(), phone = $('e-phone').value.trim();
  if (!name || !phone) return toast('Please add your name and phone');
  await api('/api/enquiries', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listingId: state.currentListing.id, listingName: state.currentListing.name, name, phone, message: $('e-msg').value.trim() }),
  });
  $('modal-form').style.display = 'none';
  $('modal-ok').style.display = 'block';
  $('e-name').value = ''; $('e-phone').value = ''; $('e-msg').value = '';
}

// ---------- OWNER LISTING ----------
async function submitListing() {
  const name = $('o-name').value.trim(), city = $('o-city').value;
  const phone = $('o-phone').value.trim();
  if (!name || !phone) return toast('Please fill property name and contact phone');

  const rooms = state.roomRows
    .filter(r => r.type && String(r.type).trim() && Number(r.rent) > 0)
    .map(r => ({ type: String(r.type).trim(), rent: Number(r.rent), ac: !!r.ac, washroom: !!r.washroom, furnished: !!r.furnished }));
  if (!rooms.length) return toast('Please add at least one room type with a price');
  const startingRent = Math.min(...rooms.map(r => r.rent));

  const amenities = [...document.querySelectorAll('#o-amen input:checked')].map(c => c.value);
  const safety = {
    guard: $('sf-guard').checked, warden: $('sf-warden').checked,
    biometric: $('sf-biometric').checked, visitorRegister: $('sf-visitors').checked,
    checkIn: $('sf-checkin').value.trim(), checkOut: $('sf-checkout').value.trim(),
  };
  const payload = {
    name, city, area: $('o-area').value.trim(), nearCollege: $('o-college').value.trim(),
    distance: $('o-college').value.trim() ? 'Near ' + $('o-college').value.trim() : '',
    gender: $('o-gender').value, startingRent,
    foodIncluded: $('o-food').value === 'true', hasAC: rooms.some(r => r.ac) || amenities.includes('AC'),
    availableFrom: $('o-date').value, amenities, safety,
    mapLink: $('o-maplink').value.trim(),
    description: $('o-desc').value.trim(), contactPhone: phone, contactWhatsApp: $('o-wa').value.trim(),
    rooms,
    photos: [...state.ownerPhotos],
  };
  if (state.ownerLat != null && state.ownerLng != null) { payload.lat = state.ownerLat; payload.lng = state.ownerLng; }
  const editing = !!state.editId;
  const res = await api(editing ? '/api/listings/' + state.editId : '/api/listings', {
    method: editing ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.error) return toast(res.error);
  clearOwnerForm();
  if (editing) {
    state.editId = null;
    toast('Changes saved — sent for re-verification.');
    setTimeout(goDash, 1000);
  } else {
    toast('Submitted! We\'ll verify and publish it soon.');
    setTimeout(() => state.user && state.user.role === 'owner' ? goDash() : route('home'), 1200);
  }
}

function clearOwnerForm() {
  ['o-name', 'o-area', 'o-college', 'o-phone', 'o-wa', 'o-desc', 'o-maplink', 'sf-checkin', 'sf-checkout'].forEach(id => { if ($(id)) $(id).value = ''; });
  ['sf-guard', 'sf-warden', 'sf-biometric', 'sf-visitors'].forEach(id => { if ($(id)) $(id).checked = false; });
  document.querySelectorAll('#o-amen input').forEach(cb => { cb.checked = cb.value === 'WiFi'; });
  state.ownerPhotos = [];
  renderPhotoPreviews();
}

// ---------- PHOTO UPLOAD ----------
function setDetailPhoto(i) { state.detailPhoto = i; renderDetail(); }

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]); // strip data: prefix
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function uploadPhotos(files) {
  const status = $('o-photo-status');
  for (const file of files) {
    if (!file.type.startsWith('image/')) { status.textContent = 'Only image files are allowed.'; continue; }
    if (file.size > 5 * 1024 * 1024) { status.textContent = `"${file.name}" is over 5 MB — please pick a smaller image.`; continue; }
    status.textContent = `Uploading ${file.name}…`;
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await fetch('/api/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type, dataBase64 }),
      });
      const data = await res.json();
      if (!res.ok) { status.textContent = data.error || 'Upload failed'; continue; }
      state.ownerPhotos.push(data.url);
      renderPhotoPreviews();
      status.textContent = `${state.ownerPhotos.length} photo(s) added.`;
    } catch { status.textContent = 'Upload failed — please try again.'; }
  }
  $('o-photos').value = ''; // allow re-selecting the same file
}

function removePhoto(i) { state.ownerPhotos.splice(i, 1); renderPhotoPreviews(); }

function renderPhotoPreviews() {
  $('o-photo-previews').innerHTML = state.ownerPhotos.map((url, i) =>
    `<div class="pp"><img src="${url}"><button onclick="removePhoto(${i})">✕</button></div>`).join('');
}

// ---------- AUTH ----------
async function loadAuthState() {
  try {
    const r = await fetch('/api/auth/me');
    const data = await r.json();
    state.user = data && data.id ? data : null;
  } catch { state.user = null; }
  updateNav();
}

function updateNav() {
  const loggedIn = !!state.user;
  const isOwner = loggedIn && state.user.role === 'owner';
  $('nav-login').style.display = loggedIn ? 'none' : '';
  $('nav-signup').style.display = loggedIn ? 'none' : '';
  $('nav-user').style.display = loggedIn ? 'inline-flex' : 'none';
  $('nav-dash').style.display = isOwner ? '' : 'none';
  $('nav-list').style.display = isOwner ? '' : 'none';      // visible only to logged-in owners
  $('nav-messages').style.display = loggedIn ? '' : 'none';
  $('nav-bell').style.display = loggedIn ? '' : 'none';
  $('nav-saved').style.display = loggedIn && !isOwner ? '' : 'none';
  if (loggedIn) {
    $('nav-username').textContent = 'Hi, ' + state.user.name.split(' ')[0];
    const n = (state.user.shortlist || []).length;
    $('nav-saved').textContent = n ? `♥ Saved (${n})` : '♥ Saved';
    startUnreadPolling();
  } else {
    stopUnreadPolling();
  }
}

let _unreadPoll = null;
function startUnreadPolling() {
  pollUnread();
  if (!_unreadPoll) _unreadPoll = setInterval(pollUnread, 20000);
}
function stopUnreadPolling() {
  clearInterval(_unreadPoll); _unreadPoll = null;
  $('bell-badge').style.display = 'none';
}
async function pollUnread() {
  try {
    const { count } = await fetch('/api/messages/unread').then(r => r.json());
    const badge = $('bell-badge');
    if (count > 0) { badge.textContent = count > 9 ? '9+' : count; badge.style.display = 'flex'; }
    else badge.style.display = 'none';
  } catch { /* ignore */ }
}

function pickRole(role) {
  state.authRole = role;
  $('role-student').classList.toggle('on', role === 'student');
  $('role-owner').classList.toggle('on', role === 'owner');
}

function isSaved(id) { return !!state.user && (state.user.shortlist || []).includes(id); }

function openAuth(mode) {
  state.authMode = mode;
  switchAuthTab(mode);
  $('auth-err').style.display = 'none';
  $('au-name').value = ''; $('au-email').value = ''; $('au-pass').value = ''; $('au-phone').value = '';
  $('auth-modal').classList.add('show');
}
function closeAuth() { $('auth-modal').classList.remove('show'); }

function switchAuthTab(mode) {
  state.authMode = mode;
  const signup = mode === 'signup', login = mode === 'login', forgot = mode === 'forgot';
  $('at-signup').classList.toggle('on', signup);
  $('at-login').classList.toggle('on', login || forgot);
  $('auth-name-field').style.display = signup ? 'block' : 'none';
  $('auth-role-field').style.display = signup ? 'block' : 'none';
  $('auth-phone-field').style.display = (signup || forgot) ? 'block' : 'none';
  $('lbl-email').textContent = login ? 'Email or mobile number' : 'Email';
  $('lbl-pass').textContent = forgot ? 'New password' : 'Password';
  $('auth-forgot-link').style.display = login ? 'block' : 'none';
  $('auth-submit').textContent = signup ? 'Create account' : forgot ? 'Reset password' : 'Log in';
  $('auth-sub').textContent = signup
    ? 'Create a free account — students save hostels, owners list properties.'
    : forgot
      ? 'Enter your email and registered mobile number to set a new password.'
      : 'Welcome back — log in to your account.';
  $('auth-err').style.display = 'none';
}

async function submitAuth() {
  const email = $('au-email').value.trim(), password = $('au-pass').value;
  const err = $('auth-err');

  if (state.authMode === 'forgot') {
    const res = await fetch('/api/auth/forgot', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, phone: $('au-phone').value.trim(), newPassword: password }),
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error || 'Could not reset'; err.style.display = 'block'; return; }
    toast('Password reset — please log in with your new password.');
    switchAuthTab('login');
    $('au-pass').value = '';
    return;
  }

  const body = state.authMode === 'login' ? { login: email, password } : { email, password };
  if (state.authMode === 'signup') {
    body.name = $('au-name').value.trim();
    body.phone = $('au-phone').value.trim();
    body.role = state.authRole;
  }
  const res = await fetch('/api/auth/' + state.authMode, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) { err.textContent = data.error || 'Something went wrong'; err.style.display = 'block'; return; }
  const wasSignup = state.authMode === 'signup';
  state.user = data;
  updateNav();
  closeAuth();
  toast(wasSignup ? 'Welcome to NestUs, ' + data.name.split(' ')[0] + '!' : 'Logged in');
  if (data.role === 'owner') goDash();
  else if (state.currentListing) renderDetail(); // refresh Save button if on a listing
}

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  state.user = null;
  updateNav();
  toast('Logged out');
  if (document.getElementById('v-saved').classList.contains('show')) route('home');
  if (state.currentListing && document.getElementById('v-detail').classList.contains('show')) renderDetail();
}

async function toggleSave(id) {
  if (!state.user) { openAuth('signup'); $('auth-sub').textContent = 'Create a free account to save this hostel.'; return; }
  const res = await fetch('/api/me/shortlist', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: id }),
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || 'Could not save');
  state.user.shortlist = data.shortlist;
  updateNav();
  renderDetail();
  toast(isSaved(id) ? 'Saved to your list' : 'Removed from saved');
}

function goSaved() { route('saved'); loadSaved(); }

async function loadSaved() {
  const res = await fetch('/api/me/shortlist');
  if (!res.ok) { route('home'); return openAuth('login'); }
  const list = await res.json();
  if (!list.length) {
    $('saved-cards').innerHTML = `<div class="empty">You haven't saved any hostels yet.<br>Tap <b>♡ Save</b> on a listing to keep it here.</div>`;
    return;
  }
  $('saved-cards').innerHTML = list.map(cardHTML).join('');
}

// ---------- ROOM TYPES EDITOR ----------
function addRoomRow(data) {
  state.roomRows.push(data || { type: '', rent: '', ac: false, washroom: false, furnished: false });
  renderRooms();
}
function removeRoomRow(i) { state.roomRows.splice(i, 1); renderRooms(); }
function updRoom(i, k, v) { if (state.roomRows[i]) state.roomRows[i][k] = v; }
function renderRooms() {
  $('rooms-editor').innerHTML = state.roomRows.map((r, i) => `
    <div class="roomedit">
      <div class="row2">
        <div class="field" style="margin-bottom:8px"><label>Room type</label>
          <input value="${escAttr(r.type)}" oninput="updRoom(${i},'type',this.value)" placeholder="e.g. Single occupancy"></div>
        <div class="field" style="margin-bottom:8px"><label>Rent (₹/mo)</label>
          <input type="number" value="${escAttr(r.rent)}" oninput="updRoom(${i},'rent',this.value)" placeholder="6000"></div>
      </div>
      <div class="checks" style="margin-bottom:8px">
        <label><input type="checkbox" ${r.ac ? 'checked' : ''} onchange="updRoom(${i},'ac',this.checked)"> AC</label>
        <label><input type="checkbox" ${r.washroom ? 'checked' : ''} onchange="updRoom(${i},'washroom',this.checked)"> Attached washroom</label>
        <label><input type="checkbox" ${r.furnished ? 'checked' : ''} onchange="updRoom(${i},'furnished',this.checked)"> Furnished</label>
      </div>
      ${state.roomRows.length > 1 ? `<button type="button" class="back" style="margin:0" onclick="removeRoomRow(${i})">Remove this room</button>` : ''}
    </div>`).join('');
}

// ---------- ADDRESS SEARCH (free OpenStreetMap geocoding) ----------
async function searchAddress() {
  const q = $('pickmap-search').value.trim();
  if (!q) return;
  $('pickmap-status').textContent = 'Searching…';
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
    const data = await r.json();
    if (!data.length) { $('pickmap-status').textContent = 'No match — try a different address, or click the map.'; return; }
    const lat = parseFloat(data[0].lat), lng = parseFloat(data[0].lon);
    if (_pickMap) _pickMap.setView([lat, lng], 16);
    setPin(lat, lng);
  } catch { $('pickmap-status').textContent = 'Search failed — click the map to set the pin instead.'; }
}

// ---------- MESSAGING ----------
let _threadPoll = null;

function goMessages() { route('messages'); loadConversations(); }

async function loadConversations() {
  const res = await fetch('/api/messages');
  if (!res.ok) { route('home'); return openAuth('login'); }
  const list = await res.json();
  $('convo-list').innerHTML = list.length ? list.map(c =>
    `<div class="dash-card" style="cursor:pointer" onclick="openThread(${c.listingId}, ${c.otherId}, '${escapeJs(c.otherName)}', '${escapeJs(c.listingName)}')">
      <div class="dash-main">
        <div class="dn">${c.otherName} <span style="font-weight:500;color:var(--muted);font-size:13px">· ${c.listingName}</span></div>
        <div class="dm" style="margin-top:4px">${c.lastText}</div>
        <div style="font-size:11px;color:var(--muted)">${fmtDateTime(c.lastAt)}</div>
      </div>
    </div>`).join('') : `<div class="empty">No messages yet.<br>Open a listing and tap <b>💬 Message owner</b> to start a conversation.</div>`;
  pollUnread(); // opening the inbox clears the bell server-side
}

function escapeJs(s) { return String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function fmtDateTime(d) { try { return new Date(d).toLocaleString('en-IN'); } catch { return ''; } }

function messageOwner(ownerId, listingId) {
  if (!state.user) { openAuth('login'); return; }
  openThread(listingId, ownerId, (state.currentListing && state.currentListing.ownerName) || 'Owner',
    (state.currentListing && state.currentListing.name) || 'listing');
}

function openThread(listingId, withId, name, listingName) {
  state.thread = { listingId, withId, name, listingName };
  $('thread-title').textContent = name;
  $('thread-sub').textContent = 'About: ' + listingName;
  $('thread-modal').classList.add('show');
  loadThread();
  clearInterval(_threadPoll);
  _threadPoll = setInterval(loadThread, 4000);
}

function closeThread() {
  clearInterval(_threadPoll); _threadPoll = null;
  $('thread-modal').classList.remove('show');
  if (document.getElementById('v-messages').classList.contains('show')) loadConversations();
}

async function loadThread() {
  const t = state.thread; if (!t) return;
  const res = await fetch(`/api/messages/thread?listingId=${t.listingId}&withId=${t.withId}`);
  if (!res.ok) return;
  const msgs = await res.json();
  const box = $('thread-messages');
  box.innerHTML = msgs.length ? msgs.map(m =>
    `<div class="bubble ${m.mine ? 'mine' : 'theirs'}">${m.text}<div class="bt">${fmtDateTime(m.createdAt)}</div></div>`
  ).join('') : '<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">Say hello to start the conversation.</div>';
  box.scrollTop = box.scrollHeight;
}

async function sendMessage() {
  const t = state.thread; if (!t) return;
  const input = $('thread-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const res = await fetch('/api/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listingId: t.listingId, toId: t.withId, text }),
  });
  const data = await res.json();
  if (!res.ok) { toast(data.error || 'Could not send'); input.value = text; return; }
  loadThread();
}

// ---------- MAP ----------
function coordsFor(l, i = 0) {
  if (typeof l.lat === 'number' && typeof l.lng === 'number') return [l.lat, l.lng];
  const base = CITY_COORDS[l.city] || CITY_COORDS.Nagpur;
  // deterministic small spread so listings without a pin don't stack
  return [base[0] + ((l.id * 7) % 20 - 10) / 700, base[1] + ((l.id * 13) % 20 - 10) / 700];
}

async function goMap() {
  route('map');
  const list = await api('/api/listings');
  if (!_mapView) {
    _mapView = L.map('map').setView(CITY_COORDS.Nagpur, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(_mapView);
  } else {
    _mapView.eachLayer(layer => { if (layer instanceof L.Marker) _mapView.removeLayer(layer); });
  }
  const pts = [];
  list.forEach(l => {
    const c = coordsFor(l);
    pts.push(c);
    L.marker(c).addTo(_mapView).bindPopup(
      `<b>${l.name}</b><br>${money(l.startingRent)}/mo · ${l.gender}<br>` +
      `<a href="#" onclick="closePopupAndOpen(${l.id});return false;">View details →</a>`
    );
  });
  setTimeout(() => {
    _mapView.invalidateSize();
    if (pts.length) _mapView.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
  }, 100);
}

function closePopupAndOpen(id) { if (_mapView) _mapView.closePopup(); openDetail(id); }

function initPickMap(lat, lng) {
  const center = (typeof lat === 'number' && typeof lng === 'number')
    ? [lat, lng]
    : (CITY_COORDS[$('o-city').value] || CITY_COORDS.Nagpur);
  setTimeout(() => {
    if (!_pickMap) {
      _pickMap = L.map('pickmap').setView(center, 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(_pickMap);
      _pickMap.on('click', e => setPin(e.latlng.lat, e.latlng.lng));
    } else {
      _pickMap.setView(center, 13);
    }
    _pickMap.invalidateSize();
    if (_pickMarker) { _pickMap.removeLayer(_pickMarker); _pickMarker = null; }
    if (typeof lat === 'number' && typeof lng === 'number') setPin(lat, lng);
  }, 120);
}

function setPin(lat, lng) {
  state.ownerLat = Math.round(lat * 1e6) / 1e6;
  state.ownerLng = Math.round(lng * 1e6) / 1e6;
  if (_pickMarker) _pickMap.removeLayer(_pickMarker);
  _pickMarker = L.marker([lat, lng]).addTo(_pickMap);
  $('pickmap-status').textContent = `Pin set ✓ (${state.ownerLat}, ${state.ownerLng})`;
}

// ---------- OWNER DASHBOARD ----------
function goDash() { route('dashboard'); loadDashboard(); }

async function loadDashboard() {
  const [listings, enquiries] = await Promise.all([
    fetch('/api/me/listings').then(r => r.ok ? r.json() : []),
    fetch('/api/me/owner-enquiries').then(r => r.ok ? r.json() : []),
  ]);

  $('dash-listings').innerHTML = listings.length ? listings.map(l => {
    const photo = l.photos && l.photos[0];
    const st = l.status || 'pending';
    const avail = l.available === false;
    return `<div class="dash-card">
      <div class="dash-thumb" style="${photo ? `background-image:url('${photo}')` : ''}">${photo ? '' : '🏠'}</div>
      <div class="dash-main">
        <div class="dn">${l.name} <span style="font-weight:500;color:var(--muted);font-size:11px">${listingCode(l.id)}</span></div>
        <div class="dm">${l.area || ''}${l.area ? ', ' : ''}${l.city} · ${money(l.startingRent)}/mo onwards</div>
        <span class="statusbadge st-${st}">${st === 'approved' ? '✓ Live' : st === 'pending' ? '⏳ Awaiting review' : 'Rejected'}</span>
        ${avail ? '<span class="statusbadge st-rejected" style="margin-left:6px">Marked full</span>' : ''}
        <div class="dash-acts">
          <button class="primary" onclick="editListing(${l.id})">Edit</button>
          <button onclick="toggleAvailability(${l.id}, ${l.available === false})">${avail ? 'Mark available' : 'Mark full'}</button>
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="empty">You haven't added any properties yet.<br>Click <b>+ Add a property</b> to list your first one.</div>`;

  $('dash-enquiries').innerHTML = enquiries.length ? enquiries.slice().reverse().map(e =>
    `<div class="dash-card"><div class="dash-main">
      <div class="dn">${e.name} <span style="font-weight:500;color:var(--muted);font-size:13px">→ ${e.listingName || ('listing #' + e.listingId)}</span></div>
      <div class="dm">📞 ${e.phone} · ${new Date(e.createdAt).toLocaleString('en-IN')}</div>
      ${e.message ? `<div style="font-size:13px">${e.message}</div>` : ''}
    </div></div>`).join('') : `<div class="empty">No enquiries yet.</div>`;
}

async function toggleAvailability(id, makeAvailable) {
  await fetch('/api/listings/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ available: makeAvailable }),
  });
  toast(makeAvailable ? 'Marked available' : 'Marked full');
  loadDashboard();
}

function startNewListing() {
  state.editId = null;
  clearOwnerForm();
  state.roomRows = [];
  addRoomRow(); // one blank room to start
  $('list-title').textContent = 'List your property';
  $('list-submit').textContent = 'Submit for verification';
  state.ownerLat = null; state.ownerLng = null;
  $('pickmap-status').textContent = 'No pin set yet.';
  if (_pickMarker && _pickMap) { _pickMap.removeLayer(_pickMarker); _pickMarker = null; }
  route('list');
  initPickMap();
}

async function editListing(id) {
  const l = await api('/api/listings/' + id);
  state.editId = id;
  $('o-name').value = l.name || '';
  $('o-city').value = l.city || 'Nagpur';
  $('o-area').value = l.area || '';
  $('o-college').value = l.nearCollege || '';
  $('o-gender').value = l.gender || 'Girls';
  $('o-date').value = l.availableFrom || '';
  $('o-food').value = l.foodIncluded ? 'true' : 'false';
  $('o-phone').value = l.contactPhone || '';
  $('o-wa').value = l.contactWhatsApp || '';
  $('o-desc').value = l.description || '';
  $('o-maplink').value = l.mapLink || '';
  document.querySelectorAll('#o-amen input').forEach(cb => { cb.checked = (l.amenities || []).includes(cb.value); });
  const sf = l.safety || {};
  $('sf-guard').checked = !!sf.guard; $('sf-warden').checked = !!sf.warden;
  $('sf-biometric').checked = !!sf.biometric; $('sf-visitors').checked = !!sf.visitorRegister;
  $('sf-checkin').value = sf.checkIn || ''; $('sf-checkout').value = sf.checkOut || '';
  state.roomRows = (l.rooms || []).map(r => ({ type: r.type || '', rent: r.rent || '', ac: !!r.ac, washroom: !!r.washroom, furnished: !!r.furnished }));
  if (!state.roomRows.length) state.roomRows = [{ type: '', rent: '', ac: false, washroom: false, furnished: false }];
  renderRooms();
  state.ownerPhotos = [...(l.photos || [])];
  renderPhotoPreviews();
  $('list-title').textContent = 'Edit property';
  $('list-submit').textContent = 'Save changes';
  state.ownerLat = typeof l.lat === 'number' ? l.lat : null;
  state.ownerLng = typeof l.lng === 'number' ? l.lng : null;
  $('pickmap-status').textContent = state.ownerLat ? `Pin set ✓ (${l.lat}, ${l.lng})` : 'No pin set yet.';
  route('list');
  initPickMap(state.ownerLat, state.ownerLng);
}

initHome();
loadAuthState();
