/* ═══════════════════════════════════════════════════════════════════════
   RoadWatch — Main Application
   IIT Madras National Road Safety Hackathon 2026 · Track: RoadWatch
   ═══════════════════════════════════════════════════════════════════════ */

const API = '';   // '' = same origin
let _currentView       = 'grid';
let _activeChatRoadId  = null;
let _charts            = {};
let _mapRoads          = [];
let _map               = null;
let _markerCluster     = null;
let _currentWizardStep = 1;
let _acTimer           = null;
let _selectedMapRoadId = null;

/* ═══════════════ HELPERS ══════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const fmtAmt = (n, cur = 'INR') => {
  if (!n && n !== 0) return '—';
  const s = { INR: '₹', USD: '$', GBP: '£', BDT: '৳', ZAR: 'R', PLN: 'zł', MGA: 'Ar' };
  const sym = s[cur] || cur + ' ';
  if (n >= 1e9) return sym + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e7) return sym + (n / 1e7).toFixed(2) + ' Cr';
  if (n >= 1e5) return sym + (n / 1e5).toFixed(2) + ' L';
  return sym + n.toLocaleString();
};

const condClass = lbl =>
  ({ Excellent: 'excellent', Good: 'good', Fair: 'fair', Poor: 'poor', Critical: 'critical' }[lbl] || 'fair');
const condColor = lbl =>
  ({ Excellent: '#10b981', Good: '#3b82f6', Fair: '#f59e0b', Poor: '#f97316', Critical: '#ef4444' }[lbl] || '#f59e0b');
const sevClass = s =>
  ({ Critical: 'sev-critical', High: 'sev-high', Medium: 'sev-medium', Low: 'sev-low' }[s] || 'sev-medium');
const stClass = s => 'sp-' + (s || 'filed').toLowerCase().replace(/\s+/g, '-');

const toast = (msg, type = '') => {
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  d.textContent = msg;
  $('toastContainer').appendChild(d);
  setTimeout(() => d.classList.add('fadeout'), 2800);
  setTimeout(() => d.remove(), 3200);
};

const fmtDate = s => {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return s; }
};

/* ═══════════════ NAVIGATION ═══════════════════════════════════════════ */
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  $(id)?.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-section="${id}"]`)?.classList.add('active');
  // Close hamburger if open
  $('navLinks')?.classList.remove('open');
  $('hamburgerBtn')?.setAttribute('aria-expanded', 'false');
  // Scroll to top on section change
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (id === 'map-section' && !window._mapInit) initMap();
  if (id === 'analytics-section') loadAnalytics();
  if (id === 'track-section')     loadComplaints();
  if (id === 'authority-section') loadAuthorities();
}

function toggleMenu() {
  const open = $('navLinks').classList.toggle('open');
  $('hamburgerBtn')?.setAttribute('aria-expanded', String(open));
}

/* ═══════════════ ONLINE / OFFLINE ═════════════════════════════════════ */
const updateOnline = () => {
  const on = navigator.onLine;
  $('offlineBadge').style.display = on ? 'none' : 'inline';
  $('onlineBadge').style.display  = on ? 'inline' : 'none';
};
window.addEventListener('online',  updateOnline);
window.addEventListener('offline', updateOnline);

/* ═══════════════ KEYBOARD SHORTCUT ════════════════════════════════════ */
document.addEventListener('keydown', e => {
  // Ctrl+K → focus hero search
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    showSection('dashboard');
    setTimeout(() => $('heroSearch')?.focus(), 150);
  }
  // Escape → close modal / chat
  if (e.key === 'Escape') {
    closeModal();
    $('chatWindow')?.classList.remove('open');
    document.querySelectorAll('.autocomplete-box').forEach(b => b.innerHTML = '');
  }
});

/* ═══════════════ STATS ════════════════════════════════════════════════ */
async function loadStats() {
  try {
    const d = await fetch(`${API}/api/stats`).then(r => r.json());
    $('stat-roads').textContent      = d.total_roads;
    $('stat-critical').textContent   = (d.critical_roads || 0) + (d.poor_roads || 0);
    $('stat-complaints').textContent = d.total_complaints;
    $('stat-countries').textContent  = d.countries_covered;
    $('stat-anomalies').textContent  = d.budget_anomalies;
    // Total network km
    if (d.total_length_km) {
      const km = d.total_length_km >= 1000
        ? (d.total_length_km / 1000).toFixed(1) + 'k'
        : d.total_length_km.toLocaleString();
      $('stat-km').textContent = km;
    }
    // Cache for offline
    const cache = {
      total_roads: d.total_roads,
      critical_poor: (d.critical_roads || 0) + (d.poor_roads || 0),
      total_complaints: d.total_complaints,
      countries_covered: d.countries_covered,
      budget_anomalies: d.budget_anomalies,
      total_length_km: d.total_length_km,
    };
    localStorage.setItem('rw_stats', JSON.stringify(cache));
  } catch {
    // Restore from cache
    try {
      const cached = JSON.parse(localStorage.getItem('rw_stats') || '{}');
      if (cached.total_roads)       $('stat-roads').textContent      = cached.total_roads;
      if (cached.critical_poor)     $('stat-critical').textContent   = cached.critical_poor;
      if (cached.total_complaints)  $('stat-complaints').textContent = cached.total_complaints;
      if (cached.countries_covered) $('stat-countries').textContent  = cached.countries_covered;
      if (cached.budget_anomalies)  $('stat-anomalies').textContent  = cached.budget_anomalies;
      if (cached.total_length_km) {
        const km = cached.total_length_km >= 1000
          ? (cached.total_length_km / 1000).toFixed(1) + 'k'
          : cached.total_length_km.toLocaleString();
        $('stat-km').textContent = km;
      }
    } catch {}
  }
}

/* ═══════════════ COUNTRY FILTER ═══════════════════════════════════════ */
async function loadCountryFilter() {
  try {
    const d = await fetch(`${API}/api/countries`).then(r => r.json());
    const sel = $('filterCountry');
    d.countries.forEach(c => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c; sel.appendChild(o);
    });
  } catch {}
}

/* ═══════════════ QUICK FILTER ═════════════════════════════════════════ */
function quickFilter(country, condition) {
  $('filterCountry').value = country;
  $('filterCond').value    = condition;
  showSection('dashboard');
  loadRoads();
}

/* ═══════════════ ROAD GRID ════════════════════════════════════════════ */
async function loadRoads() {
  if (_nearMeActive) return;   // ← Near Me is showing — don't overwrite it
  const country = $('filterCountry').value;
  const type    = $('filterType').value;
  const cond    = $('filterCond').value;
  const sort    = $('sortBy').value;
  const q       = $('heroSearch')?.value?.trim() || '';
  const params  = new URLSearchParams();
  if (country) params.set('country', country);
  if (type)    params.set('road_type', type);
  if (cond)    params.set('condition', cond);
  if (q)       params.set('q', q);
  params.set('sort', sort);
  params.set('limit', '100');

  const grid = $('roadGrid');
  grid.innerHTML = Array(6).fill(0).map(() => `
    <div class="road-card-skel">
      <div class="skel-line w40"></div>
      <div class="skel-line w70"></div>
      <div class="skel-line w55"></div>
      <div class="skel-line w30"></div>
    </div>`).join('');

  try {
    const res   = await fetch(`${API}/api/roads?${params}`).then(r => r.json());
    const roads = res.roads || res;
    const total = res.total || roads.length;
    localStorage.setItem('rw_roads_cache', JSON.stringify(roads));
    renderRoads(roads);
    renderResultsCount(roads.length, total, country, cond, q);
  } catch {
    const cached = localStorage.getItem('rw_roads_cache');
    if (cached) {
      const roads = JSON.parse(cached);
      renderRoads(roads);
      renderResultsCount(roads.length, roads.length, country, cond, q, true);
      toast('⚠️ Showing cached data (offline)', '');
    } else {
      grid.innerHTML = `<div class="empty-state"><div class="es-icon">⚠️</div><h3>Could not load data</h3><p>Check your connection and try again.</p><button class="btn-next" onclick="loadRoads()">🔄 Retry</button></div>`;
      const cb = $('resultsCountBar'); if (cb) cb.innerHTML = '';
    }
  }
}

function renderResultsCount(shown, total, country, cond, q, cached = false) {
  const cb = $('resultsCountBar');
  if (!cb) return;
  const filters = [];
  if (country) filters.push(`<span class="rc-chip">🌍 ${country}</span>`);
  if (cond)    filters.push(`<span class="rc-chip">📊 ${cond}</span>`);
  if (q)       filters.push(`<span class="rc-chip">🔍 "${q}"</span>`);
  const chips = filters.length ? ' — ' + filters.join(' ') : '';
  const badge = cached ? ' <span class="rc-offline">📶 Cached</span>' : '';
  cb.innerHTML = `<span>Showing <strong>${shown}</strong> of <strong>${total}</strong> roads${chips}${badge}</span>`;
}

function setView(v) {
  _currentView = v;
  $('roadGrid').classList.toggle('list-view', v === 'list');
  $('viewGrid').classList.toggle('active', v === 'grid');
  $('viewList').classList.toggle('active', v === 'list');
}

function renderRoads(roads) {
  const grid = $('roadGrid');
  if (!roads.length) {
    grid.innerHTML = '<div class="empty-state"><div class="es-icon">🔍</div><p>No roads found. Try changing filters.</p></div>';
    return;
  }
  grid.innerHTML = roads.map(r => {
    const cls   = condClass(r.condition_label);
    const pct   = r.budget_utilisation_pct ??
      (r.budget_sanctioned ? Math.round((r.budget_spent / r.budget_sanctioned) * 100) : 0);
    const uCls  = pct >= 90 ? 'util-good' : pct >= 65 ? 'util-warn' : 'util-bad';
    const anom  = r.budget_anomaly || (pct < 65 && r.budget_sanctioned > 0);
    return `
    <div class="road-card ${cls}" onclick="openRoadModal('${r.road_id}')" role="listitem" tabindex="0"
      onkeydown="if(event.key==='Enter')openRoadModal('${r.road_id}')"
      aria-label="${r.road_name}, condition ${r.condition_label}">
      <div class="road-card-top">
        <div class="road-badges">
          <span class="badge-road-id">${r.road_id}</span>
          <span class="badge-type">${r.road_type}</span>
          ${anom ? '<span class="badge-anomaly">⚠️ Anomaly</span>' : ''}
        </div>
        <span class="cond-${cls}" style="font-size:.85rem;font-weight:800">${r.condition_score || '?'}/10</span>
      </div>
      <div class="road-name">${r.road_name}</div>
      <div class="road-meta">
        <span>🌍 ${r.country}</span>
        <span>📍 ${r.state}</span>
        <span title="Contractor">🏗️ ${r.contractor_name || '—'}</span>
        <span title="Last relayed">🔧 ${r.last_relayed_date || '—'}</span>
      </div>
      <div class="cond-wrap">
        <div class="cond-label-row">
          <span class="cond-${cls}">${r.condition_label || 'Unknown'}</span>
          <span style="color:var(--muted);font-size:.72rem">Condition</span>
        </div>
        <div class="cond-bar"><div class="cond-fill fill-${cls}" style="width:${(r.condition_score || 0) * 10}%"></div></div>
      </div>
      <div class="budget-row">
        <span style="color:var(--muted)">💰 ${fmtAmt(r.budget_sanctioned, r.currency)} sanctioned</span>
        <span class="util-pill ${uCls}">${pct}% used</span>
      </div>
      <div class="card-actions">
        <button class="ca-btn" onclick="event.stopPropagation();showOnMap('${r.road_id}')" aria-label="Show on map">🗺️ Map</button>
        <button class="ca-btn" onclick="event.stopPropagation();reportForRoad('${r.road_id}',${r.id})" aria-label="Report issue">📢 Report</button>
        <button class="ca-btn primary" onclick="event.stopPropagation();openRoadModal('${r.road_id}')" aria-label="View details">Details →</button>
      </div>
    </div>`;
  }).join('');
}

/* ═══════════════ EXPORT CSV ════════════════════════════════════════════ */
function exportCSV() {
  const country  = $('filterCountry').value;
  const roadType = $('filterType').value;
  const params   = new URLSearchParams();
  if (country)  params.set('country', country);
  if (roadType) params.set('road_type', roadType);
  const url = `${API}/api/export/roads.csv?${params}`;
  const a = document.createElement('a');
  a.href = url; a.download = 'roadwatch_roads.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast('Downloading CSV…', 'success');
}

function exportComplaintsCSV() {
  const url = `${API}/api/export/complaints.csv`;
  const a = document.createElement('a');
  a.href = url; a.download = 'roadwatch_complaints.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  toast('Downloading complaints CSV…', 'success');
}

/* ═══════════════ AUTOCOMPLETE ══════════════════════════════════════════ */
function debounceAutocomplete(val) {
  clearTimeout(_acTimer);
  if (val.length < 2) { $('autocompleteBox').innerHTML = ''; return; }
  _acTimer = setTimeout(() => fetchAC(val, 'autocompleteBox', road => {
    $('heroSearch').value = road.road_id;
    $('autocompleteBox').innerHTML = '';
    doSearch();
  }), 250);
}

function debounceMapAutocomplete(val) {
  clearTimeout(_acTimer);
  if (val.length < 2) { $('mapAutocompleteBox').innerHTML = ''; return; }
  _acTimer = setTimeout(() => fetchAC(val, 'mapAutocompleteBox', road => {
    $('mapSearch').value = road.road_id;
    $('mapAutocompleteBox').innerHTML = '';
    loadMapSidebarRoad(road.road_id);
  }), 250);
}

function debounceWizardSearch(val) {
  clearTimeout(_acTimer);
  if (val.length < 2) { $('wizardAutoBox').innerHTML = ''; return; }
  _acTimer = setTimeout(() => fetchAC(val, 'wizardAutoBox', road => {
    $('wRoadSearch').value = road.road_id + ' — ' + road.road_name;
    $('wizardAutoBox').innerHTML = '';
    if (road.road_type) {
      const sel = document.querySelector('[name="road_type"]');
      if (sel) [...sel.options].forEach(o => { if (o.value === road.road_type) o.selected = true; });
    }
  }), 250);
}

async function fetchAC(q, boxId, onSelect) {
  try {
    const items = await fetch(`${API}/api/roads/search/autocomplete?q=${encodeURIComponent(q)}`).then(r => r.json());
    const box = $(boxId);
    if (!items.length) { box.innerHTML = ''; return; }
    box.innerHTML = '';
    items.forEach(road => {
      const div = document.createElement('div');
      div.className = 'ac-item';
      div.setAttribute('role', 'option');
      div.setAttribute('tabindex', '0');
      div.innerHTML = `
        <span class="ac-road-id">${road.road_id}</span>
        <span>${road.road_name} · ${road.state}, ${road.country}</span>
        <span class="ac-cond ${condClass(road.condition_label)}">${road.condition_label || '?'}</span>`;
      div.addEventListener('click', () => onSelect(road));
      div.addEventListener('keydown', e => { if (e.key === 'Enter') onSelect(road); });
      box.appendChild(div);
    });
  } catch {}
}

document.addEventListener('click', e => {
  if (!e.target.closest('.hero-search-wrap'))   $('autocompleteBox').innerHTML = '';
  if (!e.target.closest('.map-search-wrap'))    $('mapAutocompleteBox').innerHTML = '';
  if (!e.target.closest('#wRoadSearch')?.parentElement) $('wizardAutoBox').innerHTML = '';
});

function closeAutocomplete() { $('autocompleteBox').innerHTML = ''; }

/* ═══════════════ NEAR ME ════════════════════════════════════════════════ */
let _nearMeActive = false;

function findNearMe() {
  const btn = $('nearMeBtn');
  if (!navigator.geolocation) {
    toast('Geolocation not supported by your browser.', 'error');
    return;
  }
  // Toggle off if already active
  if (_nearMeActive) { clearNearMe(); return; }

  btn.classList.add('loading');
  btn.innerHTML = '<span class="near-me-icon">⏳</span> Locating…';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      btn.classList.remove('loading');
      try {
        const res = await fetch(`${API}/api/roads/nearby?lat=${lat}&lon=${lon}&radius_km=200`);
        const roads = await res.json();
        if (!roads || roads.length === 0) {
          toast('No monitored roads found within 200 km of your location.', '');
          btn.innerHTML = '<span class="near-me-icon">📍</span> Near Me';
          return;
        }
        _nearMeActive = true;
        btn.classList.add('active-loc');
        btn.innerHTML = '<span class="near-me-icon">📍</span> Near Me ✓';

        // Show status bar
        const bar = $('nearMeBar');
        bar.style.display = 'flex';
        $('nearMeLabel').textContent =
          `📍 ${roads.length} road${roads.length > 1 ? 's' : ''} found within 200 km of your location`;

        // Lock filters to Near Me mode
        setNearMeFilterMode(true);

        // Update stats bar with nearby-road data
        updateStatsForNearMe(roads);

        // Render the nearby roads in the grid
        renderNearbyRoads(roads, 'your location');
        toast(`📍 Found ${roads.length} road${roads.length > 1 ? 's' : ''} near you!`, 'success');
      } catch (err) {
        toast('Could not fetch nearby roads. Try again.', 'error');
        btn.innerHTML = '<span class="near-me-icon">📍</span> Near Me';
        btn.classList.remove('loading');
      }
    },
    (err) => {
      btn.classList.remove('loading');
      btn.innerHTML = '<span class="near-me-icon">📍</span> Near Me';
      const msgs = {
        1: 'Location access denied. Please allow location in your browser settings.',
        2: 'Location unavailable. Try again.',
        3: 'Location request timed out.',
      };
      toast(msgs[err.code] || 'Location error.', 'error');
    },
    { timeout: 10000, maximumAge: 60000 }
  );
}

function clearNearMe(skipReload = false) {
  if (!_nearMeActive && skipReload) return;
  _nearMeActive = false;
  const btn = $('nearMeBtn');
  if (btn) {
    btn.classList.remove('active-loc', 'loading');
    btn.innerHTML = '<span class="near-me-icon">📍</span> Near Me';
  }
  const bar = $('nearMeBar');
  if (bar) bar.style.display = 'none';
  setNearMeFilterMode(false);    // unlock filters
  if (!skipReload) { loadStats(); loadRoads(); }  // restore global stats + road list
}

function setNearMeFilterMode(active) {
  const selects = ['filterCountry','filterType','filterCond','sortBy'];
  selects.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.disabled = active;
    el.style.opacity = active ? '0.45' : '';
    el.style.cursor  = active ? 'not-allowed' : '';
  });
  // Show / hide the Near Me filter badge
  let badge = $('nearMeFilterBadge');
  if (active) {
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'nearMeFilterBadge';
      badge.className = 'nm-filter-badge';
      badge.innerHTML = '📍 Near Me Mode — filters locked &nbsp;<button onclick="clearNearMe()" class="nm-filter-clear">✕ Exit</button>';
      const toolbar = document.querySelector('.filter-group');
      if (toolbar) toolbar.prepend(badge);
    }
    badge.style.display = 'flex';
  } else {
    if (badge) badge.style.display = 'none';
  }
}

function updateStatsForNearMe(roads) {
  const poorCritical = roads.filter(r => ['Poor','Critical'].includes(r.condition_label)).length;
  const countries    = new Set(roads.map(r => r.country).filter(Boolean)).size;
  const anomalies    = roads.filter(r => r.budget_sanctioned > 0 && r.budget_spent > 0 &&
                         (r.budget_spent / r.budget_sanctioned) < 0.65).length;
  const totalKm      = roads.reduce((s, r) => s + (r.total_length_km || 0), 0);
  const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('stat-roads',      roads.length);
  set('stat-critical',   poorCritical || '—');
  set('stat-complaints', '—');           // not available per-road from nearby API
  set('stat-countries',  countries || '—');
  set('stat-anomalies',  anomalies || '—');
  set('stat-km',         fmt(Math.round(totalKm)));
}

function renderNearbyRoads(roads, locationLabel = 'your location') {
  const grid = $('roadGrid');
  if (!grid) return;

  // Update results count bar
  const cb = $('resultsCountBar');
  if (cb) cb.innerHTML = `<span>📍 Showing <strong>${roads.length}</strong> road${roads.length !== 1 ? 's' : ''} near <strong>${locationLabel}</strong> <span class="rc-chip">Nearest first</span></span>`;

  if (roads.length === 0) {
    grid.innerHTML = `<div class="empty-state"><div class="es-icon">📍</div><h3>No roads found nearby</h3><p>No monitored roads within 200 km of your location.</p><button class="btn-next" onclick="clearNearMe()">Show All Roads</button></div>`;
    return;
  }

  grid.innerHTML = roads.map(r => {
    const cond  = r.condition_label || 'Unknown';
    const score = r.condition_score ?? '—';
    const san   = r.budget_sanctioned || 0;
    const sp    = r.budget_spent || 0;
    const anomaly = san > 0 && sp > 0 && (sp / san) < 0.65;
    const distKm  = r.distance_km !== undefined ? r.distance_km : null;
    return `
      <div class="road-card ${condClass(cond)} near-me-card" onclick="openRoadModal('${r.road_id}')" tabindex="0"
           role="button" aria-label="${r.road_name}">
        <div class="road-card-header">
          <div>
            <div class="road-id-row">
              <span class="road-id">${r.road_id}</span>
              ${distKm !== null ? `<span class="road-dist-badge">📍 ${distKm} km away</span>` : ''}
            </div>
            <div class="road-name">${r.road_name}</div>
            <div class="road-meta">${r.country}${r.state ? ' · ' + r.state : ''}</div>
          </div>
          <div class="road-badges">
            <span class="cond-badge ${condClass(cond)}">${cond}</span>
            ${anomaly ? '<span class="anom-badge" title="Budget anomaly">⚠️ Anomaly</span>' : ''}
          </div>
        </div>
        <div class="road-stats">
          <div class="rs"><span class="rs-val">${score}</span><span class="rs-lbl">Score</span></div>
          <div class="rs"><span class="rs-val">${r.total_length_km ?? '—'}</span><span class="rs-lbl">km</span></div>
          <div class="rs"><span class="rs-val">${fmtAmt(san, r.currency)}</span><span class="rs-lbl">Sanctioned</span></div>
        </div>
      </div>`;
  }).join('');
}

/* ═══════════════ SEARCH ════════════════════════════════════════════════ */
// Road-ID pattern: NH-44, SH-5, M25, I-90, A1, B4501, AH1 …
const _ROAD_ID_RE = /^(NH|SH|MDR|VR|ODR|PMGSY|M\d|A\d|B\d|I-|US-|AH|RN|E\d|N\d)/i;

async function doSearch() {
  const q = $('heroSearch').value.trim();
  closeAutocomplete();
  if (!q) { clearNearMe(true); loadRoads(); return; }

  showSection('dashboard');

  // ── Road ID? → normal DB text search ───────────────────────────────────
  if (_ROAD_ID_RE.test(q)) {
    clearNearMe(true);
    loadRoads();
    return;
  }

  // ── Place name → geocode → nearby roads ────────────────────────────────
  const grid = $('roadGrid');
  if (grid) grid.innerHTML = `
    <div class="search-geocoding-state">
      <div class="sgeo-spinner"></div>
      <div class="sgeo-text">🔍 Looking up "<strong>${q}</strong>" …</div>
    </div>`;
  const cb = $('resultsCountBar');
  if (cb) cb.innerHTML = '';

  try {
    // 1. Geocode via Nominatim (OpenStreetMap) — free, no key
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const geoData = await geoRes.json();

    if (!geoData || geoData.length === 0) {
      // Geocoding failed — fall back to DB text search
      clearNearMe(true);
      loadRoads();
      toast(`Could not locate "${q}" — showing database matches instead.`, '');
      return;
    }

    const place = geoData[0];
    const lat   = parseFloat(place.lat);
    const lon   = parseFloat(place.lon);
    const displayName = place.address?.city || place.address?.town ||
                        place.address?.village || place.address?.county ||
                        place.display_name.split(',')[0];

    // 2. Find nearby roads (up to 500 km for place searches)
    const nearRes = await fetch(`${API}/api/roads/nearby?lat=${lat}&lon=${lon}&radius_km=500`);
    const nearRoads = await nearRes.json();

    if (!nearRoads || nearRoads.length === 0) {
      // No nearby roads — fall back to DB text search
      clearNearMe(true);
      loadRoads();
      toast(`No monitored roads found near "${displayName}". Showing all matches.`, '');
      return;
    }

    // 3. Activate Near Me mode with this searched location
    _nearMeActive = true;
    const btn = $('nearMeBtn');
    if (btn) { btn.classList.add('active-loc'); btn.innerHTML = '<span class="near-me-icon">📍</span> Near Me ✓'; }

    const bar = $('nearMeBar');
    if (bar) {
      bar.style.display = 'flex';
      $('nearMeLabel').textContent =
        `📍 ${nearRoads.length} road${nearRoads.length !== 1 ? 's' : ''} near "${displayName}"`;
    }

    setNearMeFilterMode(true);
    updateStatsForNearMe(nearRoads);
    renderNearbyRoads(nearRoads, displayName);

    // Update results count with location info
    if (cb) cb.innerHTML = `<span>📍 <strong>${nearRoads.length}</strong> road${nearRoads.length !== 1 ? 's' : ''} near <strong>${displayName}</strong> <span class="rc-chip">Within 500 km</span></span>`;

    toast(`📍 ${nearRoads.length} road${nearRoads.length !== 1 ? 's' : ''} found near "${displayName}"`, 'success');

    // Also pan map if open
    if (window._map && window._mapInit) {
      window._map.setView([lat, lon], 9);
    }

  } catch (err) {
    // Network error — fall back to text search
    clearNearMe(true);
    loadRoads();
    toast('Geocoding unavailable — showing database matches.', '');
  }
}

/* ═══════════════ ROAD MODAL ════════════════════════════════════════════ */
async function openRoadModal(roadId) {
  $('roadModal').classList.add('open');
  $('modalContent').innerHTML = '<div class="loading-ph">Loading road details…</div>';
  try {
    const d = await fetch(`${API}/api/roads/${encodeURIComponent(roadId)}`).then(r => {
      if (!r.ok) throw new Error('Not found'); return r.json();
    });
    $('modalContent').innerHTML = buildRoadDetailHTML(d, 'modal');
    if (d.budget_history?.length)
      setTimeout(() => renderBudgetChart(d.budget_history, 'modalBudgetChart-' + d.road_id, d.currency), 80);
  } catch {
    $('modalContent').innerHTML = '<p style="color:red;padding:1rem">Could not load road details.</p>';
  }
}

function closeModal() { $('roadModal')?.classList.remove('open'); }

function buildRoadDetailHTML(d, scope = 'modal') {
  const cls  = condClass(d.condition_label);
  const pct  = d.budget_utilisation_pct ??
    (d.budget_sanctioned ? +((d.budget_spent / d.budget_sanctioned) * 100).toFixed(1) : 0);
  const uCls = pct >= 90 ? 'util-good' : pct >= 65 ? 'util-warn' : 'util-bad';
  const cid  = scope + '-BudgetChart-' + (d.road_id || '');
  const histHTML = d.budget_history?.length
    ? `<div class="chart-mini-wrap"><h4>📊 Budget History</h4><canvas id="${cid}" height="150"></canvas></div>`
    : '';

  return `
  <div class="road-detail">
    <div class="rd-header">
      <div>
        <div class="road-badges" style="margin-bottom:.5rem">
          <span class="badge-road-id">${d.road_id}</span>
          <span class="badge-type">${d.road_type}</span>
          ${d.budget_anomaly ? '<span class="badge-anomaly">⚠️ Budget Anomaly</span>' : ''}
        </div>
        <h3 style="font-size:1.05rem;color:var(--primary);line-height:1.3">${d.road_name}</h3>
        <div style="font-size:.8rem;color:var(--muted)">${d.country} · ${d.state}${d.district ? ', ' + d.district : ''}</div>
      </div>
      <div class="rd-score cond-${cls}">${d.condition_score}/10</div>
    </div>

    <div class="cond-wrap">
      <div class="cond-label-row">
        <span class="cond-${cls}" style="font-weight:700">${d.condition_label}</span>
        <span style="color:var(--muted);font-size:.72rem">Condition Score</span>
      </div>
      <div class="cond-bar"><div class="cond-fill fill-${cls}" style="width:${(d.condition_score || 0) * 10}%"></div></div>
    </div>

    ${[
      ['🛣️ Road Type',        d.road_type],
      ['🏗️ Contractor',       d.contractor_name],
      ['📞 Contractor Tel',   d.contractor_contact],
      ['📏 Length',           d.total_length_km ? d.total_length_km + ' km' : '—'],
      ['🛤️ Surface',          d.surface_type || '—'],
      ['🔨 Constructed',      d.construction_date || '—'],
      ['🔧 Last Relayed',     d.last_relayed_date || '—'],
      ['📅 Next Maintenance', d.next_maintenance || '—'],
      ['🗂️ Open Complaints',  d.open_complaints != null ? `${d.open_complaints} / ${d.complaints_count || 0} total` : '—'],
    ].map(([k, v]) => `
      <div class="detail-row"><span class="dk">${k}</span><span class="dv">${v || '—'}</span></div>
    `).join('')}

    ${d.budget_anomaly ? `
    <div class="anomaly-flag" style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:8px;padding:.65rem;margin:.75rem 0;font-size:.82rem">
      ⚠️ <strong>Budget Anomaly:</strong> Only ${pct}% of sanctioned budget utilised — possible delay or mismanagement.
    </div>` : ''}

    <div class="budget-block">
      <h4>💰 Budget — ${d.financial_year || 'Current FY'}</h4>
      <div class="budget-grid">
        <div><div class="blbl">Sanctioned</div><div class="bval">${fmtAmt(d.budget_sanctioned, d.currency)}</div></div>
        <div><div class="blbl">Spent</div><div class="bval">${fmtAmt(d.budget_spent, d.currency)}</div></div>
      </div>
      <div class="util-bar-row"><span>Utilisation</span><span class="${uCls}">${pct}%</span></div>
      <div class="cond-bar">
        <div style="width:${pct}%;height:100%;background:${pct >= 90 ? '#10b981' : pct >= 65 ? '#f59e0b' : '#ef4444'};border-radius:3px"></div>
      </div>
      <div class="source-link" style="font-size:.75rem;color:var(--muted);margin-top:.4rem">
        Source: <a href="${d.data_source || '#'}" target="_blank" rel="noopener">${d.data_source_label || 'Government Portal'}</a>
      </div>
    </div>

    ${histHTML}

    <div class="ee-block" style="background:#f0f9ff;border-radius:8px;padding:.75rem;margin:.75rem 0">
      <h4 style="font-size:.75rem;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:.4rem;font-weight:700">
        👨‍💼 Executive Engineer / Authority
      </h4>
      <div style="font-size:.83rem;line-height:1.8">
        <strong>${d.executive_engineer || '—'}</strong><br>
        <span style="color:var(--muted)">${d.department || '—'}</span><br>
        📧 <a href="mailto:${d.ee_email}">${d.ee_email || '—'}</a><br>
        📞 ${d.ee_phone || '—'}
      </div>
    </div>

    <div class="rd-action-row" style="display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap">
      <button class="ca-btn primary" onclick="closeModal();reportForRoad('${d.road_id}',${d.id || 'null'})">📢 Report Issue</button>
      <button class="ca-btn" onclick="closeModal();chatAboutRoad('${d.road_id}')">🤖 Ask AI</button>
      <button class="ca-btn" onclick="closeModal();showOnMap('${d.road_id}')">🗺️ Map</button>
    </div>
  </div>`;
}

function renderBudgetChart(history, canvasId, currency = 'INR') {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (_charts[canvasId]) _charts[canvasId].destroy();
  _charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: history.map(h => h.financial_year + (h.work_type ? ' (' + h.work_type + ')' : '')),
      datasets: [
        { label: 'Sanctioned', data: history.map(h => h.amount_sanctioned), backgroundColor: 'rgba(37,99,168,.75)', borderRadius: 4 },
        { label: 'Spent',      data: history.map(h => h.amount_spent),      backgroundColor: 'rgba(16,185,129,.75)', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } },
      scales: {
        y: { ticks: { font: { size: 9 }, callback: v => fmtAmt(v, currency) } },
        x: { ticks: { font: { size: 9 }, maxRotation: 15 } },
      },
    },
  });
}

/* ═══════════════ MAP ═══════════════════════════════════════════════════ */
function initMap() {
  if (window._mapInit) return;
  window._mapInit = true;
  _map = L.map('map').setView([22, 82], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>', maxZoom: 19,
  }).addTo(_map);
  _markerCluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
  _map.addLayer(_markerCluster);
  loadMapMarkers();
}

async function loadMapMarkers() {
  try {
    const res  = await fetch(`${API}/api/roads?limit=200`).then(r => r.json());
    _mapRoads  = (res.roads || res);
    renderMapMarkers(_mapRoads);
  } catch {}
}

function renderMapMarkers(roads) {
  _markerCluster.clearLayers();
  roads.forEach(r => {
    if (!r.lat_center || !r.lon_center) return;
    const colour = condColor(r.condition_label);
    const icon   = L.divIcon({
      className: '',
      html: `<div style="background:${colour};width:14px;height:14px;border-radius:50%;
             border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)" title="${r.road_id}"></div>`,
      iconSize: [14, 14], iconAnchor: [7, 7],
    });
    L.marker([r.lat_center, r.lon_center], { icon })
      .addTo(_markerCluster)
      .bindPopup(`
        <div style="font-size:.82rem;min-width:160px">
          <strong>${r.road_id}</strong> — ${r.road_type}<br>
          <span style="color:${colour};font-weight:700">${r.condition_label || '?'} (${r.condition_score || '?'}/10)</span><br>
          ${r.state}, ${r.country}<br>
          <button onclick="loadMapSidebarRoad('${r.road_id}')"
            style="margin-top:.4rem;padding:.2rem .6rem;background:var(--primary);
            color:#fff;border:none;border-radius:4px;font-size:.75rem;cursor:pointer">
            View Details
          </button>
        </div>`)
      .on('click', () => loadMapSidebarRoad(r.road_id));
  });
}

async function reloadMapMarkers() {
  const type = $('mapFilterType').value;
  const cond = $('mapFilterCond').value;
  let filtered = _mapRoads;
  if (type) filtered = filtered.filter(r => r.road_type === type);
  if (cond) filtered = filtered.filter(r => r.condition_label === cond);
  renderMapMarkers(filtered);
}

function setSidebarTab(tab) {
  document.querySelectorAll('.stab').forEach((b, i) => {
    const tabs = ['info', 'complaints', 'timeline'];
    b.classList.toggle('active', tabs[i] === tab);
    b.setAttribute('aria-selected', String(tabs[i] === tab));
  });
  $('sidebarInfoTab').style.display      = tab === 'info'       ? 'block' : 'none';
  $('sidebarComplaintsTab').style.display= tab === 'complaints' ? 'block' : 'none';
  $('sidebarTimelineTab').style.display  = tab === 'timeline'   ? 'block' : 'none';
}

async function loadMapSidebarRoad(roadId) {
  _selectedMapRoadId = roadId;
  const infoTab = $('sidebarInfoTab');
  infoTab.innerHTML = '<div class="loading-ph">Loading…</div>';
  setSidebarTab('info');
  try {
    const d = await fetch(`${API}/api/roads/${encodeURIComponent(roadId)}`).then(r => r.json());
    infoTab.innerHTML = buildRoadDetailHTML(d, 'sidebar');
    if (d.budget_history?.length)
      setTimeout(() => renderBudgetChart(d.budget_history, 'sidebar-BudgetChart-' + d.road_id, d.currency), 80);
    loadSidebarComplaints(roadId);
    loadSidebarTimeline(roadId);
    if (d.lat_center && d.lon_center && _map)
      _map.setView([d.lat_center, d.lon_center], 8);
  } catch {
    infoTab.innerHTML = '<div class="loading-ph">⚠️ Could not load details.</div>';
  }
}

async function loadSidebarComplaints(roadId) {
  const tab = $('sidebarComplaintsTab');
  tab.innerHTML = '<div class="loading-ph">Loading complaints…</div>';
  try {
    const d = await fetch(`${API}/api/roads/${encodeURIComponent(roadId)}/complaints`).then(r => r.json());
    if (!d.complaints.length) {
      tab.innerHTML = '<div class="sidebar-hint">No complaints filed for this road yet.</div>'; return;
    }
    tab.innerHTML = d.complaints.map(c => `
      <div style="border-bottom:1px solid var(--border);padding:.6rem 0;font-size:.8rem">
        <div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.2rem">
          <span style="width:10px;height:10px;border-radius:50%;display:inline-block;flex-shrink:0;
            background:${condColor(c.severity === 'Critical' ? 'Critical' : c.severity === 'High' ? 'Poor' : c.severity === 'Medium' ? 'Fair' : 'Good')}"></span>
          <strong>${c.issue_type}</strong>
          <span class="status-pill ${stClass(c.status)}" style="margin-left:auto">${c.status}</span>
        </div>
        <div style="color:var(--muted)">${c.location_desc || '—'}</div>
        <code style="font-size:.7rem;color:var(--primary)">${c.complaint_id}</code>
      </div>`).join('');
  } catch {
    tab.innerHTML = '<div class="loading-ph">⚠️ Could not load complaints.</div>';
  }
}

async function loadSidebarTimeline(roadId) {
  const tab = $('sidebarTimelineTab');
  tab.innerHTML = '<div class="loading-ph">Loading timeline…</div>';
  try {
    const d = await fetch(`${API}/api/roads/${encodeURIComponent(roadId)}/timeline`).then(r => r.json());
    if (!d.events?.length) {
      tab.innerHTML = '<div class="sidebar-hint">No timeline events yet.</div>'; return;
    }
    tab.innerHTML = `<div class="timeline">` + d.events.map(ev => {
      const isBudget    = ev.type === 'budget';
      const isResolved  = ev.status === 'Resolved';
      const dotCls      = isBudget ? 'budget' : isResolved ? 'complaint resolved' : 'complaint';
      return `
      <div class="tl-event">
        <div class="tl-dot ${dotCls}"></div>
        <div class="tl-card">
          <div class="tl-date">${fmtDate(ev.date)}</div>
          <div class="tl-title">${ev.type === 'budget' ? '💰' : '📢'} ${ev.title}</div>
          <div class="tl-detail">${(ev.detail || '').substring(0, 120)}${(ev.detail || '').length > 120 ? '…' : ''}</div>
          ${ev.status ? `<span class="tl-badge status-pill ${stClass(ev.status)}" style="margin-top:.3rem;display:inline-block">${ev.status}</span>` : ''}
          ${ev.source ? `<div style="font-size:.7rem;color:var(--muted);margin-top:.2rem">Source: ${ev.source}</div>` : ''}
        </div>
      </div>`;
    }).join('') + '</div>';
  } catch {
    tab.innerHTML = '<div class="loading-ph">⚠️ Could not load timeline.</div>';
  }
}

function mapSearchRoad() { mapSearchByQuery($('mapSearch').value.trim()); }

async function mapSearchByQuery(q) {
  if (!q) return;
  $('mapAutocompleteBox').innerHTML = '';
  try {
    const res   = await fetch(`${API}/api/roads?q=${encodeURIComponent(q)}&limit=20`).then(r => r.json());
    const roads = res.roads || res;
    if (roads.length) {
      const r = roads[0];
      if (r.lat_center && r.lon_center && _map) _map.setView([r.lat_center, r.lon_center], 9);
      loadMapSidebarRoad(r.road_id);
    } else {
      toast('No roads found for "' + q + '"');
    }
  } catch {}
}

function showOnMap(roadId) {
  showSection('map-section');
  if (!window._mapInit) initMap();
  setTimeout(() => loadMapSidebarRoad(roadId), 350);
}

function locateMe() {
  if (!navigator.geolocation) { toast('Geolocation not supported', 'error'); return; }
  toast('Locating you…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    if (_map) _map.setView([lat, lon], 10);
    try {
      const roads = await fetch(`${API}/api/roads/nearby?lat=${lat}&lon=${lon}&radius_km=300`).then(r => r.json());
      if (roads.length) {
        toast(`Found ${roads.length} road(s) near you`, 'success');
        loadMapSidebarRoad(roads[0].road_id);
      } else toast('No roads found within 300 km');
    } catch { toast('Could not fetch nearby roads', 'error'); }
  }, () => toast('Could not get location', 'error'));
}

function toggleMapFullscreen() {
  const layout = document.querySelector('.map-layout');
  layout.classList.toggle('fullscreen');
  $('mapFullscreenBtn').textContent = layout.classList.contains('fullscreen') ? '✕ Exit' : '⛶ Fullscreen';
  _map?.invalidateSize();
}

/* ═══════════════ ANALYTICS ════════════════════════════════════════════ */
async function loadAnalytics() {
  try {
    const d = await fetch(`${API}/api/analytics/overview`).then(r => r.json());
    renderAnalyticsTiles(d);
    renderCondChart(d.condition_distribution);
    renderCountryChart(d.by_country);
    renderSevChart(d.complaint_severity_distribution);
    renderTypeChart(d.by_road_type);
    renderAnomalyTable(d.budget_anomalies);
  } catch {
    $('analyticsTiles').innerHTML = '<div class="loading-ph">⚠️ Could not load analytics.</div>';
  }
}

function renderAnalyticsTiles(d) {
  const anomalyCount = d.budget_anomalies?.length || 0;
  const critPoor = (d.condition_distribution['Critical'] || 0) + (d.condition_distribution['Poor'] || 0);
  const totalRoads = d.total_roads;
  const countries = Object.keys(d.by_country).length;

  // Compute total sanctioned budget across all countries
  let totalSanctioned = 0;
  Object.values(d.budget_by_country || {}).forEach(c => { totalSanctioned += c.sanctioned || 0; });
  const budgetStr = totalSanctioned >= 1e12
    ? '₹' + (totalSanctioned / 1e12).toFixed(1) + 'T'
    : totalSanctioned >= 1e9
    ? '₹' + (totalSanctioned / 1e9).toFixed(1) + 'B'
    : totalSanctioned >= 1e7
    ? '₹' + (totalSanctioned / 1e7).toFixed(1) + 'Cr'
    : '—';

  const tiles = [
    ['Total Roads',    totalRoads,          '🛣️', 'Roads in database'],
    ['Countries',      countries,           '🌍', 'Countries covered'],
    ['Complaints',     d.total_complaints,  '📢', 'Filed complaints'],
    ['Budget Anomalies', anomalyCount,      '⚠️', 'Roads below 65% utilisation'],
    ['Critical/Poor',  critPoor,            '🔴', 'Roads needing attention'],
  ];
  $('analyticsTiles').innerHTML = tiles.map(([lbl, val, icon, hint]) => `
    <div class="an-tile" title="${hint}">
      <div style="font-size:1.5rem">${icon}</div>
      <div class="an-val">${val}</div>
      <div class="an-lbl">${lbl}</div>
    </div>`).join('');
}

function renderCondChart(dist) {
  const ctx = $('condChart'); if (!ctx) return;
  if (_charts['cond']) _charts['cond'].destroy();
  const labels  = Object.keys(dist);
  _charts['cond'] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: Object.values(dist), backgroundColor: labels.map(l => condColor(l)), borderWidth: 2, borderColor: '#fff' }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { font: { size: 11 }, padding: 12 } } } },
  });
}

function renderCountryChart(byCountry) {
  const ctx = $('countryChart'); if (!ctx) return;
  if (_charts['country']) _charts['country'].destroy();
  const labels  = Object.keys(byCountry);
  const scores  = labels.map(c => byCountry[c].avg_score);
  const colours = scores.map(s => s >= 7.5 ? '#10b981' : s >= 5 ? '#f59e0b' : '#ef4444');
  _charts['country'] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Avg Score', data: scores, backgroundColor: colours, borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      scales: { x: { min: 0, max: 10, ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 10 } } } },
      plugins: { legend: { display: false } } },
  });
}

function renderSevChart(dist) {
  const ctx = $('sevChart'); if (!ctx) return;
  if (_charts['sev']) _charts['sev'].destroy();
  const clrs   = { Critical: '#ef4444', High: '#f97316', Medium: '#f59e0b', Low: '#10b981' };
  const labels = Object.keys(dist);
  _charts['sev'] = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data: Object.values(dist),
      backgroundColor: labels.map(l => clrs[l] || '#94a3b8'), borderWidth: 2, borderColor: '#fff' }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } } },
  });
}

function renderTypeChart(byType) {
  const ctx = $('typeChart'); if (!ctx) return;
  if (_charts['type']) _charts['type'].destroy();
  const labels = Object.keys(byType);
  const scores = labels.map(t => byType[t].avg_score);
  _charts['type'] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Avg Score', data: scores, backgroundColor: 'rgba(37,99,168,.75)', borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      scales: { x: { min: 0, max: 10, ticks: { font: { size: 9 } } }, y: { ticks: { font: { size: 9 } } } },
      plugins: { legend: { display: false } } },
  });
}

function renderAnomalyTable(anomalies) {
  const el  = $('anomalyTable');
  const cnt = $('anomalyCount');
  cnt.textContent = anomalies.length;
  if (!anomalies.length) {
    el.innerHTML = '<div class="empty-state"><div class="es-icon">✅</div><p>No budget anomalies detected.</p></div>';
    return;
  }
  el.innerHTML = `
  <p style="font-size:.78rem;color:var(--muted);margin-bottom:.75rem">
    ⚠️ Roads where budget spent ÷ sanctioned &lt; 65% — possible mismanagement, delay, or data gap. Click any row to see full details and source URL.
  </p>
  <table class="anomaly-table" role="table">
    <thead><tr>
      <th>Road ID</th><th>Road Name</th><th>Country</th>
      <th>Condition</th><th>Sanctioned</th><th>Spent</th><th>Utilisation</th>
    </tr></thead>
    <tbody>
      ${anomalies.map(a => `
      <tr onclick="openRoadModal('${a.road_id}')" style="cursor:pointer" tabindex="0"
        onkeydown="if(event.key==='Enter')openRoadModal('${a.road_id}')"
        title="Click to view full road details + source URL">
        <td><span class="badge-road-id">${a.road_id}</span></td>
        <td>${a.road_name}</td><td>${a.country}</td>
        <td><span class="cond-${condClass(a.condition_label)}">${a.condition_label}</span></td>
        <td>${fmtAmt(a.sanctioned, a.currency)}</td>
        <td>${fmtAmt(a.spent, a.currency)}</td>
        <td><span class="util-pill util-bad">${a.utilisation_pct}%</span></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

async function compareRoads() {
  const ids = [$('cmp1'), $('cmp2'), $('cmp3')].map(i => i.value.trim()).filter(Boolean);
  if (ids.length < 2) { toast('Enter at least 2 road IDs', 'error'); return; }
  const el = $('compareResult');
  el.innerHTML = '<div class="loading-ph">Loading comparison…</div>';
  try {
    const roads  = await fetch(`${API}/api/analytics/compare?ids=${ids.join(',')}`).then(r => r.json());
    const fields = [
      ['Road Type', 'road_type'], ['Country', 'country'], ['State', 'state'],
      ['Condition', 'condition_label'], ['Score', 'condition_score'],
      ['Last Relayed', 'last_relayed_date'], ['Contractor', 'contractor_name'],
      ['Sanctioned', 'budget_sanctioned'], ['Spent', 'budget_spent'], ['Utilisation', 'budget_utilisation_pct'],
    ];
    el.innerHTML = `<div class="compare-grid" style="grid-template-columns:repeat(${roads.length},1fr)">
      ${roads.map(r => `
        <div class="cmp-card ${condClass(r.condition_label)}">
          <h4>${r.road_id} — ${r.road_name}</h4>
          ${fields.map(([lbl, key]) => {
            let v = r[key] ?? '—';
            if (key === 'budget_sanctioned' || key === 'budget_spent') v = fmtAmt(v, r.currency);
            if (key === 'budget_utilisation_pct') v = v !== '—' ? v + '%' : '—';
            if (key === 'condition_score')        v = v !== '—' ? v + '/10' : '—';
            return `<div class="cmp-row"><span style="color:var(--muted)">${lbl}</span><strong>${v}</strong></div>`;
          }).join('')}
        </div>`).join('')}
    </div>`;
  } catch {
    el.innerHTML = '<p style="color:red;padding:1rem">Could not load comparison.</p>';
  }
}

/* ═══════════════ WIZARD ════════════════════════════════════════════════ */
function gotoStep(n) {
  if (n > _currentWizardStep) {
    if (_currentWizardStep === 1) {
      const name  = document.querySelector('[name="citizen_name"]')?.value.trim();
      const phone = document.querySelector('[name="phone"]')?.value.trim();
      const state = document.querySelector('[name="state"]')?.value.trim();
      if (!name || !phone || !state) { toast('Please fill in all required fields', 'error'); return; }
    }
    if (_currentWizardStep === 2) {
      const loc = document.querySelector('[name="location_desc"]')?.value.trim();
      if (!loc) { toast('Please enter a location description', 'error'); return; }
    }
    if (_currentWizardStep === 3 && n === 4) buildReview();
  }

  document.querySelectorAll('.wizard-step').forEach(s => s.style.display = 'none');
  $('wstep-' + n).style.display = 'block';

  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i + 1 < n) s.classList.add('done');
    else if (i + 1 === n) s.classList.add('active');
  });
  document.querySelectorAll('.step-line').forEach((l, i) => {
    l.classList.toggle('done', i + 1 < n);
  });
  _currentWizardStep = n;

  // Scroll to wizard top
  document.querySelector('.wizard-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildReview() {
  const fd   = new FormData(document.getElementById('complaintForm'));
  const get  = k => fd.get(k) || '—';
  const rows = [
    ['Name', get('citizen_name')], ['Phone', get('phone')], ['Email', get('email') || '—'],
    ['Country', get('country')], ['State', get('state')], ['District', get('district') || '—'],
    ['Location', get('location_desc')], ['Road Type', get('road_type')],
    ['Issue Type', get('issue_type')], ['Severity', get('severity')],
    ['Description', get('description')],
  ];
  $('reviewPanel').innerHTML = rows.map(([k, v]) => `
    <div class="review-row"><span class="rk">${k}</span><span class="rv">${v}</span></div>`).join('');

  fetchRoutingPreview(get('road_type'), get('country'), get('state'));
}

async function fetchRoutingPreview(roadType, country, state) {
  try {
    const auths = await fetch(`${API}/api/authorities?road_type=${encodeURIComponent(roadType)}&country=${encodeURIComponent(country)}&state=${encodeURIComponent(state)}`).then(r => r.json());
    const a = auths[0];
    if (a) {
      $('routingPreview').innerHTML = `
        <h4 style="color:var(--primary);margin-bottom:.4rem">🎯 Will be routed to:</h4>
        <strong>${a.name}</strong> — ${a.designation}<br>
        <span style="color:var(--muted)">${a.department}</span><br>
        📧 ${a.email} &nbsp; 📞 ${a.phone}
        <div style="font-size:.75rem;color:var(--success);margin-top:.3rem">✅ AI routing confirmed</div>`;
    } else {
      $('routingPreview').innerHTML = `
        <h4 style="color:var(--primary);margin-bottom:.4rem">🎯 Routing:</h4>
        Will be auto-routed to the ${roadType} authority for ${state}, ${country}.`;
    }
  } catch {}
}

function onCountryChange() {
  const hints = {
    India: 'e.g. Tamil Nadu, Karnataka, Maharashtra…',
    'United Kingdom': 'e.g. England, Scotland, Wales…',
    'United States': 'e.g. California, Florida, Texas…',
    Bangladesh: 'e.g. Dhaka, Chittagong, Sylhet…',
    'South Africa': 'e.g. Western Cape, Gauteng…',
    Madagascar: 'e.g. Analamanga, Vakinankaratra…',
    Poland: 'e.g. Lesser Poland, Silesia, Masovia…',
  };
  $('wState').placeholder = hints[$('wCountry').value] || 'State / Province';
}

function getGPS() {
  if (!navigator.geolocation) { toast('Geolocation not supported', 'error'); return; }
  toast('Getting GPS…');
  navigator.geolocation.getCurrentPosition(pos => {
    $('wLat').value = pos.coords.latitude.toFixed(5);
    $('wLon').value = pos.coords.longitude.toFixed(5);
    toast('GPS coordinates filled ✓', 'success');
  }, () => toast('Could not get location', 'error'));
}

function previewImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  _showImagePreview(file);
}

function handleDrop(e) {
  e.preventDefault();
  $('uploadZone').classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith('image/')) { toast('Please drop an image file', 'error'); return; }
  const dt = new DataTransfer();
  dt.items.add(file);
  $('photoInput').files = dt.files;
  _showImagePreview(file);
}

function _showImagePreview(file) {
  const reader = new FileReader();
  reader.onload = e => {
    $('uploadPreview').innerHTML = `
      <img src="${e.target.result}" style="max-height:140px;border-radius:8px;object-fit:cover" alt="Uploaded photo preview"/>
      <div style="margin-top:.4rem;font-size:.78rem;color:var(--success)">
        ✅ <strong>${file.name}</strong> selected (${(file.size / 1024).toFixed(1)} KB) — AI will analyse damage on submission
      </div>`;
  };
  reader.readAsDataURL(file);
}

async function submitComplaint(e) {
  e.preventDefault();
  const btn = $('submitBtn');
  btn.disabled = true; btn.textContent = '⏳ Filing complaint…';
  const res = $('complaintResult');
  res.style.display = 'none';

  try {
    const r = await fetch(`${API}/api/complaints`, { method: 'POST', body: new FormData(e.target) });
    const d = await r.json();
    if (!d.success) throw new Error(d.detail || 'Filing failed');

    const ai = d.ai_assessment;
    res.style.display = 'block';
    res.style.cssText = 'background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:1.25rem;margin-top:1rem';
    res.innerHTML = `
      <h3 style="color:var(--success);margin-bottom:.75rem">✅ Complaint Filed Successfully!</h3>
      <p>Complaint ID: <span class="cr-id" style="font-weight:800;font-size:1rem;color:var(--primary);background:#dbeafe;padding:2px 10px;border-radius:6px">${d.complaint_id}</span></p>
      <p style="margin-top:.4rem;font-size:.85rem">AI-assessed severity: <strong>${d.severity}</strong></p>
      ${buildComplaintProgress(d.status)}
      <div style="background:#f8fafc;border-radius:8px;padding:.75rem;margin:.75rem 0;font-size:.83rem">
        <strong>Routed to:</strong><br>
        ${d.routed_to.name}<br><span style="color:var(--muted)">${d.routed_to.department}</span><br>
        📧 ${d.routed_to.email} &nbsp; 📞 ${d.routed_to.phone}
      </div>
      ${ai ? `<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:.75rem;font-size:.82rem">
        🤖 <strong>AI Damage Assessment</strong><br>
        <strong>${ai.damage_type}</strong> · Score: ${ai.severity_score}/10 · Confidence: ${Math.round((ai.confidence || 0) * 100)}%<br>
        ${ai.description || ''}<br><em>${ai.recommended_action || ''}</em>
      </div>` : ''}
      <p style="margin-top:.75rem;font-size:.78rem;color:var(--muted)">
        Track your complaint with ID <strong>${d.complaint_id}</strong> in the
        <button onclick="showSection('track-section');$('trackId').value='${d.complaint_id}';trackComplaint()"
          style="background:none;border:none;color:var(--primary-lt);cursor:pointer;text-decoration:underline;font-size:inherit">
          Complaint Tracker →
        </button>
      </p>`;

    e.target.reset();
    $('uploadPreview').innerHTML = '<div class="upload-icon">📷</div><div>Click to upload a photo</div>';
    gotoStep(1);
    toast('Complaint filed! ID: ' + d.complaint_id, 'success');
    loadStats();
  } catch (err) {
    res.style.display = 'block';
    res.style.cssText = 'background:#fef2f2;border:1.5px solid #ef4444;border-radius:12px;padding:1.25rem;margin-top:1rem';
    res.innerHTML = `<p style="color:#ef4444">❌ Error: ${err.message}. Please try again.</p>`;
  } finally {
    btn.disabled = false; btn.textContent = '📢 File Complaint & Route to Authority';
    res.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function buildComplaintProgress(status) {
  const steps   = ['Filed', 'Acknowledged', 'In Progress', 'Resolved'];
  const current = steps.indexOf(status);
  return `<div class="complaint-progress">` + steps.map((s, i) => `
    ${i > 0 ? `<div class="cp-line ${i <= current ? 'done' : ''}"></div>` : ''}
    <div class="cp-step">
      <div class="cp-dot ${i < current ? 'done' : i === current ? 'current' : ''}">${i < current ? '✓' : i + 1}</div>
      <div class="cp-label ${i === current ? 'current' : ''}">${s}</div>
    </div>`).join('') + `</div>`;
}

/* ═══════════════ REPORT SHORTCUT ══════════════════════════════════════ */
function reportForRoad(roadId, roadDbId) {
  showSection('report-section');
  setTimeout(() => {
    gotoStep(2);
    const loc = document.querySelector('[name="location_desc"]');
    if (loc) loc.value = roadId + ' — ';
    if (roadDbId != null) {
      const h = document.querySelector('[name="road_id"]');
      if (h) h.value = roadDbId;
    }
  }, 100);
}

/* ═══════════════ TRACK COMPLAINTS ═════════════════════════════════════ */
function switchTrackTab(tab) {
  document.querySelectorAll('.track-tab').forEach(b => b.classList.remove('active'));
  $('ttab-' + tab).classList.add('active');
  $('trackById').style.display    = tab === 'id'    ? 'block' : 'none';
  $('trackByPhone').style.display = tab === 'phone' ? 'block' : 'none';
  $('trackResult').innerHTML = '';
}

async function trackComplaint() {
  const id  = $('trackId').value.trim();
  const box = $('trackResult');
  if (!id) return;
  box.innerHTML = '<div class="loading-ph">Searching…</div>';
  try {
    const c = await fetch(`${API}/api/complaints/${encodeURIComponent(id)}`).then(r => {
      if (!r.ok) throw new Error('Not found'); return r.json();
    });
    box.innerHTML = buildComplaintCard(c);
  } catch {
    box.innerHTML = '<p style="color:var(--danger);padding:1rem">Complaint not found. Check the ID and try again.</p>';
  }
}

async function trackByPhone() {
  const phone = $('trackPhone').value.trim();
  const box   = $('trackResult');
  if (!phone) return;
  box.innerHTML = '<div class="loading-ph">Searching…</div>';
  try {
    const d = await fetch(`${API}/api/complaints?phone=${encodeURIComponent(phone)}&limit=20`).then(r => r.json());
    if (!d.complaints?.length) {
      box.innerHTML = '<p style="color:var(--muted);padding:1rem">No complaints found for this phone number.</p>'; return;
    }
    box.innerHTML = d.complaints.map(c => `
      <div class="complaint-row" style="margin-bottom:.5rem" onclick="$('trackId').value='${c.complaint_id}';switchTrackTab('id');trackComplaint()">
        <div style="display:flex;gap:.6rem;align-items:center;padding:.75rem;background:#fff;border-radius:8px;box-shadow:var(--shadow);cursor:pointer">
          <code style="color:var(--primary);font-weight:700">${c.complaint_id}</code>
          <span>${c.issue_type}</span>
          <span class="status-pill ${stClass(c.status)}" style="margin-left:auto">${c.status}</span>
        </div>
      </div>`).join('');
  } catch {
    box.innerHTML = '<div class="loading-ph">⚠️ Could not search complaints.</div>';
  }
}

function buildComplaintCard(c) {
  const ai = c.ai_assessment;
  return `
  <div class="track-card" style="background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:1.25rem;margin:.75rem 0">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;margin-bottom:.75rem">
      <div>
        <code style="background:#f1f5f9;padding:2px 8px;border-radius:4px;font-size:.85rem;font-weight:700">${c.complaint_id}</code>
        <span class="status-pill ${stClass(c.status)}" style="margin-left:.5rem">${c.status}</span>
      </div>
      <span style="font-size:.75rem;color:var(--muted)">${fmtDate(c.filed_at)}</span>
    </div>
    ${buildComplaintProgress(c.status)}
    <p style="font-size:.9rem;font-weight:700;margin-bottom:.25rem">${c.issue_type} — ${c.severity} Severity</p>
    <p style="font-size:.83rem;color:var(--muted);margin-bottom:.4rem">${c.location_desc || ''}</p>
    <p style="font-size:.83rem">${c.description}</p>
    <div style="margin-top:.75rem;padding:.75rem;background:#f8fafc;border-radius:8px;font-size:.8rem">
      <strong>Routed to:</strong> ${c.routed_to_name || '—'} · <span style="color:var(--muted)">${c.department || '—'}</span><br>
      📧 ${c.routed_to_email || '—'} &nbsp; 📞 ${c.routed_to_phone || '—'}
    </div>
    ${ai ? `<div style="margin-top:.5rem;background:#f0fdf4;padding:.6rem;border-radius:6px;font-size:.78rem">
      🤖 AI: <strong>${ai.damage_type}</strong> (${ai.severity_score}/10) — ${ai.description || ''}
    </div>` : ''}
    ${c.resolution_note ? `<div style="margin-top:.4rem;background:#d1fae5;padding:.5rem;border-radius:6px;font-size:.8rem;color:#065f46">
      ✅ Resolution: ${c.resolution_note}
    </div>` : ''}
    ${c.resolved_at ? `<p style="font-size:.72rem;color:var(--muted);margin-top:.4rem">Resolved: ${fmtDate(c.resolved_at)}</p>` : ''}
  </div>`;
}

async function loadComplaints() {
  const status = $('filterCompStatus').value;
  const sev    = $('filterCompSev').value;
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (sev)    params.set('severity', sev);
  params.set('limit', '50');

  const list = $('complaintsList');
  list.innerHTML = '<div class="loading-ph">Loading…</div>';
  try {
    const d = await fetch(`${API}/api/complaints?${params}`).then(r => r.json());
    if (!d.complaints.length) {
      list.innerHTML = '<div class="empty-state"><div class="es-icon">📭</div><p>No complaints found.</p></div>'; return;
    }
    list.innerHTML = d.complaints.map(c => `
      <div class="complaint-row" role="listitem" onclick="$('trackId').value='${c.complaint_id}';switchTrackTab('id');trackComplaint()">
        <div class="sev-dot ${sevClass(c.severity)}"></div>
        <div class="comp-main">
          <h4>${c.issue_type} — ${c.location_desc || c.state || '—'}</h4>
          <p>${c.citizen_name} · ${c.country} · Routed to: ${c.routed_to_name || '—'}</p>
        </div>
        <div class="comp-meta">
          <span class="status-pill ${stClass(c.status)}">${c.status}</span>
          <code style="font-size:.7rem">${c.complaint_id}</code>
          <span style="font-size:.7rem;color:var(--muted)">${fmtDate(c.filed_at)}</span>
        </div>
      </div>`).join('');
  } catch {
    list.innerHTML = '<div class="loading-ph">⚠️ Could not load complaints.</div>';
  }
}

/* ═══════════════ AUTHORITIES ═══════════════════════════════════════════ */
async function loadAuthorities() {
  const country  = $('authCountry').value;
  const roadType = $('authType').value;
  const search   = $('authSearch')?.value?.toLowerCase().trim() || '';
  const params   = new URLSearchParams();
  if (country)   params.set('country', country);
  if (roadType)  params.set('road_type', roadType);

  const list = $('authorityList');
  list.innerHTML = '<div class="loading-ph">Loading…</div>';
  try {
    let auths = await fetch(`${API}/api/authorities/all?${params}`).then(r => r.json());
    if (search) auths = auths.filter(a =>
      (a.name||'').toLowerCase().includes(search) ||
      (a.department||'').toLowerCase().includes(search) ||
      (a.designation||'').toLowerCase().includes(search)
    );
    if (!auths.length) {
      list.innerHTML = '<div class="empty-state"><div class="es-icon">🔍</div><h3>No authorities found</h3><p>Try changing filters or search terms.</p></div>'; return;
    }
    list.innerHTML = auths.map(a => `
      <div class="auth-card" role="listitem">
        <span class="auth-dept">${a.department}</span>
        <span class="auth-type">${a.road_type}</span>
        <h4>${a.name}</h4>
        <div class="auth-desig">${a.designation}</div>
        <div class="auth-detail">
          🌍 ${a.country}${a.state ? ', ' + a.state : ''}<br>
          📧 <a href="mailto:${a.email}">${a.email}</a><br>
          📞 ${a.phone}<br>
          🏢 <span style="font-size:.75rem">${a.office_address || '—'}</span>
        </div>
      </div>`).join('');
  } catch {
    list.innerHTML = '<div class="loading-ph">⚠️ Could not load authorities.</div>';
  }
}

/* ═══════════════ CHATBOT ═══════════════════════════════════════════════ */
function toggleChat() {
  const w = $('chatWindow');
  w.classList.toggle('open');
  if (w.classList.contains('open')) {
    $('fabUnread').classList.remove('show');
    setTimeout(() => $('chatInput')?.focus(), 200);
  }
}

function chatAboutRoad(roadId) {
  _activeChatRoadId = roadId;
  $('chatWindow').classList.add('open');
  $('fabUnread').style.display = 'none';
  $('chatInput').value = 'Tell me about ' + roadId;
  sendChat();
}

function quickChat(msg) {
  $('chatWindow').classList.add('open');
  $('chatInput').value = msg;
  sendChat();
}

async function sendChat() {
  const input = $('chatInput');
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = '';

  addMsg(msg, 'user');
  const typing = addTypingIndicator();

  try {
    const d = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, road_id: _activeChatRoadId }),
    }).then(r => r.json());

    typing.remove();
    addMsg(d.reply, 'bot', true);
    if (d.road_resolved) _activeChatRoadId = d.road_resolved;
  } catch {
    typing.remove();
    addMsg('⚠️ Could not reach server. Please check your connection.', 'bot');
  }
}

function addMsg(text, cls, isMarkdown = false) {
  const msgs = $('chatMsgs');
  const el   = document.createElement('div');
  el.className = 'chat-msg ' + cls;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (isMarkdown && typeof marked !== 'undefined') {
    bubble.innerHTML = marked.parse(text);
  } else {
    bubble.innerHTML = text;
  }
  el.appendChild(bubble);
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

function addTypingIndicator() {
  const msgs = $('chatMsgs');
  const el   = document.createElement('div');
  el.className = 'chat-msg bot chat-typing';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  el.appendChild(bubble);
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

/* ═══════════════ SERVICE WORKER ════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

/* ═══════════════ AI PROVIDER STATUS ═══════════════════════════════════ */
async function checkAIProvider() {
  try {
    const d = await fetch(`${API}/api/health`).then(r => r.json());
    const subtitle = $('chatSubtitle');
    if (!subtitle) return;
    const p = d.ai_provider || 'rule_based';
    if (p.startsWith('groq')) {
      subtitle.innerHTML = '🟢 Groq LLaMA 3.3 70B · Live AI';
      subtitle.style.opacity = '1';
    } else if (p.startsWith('openai')) {
      subtitle.innerHTML = '🟢 GPT-3.5-turbo · Live AI';
      subtitle.style.opacity = '1';
    } else {
      subtitle.innerHTML = '⚡ Smart Rule-Based · Instant';
      subtitle.style.opacity = '.85';
    }
  } catch {}
}

/* ═══════════════ BOOT ══════════════════════════════════════════════════ */
(async () => {
  updateOnline();
  await Promise.all([loadStats(), loadCountryFilter()]);
  await loadRoads();
  checkAIProvider();

  // Auto-open chatbot after 1.8s on first visit — shows AI capability to judges immediately
  const firstVisit = !sessionStorage.getItem('rw_visited');
  if (firstVisit) {
    sessionStorage.setItem('rw_visited', '1');
    setTimeout(() => {
      $('chatWindow')?.classList.add('open');
      $('fabUnread').classList.remove('show');
    }, 1800);
  }
})();
