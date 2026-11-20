// ============================================================
// Redmetro Rioverde en vivo - prototipo con DATOS SIMULADOS
// - Paradas segun el mapa publico de la SCT (Zona Media), posiciones verificadas.
// - La linea sigue las calles (OSRM) cuando hay internet.
// - L2: minutos reales entre paradas medidos en un recorrido (salida 7:40 de Llanitos).
// - L1: se estima con la velocidad promedio real de L2. Frecuencia de 20 min.
// - EN LINEA: cuando alguien confirma "ya llego" el reporte se guarda en Firebase (coleccion "reportes")
//   y todos los telefonos ajustan los camiones simulados con el ultimo reporte de cada linea.
// ============================================================

const LINES = [
  {
    id: 'L1', short: 'L1', name: 'Rioverde \u2013 Ciudad Fern\u00e1ndez', color: '#2fbf5b',
    stops: [
      { n: 'Abasolo' }, { n: 'El Refugio' }, { n: 'Media Luna' }, { n: 'Cobach 05' }, { n: 'Walmart' },
      { n: 'Blvd. Ferrocarrilero', tr: true }, { n: 'Morelos', tr: true }, { n: 'Insurgentes' }, { n: 'Fiscal\u00eda' },
    ],
  },
  {
    id: 'L2', short: 'L2', name: 'Eje Norte \u2013 Sur', color: '#0a6b3d',
    stops: [
      { n: 'Llanitos' }, { n: 'Centenario' }, { n: 'Mariano Matamoros' }, { n: 'Soriana' }, { n: 'Blvd. Ferrocarrilero', tr: true },
      { n: 'Jacarandas' }, { n: 'Morelos', tr: true }, { n: 'Hospital Regional' }, { n: 'Justo Sierra' }, { n: 'Puente Corona' },
      { n: 'Secundaria T\u00e9cnica 74' }, { n: 'Universidad Aut\u00f3noma Zona Media' }, { n: 'CECADEE Sur-Norte' },
      { n: 'Servicios Municipales' }, { n: 'Instituto Tecnol\u00f3gico Superior' },
    ],
  },
];

// Posiciones verificadas (mismo orden que las paradas de cada linea).
const FIXED = {
  L1: [[21.945963,-100.052648],[21.940996,-100.041009],[21.93657,-100.029058],[21.933656,-100.021822],[21.927224,-100.006227],[21.925299,-100.002042],[21.923058,-99.994077],[21.922128,-99.979951],[21.919731,-99.956552]],
  L2: [[21.949435,-100.00534],[21.939796,-100.003564],[21.936243,-100.003079],[21.930557,-100.002422],[21.925393,-100.002022],[21.923566,-99.998588],[21.923058,-99.994077],[21.919278,-99.992375],[21.917188,-99.990336],[21.913946,-99.987102],[21.90707,-99.984188],[21.899703,-99.982242],[21.897899,-99.981223],[21.894028,-99.980102],[21.887858,-99.978007]],
};
LINES.forEach(l => l.stops.forEach((s, i) => { [s.lat, s.lng] = FIXED[l.id][i]; }));

// ---------- Parametros del servicio ----------
const NBUSES = 4;          // siempre 4 camiones por linea
const DWELL = 17;          // espera en cada base: de 15 a 20 min (se usa el promedio)
const STOP_WAIT = 1;       // min que "se encuentra en la estacion"
const ROAD_FACTOR = 1.04;  // si la linea es recta, se estima la distancia por calles
// Minutos reales desde la salida (por parada, en el orden de LINES). Medido con cronometro + Strava.
// L2: Llanitos 7:40 -> Tecnologico 8:12 = 32 min. Centenario es interpolado (no se midio). Morelos = zona de transferencia (7:57).
const REAL_T = { L2: [0, 4, 5, 10, 12, 15, 17, 19, 21, 23, 26, 28, 30, 31, 32] };
let SPEED = 300;           // m/min (se recalcula con la calibracion)

const STORE_KEY = 'mr_stops_v3', ROUTE_KEY = 'mr_route_v3_', FAV_KEY = 'mr_fav_v1', REP_KEY = 'mr_rep_v1';
// Ultimo reporte "ya llego" de cada linea: { li, i, d, left, ts(ms), uid }. Viene de este telefono o de otros usuarios.
// De el se calcula el ajuste de reloj de la linea (ver syncOf).
let reports = {};
let serviceReports = [];

// ---------- Configuracion de Firebase (la llave web no es secreta: la protegen las reglas de Firestore) ----------
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDY00NX6OrZuAPwcpkErvNKnYAUdlL55Xg',
  authDomain: 'red-metro-zona-media-3b465.firebaseapp.com',
  projectId: 'red-metro-zona-media-3b465',
  storageBucket: 'red-metro-zona-media-3b465.firebasestorage.app',
  messagingSenderId: '261718523009',
  appId: '1:261718523009:web:b581286040530afabc6180',
};
const FB_CDN = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-';
const STALE_MIN = 20;      // despues de estos minutos el reporte se muestra como "estimado"
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

// ---------- Geometria de la ruta ----------
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

// Recalcula velocidad, tiempos entre paradas y numero de camiones.
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
  } catch (e) { /* sin internet: queda la linea recta con el factor de calles */ }
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
// minutos recorridos desde el inicio -> posicion sobre la ruta
function positionAt(ln, minutes) {
  const m = Math.max(0, Math.min(minutes, ln.T));
  if (!ln.real) return pointAt(ln, m * SPEED / ln.k);
  let i = 0;
  while (i < ln.stops.length - 2 && m > ln.stops[i + 1].t) i++;
  const a = ln.stops[i], b = ln.stops[i + 1];
  const f = b.t > a.t ? (m - a.t) / (b.t - a.t) : 0;
  return pointAt(ln, (ln.stopD[i] + f * (ln.stopD[i + 1] - ln.stopD[i])));
}

// ---------- Simulacion (sustituir por datos reales) ----------
function fetchBuses() {
  const out = [];
  LINES.forEach(ln => {
    const now = Date.now() / 60000 + syncOf(ln);
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
// Llegadas de cada camion a una parada (ordenadas).
// here = el camion esta en la estacion. En las bases (Llanitos y Tecnologico) espera de 15 a 20 min antes de salir:
// ahi board = es la base donde sube el pasajero y dep = minutos que le faltan para salir.
function arrivals(ln, d, i, buses) {
  const t = ln.stops[i].t, T = ln.T, W = ln.dwell, c = ln.cycle, last = ln.stops.length - 1;
  const target = d === 0 ? t : T + W + (T - t);
  const boarding = (i === 0 && d === 0) || (i === last && d === 1);
  return buses.filter(b => b.line === ln.id).map(b => {
    const p = b.phase, el = (((p - target) % c) + c) % c;
    let w = (((target - p) % c) + c) % c;
    const inBase = b.waiting && ((i === last && b.dir === 0) || (i === 0 && b.dir === 1));
    if (boarding && !inBase && w < 0.2) w += c;   // un camion que acaba de salir de la base ya no cuenta como proximo
    const dep = inBase ? (b.dir === 1 ? c - p : T + W - p) : null;
    let text = 'va en sentido contrario';
    if (d === 0 && p >= 2 * T + W) text = 'en la base de ' + ln.stops[0].n;
    else if (d === 1 && p >= T && p < T + W) text = 'en la base de ' + ln.stops[last].n;
    else if (d === 0 && p < T && p <= target) {
      let j = 0; ln.stops.forEach((s, k) => { if (s.t <= p) j = k; });
      text = (i - j <= 1 ? 'es la pr\u00f3xima parada' : 'a ' + (i - j) + ' paradas') + ' (viene de ' + ln.stops[j].n + ')';
    } else if (d === 1 && p >= T + W && p <= target) {
      const m = T - (p - T - W); let j = 0; ln.stops.forEach((s, k) => { if (s.t <= m) j = k; });
      text = (j - i <= 0 ? 'es la pr\u00f3xima parada' : 'a ' + (j - i + 1) + ' paradas') + ' (viene de ' + ln.stops[Math.min(j + 1, last)].n + ')';
    }
    return { w, bus: b, here: inBase || (i !== 0 && i !== last && el < STOP_WAIT), inBase, board: inBase && boarding, dep, text };
  }).sort((x, y) => x.w - y.w);
}
// Minutos para los proximos camiones. En la base cuenta tambien el que esta esperando (w = minutos para que salga).
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
  const txt = w === undefined ? '\u2014' : (w <= 1 ? 'Llegando' : mins(w) + ' min');
  el.innerHTML = '<button class="favcard"><span>\u2b50 Mi parada</span><b>' + st.n + '</b><small>' + ln.short + ' \u2192 ' + dest + '</small><em>' + txt + '</em></button>';
  el.firstChild.onclick = () => { lineIdx = fav.l; dir = fav.d; selStop = fav.i; viewIdx = 0; clearBuses(); drawAll(); state.map.setView([st.lat, st.lng], 16); };
}

// ---------- UI ----------
const THEME_KEY='mr_theme_v1', FONT_KEY='mr_font_v1';
function applyPrefs(){document.body.classList.toggle('dark',localStorage.getItem(THEME_KEY)==='dark');document.body.classList.toggle('large-text',localStorage.getItem(FONT_KEY)==='large');}
function toggleTheme(){localStorage.setItem(THEME_KEY,localStorage.getItem(THEME_KEY)==='dark'?'light':'dark');applyPrefs();}
function toggleFont(){localStorage.setItem(FONT_KEY,localStorage.getItem(FONT_KEY)==='large'?'normal':'large');applyPrefs();}
function renderTabs() {
  const el = document.getElementById('lines');
  el.innerHTML = '';
  LINES.forEach((ln, i) => {
    const b = document.createElement('button');
    b.className = 'tab' + (i === lineIdx ? ' active' : '');
    b.innerHTML = '<span class="badge" style="background:' + ln.color + '">' + ln.short + '</span>' + ln.name;
    if (i === lineIdx) b.style.borderColor = ln.color;
    b.onclick = () => { lineIdx = i; selStop = null; schedStop = 0; trip = { a: 0, b: LINES[i].stops.length - 1, plan: { fromLine:i, fromStop:0, toLine:i, toStop:LINES[i].stops.length-1 } }; clearBuses(); drawAll(); fitLine(); };
    el.appendChild(b);
  });
  const vEl = document.getElementById('views');
  vEl.innerHTML = '';
  ['Paradas', 'Recorrido', 'Viaje', 'Horarios', 'Info', 'Reportes'].forEach((v, i) => {
    const b = document.createElement('button');
    b.className = 'vbtn' + (i === viewIdx ? ' active' : '');
    b.textContent = v;
    b.onclick = () => { viewIdx = i; renderTabs(); renderView(); };
    vEl.appendChild(b);
  });
}

function dirButtons() {
  const s = LINES[lineIdx].stops;
  return '<div class="dirs">' + [[0, s[0].n + ' \u2192 ' + s[s.length - 1].n], [1, s[s.length - 1].n + ' \u2192 ' + s[0].n]]
    .map(([d, label]) => '<button class="dir' + (d === dir ? ' active' : '') + '" data-d="' + d + '">' + label + '</button>').join('') + '</div>';
}
function bindDirs(el) {
  el.querySelectorAll('.dir').forEach(b => b.onclick = () => { dir = +b.dataset.d; refresh(); renderView(); });
}
function etaText(arr) {
  const h = arr.find(x => x.here), n = arr.find(x => !x.here);
  if (h && h.board) return '<div class="eta here"><b>En la estaci\u00f3n</b><small>Sale ~' + inMin(h.dep) + '</small></div>';
  if (h) return '<div class="eta here"><b>En la estaci\u00f3n</b><small>' + h.bus.id + (n ? ' \u00b7 sig. ' + inMin(n.w) : '') + '</small></div>';
  if (!n) return '<div class="eta late"><b>\u2014</b><small>sin datos</small></div>';
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
        '<span class="dot"></span><span class="name">' + st.n + (st.tr ? '<span class="tr">\u2194 Transferencia</span>' : '') +
        '<span class="sub">' + km(st.d) + ' km \u00b7 ' + subTxt(arr) + '</span></span>' + etaText(arr) +
        '<span class="star' + (isFav ? ' on' : '') + '" data-i="' + i + '">' + (isFav ? '\u2605' : '\u2606') + '</span></div>';
    }).join('') + '</div>';
    bindDirs(el);
    el.querySelectorAll('.stop').forEach(r => {
      r.onclick = () => { const i = +r.dataset.i; selStop = i; schedStop = i; state.map.setView([ln.stops[i].lat, ln.stops[i].lng], 16); drawStatic(); renderView(); };
    });
    el.querySelectorAll('.star').forEach(s => s.onclick = ev => { ev.stopPropagation(); toggleFav(lineIdx, +s.dataset.i, dir); });
  }

  else if (viewIdx === 1) {
    el.innerHTML = '<div class="stops">' + buses.filter(b => b.line === ln.id).map(b => busCard(ln, b)).join('') +
      '</div><p class="note">4 camiones por l\u00ednea. Dos camiones solo se cruzan cuando uno va y el otro viene.</p>';
  }

  else if (viewIdx === 2) {
    if (!trip.plan) trip.plan = { fromLine: lineIdx, fromStop: 0, toLine: lineIdx, toStop: LINES[lineIdx].stops.length - 1 };
    const pl = trip.plan;
    const lineOptions = LINES.map((x,k) => '<option value=\"'+k+'\">'+x.short+' · '+x.name+'</option>').join('');
    const stopOptions = (li, sel) => LINES[li].stops.map((x,k) => '<option value=\"'+k+'\"'+(k===sel?' selected':'')+'>'+x.n+'</option>').join('');
    el.innerHTML = '<div class=\"trip\"><label>Linea de salida<select id=\"planFL\">'+lineOptions+'</select></label><label>Parada de salida<select id=\"planFS\">'+stopOptions(pl.fromLine,pl.fromStop)+'</select></label></div>'+
      '<div class=\"trip\"><label>Linea de destino<select id=\"planTL\">'+lineOptions+'</select></label><label>Parada de destino<select id=\"planTS\">'+stopOptions(pl.toLine,pl.toStop)+'</select></label></div><div id=\"tripRes\"></div>';
    document.getElementById('planFL').value = pl.fromLine; document.getElementById('planTL').value = pl.toLine;
    const rebuild = (side) => { const li=side==='f'?pl.fromLine:pl.toLine, id=side==='f'?'planFS':'planTS'; document.getElementById(id).innerHTML=stopOptions(li,0); if(side==='f') pl.fromStop=0; else pl.toStop=0; updateTrip(); };
    document.getElementById('planFL').onchange=e=>{pl.fromLine=+e.target.value;rebuild('f');};
    document.getElementById('planTL').onchange=e=>{pl.toLine=+e.target.value;rebuild('t');};
    document.getElementById('planFS').onchange=e=>{pl.fromStop=+e.target.value;updateTrip();};
    document.getElementById('planTS').onchange=e=>{pl.toStop=+e.target.value;updateTrip();};
    updateTrip();
  }

  else if (viewIdx === 3) {
    const i = Math.min(schedStop, ln.stops.length - 1);
    const opts = ln.stops.map((s, k) => '<option value="' + k + '"' + (k === i ? ' selected' : '') + '>' + s.n + '</option>').join('');
    const w = waits(ln, dir, i, buses);
    // Proximos camiones: los de este ciclo y los del siguiente (cada 20 min)
    const list = [];
    for (let r = 0; r < 2; r++) w.forEach(x => list.push(x + r * ln.cycle));
    const next = list.sort((a, b) => a - b).slice(0, 6);
    el.innerHTML = dirButtons() + '<label class="lab">Parada<select id="selS">' + opts + '</select></label>' +
      '<div class="card"><b>Pr\u00f3ximos camiones en ' + ln.stops[i].n + '</b><ul class="times">' +
      next.map(x => '<li><span>' + inMin(x) + '</span><small>en ' + mins(x) + ' min</small></li>').join('') + '</ul>' +
      '<p class="note">Estimaci\u00f3n: pasa un cami\u00f3n cada ' + mins(ln.headway) + ' min aproximadamente.</p></div>';
    bindDirs(el);
    document.getElementById('selS').onchange = e => { schedStop = +e.target.value; selStop = schedStop; renderView(); drawStatic(); };
  }

  else if (viewIdx === 5) {
    const stopOpts=ln.stops.map((s,i)=>'<option value=\"'+i+'\">'+s.n+'</option>').join('');
    el.innerHTML='<div class=\"card report-card\"><h3>Reportar servicio</h3><p class=\"note\">Reportes comunitarios; no son datos oficiales ni verifican GPS.</p><label>Parada<select id=\"repStop\">'+stopOpts+'</select></label><label>Sentido<select id=\"repDir\"><option value=\"0\">Ida</option><option value=\"1\">Vuelta</option></select></label><div class=\"report-buttons\"><button data-type=\"full\">Camión lleno</button><button data-type=\"delay\">Retraso</button><button data-type=\"noshow\">No pasó</button></div><p id=\"repMsg\" class=\"note\"></p><h4>Reportes recientes en este teléfono</h4><div id=\"repHistory\"></div><h4>Reportes de la comunidad</h4><div id=\"communityReportList\"></div></div>';
    let history=[];try{history=JSON.parse(localStorage.getItem('mr_service_reports_v1')||'[]').slice(-5).reverse();}catch(e){}
    const rLabels={full:'Camión lleno',delay:'Retraso',noshow:'No pasó'};const rh=document.getElementById('repHistory');if(rh)rh.innerHTML=history.map(r=>'<div class=\"history-row\"><b>'+rLabels[r.type]+'</b><small>'+LINES[r.li].short+' · '+LINES[r.li].stops[r.i].n+' · '+new Date(r.ts).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})+'</small></div>').join('')||'<p class=\"note\">Aún no hay reportes.</p>';
    const cr=document.getElementById('communityReportList');if(cr)cr.innerHTML=serviceReports.slice(0,10).map(r=>'<div class=\"history-row\"><b>'+rLabels[r.type]+'</b><small>'+r.line+' · '+LINES[r.li].stops[r.i].n+' · hace '+Math.max(0,mins((Date.now()-r.ts)/60000))+' min</small></div>').join('')||'<p class=\"note\">No hay reportes comunitarios recientes.</p>';
    el.querySelectorAll('[data-type]').forEach(b=>b.onclick=async()=>{const type=b.dataset.type,i=+document.getElementById('repStop').value,d=+document.getElementById('repDir').value;const labels={full:'camión lleno',delay:'retraso',noshow:'no pasó'};if(!confirm('¿Enviar reporte de '+labels[type]+' en '+ln.stops[i].n+'?'))return;const msg=document.getElementById('repMsg');msg.textContent='Guardado en este teléfono…';const shared=await submitServiceReport({type,li:lineIdx,i,d,ts:Date.now()});msg.textContent=shared?'Reporte compartido con otros usuarios.':'Reporte guardado solo en este teléfono; no se compartió.';renderView();});
  }

  else {
    const other = LINES[1 - lineIdx];
    const rows = ln.stops.map((s, i) => '<tr><td>' + s.n + '</td><td>' + km(s.d) + '</td><td>' + mins(s.t) + '</td></tr>').join('');
    el.innerHTML = '<div class="settings"><button id="themeToggle">Cambiar tema</button><button id="fontToggle">Texto grande</button></div><div class="stats">' +
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
      ' L\u00ednea ' + other.short + ': ' + other.km.toFixed(1) + ' km, ' + mins(other.T) + ' min.</p>';
    const themeBtn=document.getElementById('themeToggle');if(themeBtn)themeBtn.onclick=toggleTheme;const fontBtn=document.getElementById('fontToggle');if(fontBtn)fontBtn.onclick=toggleFont;
  }
}

function updateTrip() {
  const el = document.getElementById('tripRes'); if (!el) return;
  const pl = trip.plan || { fromLine: lineIdx, fromStop: 0, toLine: lineIdx, toStop: LINES[lineIdx].stops.length - 1 };
  const LA = LINES[pl.fromLine], LB = LINES[pl.toLine], A = LA.stops[pl.fromStop], B = LB.stops[pl.toStop];
  if (!A || !B || (LA.id === LB.id && pl.fromStop === pl.toStop)) { el.innerHTML = '<p class="note">Selecciona dos paradas diferentes.</p>'; return; }
  const traffic = (() => { const h = new Date().getHours(); return h >= 13 && h < 16 ? 1.15 : 1; })();
  const leg = (ln, i, j) => Math.abs(ln.stops[j].t - ln.stops[i].t) * traffic;
  let best = null;
  if (LA.id === LB.id) best = { minutes: leg(LA, pl.fromStop, pl.toStop), distance: Math.abs(B.d - A.d), path: 'Viaje directo' };
  else {
    const shared = LA.stops.filter(x => x.tr && LB.stops.some(y => y.tr && y.n === x.n));
    shared.forEach(st => {
      const ai = LA.stops.findIndex(x => x.n === st.n), bi = LB.stops.findIndex(x => x.n === st.n);
      const candidate = { minutes: leg(LA, pl.fromStop, ai) + 9 + leg(LB, bi, pl.toStop), distance: Math.abs(st.d - A.d) + Math.abs(B.d - LB.stops[bi].d), path: 'Transbordo en ' + st.n + ' (5 min de espera + 4 min caminando)' };
      if (!best || candidate.minutes < best.minutes) best = candidate;
    });
  }
  if (!best) { el.innerHTML = '<p class="note">No se encontró transbordo entre estas líneas.</p>'; return; }
  const originDistance = loc.pos ? dist(loc.pos, [A.lat, A.lng]) : Infinity;
  const walk = originDistance < 400 ? Math.ceil(originDistance / 75) : 0;
  const firstWait = LA.id === LB.id ? Math.max(0, waits(LA, pl.toStop > pl.fromStop ? 0 : 1, pl.fromStop, state.buses)[0] || 0) : 5;
  const total = best.minutes + walk + firstWait;
  el.innerHTML = '<div class="card"><div class="stats"><div><b>' + km(best.distance) + ' km</b><small>distancia aprox.</small></div><div><b>' + mins(best.minutes) + ' min</b><small>en ruta</small></div><div><b>' + mins(total) + ' min</b><small>total estimado</small></div></div><p><b>' + A.n + '</b> → <b>' + B.n + '</b></p><p class="note">' + best.path + '. ' + (LA.id === LB.id ? 'Espera estimada al camión: ' + mins(firstWait) + ' min. ' : 'Primer camión: ' + mins(firstWait) + ' min estimados. ') + (traffic > 1 ? 'Se añade margen de tráfico de 13:00 a 16:00. ' : '') + (walk ? 'Incluye ' + walk + ' min a pie hasta la parada de salida. ' : '') + '</p><small class="note">No es un horario oficial ni seguimiento en vivo.</small></div>';
}

// Capa fija: linea y paradas
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
      const icon = L.divIcon({ className: '', html: '<div class="bus-icon" style="--c:' + ln.color + '">\ud83d\ude8c</div>', iconSize: [34, 34], iconAnchor: [17, 17] });
      state.markers[b.id] = L.marker([b.lat, b.lng], { icon, zIndexOffset: 1000 }).addTo(state.map).bindTooltip(b.id);
    }
  });
  Object.keys(state.markers).forEach(id => { if (!ids.has(id)) { state.map.removeLayer(state.markers[id]); delete state.markers[id]; } });
}

function refresh() {
  state.buses = fetchBuses();
  drawBuses(state.buses);
  renderFav(); renderNear(); renderNet();
  if (viewIdx === 2) updateTrip(); else renderView();
}
function drawAll() { renderTabs(); drawStatic(); state.buses = fetchBuses(); drawBuses(state.buses); renderFav(); renderView(); renderNet(); }
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
  if (!confirm('\u00bfBorrar posiciones editadas?')) return;
  try { localStorage.removeItem(STORE_KEY); LINES.forEach(l => localStorage.removeItem(ROUTE_KEY + l.id)); } catch (e) {}
  location.reload();
}

// ---------- Tarjeta de cada camion (recorrido) ----------
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
    body = '<p>Pas\u00f3 por <b>' + prev.n + '</b></p><p>Pr\u00f3xima: <b>' + next.n + '</b> \u00b7 llega a las <b>' + inMin(toNext) + '</b> (' + (toNext < 1 ? 'llegando' : mins(toNext) + ' min') + ')</p>' +
      '<p>Termina en ' + head + ' a las <b>' + inMin(toEnd) + '</b></p>';
  }
  const pct = Math.max(0, Math.min(100, m / T * 100));
  return '<div class="bcard" style="--c:' + ln.color + '"><div class="bh"><b>\ud83d\ude8c ' + b.id + '</b><span>' + (b.dir === 0 ? '\u2192 ' : '\u2190 ') + head + '</span></div>' +
    '<div class="bar"><i style="width:' + pct + '%"></i>' + S.map(s => '<u style="left:' + (s.t / T * 100) + '%"></u>').join('') +
    '<span class="bm" style="left:' + pct + '%">\ud83d\ude8c</span></div>' + body + '</div>';
}

// ---------- Ubicacion del usuario ----------
// El permiso se pregunta UNA sola vez (la primera vez que abres la app). Despues se activa solo.
const GEO_KEY = 'mr_geo_v1';   // sin valor = nunca preguntado - 'asked' = ya se pregunto - 'granted' = permitido - 'denied' = negado
const geoGet = () => { try { return localStorage.getItem(GEO_KEY); } catch (e) { return null; } };
const geoSet = v => { try { localStorage.setItem(GEO_KEY, v); } catch (e) {} };
const loc = { pos: null, acc: 0, marker: null, circle: null, trail: null, pts: [], watch: null, near: null, answer: null, err: null };
function loadReports() {
  try { reports = JSON.parse(localStorage.getItem(REP_KEY) || '{}') || {}; } catch (e) { reports = {}; }
  LINES.forEach((l, li) => {
    const r = reports[l.id];
    if (r && !(r.li === li && r.i >= 0 && r.i < l.stops.length && (r.d === 0 || r.d === 1) && r.ts > 0)) delete reports[l.id];
  });
}
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
    } else if (!loc.pos) loc.err = 'fail';       // sin senal por ahora: sigue intentando solo
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
    loc.marker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 2000 }).addTo(state.map).bindTooltip('T\u00fa est\u00e1s aqu\u00ed');
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
// ---------- Reportes "ya llego" (locales + en linea) ----------
// Un reporte dice: en el momento ts el camion estaba en la parada i, sentido d (en una base: le faltaban "left" min para salir).
// Con el se calcula cuanto hay que adelantar el reloj de la linea para que un camion simulado coincida con ese hecho.
// Se calcula sobre el reloj "crudo" (sin ajustes) y por eso todos los telefonos llegan al mismo resultado.
function offsetFromReport(ln, r) {
  const last = ln.stops.length - 1, c = ln.cycle, at = r.ts / 60000;
  const phases = [];
  for (let k = 0; k < ln.nBuses; k++) phases.push((((at - k * ln.headway) % c) + c) % c);
  const base = (r.i === 0 && r.d === 0) || (r.i === last && r.d === 1);
  if (base) {
    const target = r.d === 0 ? c - r.left : ln.T + ln.dwell - r.left;   // fase en que el camion espera en la base con "left" min por salir
    return phases.map(p => { let x = (target - p) % c; if (x > c / 2) x -= c; if (x < -c / 2) x += c; return x; })
      .reduce((m, x) => Math.abs(x) < Math.abs(m) ? x : m);
  }
  const buses = phases.map((p, k) => busFromPhase(ln, k, p));
  return arrivals(ln, r.d, r.i, buses).map(a => a.w > c / 2 ? a.w - c : a.w)
    .reduce((m, x) => Math.abs(x) < Math.abs(m) ? x : m);
}
// Ajuste de reloj de la linea (min). Se recalcula solo cuando cambia el reporte o los tiempos de la linea.
function syncOf(ln) {
  const r = reports[ln.id];
  if (!r || !ln.cycle) return 0;
  const key = [r.ts, r.i, r.d, r.left, ln.cycle, ln.T].join('|');
  if (ln._sk !== key) { ln._sk = key; ln._sv = offsetFromReport(ln, r); }
  return ln._sv;
}
function saveReports() { try { localStorage.setItem(REP_KEY, JSON.stringify(reports)); } catch (e) {} }
// Se queda con el reporte mas nuevo de cada linea.
function consider(r) {
  const ln = LINES[r.li];
  if (!ln || !(r.i >= 0 && r.i < ln.stops.length) || (r.d !== 0 && r.d !== 1) || !(r.left >= 0 && r.left <= 30)) return false;
  const cur = reports[ln.id];
  if (cur && r.ts <= cur.ts) return false;
  reports[ln.id] = r; saveReports();
  return true;
}
// El usuario confirma que el camion ya esta (o que ya salio de la base): se ajusta el reloj y se avisa a los demas.
// - En una parada normal: el camion llega ahora.
// - En una base (Llanitos / Tecnologico): el camion esta DETENIDO esperando y le faltan "left" min para salir (no sale de inmediato).
function syncTo(li, i, d, left) {
  const r = { li, i, d, left: Math.round(left), ts: Date.now(), uid: online.uid || 'local' };
  consider(r);
  publishReport(r);
  loc.answer = { yes: d };
  refresh();
}

// ---------- En linea (Firebase) ----------
const online = { state: 'connecting', err: null, busy: false, db: null, uid: null, unsub: null, rt: null, last: {} };
function loadScript(src) {
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => no({ code: 'sin-red' });
    document.head.appendChild(s);
  });
}
async function initOnline() {
  if (online.busy || online.state === 'ok') return;
  online.busy = true; online.state = 'connecting'; online.err = null; renderNet();
  try {
    if (typeof firebase === 'undefined') await loadScript(FB_CDN + 'app-compat.js');
    if (!firebase.auth) await loadScript(FB_CDN + 'auth-compat.js');
    if (!firebase.firestore) await loadScript(FB_CDN + 'firestore-compat.js');
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    if (!online.db) {
      online.db = firebase.firestore();
      try { online.db.settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch (e) {}
    }
    const cred = await firebase.auth().signInAnonymously();
    online.uid = cred.user.uid;
    listenReports();
  } catch (e) {
    online.state = 'error'; online.err = (e && e.code) || 'error';
  }
  online.busy = false;
  renderNet();
  if (online.state === 'error') retryOnline();
}
function retryOnline() { clearTimeout(online.rt); online.rt = setTimeout(() => { if (online.state === 'error') initOnline(); }, 30000); }
function listenReports() {
  if (online.unsub) { online.unsub(); online.unsub = null; }
  const cutoff = firebase.firestore.Timestamp.fromMillis(Date.now() - 3 * 3600000);
  online.unsub = online.db.collection('reportes').where('ts', '>', cutoff).orderBy('ts', 'desc').limit(40).onSnapshot(snap => {
    if (!snap.metadata.fromCache) { online.state = 'ok'; online.err = null; }
    let changed = false;
    serviceReports = [];
    snap.forEach(doc => {
      const x = doc.data({ serverTimestamps: 'estimate' });
      if (!x || (x.tipo && !['arrival','full','delay','noshow'].includes(x.tipo)) || !x.ts || !x.ts.toMillis) return;
      const li = LINES.findIndex(l => l.id === x.linea), ts = x.ts.toMillis();
      if (li < 0 || ts > Date.now() + 300000) return;
      if (x.tipo && ['full','delay','noshow'].includes(x.tipo)) { if (x.parada >= 0 && x.parada < LINES[li].stops.length) serviceReports.push({type:x.tipo,li,line:LINES[li].short,i:x.parada,d:x.sentido,ts,uid:x.uid||'?'}); return; }
      if (consider({ li, i: x.parada, d: x.sentido, left: x.left || 0, ts, uid: x.uid || '?' })) changed = true;
    });
    if (changed) refresh(); else { renderNet(); if (viewIdx === 5) renderView(); }
  }, err => {
    online.state = 'error'; online.err = err.code || 'error';
    if (online.unsub) { online.unsub(); online.unsub = null; }
    renderNet(); retryOnline();
  });
}
function publishReport(r) {
  if (!online.db || !online.uid || !window.firebase) return;
  const key = r.li + '|' + r.i + '|' + r.d;
  if (online.last[key] && r.ts - online.last[key] < 20000) return;   // evita doble toque
  online.last[key] = r.ts;
  online.db.collection('reportes').add({
    tipo: 'arrival', linea: LINES[r.li].id, sentido: r.d, parada: r.i, left: r.left,
    ts: firebase.firestore.FieldValue.serverTimestamp(), expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + 3 * 3600000), uid: online.uid,
  }).catch(e => { online.state = 'error'; online.err = (e && e.code) || 'error'; renderNet(); retryOnline(); });
}
// Linea de estado bajo el mapa: dice si hay conexion y que tan reciente es el ultimo reporte de la linea que se ve.
function submitServiceReport(r) {
  try { const arr=JSON.parse(localStorage.getItem('mr_service_reports_v1')||'[]');arr.push({...r});localStorage.setItem('mr_service_reports_v1',JSON.stringify(arr.slice(-50))); } catch(e) {}
  if(!online.db||!online.uid)return Promise.resolve(false);
  return online.db.collection('reportes').add({tipo:r.type,linea:LINES[r.li].id,sentido:r.d,parada:r.i,left:0,ts:firebase.firestore.FieldValue.serverTimestamp(),expiresAt:firebase.firestore.Timestamp.fromMillis(Date.now()+3*3600000),uid:online.uid}).then(()=>true).catch(e=>{online.err=e.code||'error';renderNet();retryOnline();return false;});
}
function renderNet() {
  const el = document.getElementById('net');
  if (!el) return;
  const ln = LINES[lineIdx], r = reports[ln.id];
  let html;
  if (r) {
    const age = Math.max(0, (Date.now() - r.ts) / 60000), s = ln.stops[r.i];
    const who = r.uid === online.uid ? 'por ti' : (r.uid === 'local' ? 'en este tel\u00e9fono' : 'por otro usuario');
    const when = age < 1 ? 'hace un momento' : 'hace ' + mins(age) + ' min';
    html = (age <= STALE_MIN ? '<b>Confirmado ' + when + '</b>' : '<b>Estimado</b> \u00b7 \u00faltimo reporte ' + when) +
      ' \u00b7 ' + ln.short + ' en ' + s.n + ' (' + who + ')';
  } else html = 'Sin reportes recientes en ' + ln.short + '. Mostrando estimaci\u00f3n.';
  const dot = online.state === 'ok' ? '\ud83d\udfe2' : online.state === 'connecting' ? '\ud83d\udfe1' : '\u26aa';
  const st = online.state === 'ok' ? 'En l\u00ednea' : online.state === 'connecting' ? 'Conectando\u2026' : 'Sin conexi\u00f3n con otros usuarios' + (online.err ? ' (' + online.err + ')' : '');
  el.innerHTML = '<div class="netbar ' + online.state + '"><span>' + dot + ' ' + st + '</span><small>' + html + '</small></div>';
}
function renderNear() {
  const el = document.getElementById('near');
  if (!el) return;
  const bind = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = fn; };
  if (!loc.pos) {
    el.innerHTML = loc.err === 'denied' ? '<div class="near warn">\ud83d\udccd Sin permiso de ubicaci\u00f3n. Act\u00edvalo en los ajustes del tel\u00e9fono. <button class="nbtn" id="nAsk">Reintentar</button></div>'
      : loc.err === 'fail' ? '<div class="near warn">\ud83d\udccd No se pudo obtener tu ubicaci\u00f3n. <button class="nbtn" id="nAsk">Reintentar</button></div>'
      : loc.watch !== null ? '<div class="near">\ud83d\udccd Buscando tu ubicaci\u00f3n\u2026</div>'
      : '<button class="near ask" id="nAsk">\ud83d\udccd Activar mi ubicaci\u00f3n para saber tu parada</button>';
    bind('#nAsk', () => { loc.err = null; if (geoGet() === null) askPerm(); else startGeo(); });
    return;
  }
  const n = loc.near, ln = LINES[n.li], S = ln.stops, st = S[n.i], last = S.length - 1;
  const base = n.i === 0 || n.i === last;
  const dirs = n.i === 0 ? [0] : n.i === last ? [1] : [0, 1];
  const lab = d => 'hacia ' + (d === 0 ? S[last].n : S[0].n);
  const head = '<div class="nh"><b>\ud83d\udccd ' + st.n + '</b><small>' + ln.short + ' \u00b7 a ' + Math.round(n.d) + ' m de ti</small></div>';
  const rows = () => dirs.map(d => {
    const a = arrivals(ln, d, n.i, state.buses).find(x => !x.here);
    return a ? '<div class="nrow"><span>' + lab(d) + '<small>' + a.bus.id + ' \u00b7 ' + (base ? 'sale' : 'llega') + ' a las ' + inMin(a.w) + '</small></span><b class="cd" data-ts="' + (Date.now() + a.w * 60000) + '"></b></div>' : '';
  }).join('');
  let html;
  if (n.d > 250) html = head + '<p class="nq">A\u00fan no est\u00e1s en la parada. Si sales ahora, el siguiente MetroRed pasa en:</p>' + rows();
  else if (loc.answer && loc.answer.ask !== undefined) {
    // Ya esta en la base: se pregunta hace cuanto llego para no hacerlo salir de inmediato.
    const W = Math.round(ln.dwell);
    const chips = [['Reci\u00e9n lleg\u00f3', W], ['Hace ~5 min', W - 5], ['Hace ~10 min', W - 10], ['Ya va a salir', 2]];
    html = head + '<p class="nq">\u00bfHace cu\u00e1nto lleg\u00f3 a la base? Aqu\u00ed espera de 15 a 20 min antes de salir.</p><div class="nb">' +
      chips.map(c => '<button class="nbtn y" data-left="' + c[1] + '">' + c[0] + '</button>').join('') + '<button class="nbtn" id="nCancel">Cancelar</button></div>';
  }
  else if (loc.answer && loc.answer.yes !== undefined) {
    const d = loc.answer.yes, h = arrivals(ln, d, n.i, state.buses).find(x => x.here);
    if (h && h.board) html = head + '<div class="nhere">\ud83d\ude8c Se encuentra en la base</div><p class="nq">' + h.bus.id + ' ' + lab(d) + '. Sale hacia las <b>' + inMin(h.dep) + '</b> (en ' + mins(h.dep) + ' min). En la base espera de 15 a 20 min.</p><button class="nbtn" id="nLeft">Ya sali\u00f3</button>';
    else if (h) html = head + '<div class="nhere">\ud83d\ude8c Se encuentra en la estaci\u00f3n</div><p class="nq">' + h.bus.id + ' ' + lab(d) + '. Sale en un momento.</p>';
    else { loc.answer = 'no'; html = head + '<p class="nq">El MetroRed ya sali\u00f3. El siguiente ' + (base ? 'sale' : 'llega') + ' en:</p>' + rows() + '<button class="nbtn" id="nYes">Ya lleg\u00f3 otro</button>'; }
  } else if (loc.answer === 'no') html = head + '<p class="nq">El MetroRed ' + (base ? 'saldr\u00e1' : 'llegar\u00e1') + ' en:</p>' + rows() + '<button class="nbtn" id="nYes">Ya lleg\u00f3</button>';
  else html = head + '<p class="nq">' + (base ? '\u00bfYa est\u00e1 el MetroRed en la base?' : '\u00bfYa est\u00e1 el MetroRed en esta parada?') + '</p><div class="nb">' +
    dirs.map(d => '<button class="nbtn y" data-y="' + d + '">' + (base ? 'S\u00ed, ya est\u00e1 aqu\u00ed' : 'S\u00ed, va ' + lab(d)) + '</button>').join('') + '<button class="nbtn" id="nNo">Todav\u00eda no</button></div>';
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
  applyPrefs();
  loadFav(); loadReports();
  LINES.forEach(l => setGeom(l, straightGeom(l), false));
  trip = { a: 0, b: LINES[0].stops.length - 1 };
  state.map = L.map('map', { zoomControl: false }).setView([21.93, -99.99], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '\u00a9 OpenStreetMap' }).addTo(state.map);
  drawAll();
  fitLine();
  LINES.forEach(loadRoute);
  const sheet = document.getElementById('sheet'), grab = document.getElementById('grab');
  let sheetStart = null, dragged = false;
  const sheetState = mode => { sheet.classList.toggle('collapsed', mode === 'small'); sheet.classList.toggle('expanded', mode === 'large'); };
  grab.onclick = () => { if (dragged) { dragged = false; return; } const mode = sheet.classList.contains('collapsed') ? 'normal' : sheet.classList.contains('expanded') ? 'small' : 'large'; sheetState(mode); };
  grab.addEventListener('pointerdown', e => { sheetStart = e.clientY; dragged = false; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener('pointerup', e => { if (sheetStart === null) return; const delta = e.clientY - sheetStart; if (Math.abs(delta) > 35) { dragged = true; sheetState(delta < 0 ? 'large' : 'small'); } sheetStart = null; });
  grab.addEventListener('pointercancel', () => { sheetStart = null; });
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
  // El permiso se pregunta solo la primera vez. Si ya lo diste, se activa solo; si dijiste "Ahora no", solo con el boton .
  const g = geoGet();
  if (g === 'granted') startGeo(); else if (g === null) askPerm();
  setInterval(tickCd, 1000);
  setInterval(refresh, 5000);
  initOnline();
  window.addEventListener('online', () => { if (online.state !== 'ok') initOnline(); });
}

init();
