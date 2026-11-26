
(() => {
  const style = document.createElement('style');

  style.textContent = `
    #testerAccessBtn {
      border: 0;
      border-radius: 9px;
      padding: 8px 10px;
      background: #fff;
      color: #064d2e;
      font-weight: 800;
    }

    #testerModal {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: #0009;
      display: grid;
      place-items: center;
      padding: 20px;
    }

    #testerModal[hidden] {
      display: none;
    }

    .testerBox {
      width: 100%;
      max-width: 360px;
      background: white;
      color: #16212b;
      padding: 22px;
      border-radius: 16px;
    }

    .testerBox input,
    .testerBox button {
      width: 100%;
      padding: 12px;
      margin-top: 10px;
      border-radius: 9px;
      border: 1px solid #ddd;
      font: inherit;
    }

    .testerBox button {
      background: #064d2e;
      color: white;
      font-weight: 800;
      border: 0;
    }

    #testerMessage {
      font-size: 13px;
      margin-top: 12px;
    }
  `;

  document.head.appendChild(style);

  const topbar = document.querySelector('.topbar');

  if (!topbar) {
    console.error('MetroRed: no se encontró .topbar');
    return;
  }

  const button = document.createElement('button');
  button.id = 'testerAccessBtn';
  button.textContent = 'Acceso tester';
  topbar.appendChild(button);

  const modal = document.createElement('div');
  modal.id = 'testerModal';
  modal.hidden = true;

  modal.innerHTML = `
    <div class="testerBox">
      <h3>Acceso privado MetroRed</h3>

      <input
        id="testerEmail"
        type="email"
        placeholder="Correo electrónico"
        autocomplete="username"
      >

      <input
        id="testerPassword"
        type="password"
        placeholder="Contraseña"
        autocomplete="current-password"
      >

      <button id="testerLogin">Iniciar sesión</button>

      <button id="testerLogout" hidden>
        Cerrar sesión
      </button>

      <button id="testerClose" type="button">
        Cerrar
      </button>

      <p id="testerMessage"></p>
    </div>
  `;

  document.body.appendChild(modal);

  let privateAuth = null;
  let privateDb = null;

  function message(text) {
    document.getElementById('testerMessage').textContent = text;
  }

  async function waitFirebase() {
    for (let i = 0; i < 100; i++) {
      if (
        window.firebase &&
        firebase.apps.length &&
        firebase.firestore &&
        firebase.auth
      ) {
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    throw new Error('Firebase no está disponible.');
  }

  async function getPrivateAuth() {
    await waitFirebase();

    let app = firebase.apps.find(
      item => item.name === 'metrored-private'
    );

    if (!app) {
      app = firebase.initializeApp(
        FIREBASE_CONFIG,
        'metrored-private'
      );
    }

    privateAuth = app.auth();
    privateDb = app.firestore();

    return privateAuth;
  }

  button.onclick = () => {
    modal.hidden = false;
    message('');
  };

  document.getElementById('testerClose').onclick = () => {
    modal.hidden = true;
  };

  document.getElementById('testerLogin').onclick = async () => {
    const email = document.getElementById('testerEmail').value.trim();
    const password = document.getElementById('testerPassword').value;
    const login = document.getElementById('testerLogin');

    if (!email || !password) {
      message('Escribe tu correo y contraseña.');
      return;
    }

    login.disabled = true;
    message('Verificando acceso...');

    try {
      const auth = await getPrivateAuth();

      const credential = await auth.signInWithEmailAndPassword(
        email,
        password
      );

      const user = credential.user;

      const snapshot = await privateDb
        .collection('roles')
        .doc(user.uid)
        .get();

      const role = snapshot.exists ? snapshot.data() : null;

      if (
        !role ||
        role.active !== true ||
        !['admin', 'tester'].includes(role.role)
      ) {
        await auth.signOut();
        throw new Error('Tu cuenta no tiene autorización.');
      }

      message('Acceso autorizado: ' + role.role);

      document.getElementById('testerLogout').hidden = false;
      login.hidden = true;

      button.textContent = 'Sesión: ' + role.role;

      window.metroredTester = {
        uid: user.uid,
        role: role.role,
        auth,
        db: privateDb
      };

      document.dispatchEvent(
        new CustomEvent('metrored:tester-login', {
          detail: {
            uid: user.uid,
            role: role.role
          }
        })
      );

    } catch (error) {
      message(error.message || 'No se pudo iniciar sesión.');
    } finally {
      login.disabled = false;
    }
  };

  document.getElementById('testerLogout').onclick = async () => {
  try {
    if (window.metroredStopTesterTracking) {
      await window.metroredStopTesterTracking();
    }

    document.dispatchEvent(
      new CustomEvent('metrored:tester-logout')
    );

    if (privateAuth) {
      await privateAuth.signOut();
    }

    window.metroredTester = null;

    document.getElementById('testerLogin').hidden = false;
    document.getElementById('testerLogout').hidden = true;

    button.textContent = 'Acceso tester';
    message('Sesión cerrada.');

  } catch (error) {
    message('No se pudo cerrar la sesión: ' + error.message);
  }
};
})();
