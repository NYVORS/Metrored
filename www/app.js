// ============================================================
// Redmetro Rioverde en vivo — prototipo con DATOS SIMULADOS
// - Paradas según el mapa público de la SCT (Zona Media), posiciones verificadas.
// - La línea sigue las calles (OSRM) cuando hay internet.
// - L2: minutos reales entre paradas medidos en un recorrido (salida 7:40 de Llanitos).
// - L1: se estima con la velocidad promedio real de L2. Frecuencia de 20 min.
// ============================================================

const LINES = [
  {
    id: 'L1', short: 'L1', name: 'Rioverde – Ciudad Fernández', color: '#2fbf5b',
    stops: [
      { n: 'Abasolo' }, { n: 'El Refugio' }, { n: 'Media Luna' }, { n: 'Cobach 05' }, { n: 'Walmart' },
      { n: 'Blvd. Ferrocarrilero', tr: true }, { n: 'Morelos', tr: true }, { n: 'Insurgentes' }, { n: 'Fiscalía' },
    ],
  },
  {
    id: 'L2', short: 'L2', name: 'Eje Norte – Sur', color: '#0a6b3d',
    stops: [
      { n: 'Llanitos' }, { n: 'Centenario' }, { n: 'Mariano Matamoros' }, { n: 'Soriana' }, { n: 'Blvd. Ferrocarrilero', tr: true },
      { n: 'Jacarandas' }, { n: 'Morelos', tr: true }, { n: 'Hospital Regional' }, { n: 'Justo Sierra' }, { n: 'Puente Corona' },
      { n: 'Secundaria Técnica 74' }, { n: 'Universidad Autónoma Zona Media' }, { n: 'CECADEE Sur-Norte' },
      { n: 'Servicios Municipales' }, { n: 'Instituto Tecnológico Superior' },
    ],
  },
];

// Posiciones verificadas (mismo orden que las paradas de cada línea).
const FIXED = {
  L1: [[21.945963,-100.052648],[21.940996,-100.041009],[21.93657,-100.029058],[21.933656,-100.021822],[21.927224,-100.006227],[21.925299,-100.002042],[21.923058,-99.994077],[21.922128,-99.979951],[21.919731,-99.956552]],
  L2: [[21.949435,-100.00534],[21.939796,-100.003564],[21.936243,-100.003079],[21.930557,-100.002422],[21.925393,-100.002022],[21.923566,-99.998588],[21.923058,-99.994077],[21.919278,-99.992375],[21.917188,-99.990336],[21.913946,-99.987102],[21.90707,-99.984188],[21.899703,-99.982242],[21.893981,-99.979935],[21.890552,-99.978866],[21.887858,-99.978007]],
};
LINES.forEach(l => l.stops.forEach((s, i) => { [s.lat, s.lng] = FIXED[l.id][i]; }));

// ---------- Parámetros del servicio ----------
const NBUSES = 4;          // siempre 4 camiones por línea
const DWELL = 17;          // espera en cada base: de 15 a 20 min (se usa el promedio)
const STOP_WAIT = 1;       // min que "se encuentra en la estación"
const ROAD_FACTOR = 1.04;  // si la línea es recta, se estima la distancia por calles
// Minutos reales desde la salida (por parada, en el orden de LINES). Medido con cronómetro + Strava.
// L2: Llanitos 7:40 -> Tecnológico 8:12 = 32 min. Centenario es interpolado (no se midió). Morelos = zona de transferencia (7:57).
const REAL_T = { L2: [0, 4, 5, 10, 12, 15, 17, 19, 21, 23, 26, 28, 30, 31, 32] };
let SPEED = 300;           // m/min (se recalcula con la calibración)

const STORE_KEY = 'mr_stops_v3', ROUTE_KEY = 'mr_route_v3_', FAV_KEY = 'mr_fav_v1', SYNC_KEY = 'mr_sync_v1';
let sync = {};   // ajuste de reloj por línea (min) cuando el usuario confirma que el camión ya está
let lineIdx = 0, dir = 0, selStop = null, editMode = false, viewIdx = 0, schedStop = 0;
let trip = { a: 0, b: 0 }, fav = null;
const state = { map: null, buses: [], markers: {}, stopMarkers: [], poly: null };

// ---------- Utilidades ----------
const fmtTime = d => d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
const inMin = m => fmtTime(new Date(Date.now() + m * 60000));
const km = m => (m / 1000).toFixed(1);
const mins = m => Math.round(m);

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
function setGeom(ln, geom, road) {
  ln.geom = geom;
  ln.k = road ? 1 : ROAD_FACTOR;
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
  recalcTimes();
}
const straightGeom = ln => ln.stops.map(s => [s.lat, s.lng]);

// Recalcula velocidad, tiempos entre paradas y número de camiones.
function recalcTimes() {
  if (!LINES.every(l => l.stopD)) return;
  const c = LINES.find(l => REAL_T[l.id]);
  const rt = REAL_T[c.id];
  SPEED = c.stopD[c.stops.length - 1] * c.k / rt[rt.length - 1]; // m/min promedio real (con paradas)
  LINES.forEach(l => {
    l.real = REAL_T[l.id] || null;
    l.stops.forEach((s, i) => { s.d = l.stopD[i] * l.k; s.t = l.real ? l.real[i] : s.d / SPEED; });
    const last = l.stops.length - 1;
    l.T = l.stops[last].t;                 // minutos de ida
    l.km = l.stops[last].d / 1000;         // km de ida
    l.nBuses = NBUSES; l.dwell = DWELL;
    l.cycle = 2 * (l.T + DWELL);           // ida + base + vuelta + base
    l.headway = l.cycle / NBUSES;          // 4 camiones equidistantes: nunca dos en el mismo punto y sentido
  });
}

async function loadRoute(ln) {
  const sig = ln.stops.map(s => s.lat.toFixed(5) + ',' + s.lng.toFixed(5)).join(';');
  try {
    const c = JSON.parse(localStorage.getItem(ROUTE_KEY + ln.id) || 'null');
    if (c && c.sig === sig) { setGeom(ln, c.geom, true); return; }
  } catch (e) {}
  setGeom(ln, straightGeom(ln), false);
  try {
    const coords = ln.stops.map(s => s.lng + ',' + s.lat).join(';');
    const r = await fetch('https://router.project-osrm.org/route/v1/driving/' + coords + '?overview=full&geometries=geojson');
    const j = await r.json();
    if (j.routes && j.routes[0]) {
      const geom = j.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
      setGeom(ln, geom, true);
      try { localStorage.setItem(ROUTE_KEY + ln.id, JSON.stringify({ sig, geom })); } catch (e) {}
      if (LINES[lineIdx] === ln) drawStatic();
      refresh(); renderView();
    }
  } catch (e) { /* sin internet: queda la línea recta con el factor de calles */ }
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
// minutos recorridos desde el inicio -> posición sobre la ruta
function positionAt(ln, minutes) {
  const m = Math.max(0, Math.min(minutes, ln.T));
  if (!ln.real) return pointAt(ln, m * SPEED / ln.k);
  let i = 0;
  while (i < ln.stops.length - 2 && m > ln.stops[i + 1].t) i++;
  const a = ln.stops[i], b = ln.stops[i + 1];
  const f = b.t > a.t ? (m - a.t) / (b.t - a.t) : 0;
  return pointAt(ln, (ln.stopD[i] + f * (ln.stopD[i + 1] - ln.stopD[i])));
}

// ---------- Simulación (sustituir por datos reales) ----------
function fetchBuses() {
  const out = [];
  LINES.forEach(ln => {
    const now = Date.now() / 60000 + (sync[ln.id] || 0);
    for (let k = 0; k < ln.nBuses; k++) {
      const phase = (((now - k * ln.headway) % ln.cycle) + ln.cycle) % ln.cycle;
      out.push(busFromPhase(ln, k, phase));
    }
  });
  return out;
}
function busFromPhase(ln, k, p) {
  const T = ln.T;
  let d, along, waiting = false;
  const W = ln.dwell;
  if (p < T)                    { d = 0; along = p; }
  else if (p < T + W)           { d = 0; along = T; waiting = true; }
  else if (p < 2 * T + W)       { d = 1; along = p - T - W; }
  else                          { d = 1; along = T; waiting = true; }
  const pos = positionAt(ln, d === 0 ? along : T - along);
  return { id: ln.id + '-' + (k + 1), line: ln.id, dir: d, phase: p, waiting, lat: pos[0], lng: pos[1] };
}
// Llegadas de cada camión a una parada (ordenadas).
// here = el camión está en la estación. En las bases (Llanitos y Tecnológico) espera de 15 a 20 min antes de salir:
// ahí board = es la base donde sube el pasajero y dep = minutos que le faltan para salir.
function arrivals(ln, d, i, buses) {
  const t = ln.stops[i].t, T = ln.T, W = ln.dwell, c = ln.cycle, last = ln.stops.length - 1;
  const target = d === 0 ? t : T + W + (T - t);
  const boarding = (i === 0 && d === 0) || (i === last && d === 1);
  return buses.filter(b => b.line === ln.id).map(b => {
    const p = b.phase, el = (((p - target) % c) + c) % c;
    let w = (((target - p) % c) + c) % c;
    const inBase = b.waiting && ((i === last && b.dir === 0) || (i === 0 && b.dir === 1));
    if (boarding && !inBase && w < 0.2) w += c;   // un camión que acaba de salir de la base ya no cuenta como próximo
    const dep = inBase ? (b.dir === 1 ? c - p : T + W - p) : null;
    let text = 'va en sentido contrario';
    if (d === 0 && p >= 2 * T + W) text = 'en la base de ' + ln.stops[0].n;
    else if (d === 1 && p >= T && p < T + W) text = 'en la base de ' + ln.stops[last].n;
    else if (d === 0 && p < T && p <= target) {
      let j = 0; ln.stops.forEach((s, k) => { if (s.t <= p) j = k; });
      text = (i - j <= 1 ? 'es la próxima parada' : 'a ' + (i - j) + ' paradas') + ' (viene de ' + ln.stops[j].n + ')';
    } else if (d === 1 && p >= T + W && p <= target) {
      const m = T - (p - T - W); let j = 0; ln.stops.forEach((s, k) => { if (s.t <= m) j = k; });
      text = (j - i <= 0 ? 'es la próxima parada' : 'a ' + (j - i + 1) + ' paradas') + ' (viene de ' + ln.stops[Math.min(j + 1, last)].n + ')';
    }
    return { w, bus: b, here: inBase || (i !== 0 && i !== last && el < STOP_WAIT), inBase, board: inBase && boarding, dep, text };
  }).sort((x, y) => x.w - y.w);
}
// Minutos para los próximos camiones. En la base cuenta también el que está esperando (w = minutos para que salga).
const waits = (ln, d, i, buses) => arrivals(ln, d, i, buses).filter(a => !a.here || a.board).map(a => a.w);

// ---------- Mi parada ----------
function loadFav() { try { fav = JSON.parse(localStorage.getItem(FAV_KEY) || 'null'); } catch (e) { fav = null; } }
function saveFav() { try { localStorage.setItem(FAV_KEY, JSON.stringify(fav)); } catch (e) {} }
function toggleFav(li, i, d) {
  if (fav && fav.l === li && fav.i === i && fav.d === d) fav = null; else fav = { l: li, i, d };
  saveFav(); renderFav(); renderView();
}
function renderFav() {
  const el = document.getElementById('fav');
  if (!fav) { el.innerHTML = ''; return; }
  const ln = LINES[fav.l], st = ln.stops[fav.i];
  const w = waits(ln, fav.d, fav.i, state.buses)[0];
  const dest = fav.d === 0 ? ln.stops[ln.stops.length - 1].n : ln.stops[0].n;
  const txt = w === undefined ? '—' : (w <= 1 ? 'Llegando' : mins(w) + ' min');
  el.innerHTML = '<button class="favcard"><span>⭐ Mi parada</span><b>' + st.n + '</b><small>' + ln.short + ' → ' + dest + '</small><em>' + txt + '</em></button>';
  el.firstChild.onclick = () => { lineIdx = fav.l; dir = fav.d; selStop = fav.i; viewIdx = 0; clearBuses(); drawAll(); state.map.setView([st.lat, st.lng], 16); };
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
    b.onclick = () => { lineIdx = i; selStop = null; schedStop = 0; trip = { a: 0, b: LINES[i].stops.length - 1 }; clearBuses(); drawAll(); fitLine(); };
    el.appendChild(b);
  });
  const vEl = document.getElementById('views');
  vEl.innerHTML = '';
  ['Paradas', 'Recorrido', 'Viaje', 'Horarios', 'Info'].forEach((v, i) => {
    const b = document.createElement('button');
    b.className = 'vbtn' + (i === viewIdx ? ' active' : '');
    b.textContent = v;
    b.onclick = () => { viewIdx = i; renderTabs(); renderView(); };
    vEl.appendChild(b);
  });
}

function dirButtons() {
  const s = LINES[lineIdx].stops;
  return '<div class="dirs">' + [[0, s[0].n + ' → ' + s[s.length - 1].n], [1, s[s.length - 1].n + ' → ' + s[0].n]]
    .map(([d, label]) => '<button class="dir' + (d === dir ? ' active' : '') + '" data-d="' + d + '">' + label + '</button>').join('') + '</div>';
}
function bindDirs(el) {
  el.querySelectorAll('.dir').forEach(b => b.onclick = () => { dir = +b.dataset.d; refresh(); renderView(); });
}
function etaText(arr) {
  const h = arr.find(x => x.here), n = arr.find(x => !x.here);
  if (h && h.board) return '<div class="eta here"><b>En la estación</b><small>Sale ~' + inMin(h.dep) + '</small></div>';
  if (h) return '<div class="eta here"><b>En la estación</b><small>' + h.bus.id + (n ? ' · sig. ' + inMin(n.w) : '') + '</small></div>';
  if (!n) return '<div class="eta late"><b>—</b><small>sin datos</small></div>';
  return n.w <= 1 ? '<div class="eta soon"><b>Llegando</b><small>llega ' + inMin(n.w) + '</small></div>'
    : '<div class="eta"><b>' + mins(n.w) + ' min</b><small>Llega a las ' + inMin(n.w) + '</small></div>';
}
const subTxt = arr => { const bb = arr.find(x => x.board); if (bb) return bb.bus.id + ': espera en la base (15 a 20 min)'; const n = arr.find(x => !x.here); return n ? n.bus.id + ': ' + n.text : ''; };

function renderView() {
  const el = document.getElementById('view');
  const ln = LINES[lineIdx];
  if (!ln.T) { el.innerHTML = ''; return; }
  const buses = state.buses;

  if (viewIdx === 0) {
    const order = ln.stops.map((_, i) => i);
    if (dir === 1) order.reverse();
    el.innerHTML = dirButtons() + '<div class="stops">' + order.map(i => {
      const st = ln.stops[i], arr = arrivals(ln, dir, i, buses);
      const isFav = fav && fav.l === lineIdx && fav.i === i && fav.d === dir;
      return '<div class="stop' + (i === selStop ? ' selected' : '') + '" data-i="' + i + '" style="--c:' + ln.color + '">' +
        '<span class="dot"></span><span class="name">' + st.n + (st.tr ? '<span class="tr">↔ Transferencia</span>' : '') +
        '<span class="sub">' + km(st.d) + ' km · ' + subTxt(arr) + '</span></span>' + etaText(arr) +
        '<span class="star' + (isFav ? ' on' : '') + '" data-i="' + i + '">' + (isFav ? '★' : '☆') + '</span></div>';
    }).join('') + '</div>';
    bindDirs(el);
    el.querySelectorAll('.stop').forEach(r => {
      r.onclick = () => { const i = +r.dataset.i; selStop = i; schedStop = i; state.map.setView([ln.stops[i].lat, ln.stops[i].lng], 16); drawStatic(); renderView(); };
    });
    el.querySelectorAll('.star').forEach(s => s.onclick = ev => { ev.stopPropagation(); toggleFav(lineIdx, +s.dataset.i, dir); });
  }

  else if (viewIdx === 1) {
    el.innerHTML = '<div class="stops">' + buses.filter(b => b.line === ln.id).map(b => busCard(ln, b)).join('') +
      '</div><p class="note">4 camiones por línea. Dos camiones solo se cruzan cuando uno va y el otro viene.</p>';
  }

  else if (viewIdx === 2) {
    const opts = sel => ln.stops.map((s, i) => '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>' + s.n + '</option>').join('');
    if (trip.b >= ln.stops.length || trip.a >= ln.stops.length) trip = { a: 0, b: ln.stops.length - 1 };
    el.innerHTML = '<div class="trip"><label>Salgo de<select id="selA">' + opts(trip.a) + '</select></label>' +
      '<button id="swap" class="swap" aria-label="Invertir">⇅</button>' +
      '<label>Voy a<select id="selB">' + opts(trip.b) + '</select></label></div><div id="tripRes"></div>';
    document.getElementById('selA').onchange = e => { trip.a = +e.target.value; updateTrip(); };
    document.getElementById('selB').onchange = e => { trip.b = +e.target.value; updateTrip(); };
    document.getElementById('swap').onclick = () => { [trip.a, trip.b] = [trip.b, trip.a]; renderView(); };
    updateTrip();
  }

  else if (viewIdx === 3) {
    const i = Math.min(schedStop, ln.stops.length - 1);
    const opts = ln.stops.map((s, k) => '<option value="' + k + '"' + (k === i ? ' selected' : '') + '>' + s.n + '</option>').join('');
    const w = waits(ln, dir, i, buses);
    // Próximos camiones: los de este ciclo y los del siguiente (cada 20 min)
    const list = [];
    for (let r = 0; r < 2; r++) w.forEach(x => list.push(x + r * ln.cycle));
    const next = list.sort((a, b) => a - b).slice(0, 6);
    el.innerHTML = dirButtons() + '<label class="lab">Parada<select id="selS">' + opts + '</select></label>' +
      '<div class="card"><b>Próximos camiones en ' + ln.stops[i].n + '</b><ul class="times">' +
      next.map(x => '<li><span>' + inMin(x) + '</span><small>en ' + mins(x) + ' min</small></li>').join('') + '</ul>' +
      '<p class="note">Estimación: pasa un camión cada ' + mins(ln.headway) + ' min aproximadamente.</p></div>';
    bindDirs(el);
    document.getElementById('selS').onchange = e => { schedStop = +e.target.value; selStop = schedStop; renderView(); drawStatic(); };
  }

  else {
    const other = LINES[1 - lineIdx];
    const rows = ln.stops.map((s, i) => '<tr><td>' + s.n + '</td><td>' + km(s.d) + '</td><td>' + mins(s.t) + '</td></tr>').join('');
    el.innerHTML = '<div class="stats">' +
      '<div><b>' + ln.km.toFixed(1) + ' km</b><small>distancia de ida</small></div>' +
      '<div><b>' + mins(ln.T) + ' min</b><small>tiempo de ida</small></div>' +
      '<div><b>' + (SPEED * 0.06).toFixed(1) + ' km/h</b><small>velocidad promedio</small></div>' +
      '<div><b>' + mins(ln.headway) + ' min</b><small>entre camiones</small></div>' +
      '<div><b>' + mins(ln.cycle) + ' min</b><small>vuelta completa</small></div>' +
      '<div><b>' + mins(ln.dwell) + ' min</b><small>espera en base</small></div>' +
      '<div><b>' + ln.nBuses + '</b><small>camiones (fijos)</small></div></div>' +
      '<table class="tbl"><tr><th>Parada</th><th>km</th><th>min</th></tr>' + rows + '</table>' +
      '<p class="note">' + (ln.real ? 'Tiempos medidos en un recorrido real.' : 'Tiempos estimados con la velocidad promedio real de L2.') + ' ' +
      (ln.k === 1 ? 'Distancias por calles.' : 'Distancias estimadas (sin internet para trazar por calles).') +
      ' Línea ' + other.short + ': ' + other.km.toFixed(1) + ' km, ' + mins(other.T) + ' min.</p>';
  }
}

function updateTrip() {
  const ln = LINES[lineIdx], el = document.getElementById('tripRes');
  if (!el) return;
  if (trip.a === trip.b) { el.innerHTML = '<p class="note">Elige dos paradas distintas.</p>'; return; }
  const d = trip.b > trip.a ? 0 : 1;
  const A = ln.stops[trip.a], B = ln.stops[trip.b];
  const distM = Math.abs(B.d - A.d), ride = Math.abs(B.t - A.t);
  const w = waits(ln, d, trip.a, state.buses)[0] || 0;
  const dest = d === 0 ? ln.stops[ln.stops.length - 1].n : ln.stops[0].n;
  el.innerHTML = '<div class="card"><div class="stats">' +
    '<div><b>' + km(distM) + ' km</b><small>distancia</small></div>' +
    '<div><b>' + mins(ride) + ' min</b><small>en camión</small></div>' +
    '<div><b>' + (w <= 1 ? 'Ya' : mins(w) + ' min') + '</b><small>próximo camión</small></div></div>' +
    '<p class="note">Dirección ' + dest + '. Llegarías a ' + B.n + ' hacia las <b>' + inMin(w + ride) + '</b> (' + mins(w + ride) + ' min en total).</p></div>';
}

// Capa fija: línea y paradas
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
        setGeom(ln, straightGeom(ln), false);
        state.poly.setLatLngs(ln.geom);
        clearTimeout(state.rt);
        state.rt = setTimeout(() => loadRoute(ln), 800);
      });
    }
    state.stopMarkers.push(m);
  });
}
function clearBuses() { Object.values(state.markers).forEach(m => state.map.removeLayer(m)); state.markers = {}; }
function drawBuses(buses) {
  const ln = LINES[lineIdx];
  const ids = new Set();
  buses.filter(b => b.line === ln.id).forEach(b => {
    ids.add(b.id);
    if (state.markers[b.id]) state.markers[b.id].setLatLng([b.lat, b.lng]);
    else {
      const icon = L.divIcon({ className: '', html: '<div class="bus-icon" style="--c:' + ln.color + '">🚌</div>', iconSize: [34, 34], iconAnchor: [17, 17] });
      state.markers[b.id] = L.marker([b.lat, b.lng], { icon, zIndexOffset: 1000 }).addTo(state.map).bindTooltip(b.id);
    }
  });
  Object.keys(state.markers).forEach(id => { if (!ids.has(id)) { state.map.removeLayer(state.markers[id]); delete state.markers[id]; } });
}

function refresh() {
  state.buses = fetchBuses();
  drawBuses(state.buses);
  renderFav(); renderNear();
  if (viewIdx === 2) updateTrip(); else renderView();
}
function drawAll() { renderTabs(); drawStatic(); state.buses = fetchBuses(); drawBuses(state.buses); renderFav(); renderView(); }
function fitLine() {
  const ln = LINES[lineIdx];
  state.map.fitBounds(ln.geom, { paddingTopLeft: [20, 90], paddingBottomRight: [20, 340] });
}

// ---------- Editor de posiciones ----------
function setEditMode(on) {
  editMode = on;
  document.getElementById('editor').hidden = !on;
  document.getElementById('status').textContent = on ? 'EDITOR' : 'BETA';
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

// ---------- Tarjeta de cada camión (recorrido) ----------
function busCard(ln, b) {
  const T = ln.T, S = ln.stops, last = S.length - 1, p = b.phase;
  let m, body, head;
  if (b.waiting) {
    const left = b.dir === 0 ? T + ln.dwell - p : ln.cycle - p;
    m = b.dir === 0 ? T : 0; head = b.dir === 0 ? S[0].n : S[last].n;
    body = '<p><b>En la base de ' + (b.dir === 0 ? S[last].n : S[0].n) + '</b></p><p>Sale a las <b>' + inMin(left) + '</b> (en ' + mins(left) + ' min) hacia ' + head + '</p>';
  } else {
    const along = b.dir === 0 ? p : p - T - ln.dwell;
    m = b.dir === 0 ? along : T - along; head = b.dir === 0 ? S[last].n : S[0].n;
    let j = 0; S.forEach((s, k) => { if (s.t <= m) j = k; });
    const nx = Math.min(j + 1, last), prev = b.dir === 0 ? S[j] : S[nx], next = b.dir === 0 ? S[nx] : S[j];
    const toNext = Math.abs(next.t - m), toEnd = b.dir === 0 ? T - m : m;
    body = '<p>Pasó por <b>' + prev.n + '</b></p><p>Próxima: <b>' + next.n + '</b> · llega a las <b>' + inMin(toNext) + '</b> (' + (toNext < 1 ? 'llegando' : mins(toNext) + ' min') + ')</p>' +
      '<p>Termina en ' + head + ' a las <b>' + inMin(toEnd) + '</b></p>';
  }
  const pct = Math.max(0, Math.min(100, m / T * 100));
  return '<div class="bcard" style="--c:' + ln.color + '"><div class="bh"><b>🚌 ' + b.id + '</b><span>' + (b.dir === 0 ? '→ ' : '← ') + head + '</span></div>' +
    '<div class="bar"><i style="width:' + pct + '%"></i>' + S.map(s => '<u style="left:' + (s.t / T * 100) + '%"></u>').join('') +
    '<span class="bm" style="left:' + pct + '%">🚌</span></div>' + body + '</div>';
}

// ---------- Ubicación del usuario ----------
// El permiso se pregunta UNA sola vez (la primera vez que abres la app). Después se activa solo.
const GEO_KEY = 'mr_geo_v1';   // sin valor = nunca preguntado · 'asked' = ya se preguntó · 'granted' = permitido · 'denied' = negado
const geoGet = () => { try { return localStorage.getItem(GEO_KEY); } catch (e) { return null; } };
const geoSet = v => { try { localStorage.setItem(GEO_KEY, v); } catch (e) {} };
const loc = { pos: null, acc: 0, marker: null, circle: null, trail: null, pts: [], watch: null, near: null, answer: null, err: null };
function loadSync() { try { sync = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); } catch (e) { sync = {}; } }
function askPerm() { document.getElementById('perm').hidden = false; }
function startGeo() {
  document.getElementById('perm').hidden = true;
  if (!navigator.geolocation) { loc.err = 'fail'; renderNear(); return; }
  if (loc.watch !== null) { renderNear(); return; }
  loc.err = null;
  loc.watch = navigator.geolocation.watchPosition(onPos, e => {
    if (e.code === 1) {                          // permiso negado
      if (loc.watch !== null) navigator.geolocation.clearWatch(loc.watch);
      loc.watch = null; geoSet('denied'); loc.err = 'denied';
    } else if (!loc.pos) loc.err = 'fail';       // sin señal por ahora: sigue intentando solo
    renderNear();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  renderNear();
}
function onPos(p) {
  if (geoGet() !== 'granted') geoSet('granted');
  loc.err = null; loc.acc = p.coords.accuracy;
  const ll = [p.coords.latitude, p.coords.longitude], first = !loc.pos;
  loc.pos = ll;
  if (!loc.marker) {
    loc.circle = L.circle(ll, { radius: loc.acc, color: '#1a73e8', weight: 1, fillOpacity: .12 }).addTo(state.map);
    loc.trail = L.polyline([], { color: '#1a73e8', weight: 4, dashArray: '2 8', opacity: .8 }).addTo(state.map);
    loc.marker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 2000 }).addTo(state.map).bindTooltip('Tú estás aquí');
  }
  loc.marker.setLatLng(ll); loc.circle.setLatLng(ll).setRadius(loc.acc);
  const last = loc.pts[loc.pts.length - 1];
  if (!last || dist(last, ll) > 8) { loc.pts.push(ll); if (loc.pts.length > 300) loc.pts.shift(); loc.trail.setLatLngs(loc.pts); }
  if (first) state.map.setView(ll, 16);
  updateNear();
}
function updateNear() {
  let best = null;
  LINES.forEach((l, li) => l.stops.forEach((s, i) => { const d = dist(loc.pos, [s.lat, s.lng]); if (!best || d < best.d) best = { li, i, d }; }));
  const pv = loc.near;
  if (pv && (pv.li !== best.li || pv.i !== best.i)) {
    const pd = dist(loc.pos, [LINES[pv.li].stops[pv.i].lat, LINES[pv.li].stops[pv.i].lng]);
    if (pd < best.d + 40) best = { li: pv.li, i: pv.i, d: pd };   // evita saltos entre paradas pegadas
  }
  const changed = !pv || pv.li !== best.li || pv.i !== best.i;
  loc.near = best;
  if (changed) {
    loc.answer = null;
    if (!editMode && best.d < 400) { lineIdx = best.li; selStop = best.i; schedStop = best.i; clearBuses(); drawAll(); }
  }
  renderNear();
}
// El usuario confirma que el camión ya está: se ajusta el reloj de la línea.
// - En una parada normal: el camión llega ahora.
// - En una base (Llanitos / Tecnológico): el camión está DETENIDO esperando y le faltan "left" min para salir (no sale de inmediato).
function syncTo(li, i, d, left) {
  const ln = LINES[li], last = ln.stops.length - 1, c = ln.cycle;
  const base = (i === 0 && d === 0) || (i === last && d === 1);
  let best;
  if (base) {
    const target = d === 0 ? c - left : ln.T + ln.dwell - left;   // fase en que el camión espera en la base con "left" min por salir
    const diff = b => { let x = (target - b.phase) % c; if (x > c / 2) x -= c; if (x < -c / 2) x += c; return x; };
    best = fetchBuses().filter(b => b.line === ln.id).map(diff).reduce((m, x) => Math.abs(x) < Math.abs(m) ? x : m);
  } else {
    const arr = arrivals(ln, d, i, state.buses);
    best = arr.map(a => a.w > c / 2 ? a.w - c : a.w).reduce((m, x) => Math.abs(x) < Math.abs(m) ? x : m);
  }
  sync[ln.id] = (sync[ln.id] || 0) + best;
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) {}
  loc.answer = { yes: d };
  refresh();
}
function renderNear() {
  const el = document.getElementById('near');
  if (!el) return;
  const bind = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
  if (!loc.pos) {
    el.innerHTML = loc.err === 'denied' ? '<div class="near warn">📍 Sin permiso de ubicación. Actívalo en los ajustes del teléfono. <button class="nbtn" id="nAsk">Reintentar</button></div>'
      : loc.err === 'fail' ? '<div class="near warn">📍 No se pudo obtener tu ubicación. <button class="nbtn" id="nAsk">Reintentar</button></div>'
      : loc.watch !== null ? '<div class="near">📍 Buscando tu ubicación…</div>'
      : '<button class="near ask" id="nAsk">📍 Activar mi ubicación para saber tu parada</button>';
    bind('#nAsk', () => { loc.err = null; if (geoGet() === null) askPerm(); else startGeo(); });
    return;
  }
  const n = loc.near, ln = LINES[n.li], S = ln.stops, st = S[n.i], last = S.length - 1;
  const base = n.i === 0 || n.i === last;
  const dirs = n.i === 0 ? [0] : n.i === last ? [1] : [0, 1];
  const lab = d => 'hacia ' + (d === 0 ? S[last].n : S[0].n);
  const head = '<div class="nh"><b>📍 ' + st.n + '</b><small>' + ln.short + ' · a ' + Math.round(n.d) + ' m de ti</small></div>';
  const rows = () => dirs.map(d => {
    const a = arrivals(ln, d, n.i, state.buses).find(x => !x.here);
    return a ? '<div class="nrow"><span>' + lab(d) + '<small>' + a.bus.id + ' · ' + (base ? 'sale' : 'llega') + ' a las ' + inMin(a.w) + '</small></span><b class="cd" data-ts="' + (Date.now() + a.w * 60000) + '"></b></div>' : '';
  }).join('');
  let html;
  if (n.d > 250) html = head + '<p class="nq">Aún no estás en la parada. Si sales ahora, el siguiente MetroRed pasa en:</p>' + rows();
  else if (loc.answer && loc.answer.ask !== undefined) {
    // Ya está en la base: se pregunta hace cuánto llegó para no hacerlo salir de inmediato.
    const W = Math.round(ln.dwell);
    const chips = [['Recién llegó', W], ['Hace ~5 min', W - 5], ['Hace ~10 min', W - 10], ['Ya va a salir', 2]];
    html = head + '<p class="nq">¿Hace cuánto llegó a la base? Aquí espera de 15 a 20 min antes de salir.</p><div class="nb">' +
      chips.map(c => '<button class="nbtn y" data-left="' + c[1] + '">' + c[0] + '</button>').join('') + '<button class="nbtn" id="nCancel">Cancelar</button></div>';
  }
  else if (loc.answer && loc.answer.yes !== undefined) {
    const d = loc.answer.yes, h = arrivals(ln, d, n.i, state.buses).find(x => x.here);
    if (h && h.board) html = head + '<div class="nhere">🚌 Se encuentra en la base</div><p class="nq">' + h.bus.id + ' ' + lab(d) + '. Sale hacia las <b>' + inMin(h.dep) + '</b> (en ' + mins(h.dep) + ' min). En la base espera de 15 a 20 min.</p><button class="nbtn" id="nLeft">Ya salió</button>';
    else if (h) html = head + '<div class="nhere">🚌 Se encuentra en la estación</div><p class="nq">' + h.bus.id + ' ' + lab(d) + '. Sale en un momento.</p>';
    else { loc.answer = 'no'; html = head + '<p class="nq">El MetroRed ya salió. El siguiente ' + (base ? 'sale' : 'llega') + ' en:</p>' + rows() + '<button class="nbtn" id="nYes">Ya llegó otro</button>'; }
  } else if (loc.answer === 'no') html = head + '<p class="nq">El MetroRed ' + (base ? 'saldrá' : 'llegará') + ' en:</p>' + rows() + '<button class="nbtn" id="nYes">Ya llegó</button>';
  else html = head + '<p class="nq">' + (base ? '¿Ya está el MetroRed en la base?' : '¿Ya está el MetroRed en esta parada?') + '</p><div class="nb">' +
    dirs.map(d => '<button class="nbtn y" data-y="' + d + '">' + (base ? 'Sí, ya está aquí' : 'Sí, va ' + lab(d)) + '</button>').join('') + '<button class="nbtn" id="nNo">Todavía no</button></div>';
  el.innerHTML = '<div class="near">' + html + '</div>';
  el.querySelectorAll('[data-y]').forEach(b => b.onclick = () => {
    const d = +b.dataset.y;
    if (base) { loc.answer = { ask: d }; renderNear(); } else syncTo(n.li, n.i, d, 0);
  });
  el.querySelectorAll('[data-left]').forEach(b => b.onclick = () => syncTo(n.li, n.i, loc.answer.ask, +b.dataset.left));
  bind('#nCancel', () => { loc.answer = null; renderNear(); });
  bind('#nLeft', () => { syncTo(n.li, n.i, loc.answer.yes, 0); loc.answer = 'no'; renderNear(); });
  bind('#nNo', () => { loc.answer = 'no'; renderNear(); });
  bind('#nYes', () => { loc.answer = null; renderNear(); });
  tickCd();
}
function tickCd() {
  document.querySelectorAll('.cd').forEach(e => {
    const ms = +e.dataset.ts - Date.now();
    e.textContent = ms <= 30000 ? 'Llegando' : Math.floor(ms / 60000) + ' min ' + String(Math.floor(ms % 60000 / 1000)).padStart(2, '0') + ' s';
  });
}

function init() {
  loadOverrides();
  loadFav(); loadSync();
  LINES.forEach(l => setGeom(l, straightGeom(l), false));
  trip = { a: 0, b: LINES[0].stops.length - 1 };
  state.map = L.map('map', { zoomControl: false }).setView([21.93, -99.99], 13);
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
  document.getElementById('permOk').onclick = () => { geoSet('asked'); startGeo(); };
  document.getElementById('permNo').onclick = () => { geoSet('asked'); document.getElementById('perm').hidden = true; renderNear(); };
  document.getElementById('locBtn').onclick = () => loc.pos ? state.map.setView(loc.pos, 16) : (geoGet() === null ? askPerm() : startGeo());
  renderNear();
  // El permiso se pregunta solo la primera vez. Si ya lo diste, se activa solo; si dijiste "Ahora no", solo con el botón 📍.
  const g = geoGet();
  if (g === 'granted') startGeo(); else if (g === null) askPerm();
  setInterval(tickCd, 1000);
  setInterval(refresh, 5000);
}

init();
