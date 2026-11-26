
(() => {
  let watchId = null;
  let sessionId = null;
  let lastPosition = null;
  let active = false;

  const style = document.createElement('style');
  style.textContent = `
    #testerPanel {
      position: fixed;
      inset: 0;
      z-index: 1100;
      background: #f4f6f8;
      color: #17212b;
      overflow-y: auto;
      padding: 20px;
    }
    #testerPanel[hidden] { display: none; }
    .tp-card {
      max-width: 520px;
      margin: 30px auto;
      padding: 22px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 3px 15px #0001;
    }
    .tp-card button {
      width: 100%;
      padding: 13px;
      margin-top: 10px;
      border: 0;
      border-radius: 10px;
      background: #075b39;
      color: white;
      font-weight: 700;
      font-size: 15px;
    }
    .tp-card button:disabled {
      opacity: .5;
    }
    .tp-card .tp-stop {
      background: #a32929;
    }
    .tp-status {
      padding: 12px;
      background: #edf4ef;
      border-radius: 9px;
      margin: 14px 0;
    }
    .tp-question {
      padding: 12px 0;
      border-bottom: 1px solid #eee;
    }
    .tp-question button {
      width: 48%;
      display: inline-block;
    }
    .tp-question .tp-no {
      background: #68737d;
    }
  `;

  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.id = 'testerPanel';
  panel.hidden = true;

  panel.innerHTML = `
    <div class="tp-card">
      <h2>Panel de pruebas MetroRed</h2>
      <p>El seguimiento es voluntario y puedes detenerlo cuando quieras.</p>

      <div class="tp-status" id="tpStatus">
        Seguimiento detenido.
      </div>

      <button id="tpStart">Iniciar seguimiento GPS</button>
      <button id="tpStop" class="tp-stop" disabled>
        Detener seguimiento
      </button>

      <div id="tpQuestions" hidden>
        <h3>Registro de prueba</h3>

        <div class="tp-question">
          ¿Ya llegaste a la estación?
          <button data-event="arrived_station" data-answer="yes">Sí</button>
          <button class="tp-no" data-event="arrived_station" data-answer="no">No</button>
        </div>

        <div class="tp-question">
          ¿Ya estás arriba de la unidad?
          <button data-event="boarded_unit" data-answer="yes">Sí</button>
          <button class="tp-no" data-event="boarded_unit" data-answer="no">No</button>
        </div>

        <div class="tp-question">
          ¿Ya salió de la estación?
          <button data-event="left_station" data-answer="yes">Sí</button>
          <button class="tp-no" data-event="left_station" data-answer="no">No</button>
        </div>
      </div>

      <button id="tpClose">Cerrar panel</button>
    </div>
  `;

  document.body.appendChild(panel);

  const status = document.getElementById('tpStatus');
  const startButton = document.getElementById('tpStart');
  const stopButton = document.getElementById('tpStop');
  const questions = document.getElementById('tpQuestions');

  function setStatus(text) {
    status.textContent = text;
  }

  function getTester() {
    const tester = window.metroredTester;

    if (!tester || !tester.uid || !tester.db) {
      throw new Error('Inicia sesión como tester o administrador.');
    }

    return tester;
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

  async function startTracking() {
    if (active) return;

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

    startButton.disabled = true;
    setStatus('Solicitando permiso de ubicación...');

    navigator.geolocation.getCurrentPosition(async position => {
      try {
        sessionId = 'session_' + Date.now() + '_' +
          Math.random().toString(36).slice(2, 8);

        const initial = {
          uid: tester.uid,
          role: tester.role,
          status: 'active',
          startedAt: firebase.firestore.FieldValue.serverTimestamp(),
          startLocation: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          }
        };

        await tester.db.collection('tester_sessions')
          .doc(sessionId).set(initial);

        active = true;
        lastPosition = position;

        watchId = navigator.geolocation.watchPosition(
          handlePosition,
          handlePositionError,
          {
            enableHighAccuracy: true,
            maximumAge: 5000,
            timeout: 20000
          }
        );

        startButton.disabled = true;
        stopButton.disabled = false;
        questions.hidden = false;

        setStatus('Seguimiento activo. Ubicación compartida con el sistema privado de pruebas.');

        await saveEvent('tracking_started', {
          accuracy: position.coords.accuracy
        });

      } catch (error) {
        active = false;
        sessionId = null;
        startButton.disabled = false;
        setStatus('No se pudo iniciar: ' + error.message);
      }
    }, error => {
      startButton.disabled = false;
      setStatus('No se obtuvo permiso de ubicación: ' + error.message);
    }, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 0
    });
  }

  async function handlePosition(position) {
    if (!active) return;

    const tester = getTester();
    const coords = position.coords;

    if (coords.accuracy > 100) return;

    lastPosition = position;

    try {
      await tester.db.collection('tester_sessions')
        .doc(sessionId).update({
          lastLocation: {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy
          },
          lastUpdateAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
      setStatus('Error guardando ubicación: ' + error.message);
    }
  }

  function handlePositionError(error) {
    setStatus('Problema de ubicación: ' + error.message);
  }

  async function stopTracking() {
    if (!active) return;

    const tester = getTester();

    active = false;

    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    try {
      await tester.db.collection('tester_sessions')
        .doc(sessionId).update({
          status: 'finished',
          finishedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

      await tester.db.collection('tester_events').add({
        uid: tester.uid,
        sessionId,
        type: 'tracking_stopped',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      setStatus('Seguimiento detenido y sesión guardada.');

    } catch (error) {
      setStatus('Seguimiento detenido. Error guardando cierre: ' + error.message);
    }

    sessionId = null;
    lastPosition = null;
    startButton.disabled = false;
    stopButton.disabled = true;
    questions.hidden = true;
  }

  panel.addEventListener('click', async event => {
    const button = event.target.closest('button[data-event]');
    if (!button) return;

    try {
      await saveEvent(button.dataset.event, {
        answer: button.dataset.answer
      });

      setStatus('Respuesta registrada correctamente.');
    } catch (error) {
      setStatus(error.message);
    }
  });

  startButton.onclick = startTracking;
  stopButton.onclick = stopTracking;

  document.getElementById('tpClose').onclick = () => {
    panel.hidden = true;
  };

  document.addEventListener('metrored:tester-login', () => {
    panel.hidden = false;
  });

  document.addEventListener('metrored:tester-logout', () => {
    if (active) stopTracking();
    panel.hidden = true;
  });

  window.addEventListener('beforeunload', () => {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
    }
  });
})();
