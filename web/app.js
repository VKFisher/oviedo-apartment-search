// Oviedo apartment heat map: combines precomputed per-cell measurements
// (web/data/grid.json, built by pipeline/build.py) into one weighted score.

const PALETTES = {
  viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  blue: ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'],
  diverging: ['#8e1b1b', '#e34948', '#e87c74', '#f5b7b1', '#f0efec', '#b7d3f6', '#6da7ec', '#256abf', '#0d366b'],
};
const view = { palette: 'viridis', stretch: 'view', bands: 0, opacity: 0.65 };
const POI_COLORS = { rail: '#2a78d6', mall: '#eb6834', playground: '#1baf7a', supermarket: '#eda100', health_centre: '#e87ba4', park: '#008300', kindergarten: '#4a3aa7', hospital: '#e34948', bus: '#8a8983', industrial: '#5c5b57' };

// kind: near = closer is better (score 1 at 0 m, 0 at r); far = farther is better (0 at 0 m, 1 at r);
// low = lower value is better (1 at 0, 0 at r); range = lower is better between fixed lo and slider r.
const FACTORS = [
  { key: 'park', label: 'Park', kind: 'near', unit: 'm', r: 800, rmax: 3000, w: 1.0, on: true, desc: 'Stroller walks. Distance to the nearest OSM park at least as big as the size slider; adjacent pieces count as one park.' },
  { key: 'playground', label: 'Playground', kind: 'near', unit: 'm', r: 400, rmax: 2000, w: 0.5, on: false, desc: 'Distance to the nearest playground (OSM). Relevant from about a year old; off by default.' },
  { key: 'supermarket', label: 'Supermarket', kind: 'near', unit: 'm', r: 500, rmax: 2000, w: 0.8, on: true, desc: 'Everyday shopping on foot. Distance to the nearest supermarket (OSM).' },
  { key: 'mall', label: 'Shopping mall', kind: 'near', unit: 'm', r: 2500, rmax: 8000, w: 0.6, on: true, desc: 'Bigger shopping trips. Distance to the nearest mall: Parque Principado, Los Prados, Salesas, Azabache… (OSM shop=mall).' },
  { key: 'health_centre', label: 'Centro de salud', kind: 'near', unit: 'm', r: 1000, rmax: 4000, w: 0.7, on: true, desc: 'Public primary care, where the paediatrician does checkups and vaccinations. Distance to the nearest centro de salud or consultorio.' },
  { key: 'hospital', label: 'Hospital', kind: 'near', unit: 'm', r: 3000, rmax: 10000, w: 0.5, on: true, desc: 'Paediatric emergencies. Distance to HUCA or Centro Médico de Asturias.' },
  { key: 'bus', label: 'Bus stop', kind: 'near', unit: 'm', r: 400, rmax: 2000, w: 0.8, on: true, desc: 'Distance to the nearest bus stop. Dense inside Oviedo, so it mostly matters outside the city.' },
  { key: 'rail', label: 'Train station', kind: 'near', unit: 'm', r: 1500, rmax: 5000, w: 0.6, on: true, desc: 'Distance to the nearest Renfe / Cercanías station or halt (Oviedo, Lugones, Colloto, Meres…).' },
  { key: 'kindergarten', label: 'Daycare (escuela infantil)', kind: 'near', unit: 'm', r: 800, rmax: 3000, w: 0.5, on: false, desc: 'Distance to the nearest escuela infantil (OSM; coverage may be incomplete). Off by default.' },
  { key: 'rent', label: 'Rent (€/m²)', kind: 'range', unit: '€/m²', lo: 9.5, r: 12.5, rmin: 10, rmax: 15, w: 0.6, on: true, desc: 'idealista district averages, Aug 2026. Score 1 at 9.5 €/m², 0 at the slider value. Nearly flat across Oviedo (10.3–12.4), so it separates little.' },
  { key: 'slope', label: 'Hilliness (slope %)', kind: 'low', unit: '%', r: 12, rmin: 3, rmax: 30, w: 1.0, on: true, desc: 'Mean terrain gradient within ~200 m, from the IGN 25 m bare-earth model. Score 0 at the slider value.' },
  { key: 'industrial', label: 'Industrial zone', kind: 'far', unit: 'm', r: 500, rmax: 2000, w: 0.7, on: true, desc: 'Distance to the nearest industrial area (OSM landuse). Score 0 next to it, 1 at the slider value.' },
  { key: 'big_road', label: 'Motorway / main road', kind: 'far', unit: 'm', r: 200, rmax: 1000, w: 0.6, on: true, desc: 'Distance to the nearest motorway, trunk or primary road (OSM). A plain traffic heuristic, kept alongside the official noise map.' },
  { key: 'railway', label: 'Railway line', kind: 'far', unit: 'm', r: 150, rmax: 800, w: 0.4, on: true, desc: 'Distance to the nearest rail track (OSM). Same idea as the road heuristic.' },
  { key: 'noise_lden', label: 'Noise, day-evening-night (Lden)', kind: 'range', unit: 'dB', lo: 50, r: 65, rmin: 55, rmax: 80, w: 0.8, on: true, desc: 'Official strategic noise map (MITECO, phase 3), Lden band averaged over the cell. Score 1 below 55 dB, 0 at the slider value. Covers the Oviedo municipality only.' },
  { key: 'noise_ln', label: 'Noise, night (Ln)', kind: 'range', unit: 'dB', lo: 45, r: 55, rmin: 50, rmax: 75, w: 0.6, on: false, desc: 'Same map, night indicator. Score 1 below 50 dB, 0 at the slider value. Off by default.' },
  { key: 'reputation', label: 'Barrio reputation', kind: 'score', unit: '', w: 1.0, on: true, desc: 'Score from the researched barrio dossiers: safety, upkeep, social issues, what locals say. Click a cell, then the dossier link, to read the write-up and its sources.' },
  { key: 'flood', label: 'Flood zone', kind: 'flood', unit: '', w: 0.7, on: true, desc: 'Official flood zones (MITECO SNCZI), averaged over the cell: 100-year zone counts 2, 500-year zone 1; score = 1 − level/2. Matters mostly for low floors.' },
];
const KIND_LABEL = { near: 'closer is better', far: 'farther is better', low: 'lower is better', range: 'lower is better', flood: 'outside is better', score: 'higher is better' };

let G, POIS, AREAS, map, overlay, canvas, ctx, areasLayer;
const poiLayers = {};
const state = {};
const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---- URL as state: ?park=off_w0.8_r700_m800_v1&view=p-blue_b-9&map=43.36_-5.84_14 (defaults omitted)
const num = (x) => String(+(+x).toFixed(3));
function stateToParams() {
  const q = new URLSearchParams();
  for (const f of FACTORS) {
    const st = state[f.key], t = [];
    if (st.on !== f.on) t.push(st.on ? 'on' : 'off');
    if (st.w !== f.w) t.push('w' + num(st.w));
    if (f.r != null && st.r !== f.r) t.push('r' + num(st.r));
    if (st.must) t.push('m' + num(st.cut));
    if (G.variants && G.variants[f.key] && st.variant !== Math.max(0, G.variants[f.key].steps.indexOf(1))) t.push('v' + st.variant);
    if (t.length) q.set(f.key, t.join('_'));
  }
  const v = [];
  if (view.palette !== 'viridis') v.push('p-' + view.palette);
  if (view.stretch !== 'view') v.push('c-' + view.stretch);
  if (view.bands !== 0) v.push('b-' + view.bands);
  if (view.opacity !== 0.65) v.push('o-' + num(view.opacity));
  if (v.length) q.set('view', v.join('_'));
  if (new URLSearchParams(location.search).has('mobile')) q.set('mobile', '1');
  if (map) { const c = map.getCenter(); q.set('map', `${c.lat.toFixed(4)}_${c.lng.toFixed(4)}_${map.getZoom()}`); }
  return q;
}
function paramsToState(q) {
  for (const f of FACTORS) {
    const st = state[f.key], spec = q.get(f.key);
    if (!spec) continue;
    for (const t of spec.split('_')) {
      if (t === 'on' || t === 'off') st.on = t === 'on';
      else if (t[0] === 'w') st.w = +t.slice(1);
      else if (t[0] === 'r') st.r = +t.slice(1);
      else if (t[0] === 'm') { st.must = true; st.cut = +t.slice(1); }
      else if (t[0] === 'v') st.variant = parseInt(t.slice(1));
    }
  }
  for (const t of (q.get('view') || '').split('_').filter(Boolean)) {
    const [k, val] = [t[0], t.slice(2)];
    if (k === 'p') view.palette = val; else if (k === 'c') view.stretch = val; else if (k === 'b') view.bands = parseInt(val); else if (k === 'o') view.opacity = +val;
  }
}
let urlTimer;
function syncUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => history.replaceState(null, '', '?' + [...stateToParams()].map(([k, v]) => `${k}=${v}`).join('&')), 150);
}
function urlHasState() {
  return [...new URLSearchParams(location.search).keys()].some((k) => k !== 'map');
}

function loadState() {
  let saved = {};
  if (!urlHasState()) { try { saved = JSON.parse(localStorage.getItem('oviedo-heat-state') || '{}'); } catch (e) { /* ignore */ } }
  for (const f of FACTORS) state[f.key] = Object.assign({ on: f.on, w: f.w, r: f.r, pois: false, must: false, cut: defaultCut(f), variant: null }, saved[f.key] || {});
  if (urlHasState()) paramsToState(new URLSearchParams(location.search));
  applyVariants();
}
// Some factors ship several precomputed layers (e.g. park distance per minimum park size); pick the active one.
function applyVariants() {
  for (const key in G.variants || {}) {
    const v = G.variants[key], st = state[key];
    if (st.variant == null || st.variant >= v.steps.length) st.variant = Math.max(0, v.steps.indexOf(1));
    G.factors[key] = v.values[st.variant];
  }
}
function variantStep(key) {
  const v = G.variants && G.variants[key];
  return v ? v.steps[state[key].variant] : null;
}
function saveView() {
  try { localStorage.setItem('oviedo-heat-view', JSON.stringify(view)); } catch (e) { /* ignore */ }
  syncUrl();
}
function loadView() {
  if (urlHasState()) return; // paramsToState already applied the URL's view settings
  try { Object.assign(view, JSON.parse(localStorage.getItem('oviedo-heat-view') || '{}')); } catch (e) { /* ignore */ }
}
function saveState() {
  try { localStorage.setItem('oviedo-heat-state', JSON.stringify(state)); } catch (e) { /* ignore */ }
  syncUrl();
}

function scoreOf(f, v) {
  if (v == null) return null;
  const s = state[f.key];
  if (f.kind === 'near') return clamp(1 - v / s.r);
  if (f.kind === 'far') return clamp(v / s.r);
  if (f.kind === 'low') return clamp(1 - v / s.r);
  if (f.kind === 'flood') return 1 - v / 2;
  if (f.kind === 'score') return clamp(v);
  return clamp((s.r - v) / (s.r - f.lo)); // range
}

function defaultCut(f) {
  return f.kind === 'flood' ? 0.5 : f.kind === 'score' ? 0.6 : f.r;
}
// A cell passes a factor's "must" filter unless its value is on the wrong side of the cut. No data never excludes.
function passes(f, v) {
  if (v == null) return true;
  const c = state[f.key].cut;
  if (f.kind === 'near') return v <= c;
  if (f.kind === 'far') return v >= c;
  if (f.kind === 'flood') return v < c;
  if (f.kind === 'score') return v >= c;
  return v <= c; // low, range
}
function activeFilters() {
  return FACTORS.filter((f) => G.factors[f.key] && state[f.key].on && state[f.key].must);
}
function excludedBy(i) {
  return activeFilters().filter((f) => !passes(f, G.factors[f.key][i]));
}
const CUT_LABEL = { near: 'required: within', far: 'required: at least … away', low: 'required: at most', range: 'required: at most', flood: 'required: flood level below', score: 'required: score at least' };
function cutSliderSpec(f) {
  if (f.kind === 'flood') return [0.25, 2, 0.25];
  if (f.kind === 'score') return [0, 1, 0.05];
  return [f.rmin ?? 50, f.rmax, f.unit === 'm' ? 50 : f.unit === 'dB' ? 1 : 0.5];
}

function totalAt(i) {
  let sw = 0, ss = 0;
  for (const f of FACTORS) {
    const s = state[f.key];
    if (!s.on || s.w <= 0 || !G.factors[f.key]) continue;
    const sc = scoreOf(f, G.factors[f.key][i]);
    if (sc == null) continue;
    sw += s.w; ss += s.w * sc;
  }
  return sw > 0 ? ss / sw : null;
}

const toRGB = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
function ramp(t) {
  const P = PALETTES[view.palette], x = t * (P.length - 1), i = Math.min(Math.floor(x), P.length - 2), fr = x - i;
  const a = toRGB(P[i]), b = toRGB(P[i + 1]);
  return a.map((c, k) => Math.round(c + (b[k] - c) * fr));
}

let range = [0, 1];
function visibleRows() {
  const b = G.meta.bounds, { nx, ny } = G.meta, mb = map.getBounds();
  const r0 = Math.max(0, Math.floor((b.north - mb.getNorth()) / ((b.north - b.south) / ny)));
  const r1 = Math.min(ny, Math.ceil((b.north - mb.getSouth()) / ((b.north - b.south) / ny)));
  const c0 = Math.max(0, Math.floor((mb.getWest() - b.west) / ((b.east - b.west) / nx)));
  const c1 = Math.min(nx, Math.ceil((mb.getEast() - b.west) / ((b.east - b.west) / nx)));
  return [r0, r1, c0, c1];
}
const SCALE = 3; // overlay pixels per cell: smooth colour, crisp per-cell exclusion edges
let included = 0;
function render() {
  const { nx, ny } = G.meta, n = nx * ny;
  const totals = new Float32Array(n).fill(NaN), incl = new Uint8Array(n);
  const filters = activeFilters();
  included = 0;
  for (let i = 0; i < n; i++) {
    const t = totalAt(i);
    if (t == null) continue;
    totals[i] = t;
    if (filters.every((f) => passes(f, G.factors[f.key][i]))) { incl[i] = 1; included++; }
  }
  // Contrast range: percentiles of the included cells in view (or the whole box), or the absolute 0..1 scale.
  let sample = [];
  if (view.stretch !== 'none') {
    const [r0, r1, c0, c1] = view.stretch === 'view' ? visibleRows() : [0, ny, 0, nx];
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) { const i = r * nx + c; if (incl[i]) sample.push(totals[i]); }
  }
  sample.sort((a, b) => a - b);
  range = sample.length > 10 ? [sample[Math.floor(sample.length * 0.05)], sample[Math.floor(sample.length * 0.95)]] : [0, 1];
  const [lo, hi] = range, k = view.bands;
  const W = nx * SCALE, H = ny * SCALE, img = ctx.createImageData(W, H), d = img.data, cache = new Map();
  for (let py = 0; py < H; py++) {
    const cy = (py + 0.5) / SCALE - 0.5, r0 = Math.max(0, Math.min(ny - 1, Math.floor(cy))), r1 = Math.min(ny - 1, r0 + 1), fy = Math.max(0, Math.min(1, cy - r0));
    const rn = Math.max(0, Math.min(ny - 1, Math.round(cy)));
    for (let px = 0; px < W; px++) {
      const cx = (px + 0.5) / SCALE - 0.5, c0 = Math.max(0, Math.min(nx - 1, Math.floor(cx))), c1 = Math.min(nx - 1, c0 + 1), fx = Math.max(0, Math.min(1, cx - c0));
      const cn = Math.max(0, Math.min(nx - 1, Math.round(cx)));
      const o = (py * W + px) * 4;
      if (!incl[rn * nx + cn]) { d[o + 3] = 0; continue; }
      // bilinear over the included neighbours only
      let sw = 0, st = 0;
      const acc = (i, w) => { if (w > 0 && incl[i]) { sw += w; st += w * totals[i]; } };
      acc(r0 * nx + c0, (1 - fx) * (1 - fy)); acc(r0 * nx + c1, fx * (1 - fy)); acc(r1 * nx + c0, (1 - fx) * fy); acc(r1 * nx + c1, fx * fy);
      const t = sw > 0 ? st / sw : totals[rn * nx + cn];
      let u = hi > lo ? clamp((t - lo) / (hi - lo)) : 0.5;
      if (k) u = Math.min(Math.floor(u * k), k - 1) / (k - 1);
      const key = Math.round(u * 255);
      let pxl = cache.get(key);
      if (!pxl) { pxl = ramp(u); cache.set(key, pxl); }
      d[o] = pxl[0]; d[o + 1] = pxl[1]; d[o + 2] = pxl[2]; d[o + 3] = Math.round(255 * (0.25 + 0.75 * u));
    }
  }
  ctx.putImageData(img, 0, 0);
  overlay.setUrl(canvas.toDataURL());
  updateLegend();
}

function fmt(v, unit) {
  if (v == null) return '—';
  return unit === 'm' ? (v >= 1000 ? (v / 1000).toFixed(1) + ' km' : v + ' m') : v + ' ' + unit;
}
function fmtFactor(f, v) {
  if (v == null) return f.kind === 'flood' ? '—' : 'no data';
  if (f.kind === 'score') return v.toFixed(2);
  if (f.kind === 'flood') return v === 0 ? 'outside' : v >= 1.5 ? `T=100 zone (${v.toFixed(1)}/2)` : v >= 0.5 ? `flood zone, partly (${v.toFixed(1)}/2)` : `edge of flood zone (${v.toFixed(1)}/2)`;
  if (f.unit === 'dB') return v <= f.lo ? `< ${f.lo + 5} dB` : `≈ ${v.toFixed(0)} dB`;
  return fmt(v, f.unit);
}

function cellIndex(latlng) {
  const b = G.meta.bounds, { nx, ny } = G.meta;
  const col = Math.floor((latlng.lng - b.west) / ((b.east - b.west) / nx));
  const row = Math.floor((b.north - latlng.lat) / ((b.north - b.south) / ny));
  return row < 0 || row >= ny || col < 0 || col >= nx ? -1 : row * nx + col;
}

function onClick(e) {
  const i = cellIndex(e.latlng);
  if (i < 0) return;
  const area = G.factors.area[i] >= 0 ? G.meta.area_names[G.factors.area[i]] : 'outside mapped areas';
  const t = totalAt(i);
  let html = `<b>${area}</b><br>elevation ${fmt(G.factors.elevation[i], 'm')}<table>`;
  for (const f of FACTORS) {
    if (!G.factors[f.key]) continue;
    const s = state[f.key], v = G.factors[f.key][i], sc = scoreOf(f, v);
    const off = !s.on || s.w <= 0;
    html += `<tr class="${off ? 'off' : ''}"><td>${f.label}</td><td class="n">${fmtFactor(f, v)}</td><td class="n">${off || sc == null ? '' : sc.toFixed(2)}</td><td class="n">${off ? '' : '×' + s.w.toFixed(1)}</td></tr>`;
  }
  html += `<tr class="total"><td>Score</td><td></td><td class="n">${t == null ? '—' : t.toFixed(2)}</td><td></td></tr></table>`;
  const ex = excludedBy(i);
  if (ex.length) html += `<p class="excl">Unshaded: fails ${ex.map((f) => `<b>${f.label}</b> (${fmtFactor(f, G.factors[f.key][i])})`).join(', ')}</p>`;
  const di = G.factors.dossier ? G.factors.dossier[i] : -1;
  if (di >= 0) html += `<p class="dlink"><a href="#" onclick="showDossier(${di});return false;">Read the ${DOSSIERS[di].name} dossier →</a></p>`;
  L.popup({ maxWidth: Math.min(360, window.innerWidth - 40) }).setLatLng(e.latlng).setContent(html).openOn(map);
}

function slider(parent, label, min, max, step, value, unit, onInput) {
  const row = document.createElement('label'); row.className = 'row';
  row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output>${value}${unit ? ' ' + unit : ''}</output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.addEventListener('input', () => { out.textContent = input.value + (unit ? ' ' + unit : ''); onInput(parseFloat(input.value)); });
  parent.appendChild(row);
}

const narrow = () => window.matchMedia('(max-width: 760px)').matches || new URLSearchParams(location.search).has('mobile');
// Narrow screens: the panel becomes a fixed strip under the map showing one card at a time
// (View, Layers, then each factor); swipe (scroll-snap) or the arrows move between cards.
function setupStrip() {
  if (!narrow()) return;
  if (new URLSearchParams(location.search).has('mobile')) document.querySelector('link[href="mobile.css"]').media = 'all';
  const panel = document.getElementById('panel'), track = document.createElement('div');
  track.id = 'track';
  const cards = [...document.querySelectorAll('#factors .factor')];
  const names = FACTORS.filter((f) => G.factors[f.key]).map((f) => f.label);
  cards.forEach((c) => track.appendChild(c));
  panel.appendChild(track);
  // view settings, layer toggles and the link/reset buttons live in a ☰ sheet above the strip
  const menu = document.getElementById('menu'), menuBtn = document.getElementById('menu-btn');
  for (const id of ['global', 'layers']) menu.appendChild(document.getElementById(id));
  menu.appendChild(document.querySelector('#panel .tools'));
  const toggleMenu = (open) => { menu.hidden = !open; menuBtn.classList.toggle('on', open); if (open) map.closePopup(); };
  menuBtn.addEventListener('click', () => toggleMenu(menu.hidden));
  document.getElementById('menu-close').addEventListener('click', () => toggleMenu(false));
  map.on('click', () => toggleMenu(false));
  const nameEl = document.getElementById('strip-name');
  let current = 0;
  const show = () => { nameEl.innerHTML = `${names[current]}<small>${current + 1}/${names.length}</small>`; };
  const go = (i) => { current = Math.max(0, Math.min(names.length - 1, i)); show(); track.scrollTo({ left: current * track.clientWidth, behavior: 'smooth' }); };
  let settle;
  track.addEventListener('scroll', () => { clearTimeout(settle); settle = setTimeout(() => { const i = Math.round(track.scrollLeft / track.clientWidth); if (i !== current) { current = i; show(); } }, 120); }); // after a swipe settles
  show();
  document.getElementById('prev').addEventListener('click', () => go(current - 1));
  document.getElementById('next').addEventListener('click', () => go(current + 1));
}
function buildPanel() {
  const root = document.getElementById('factors');
  for (const f of FACTORS) {
    if (!G.factors[f.key]) continue; // layer not built
    const s = state[f.key];
    const box = document.createElement('div'); box.className = 'factor' + (s.on ? '' : ' off');
    box.innerHTML = `<div class="head"><input type="checkbox" id="on-${f.key}" ${s.on ? 'checked' : ''}><label for="on-${f.key}">${f.label}</label><button class="must ${s.must ? 'on' : ''}" title="hard filter: cells failing it are left unshaded">must</button>${POIS[f.key] ? `<button class="eye ${s.pois ? 'on' : ''}" title="show on map">● ${poisFor(f.key).length}</button>` : ''}</div><div class="desc"><span class="kind">${KIND_LABEL[f.kind][0].toUpperCase() + KIND_LABEL[f.kind].slice(1)}.</span> ${f.desc}</div><div class="body"></div>`;
    const body = box.querySelector('.body');
    box.querySelector('input[type=checkbox]').addEventListener('change', (e) => { s.on = e.target.checked; box.classList.toggle('off', !s.on); saveState(); render(); });
    const must = box.querySelector('.must');
    must.addEventListener('click', () => { s.must = !s.must; must.classList.toggle('on', s.must); cutRow.hidden = !s.must; saveState(); render(); });
    const eye = box.querySelector('.eye');
    if (eye) eye.addEventListener('click', () => { s.pois = !s.pois; eye.classList.toggle('on', s.pois); showPois(f.key, s.pois); saveState(); });
    slider(body, 'weight', 0, 1, 0.1, s.w, '', (v) => { s.w = v; saveState(); render(); });
    const v = G.variants && G.variants[f.key];
    if (v) {
      slider(body, v.label, 0, v.steps.length - 1, 1, s.variant, '', (i) => {
        s.variant = i; G.factors[f.key] = v.values[i]; saveState();
        if (poiLayers[f.key]) { const on = s.pois; showPois(f.key, false); delete poiLayers[f.key]; if (on) showPois(f.key, true); }
        const eye = box.querySelector('.eye'); if (eye) eye.textContent = `● ${poisFor(f.key).length}`;
        render();
      });
      const row = body.lastElementChild, out = row.querySelector('output'), inp = row.querySelector('input');
      const show = () => { out.textContent = `${v.steps[parseInt(inp.value)]} ${v.unit}`; };
      inp.addEventListener('input', show); show();
    }
    if (f.kind !== 'flood' && f.kind !== 'score') {
      const rl = f.kind === 'near' ? 'no benefit beyond' : f.kind === 'far' ? 'no penalty beyond' : 'score 0 at';
      slider(body, rl, f.rmin ?? 50, f.rmax, f.unit === 'm' ? 50 : f.unit === 'dB' ? 1 : 0.5, s.r, f.unit, (v) => { s.r = v; saveState(); render(); });
    }
    const [cmin, cmax, cstep] = cutSliderSpec(f);
    slider(body, CUT_LABEL[f.kind], cmin, cmax, cstep, s.cut, f.unit, (v) => { s.cut = v; saveState(); render(); });
    const cutRow = body.lastElementChild;
    cutRow.classList.add('cut');
    cutRow.hidden = !s.must;
    root.appendChild(box);
    if (s.pois) showPois(f.key, true);
  }
  const op = document.getElementById('opacity');
  op.value = view.opacity; op.nextElementSibling.textContent = view.opacity;
  op.addEventListener('input', () => { view.opacity = parseFloat(op.value); overlay.setOpacity(view.opacity); op.nextElementSibling.textContent = op.value; saveView(); });
  for (const key of ['palette', 'stretch', 'bands']) {
    const el = document.getElementById(key);
    el.value = String(view[key]);
    el.addEventListener('change', () => { view[key] = key === 'bands' ? parseInt(el.value) : el.value; saveView(); render(); });
  }
  document.getElementById('areas').addEventListener('change', (e) => { e.target.checked ? areasLayer.addTo(map) : areasLayer.remove(); });
  overlayToggle('flood', async () => {
    const [q100, q500] = await Promise.all(['data/flood_q100.geojson', 'data/flood_q500.geojson'].map((u) => fetch(u).then((r) => r.json())));
    return L.layerGroup([
      L.geoJSON(q500, { style: { color: '#2a78d6', weight: 1, fillColor: '#2a78d6', fillOpacity: 0.15 }, onEachFeature: (ft, l) => l.bindTooltip(`T=500 · ${ft.properties.rio}`, { sticky: true }) }),
      L.geoJSON(q100, { style: { color: '#0d366b', weight: 1, fillColor: '#0d366b', fillOpacity: 0.3 }, onEachFeature: (ft, l) => l.bindTooltip(`T=100 · ${ft.properties.rio}`, { sticky: true }) }),
    ]);
  });
  overlayToggle('noise', async () => {
    const bands = await fetch('data/noise_lden.geojson').then((r) => r.json());
    const shade = { 55: 0.08, 60: 0.16, 65: 0.28, 70: 0.42, 75: 0.6 };
    return L.geoJSON(bands, { style: (ft) => ({ color: '#eb6834', weight: 0.5, fillColor: '#eb6834', fillOpacity: shade[ft.properties.db] ?? 0.5 }), onEachFeature: (ft, l) => l.bindTooltip(`Lden ${ft.properties.db}–${ft.properties.db + 5} dB`, { sticky: true }) });
  });
  const m = G.meta;
  document.getElementById('meta').textContent = `Grid ${m.nx}×${m.ny} cells of ${m.cell_m} m, built ${m.generated}.`;
}

let DOSSIERS = [];
function showDossier(i) {
  const d = DOSSIERS[i], el = document.getElementById('dossier');
  const para = (label, text) => (text ? `<h4>${label}</h4><p>${text}</p>` : '');
  const score = d.score_override ?? d.score;
  el.innerHTML = `<button class="close" onclick="document.getElementById('dossier').hidden=true">×</button>
    <h3>${d.name}</h3>
    <p class="meta">reputation score <b>${score == null ? 'n/a' : score.toFixed(2)}</b>${d.score_override != null ? ' (your override)' : ''} · confidence ${d.confidence}</p>
    ${para('Character', d.character)}${para('For a family', d.families)}${para('Safety', d.safety)}${para('Nuisances', d.nuisances)}${para('Housing', d.housing)}
    <h4>Sources</h4><ol>${(d.sources || []).map((s) => `<li><a href="${s.url}" target="_blank" rel="noopener">${s.title}</a>${s.note ? ` — ${s.note}` : ''}</li>`).join('')}</ol>`;
  el.hidden = false;
  if (narrow()) map.closePopup();
}

const overlays = {};
function overlayToggle(id, build) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', async () => {
    if (!overlays[id]) overlays[id] = await build();
    el.checked ? overlays[id].addTo(map) : overlays[id].remove();
  });
}

function poisFor(key) {
  const min = variantStep(key);
  return min == null ? POIS[key] : POIS[key].filter((p) => p[3] >= min);
}
function showPois(key, on) {
  if (!poiLayers[key]) {
    const color = POI_COLORS[key] || '#5c5b57', small = key === 'bus';
    poiLayers[key] = L.layerGroup(poisFor(key).map(([lat, lon, name, ha]) =>
      L.circleMarker([lat, lon], { radius: small ? 2.5 : ha ? Math.min(12, 4 + Math.sqrt(ha)) : 5, color: '#fff', weight: 1, fillColor: color, fillOpacity: 0.9 }).bindTooltip(`${name || key}${ha ? ` · ${ha} ha` : ''}`)));
  }
  on ? poiLayers[key].addTo(map) : poiLayers[key].remove();
}

let legendDiv;
function legend() {
  const c = L.control({ position: 'bottomright' });
  c.onAdd = () => {
    legendDiv = L.DomUtil.create('div', 'legend');
    updateLegend();
    return legendDiv;
  };
  c.addTo(map);
}
function updateLegend() {
  if (!legendDiv) return;
  const [lo, hi] = range, P = PALETTES[view.palette];
  const label = { view: '5th–95th percentile of cells in view', box: '5th–95th percentile of the box', none: 'absolute' }[view.stretch];
  const bg = view.bands ? `linear-gradient(90deg,${Array.from({ length: view.bands }, (_, i) => { const c = P[Math.round((i / (view.bands - 1)) * (P.length - 1))]; return `${c} ${(100 * i) / view.bands}%, ${c} ${(100 * (i + 1)) / view.bands}%`; }).join(',')})` : `linear-gradient(90deg,${P.join(',')})`;
  const nf = activeFilters().length, cell = G.meta.cell_m;
  const pass = nf ? `<div class="pass">${included.toLocaleString()} cells (${(included * cell * cell / 1e6).toFixed(1)} km²) pass ${nf} filter${nf > 1 ? 's' : ''}; the rest are unshaded</div>` : '';
  legendDiv.innerHTML = `Weighted score, ${label}<div class="bar" style="background:${bg}"></div><div class="ticks"><span>${lo.toFixed(2)} worse</span><span>better ${hi.toFixed(2)}</span></div>${pass}`;
}

async function main() {
  [G, POIS, AREAS, DOSSIERS] = await Promise.all(['data/grid.json', 'data/pois.json', 'data/areas.geojson', 'data/dossiers.json'].map((u) => fetch(u).then((r) => (r.ok ? r.json() : []))));
  loadState();
  loadView();
  const b = G.meta.bounds, bounds = [[b.south, b.west], [b.north, b.east]];
  map = L.map('map', { zoomControl: false });
  L.control.zoom({ position: narrow() ? 'bottomleft' : 'topleft' }).addTo(map); // on phones the popup would sit under a top-left control
  const mp = (new URLSearchParams(location.search).get('map') || '').split('_').map(Number);
  if (mp.length === 3 && mp.every((x) => !isNaN(x))) map.setView([mp[0], mp[1]], mp[2]); else map.fitBounds(bounds);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
  canvas = document.createElement('canvas'); canvas.width = G.meta.nx * SCALE; canvas.height = G.meta.ny * SCALE; ctx = canvas.getContext('2d');
  overlay = L.imageOverlay(canvas.toDataURL(), bounds, { opacity: view.opacity, interactive: false }).addTo(map);
  areasLayer = L.geoJSON(AREAS, { style: { color: '#5c5b57', weight: 1, fill: false, dashArray: '3 3' }, onEachFeature: (ft, l) => l.bindTooltip(ft.properties.name, { sticky: true }) });
  buildPanel();
  setupStrip();
  render();
  legend();
  map.on('click', onClick);
  map.on('moveend', () => { syncUrl(); if (view.stretch === 'view') render(); });
  syncUrl();
  document.getElementById('copy').addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'copied'; setTimeout(() => { e.target.textContent = 'copy link'; }, 1500); } catch (err) { prompt('Copy this link:', location.href); }
  });
  document.getElementById('reset').addEventListener('click', () => {
    try { localStorage.removeItem('oviedo-heat-state'); localStorage.removeItem('oviedo-heat-view'); } catch (e) { /* ignore */ }
    location.href = location.pathname;
  });
}
main();
