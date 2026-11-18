// ============================================================
// Redmetro Rioverde en vivo — prototipo con DATOS SIMULADOS
// Paradas tomadas del mapa público de la SCT (Zona Media).
// Las posiciones son APROXIMADAS (se calcularon desde la imagen del mapa).
// Cuando tengas coordenadas reales o GPS, reemplaza LINES y fetchBuses().
// ============================================================

// Posición de cada parada como píxel del mapa (x, y) -> convertido a lat/lng.
// Origen: Morelos (355, 265) ≈ centro de Rioverde, SLP.
const ORIGIN = { x: 355, y: 265, lat: 21.9330, lng: -99.9800 };
const LAT_PER_PX = 0.00018, LNG_PER_PX = 0.000194;
const px = (x, y) => [ORIGIN.lat - (y - ORIGIN.y) * LAT_PER_PX, ORIGIN.lng + (x - ORIGIN.x) * LNG_PER_PX];

// n: nombre · p: [x, y] en el mapa · t: minutos desde la base · tr: zona de transferencia
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

const ONE_WAY = 50;   // minutos de ida (dato de Alejandro, por confirmar)
const DWELL   = 17;   // minutos de espera en base
const BUSES_PER_LINE = 4;
const CYCLE = (ONE_WAY + DWELL) * 2;

// ---------- Estado ----------
let lineIdx = 0, dir = 0, selStop = null;
const state = { map: null, buses: [], markers: {}, stopMarkers: [], poly: null };

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

function positionAt(ln, minutes) {
  const s = ln.stops;
  for (let i = 0; i < s.length - 1; i++) {
    if (minutes <= s[i + 1].t) {
      const f = (minutes - s[i].t) / (s[i + 1].t - s[i].t);
      return [s[i].lat + f * (s[i + 1].lat - s[i].lat), s[i].lng + f * (s[i + 1].lng - s[i].lng)];
    }
  }
  const l = s[s.length - 1];
  return [l.lat, l.lng];
}

// ---------- ETA ----------
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
    if (i === lineIdx) { b.style.borderColor = ln.color; }
    b.onclick = () => { lineIdx = i; selStop = null; drawAll(); fitLine(); };
    el.appendChild(b);
  });
  const dEl = document.getElementById('dirs');
  const s = LINES[lineIdx].stops;
  dEl.innerHTML = '';
  [[0, s[0].n + ' → ' + s[s.length - 1].n], [1, s[s.length - 1].n + ' → ' + s[0].n]].forEach(([d, label]) => {
    const b = document.createElement('button');
    b.className = 'dir' + (d === dir ? ' active' : '');
    b.textContent = label;
    b.onclick = () => { dir = d; drawAll(); };
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
    row.onclick = () => { selStop = i; state.map.setView([st.lat, st.lng], 15); drawAll(); };
    el.appendChild(row);
  });
}

function drawMap(buses) {
  const ln = LINES[lineIdx];
  if (state.poly) state.map.removeLayer(state.poly);
  state.stopMarkers.forEach(m => state.map.removeLayer(m));
  state.stopMarkers = [];
  state.poly = L.polyline(ln.stops.map(s => [s.lat, s.lng]), { color: ln.color, weight: 6, opacity: .9 }).addTo(state.map);
  ln.stops.forEach((s, i) => {
    const cls = 'stop-pin' + (s.tr ? ' tr' : '') + (i === selStop ? ' sel' : '');
    const icon = L.divIcon({ className: '', html: '<div class="' + cls + '" style="--c:' + ln.color + '"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    state.stopMarkers.push(L.marker([s.lat, s.lng], { icon }).addTo(state.map).bindTooltip(s.n));
  });
  Object.values(state.markers).forEach(m => state.map.removeLayer(m));
  state.markers = {};
  buses.filter(b => b.line === ln.id).forEach(b => {
    const icon = L.divIcon({ className: '', html: '<div class="bus-icon" style="--c:' + ln.color + '">🚌</div>', iconSize: [34, 34], iconAnchor: [17, 17] });
    state.markers[b.id] = L.marker([b.lat, b.lng], { icon }).addTo(state.map).bindTooltip(b.id + (b.waiting ? ' (en base)' : ''));
  });
}

function drawAll() {
  const buses = fetchBuses();
  state.buses = buses;
  renderTabs();
  renderStops(buses);
  drawMap(buses);
}

function fitLine() {
  const ln = LINES[lineIdx];
  state.map.fitBounds(ln.stops.map(s => [s.lat, s.lng]), { paddingTopLeft: [20, 90], paddingBottomRight: [20, 320] });
}

function init() {
  state.map = L.map('map', { zoomControl: false }).setView([ORIGIN.lat, ORIGIN.lng], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(state.map);
  drawAll();
  fitLine();
  document.getElementById('grab').onclick = () => document.getElementById('sheet').classList.toggle('collapsed');
  setInterval(drawAll, 5000);
}

init();
