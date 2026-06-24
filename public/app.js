// ---- NestUs frontend ----
const state = { filters: {}, chips: new Set(), currentListing: null, selectedRoom: null, user: null, authMode: 'signup', ownerPhotos: [], detailPhoto: 0 };

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
  const sel = $('s-city');
  const names = Object.keys(cities);
  sel.innerHTML = names.map(c => `<option>${c}</option>`).join('') || '<option>Nagpur</option>';

  const total = Object.values(cities).reduce((a, b) => a + b, 0);
  $('home-stats').innerHTML = `
    <div class="stat"><div class="num">${total}+</div><div class="lbl">Verified listings</div></div>
    <div class="stat"><div class="num">${names.length}</div><div class="lbl">Cities</div></div>
    <div class="stat"><div class="num">4.4★</div><div class="lbl">Avg. rating</div></div>`;
  $('home-cities').innerHTML = names.map(c => `
    <div class="citycard" onclick="quickCity('${c}')">
      <div class="cn">${c}</div><div class="cc">${cities[c]} listing${cities[c] > 1 ? 's' : ''} available</div>
    </div>`).join('');
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
  const rooms = (l.rooms || []).map((r, i) => `
    <div class="roomrow ${state.selectedRoom && r.type === state.selectedRoom.type ? 'sel' : ''}" onclick="selRoom(${i})">
      <span class="rt">${r.type}</span><span class="rp">${money(r.rent)}/mo</span>
    </div>`).join('');
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
        <div class="dmeta">📍 ${l.area}, ${l.city}${l.distance ? ' · ' + l.distance : ''}
          ${l.verified ? ' · <b style="color:var(--green)">✓ Verified</b>' : ''}</div>
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
      </div>
      <div>
        <div class="bookbox">
          <div style="font-weight:800;margin-bottom:12px">Room types <span style="font-size:11px;font-weight:400;color:var(--muted)">(tap to select)</span></div>
          ${rooms || '<div style="color:var(--muted);font-size:13px">Contact owner for room details.</div>'}
          <div style="font-size:13px;color:var(--muted);margin:12px 0">Selected: <b id="sel-label">${sr.type ? sr.type + ' — ' + money(sr.rent) + '/mo' : money(l.startingRent) + '/mo'}</b></div>
          <button class="btn" onclick="openContact()">Contact owner</button>
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
  const rent = Number($('o-rent').value), phone = $('o-phone').value.trim();
  if (!name || !rent || !phone) return toast('Please fill name, rent and contact phone');

  const amenities = [...document.querySelectorAll('#o-amen input:checked')].map(c => c.value);
  const payload = {
    name, city, area: $('o-area').value.trim(), nearCollege: $('o-college').value.trim(),
    distance: $('o-college').value.trim() ? 'Near ' + $('o-college').value.trim() : '',
    gender: $('o-gender').value, startingRent: rent,
    foodIncluded: $('o-food').value === 'true', hasAC: amenities.includes('AC'),
    availableFrom: $('o-date').value, amenities,
    description: $('o-desc').value.trim(), contactPhone: phone, contactWhatsApp: $('o-wa').value.trim(),
    rooms: [{ type: 'Starting from', rent }],
    photos: [...state.ownerPhotos],
  };
  const res = await api('/api/listings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (res.error) return toast(res.error);
  toast('Submitted! We\'ll verify and publish it soon.');
  ['o-name', 'o-area', 'o-college', 'o-rent', 'o-phone', 'o-wa', 'o-desc'].forEach(id => $(id).value = '');
  state.ownerPhotos = [];
  renderPhotoPreviews();
  setTimeout(() => route('home'), 1500);
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
  $('nav-login').style.display = loggedIn ? 'none' : '';
  $('nav-signup').style.display = loggedIn ? 'none' : '';
  $('nav-saved').style.display = loggedIn ? '' : 'none';
  $('nav-user').style.display = loggedIn ? 'inline-flex' : 'none';
  if (loggedIn) {
    $('nav-username').textContent = 'Hi, ' + state.user.name.split(' ')[0];
    const n = (state.user.shortlist || []).length;
    $('nav-saved').textContent = n ? `♥ Saved (${n})` : '♥ Saved';
  }
}

function isSaved(id) { return !!state.user && (state.user.shortlist || []).includes(id); }

function openAuth(mode) {
  state.authMode = mode;
  switchAuthTab(mode);
  $('auth-err').style.display = 'none';
  $('au-name').value = ''; $('au-email').value = ''; $('au-pass').value = '';
  $('auth-modal').classList.add('show');
}
function closeAuth() { $('auth-modal').classList.remove('show'); }

function switchAuthTab(mode) {
  state.authMode = mode;
  $('at-signup').classList.toggle('on', mode === 'signup');
  $('at-login').classList.toggle('on', mode === 'login');
  $('auth-name-field').style.display = mode === 'signup' ? 'block' : 'none';
  $('auth-submit').textContent = mode === 'signup' ? 'Create account' : 'Log in';
  $('auth-sub').textContent = mode === 'signup'
    ? 'Create a free account to save hostels you like.'
    : 'Welcome back — log in to your account.';
  $('auth-err').style.display = 'none';
}

async function submitAuth() {
  const email = $('au-email').value.trim(), password = $('au-pass').value;
  const err = $('auth-err');
  const body = { email, password };
  if (state.authMode === 'signup') body.name = $('au-name').value.trim();
  const res = await fetch('/api/auth/' + state.authMode, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) { err.textContent = data.error || 'Something went wrong'; err.style.display = 'block'; return; }
  state.user = data;
  updateNav();
  closeAuth();
  toast(state.authMode === 'signup' ? 'Welcome to NestUs, ' + data.name.split(' ')[0] + '!' : 'Logged in');
  if (state.currentListing) renderDetail(); // refresh Save button if on a listing
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

initHome();
loadAuthState();
