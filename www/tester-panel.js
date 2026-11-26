
(() => {
  let watchId = null;
  let sessionId = null;
  let active = false;
  let finishing = false;
  let currentRoute = [];
  let nextStation = 0;
  let insideCount = 0;
  let lastInsideTime = 0;
  let lastSavedStation = null;

  const LINES = {
    L1: [
      ['Abasolo', 21.945963, -100.052648],
      ['El Refugio', 21.940996, -100.041009],
      ['Media Luna', 21.936570, -100.029058],
      ['Cobach 05', 21.933656, -100.021822],
      ['Walmart', 21.927224, -100.006227],
      ['Blvd. Ferrocarrilero', 21.925299, -100.002042],
      ['Morelos', 21.923058, -99.994077],
      ['Insurgentes', 21.922128, -99.979951],
      ['Fiscalía', 21.919731, -99.956552]
    ],
    L2: [
      ['Llanitos', 21.949435, -100.005340],
      ['Centenario', 21.940203, -100.003805],
      ['Mariano Matamoros', 21.936069, -100.003217],
      ['Soriana', 21.930784, -100.002457],
      ['Blvd. Ferrocarrilero', 21.925393, -100.002022],
      ['Jacarandas', 21.923486, -99.998776],
      ['Morelos', 21.923080, -99.994591],
      ['Hospital Regional', 21.919392, -99.992395],
      ['Justo Sierra', 21.916763, -99.989755],
      ['Puente Corona', 21.914682, -99.987805],
      ['Secundaria Técnica 74', 21.907070, -99.984188],
      ['Universidad Autónoma Zona Media', 21.899703, -99.982242],
      ['CECADEE Sur-Norte', 21.896840, -99.980850],
      ['Servicios Municipales', 21.894028, -99.980102],
      ['Instituto Tecnológico Superior', 21.887858, -99.978007]
    ]
  };

  const style = document.createElement('style');
  style.textContent = `
    #testerPanel {
      position: fixed;
      inset: 0;
      z-index: 1100;
      background: #f4f6f8;
      color: #17212b;
      overflow-y: auto;
      padding: 16px;
    }
    #testerPanel[hidden] { display: none; }
    .tp-card {
      max-width: 520px;
      margin: 15px auto;
      padding: 20px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 3px 15px #0001;
    }
    .tp-card button, .tp-card select {
      box-sizing: border-box;
      width: 100%;
      padding: 13px;
      margin-top: 9px;
      border: 0;
      border-radius: 10px;
      font-size: 15px;
    }
    .tp-card button {
      background: #075b39;
      color: white;
      font-weight: 700;
    }
    .tp-card button:disabled { opacity: .5; }
    .tp-card .tp-stop { background: #a32929; }
    .tp-card .tp-secondary { background: #68737d; }
    .tp-status {
      padding: 12px;
      background: #edf4ef;
      border-radius: 9px;
      margin: 14px 0;
      line-height: 1.5;
    }
    .tp-question {
      padding: 12px 0;
      border-bottom: 1px solid #eee;
    }
    .tp-question p { margin: 4px 0; }
    .tp-answers {
      display: flex;
      gap: 8px;
    }
    .tp-answers button { width: 50%; }
    .tp-answers .tp-no { background: #68737d; }
    .tp-small {
      font-size: 12px;
      color: #58636d;
      line-height: 1.5;
    }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.id = 'testerPanel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="tp-card">
      <h2>Panel de pruebas MetroRed</h2>
      <p>El seguimiento es voluntario. Puedes detenerlo cuando quieras.</p>

      <label for="tpLine"><b>Línea</b></label>
      <select id="tpLine">
        <option value="L1">L1 · Rioverde – Ciudad Fernández</option>
        <option value="L2">L2 · Eje Norte – Sur</option>
      </select>

      <label for="tpDirection"><b>Sentido</b></label>
      <select id="tpDirection">
        <option value="0">Ida · primera a última estación</option>
        <option value="1">Regreso · última a primera estación</option>
      </select>

      <div class="tp-status" id="tpStatus">
        Seguimiento detenido.
      </div>

      <button id="tpStart" type="button">Iniciar seguimiento GPS</button>
      <button id="tpStop" class="tp-stop" type="button" disabled>
        Detener seguimiento
      </button>

      <p class="tp-small">
        Solo se guardarán los registros necesarios para confirmar el paso por estaciones.
        No se guardará un historial continuo de tu recorrido.
      </p>

      <div id="tpQuestions" hidden>
        <h3>Registro manual</h3>

        <div class="tp-question">
          <p>¿Ya llegaste a la estación?</p>
          <div class="tp-answers">
            <button type="button" data-event="arrived_station" data-answer="yes">Sí</button>
            <button type="button" class="tp-no" data-event="arrived_station" data-answer="no">No</button>
          </div>
        </div>

        <div class="tp-question">
          <p>¿Ya estás arriba de la unidad?</p>
          <div class="tp-answers">
            <button type="button" data-event="boarded_unit" data-answer="yes">Sí</button>
            <button type="button" class="tp-no" data-event="boarded_unit" data-answer="no">No</button>
          </div>
        </div>

        <div class="tp-question">
          <p>¿La unidad ya salió de la estación?</p>
          <div class="tp-answers">
            <button type="button" data-event="left_station" data-answer="yes">Sí</button>
            <button type="button" class="tp-no" data-event="left_station" data-answer="no">No</button>
          </div>
        </div>
      </div>

      <button id="tpClose" class="tp-secondary" type="button">Cerrar panel</button>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = id => document.getElementById(id);
  const status = $('tpStatus');
  const startButton = $('tpStart');
  const stopButton = $('tpStop');
  const questions = $('tpQuestions');

  function setStatus(message) {
    status.textContent = message;
  }

  function getTester() {
    const tester = window.metroredTester;
    if (!tester || !tester.uid || !tester.db) {
      throw new Error('Inicia sesión como tester o administrador.');
    }
    return tester;
  }

  function distanceMeters(lat1, lon1, lat2, lon2) {
    const rad = value => value * Math.PI / 180;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function saveEvent(type, extra = {}) {
    const tester = getTester();
    if (!active || !sessionId) {
      throw new Error('No hay una sesión activa.');
    }

    await tester.db.collection('tester_events').add({
      uid: tester.uid,
      sessionId,
      type,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      ...extra
    });
  }

  function buildRoute(line, direction) {
    const stops = LINES[line].map((stop, index) => ({
      index,
      name: stop[0],
      lat: stop[1],
      lng: stop[2]
    }));

    return direction === 1 ? stops.reverse() : stops;
  }

  async function startTracking() {
    if (active || finishing) return;

    if (!navigator.geolocation) {
      setStatus('Este dispositivo no permite obtener ubicación.');
      return;
    }

    let tester;
    try {
      tester = getTester();
    } catch (error) {
      setStatus(error.message);
      return;
    }

    const line = $('tpLine').value;
    const direction = Number($('tpDirection').value);

    currentRoute = buildRoute(line, direction);
    nextStation = 0;
    insideCount = 0;
    lastInsideTime = 0;
    lastSavedStation = null;

    startButton.disabled = true;
    $('tpLine').disabled = true;
    $('tpDirection').disabled = true;
    setStatus('Solicitando permiso de ubicación...');

    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const coords = position.coords;
        if (coords.accuracy > 100) {
          throw new Error('La precisión GPS es insuficiente. Intenta nuevamente en un lugar despejado.');
        }

        sessionId = 'session_' + Date.now() + '_' +
          Math.random().toString(36).slice(2, 8);

        await tester.db.collection('tester_sessions').doc(sessionId).set({
          uid: tester.uid,
          role: tester.role,
          status: 'active',
          line,
          direction,
          stationCount: currentRoute.length,
          startedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        active = true;

        await saveEvent('tracking_started', {
          line,
          direction,
          accuracy: coords.accuracy
        });

        watchId = navigator.geolocation.watchPosition(
          handlePosition,
          handlePositionError,
          {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 20000
          }
        );

        stopButton.disabled = false;
        questions.hidden = false;
        setStatus('Seguimiento activo. Próxima estación: ' + currentRoute[0].name);

      } catch (error) {
        active = false;
        sessionId = null;
        startButton.disabled = false;
        $('tpLine').disabled = false;
        $('tpDirection').disabled = false;
        setStatus('No se pudo iniciar: ' + error.message);
      }
    }, error => {
      startButton.disabled = false;
      $('tpLine').disabled = false;
      $('tpDirection').disabled = false;
      setStatus('No se obtuvo ubicación: ' + error.message);
    }, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    });
  }

  async function handlePosition(position) {
    if (!active || finishing || nextStation >= currentRoute.length) return;

    const coords = position.coords;

    // Se descartan lecturas demasiado imprecisas.
    if (!Number.isFinite(coords.accuracy) || coords.accuracy > 50) {
      insideCount = 0;
      return;
    }

    const station = currentRoute[nextStation];
    const distance = distanceMeters(
      coords.latitude,
      coords.longitude,
      station.lat,
      station.lng
    );

    // Radio de confirmación: 75 metros.
    if (distance > 75) {
      insideCount = 0;
      lastInsideTime = 0;
      return;
    }

    const now = Date.now();

    // Se requieren dos lecturas dentro del radio, separadas por al menos 2.5 segundos.
    if (!lastInsideTime || now - lastInsideTime >= 2500) {
      insideCount++;
      lastInsideTime = now;
    }

    if (insideCount < 2) {
      setStatus('Detectando estación: ' + station.name + '...');
      return;
    }

    // Bloquea registros duplicados de la misma estación.
    if (lastSavedStation === station.index) return;

    insideCount = 0;
    lastInsideTime = 0;
    lastSavedStation = station.index;

    try {
      const tester = getTester();
      const detectedAt = position.timestamp || now;

      await tester.db.collection('tester_events').add({
        uid: tester.uid,
        sessionId,
        type: 'station_detected',
        line: $('tpLine').value,
        direction: Number($('tpDirection').value),
        stationIndex: station.index,
        station: station.name,
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        detectedAt: firebase.firestore.Timestamp.fromMillis(detectedAt),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      nextStation++;

      await tester.db.collection('tester_sessions').doc(sessionId).update({
        lastStation: station.name,
        stationsRecorded: nextStation,
        lastStationAt: firebase.firestore.Timestamp.fromMillis(detectedAt)
      });

      if (nextStation >= currentRoute.length) {
        setStatus('Recorrido completado. Seguimiento detenido.');
        await stopTracking('completed');
        return;
      }

      setStatus(
        'Estación registrada: ' + station.name +
        '. Próxima: ' + currentRoute[nextStation].name
      );

    } catch (error) {
      lastSavedStation = null;
      setStatus('Error guardando estación: ' + error.message);
    }
  }

  function handlePositionError(error) {
    if (!active) return;
    setStatus('Problema con el GPS: ' + error.message);
  }

  async function stopTracking(reason = 'manual', testerOverride = null) {
    if (!active || finishing) return;

    finishing = true;
    active = false;

    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    const oldSessionId = sessionId;
    const tester = testerOverride || window.metroredTester;

    // Se limpia el estado local aunque falle la conexión.
    sessionId = null;
    lastSavedStation = null;
    insideCount = 0;
    lastInsideTime = 0;

    try {
      if (!tester || !tester.db || !oldSessionId) {
        throw new Error('No se pudo validar la sesión para guardar el cierre.');
      }

      await tester.db.collection('tester_sessions').doc(oldSessionId).update({
        status: 'finished',
        finishReason: reason,
        finishedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      await tester.db.collection('tester_events').add({
        uid: tester.uid,
        sessionId: oldSessionId,
        type: 'tracking_stopped',
        reason,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      setStatus(
        reason === 'completed'
          ? 'Recorrido completado. GPS desactivado.'
          : 'Seguimiento detenido. GPS desactivado.'
      );

    } catch (error) {
      setStatus('GPS detenido. No se pudo guardar el cierre: ' + error.message);
    }

    startButton.disabled = false;
    stopButton.disabled = true;
    $('tpLine').disabled = false;
    $('tpDirection').disabled = false;
    questions.hidden = true;
    currentRoute = [];
    finishing = false;
  }

  // Las preguntas se manejan mediante delegación de eventos.
  // Cada botón tiene type="button" para evitar comportamientos inesperados.
  panel.addEventListener('click', async event => {
    const button = event.target.closest('button[data-event]');
    if (!button) return;

    if (!active) {
      setStatus('Primero inicia el seguimiento.');
      return;
    }

    button.disabled = true;

    try {
      await saveEvent(button.dataset.event, {
        answer: button.dataset.answer,
        line: $('tpLine').value,
        direction: Number($('tpDirection').value)
      });

      setStatus(
        button.dataset.answer === 'yes'
          ? 'Respuesta Sí registrada correctamente.'
          : 'Respuesta No registrada correctamente.'
      );
    } catch (error) {
      setStatus('No se pudo guardar la respuesta: ' + error.message);
    } finally {
      button.disabled = false;
    }
  });

  startButton.onclick = startTracking;
  stopButton.onclick = () => stopTracking('manual');

  $('tpClose').onclick = () => {
    if (active) {
      setStatus('Detén el seguimiento antes de cerrar el panel.');
      return;
    }
    panel.hidden = true;
  };

  document.addEventListener('metrored:tester-login', () => {
    panel.hidden = false;
  });

  document.addEventListener('metrored:tester-logout', () => {
    if (active) stopTracking('logout');
    panel.hidden = true;
  });

  // Permite que tester-access.js espere a que el GPS se detenga antes de cerrar sesión.
  window.metroredStopTesterTracking = async () => {
    if (active) await stopTracking('logout');
  };

  window.addEventListener('beforeunload', () => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  });
})();
