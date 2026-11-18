// ============================================================
// Redmetro Rioverde en vivo — prototipo con DATOS SIMULADOS
// - Paradas según el mapa público de la SCT (Zona Media).
// - La línea se dibuja siguiendo las calles (OSRM) cuando hay internet.
// - Posiciones de paradas APROXIMADAS: se corrigen arrastrándolas
//   en el modo editor (toca 5 veces la etiqueta "DEMO").
// ============================================================

// Posición inicial aproximada (calculada del mapa-imagen). Se corrige con el editor.
const ORIGIN = { x: 355, y: 265, lat: 21.9330, lng: -99.9800 };
const LAT_PER_PX = 0.00018, LNG_PER_PX = 0.000194;
const px = (x, y) => [ORIGIN.lat - (y - ORIGIN.y) * LAT_PER_PX, ORIGIN.lng + (x - ORIGIN.x) * LNG_PER_PX];

const LINES = [
  {
    id: 'L1', short: 'L1', name: 'Rioverde – Ciudad Fernández', color: '#8dc63f',
    stops: [
      { n: 'Abasolo',            p: [15, 105],  t: 0 },
      { n: 'El Refugio',         p: [85, 140],  t: 6 },
      { n: 'Media Luna',         p: [150, 178], t: 12 },
      { n: 'Cobach 05',          p: [205, 192], t: 17 },
      { n: 'Walmart',            p: [273, 213], t: 24 },
      { n: 'Blvd. Ferrocarril',  p: [315, 243], t: 30, tr: true },
      { n: 'Morelos',            p: [355, 265], t: 34, tr: true },
      { n: 'Insurgentes',        p: [435, 262], t: 40 },
      { n: 'Fiscalía',           p: [600, 245], t: 50 },
    ],
  },
  {
    id: 'L2', short: 'L2', name: 'Eje Norte – Sur', color: '#0b6b45',
    stops: [
      { n: 'Llanitos',                         p: [293, 92],  t: 0 },
      { n: 'Centenario',                       p: [297, 147], t: 4 },
      { n: 'Mariano Matamoros',                p: [305, 174], t: 8 },
      { n: 'Soriana',                          p: [336, 200], t: 12 },
      { n: 'Morelos',                          p: [355, 265], t: 18, tr: true },
      { n: 'Jacarandas',                       p: [365, 277], t: 20 },
      { n: 'Hospital Regional',                p: [385, 300], t: 23 },
      { n: 'Justo Sierra',                     p: [385, 320], t: 26 },
      { n: 'Puente Corona',                    p: [417, 312], t: 29 },
      { n: 'Secundaria Técnica 74',            p: [413, 350], t: 33 },
      { n: 'Universidad Autónoma Zona Media',  p: [425, 400], t: 39 },
      { n: 'CECADEE Sur-Norte',                p: [440, 425], t: 43 },
      { n: 'Servicios Municipales',            p: [435, 440], t: 46 },
      { n: 'Instituto Tecnológico Superior',   p: [430, 468], t: 50 },
    ],
  },
];
LINES.forEach(l => l.stops.forEach(s => { [s.lat, s.lng] = px(s.p[0], s.p[1]); }));

// Posiciones verificadas por Alejandro (en el mismo orden que las paradas de cada línea).
const FIXED = {
  L1: [[21.9618,-100.04596],[21.973312,-100.001432],[21.94866,-100.01977],[21.94614,-100.0091],[21.94236,-99.995908],[21.93696,-99.98776],[21.933,-99.98],[21.93354,-99.96448],[21.9366,-99.93247]],
  L2: [[21.949435,-100.00534],[21.939796,-100.003564],[21.936243,-100.003079],[21.930576,-100.002201],[21.922857,-99.993727],[21.923536,-99.998548],[21.919531,-99.991844],[21.917281,-99.989823],[21.914353,-99.986851],[21.907209,-99.983823],[21.900124,-99.980838],[21.89405,-99.979649],[21.89087,-99.978829],[21.886422,-99.978204]],
};
LINES.forEach(l => l.stops.forEach((s, i) => { [s.lat, s.lng] = FIXED[l.id][i]; }));

const ONE_WAY = 50;
const DWELL   = 17;
const BUSES_PER_LINE = 4;
const CYCLE = (ONE_WAY + DWELL) * 2;

const STORE_KEY = 'mr_stops_v2', ROUTE_KEY = 'mr_route_v2_';
let lineIdx = 0, dir = 0, selStop = null, editMode = false;
const state = { map: null, buses: [], markers: {}, stopMarkers: [], poly: null };

// ---------- Posiciones guardadas por el editor ----------
function loadOverrides() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    LINES.forEach(l => {
      if (o[l.id] && o[l.id].length === l.stops.length) l.stops.forEach((s, i) => { s.lat = o[l.id][i][0]; s.lng = o[l.id][i][1]; });
    });
  } catch (e) {}
}
function saveOverrides() {
  try {
    const o = {};
    LINES.forEach(l => o[l.id] = l.stops.map(s => [+s.lat.toFixed(6), +s.lng.toFixed(6)]));
    localStorage.setItem(STORE_KEY, JSON.stringify(o));
  } catch (e) {}
}

// ---------- Geometría de la ruta ----------
function dist(a, b) {
  const dx = (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), dy = b[0] - a[0];
  return Math.sqrt(dx * dx + dy * dy) * 111320;
}
function setGeom(ln, geom) {
  ln.geom = geom;
  ln.cum = [0];
  for (let i = 1; i < geom.length; i++) ln.cum.push(ln.cum[i - 1] + dist(geom[i - 1], geom[i]));
  let start = 0;
  ln.stopD = ln.stops.map(s => {
    let best = start, bd = Infinity;
    for (let i = start; i < geom.length; i++) {
      const d = dist(geom[i], [s.lat, s.lng]);
      if (d < bd) { bd = d; best = i; }
    }
    start = best;
    return ln.cum[best];
  });
}
function straightGeom(ln) { return ln.stops.map(s => [s.lat, s.lng]); }

async function loadRoute(ln) {
  const sig = ln.stops.map(s => s.lat.toFixed(5) + ',' + s.lng.toFixed(5)).join(';');
  try {
    const c = JSON.parse(localStorage.getItem(ROUTE_KEY + ln.id) || 'null');
    if (c && c.sig === sig) { setGeom(ln, c.geom); return; }
  } catch (e) {}
  setGeom(ln, straightGeom(ln));
  try {
    const coords = ln.stops.map(s => s.lng + ',' + s.lat).join(';');
    const r = await fetch('https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=full&geometries=geojson');
    const j = await r.json();
    if (j.routes && j.routes[0]) {
      const geom = j.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      setGeom(ln, geom);
      try { localStorage.setItem(ROUTE_KEY + ln.id, JSON.stringify({ sig, geom })); } catch (e) {}
      if (LINES[lineIdx] === ln) drawStatic();
    }
  } catch (e) { /* sin internet: queda la línea recta */ }
}

function pointAt(ln, d) {
  const g = ln.geom, c = ln.cum;
  if (d <= 0) return g[0];
  for (let i = 1; i < g.length; i++) {
    if (d <= c[i]) {
      const f = (d - c[i - 1]) / ((c[i] - c[i - 1]) || 1);
      return [g[i - 1][0] + f * (g[i][0] - g[i - 1][0]), g[i - 1][1] + f * (g[i][1] - g[i - 1][1])];
    }
  }
  return g[g.length - 1];
}
function positionAt(ln, minutes) {
  const s = ln.stops;
  let d = ln.stopD[s.length - 1];
  for (let i = 0; i < s.length - 1; i++) {
    if (minutes <= s[i + 1].t) {
      const f = (minutes - s[i].t) / (s[i + 1].t - s[i].t);
      d = ln.stopD[i] + f * (ln.stopD[i + 1] - ln.stopD[i]);
      break;
    }
  }
  return pointAt(ln, d);
}

// ---------- Simulación (sustituir por datos reales) ----------
function fetchBuses() {
  const now = Date.now() / 60000;
  const out = [];
  LINES.forEach((ln, li) => {
    for (let b = 0; b < BUSES_PER_LINE; b++) {
      const phase = (now + b * (CYCLE / BUSES_PER_LINE) + li * 7) % CYCLE;
      out.push(busFromPhase(ln, b, phase));
    }
  });
  return out;
}
function busFromPhase(ln, b, p) {
  let d, along, waiting = false;
  if (p < ONE_WAY)                  { d = 0; along = p; }
  else if (p < ONE_WAY + DWELL)     { d = 0; along = ONE_WAY; waiting = true; }
  else if (p < 2 * ONE_WAY + DWELL) { d = 1; along = p - ONE_WAY - DWELL; }
  else                              { d = 1; along = ONE_WAY; waiting = true; }
  const pos = positionAt(ln, d === 0 ? along : ONE_WAY - along);
  return { id: ln.id + '-' + (b + 1), line: ln.id, dir: d, along, waiting, lat: pos[0], lng: pos[1] };
}

function etaFor(ln, d, stopIdx, buses) {
  const stopT = ln.stops[stopIdx].t;
  const target = d === 0 ? stopT : ONE_WAY - stopT;
  let best = null;
  buses.filter(x => x.line === ln.id && x.dir === d).forEach(x => {
    const diff = target - x.along;
    if (diff < 0) return;
    if (best === null || diff < best) best = diff;
  });
  return best === null ? null : Math.round(best);
}

// ---------- UI ----------
function renderTabs() {
  const el = document.getElementById('lines');
  el.innerHTML = '';
  LINES.forEach((ln, i) => {
    const b = document.createElement('button');
    b.className = 'tab' + (i === lineIdx ? ' active' : '');
    b.innerHTML = '<span class="badge" style="background:' + ln.color + '">' + ln.short + '</span>' + ln.name;
    if (i === lineIdx) b.style.borderColor = ln.color;
    b.onclick = () => { lineIdx = i; selStop = null; clearBuses(); drawAll(); fitLine(); };
    el.appendChild(b);
  });
  const dEl = document.getElementById('dirs');
  const s = LINES[lineIdx].stops;
  dEl.innerHTML = '';
  [[0, s[0].n + ' → ' + s[s.length - 1].n], [1, s[s.length - 1].n + ' → ' + s[0].n]].forEach(([d, label]) => {
    const b = document.createElement('button');
    b.className = 'dir' + (d === dir ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { dir = d; refresh(); renderTabs(); };
    dEl.appendChild(b);
  });
}

function renderStops(buses) {
  const ln = LINES[lineIdx];
  const el = document.getElementById('stops');
  el.innerHTML = '';
  const order = ln.stops.map((_, i) => i);
  if (dir === 1) order.reverse();
  order.forEach(i => {
    const st = ln.stops[i];
    const eta = etaFor(ln, dir, i, buses);
    const row = document.createElement('button');
    row.className = 'stop' + (i === selStop ? ' selected' : '');
    row.style.setProperty('--c', ln.color);
    let etaHtml;
    if (eta === null) etaHtml = '<div class="eta late"><b>—</b><small>sin datos</small></div>';
    else if (eta <= 2) etaHtml = '<div class="eta soon"><b>Llegando</b></div>';
    else etaHtml = '<div class="eta"><b>' + eta + ' min</b><small>próximo</small></div>';
    const tr = st.tr ? '<span class="tr">↔ Transferencia</span>' : '';
    row.innerHTML = '<span class="dot"></span><span class="name">' + st.n + tr + '</span>' + etaHtml;
    row.onclick = () => { selStop = i; state.map.setView([st.lat, st.lng], 16); drawStatic(); refresh(); };
    el.appendChild(row);
  });
}

// Capa fija: línea y paradas (se redibuja solo al cambiar algo)
function drawStatic() {
  const ln = LINES[lineIdx];
  if (state.poly) state.map.removeLayer(state.poly);
  state.stopMarkers.forEach(m => state.map.removeLayer(m));
  state.stopMarkers = [];
  state.poly = L.polyline(ln.geom, { color: ln.color, weight: 6, opacity: .9 }).addTo(state.map);
  ln.stops.forEach((s, i) => {
    const cls = 'stop-pin' + (s.tr ? ' tr' : '') + (i === selStop ? ' sel' : '');
    const icon = L.divIcon({ className: '', html: '<div class="' + cls + '" style="--c:' + ln.color + '"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    const m = L.marker([s.lat, s.lng], { icon, draggable: editMode }).addTo(state.map).bindTooltip(s.n, { permanent: editMode, direction: 'top' });
    if (editMode) {
      m.on('dragend', () => {
        const p = m.getLatLng();
        s.lat = p.lat; s.lng = p.lng;
        saveOverrides();
        setGeom(ln, straightGeom(ln));
        state.poly.setLatLngs(ln.geom);
        clearTimeout(state.rt);
        state.rt = setTimeout(() => loadRoute(ln), 800);
      });
    }
    state.stopMarkers.push(m);
  });
}

function clearBuses() {
  Object.values(state.markers).forEach(m => state.map.removeLayer(m));
  state.markers = {};
}
function drawBuses(buses) {
  const ln = LINES[lineIdx];
  buses.filter(b => b.line === ln.id).forEach(b => {
    if (state.markers[b.id]) state.markers[b.id].setLatLng([b.lat, b.lng]);
    else {
      const icon = L.divIcon({ className: '', html: '<div class="bus-icon" style="--c:' + ln.color + '">🚌</div>', iconSize: [34, 34], iconAnchor: [17, 17] });
      state.markers[b.id] = L.marker([b.lat, b.lng], { icon, zIndexOffset: 1000 }).addTo(state.map).bindTooltip(b.id);
    }
  });
}

function refresh() {
  const buses = fetchBuses();
  state.buses = buses;
  renderStops(buses);
  drawBuses(buses);
}
function drawAll() { renderTabs(); drawStatic(); refresh(); }

function fitLine() {
  const ln = LINES[lineIdx];
  state.map.fitBounds(ln.geom, { paddingTopLeft: [20, 90], paddingBottomRight: [20, 320] });
}

// ---------- Editor de posiciones ----------
function setEditMode(on) {
  editMode = on;
  document.getElementById('editor').hidden = !on;
  document.getElementById('status').textContent = on ? 'EDITOR' : 'DEMO';
  drawStatic();
}
function exportJson() {
  const o = {};
  LINES.forEach(l => o[l.id] = l.stops.map(s => ({ n: s.n, lat: +s.lat.toFixed(6), lng: +s.lng.toFixed(6) })));
  const txt = JSON.stringify(o, null, 1);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => alert('Posiciones copiadas'), () => prompt('Copia esto:', txt));
  else prompt('Copia esto:', txt);
}
function resetStops() {
  if (!confirm('¿Borrar posiciones editadas?')) return;
  try { localStorage.removeItem(STORE_KEY); LINES.forEach(l => localStorage.removeItem(ROUTE_KEY + l.id)); } catch (e) {}
  location.reload();
}

function init() {
  loadOverrides();
  LINES.forEach(l => setGeom(l, straightGeom(l)));
  state.map = L.map('map', { zoomControl: false }).setView([ORIGIN.lat, ORIGIN.lng], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(state.map);
  drawAll();
  fitLine();
  LINES.forEach(loadRoute);
  document.getElementById('grab').onclick = () => document.getElementById('sheet').classList.toggle('collapsed');
  let taps = 0, tt;
  document.getElementById('status').onclick = () => {
    if (editMode) return setEditMode(false);
    if (++taps >= 5) { taps = 0; setEditMode(true); }
    clearTimeout(tt); tt = setTimeout(() => taps = 0, 2000);
  };
  document.getElementById('btnCopy').onclick = exportJson;
  document.getElementById('btnReset').onclick = resetStops;
  document.getElementById('btnDone').onclick = () => setEditMode(false);
  setInterval(refresh, 5000);
}

init();
