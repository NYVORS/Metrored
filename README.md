# Redmetro Rioverde en vivo

Prototipo de app para ver dónde viene el siguiente autobús de Mi Redmetro en Rioverde (Zona Media, SLP).
Líneas: **L1 Rioverde–Ciudad Fernández** y **L2 Eje Norte–Sur**, con las paradas del mapa público de la SCT.
Hoy usa **datos simulados** (4 autobuses por línea, ~50 min de ida, ~17 min de espera en base).

> Las posiciones de las paradas son aproximadas (calculadas desde la imagen del mapa). Hay que verificarlas con coordenadas reales.
> App independiente: no usa logos ni marcas oficiales.

## Estructura

```
www/index.html   Pantalla (mapa + panel de paradas)
www/styles.css   Estilos
www/app.js       Lógica, simulación y tiempos de llegada (ETA)
capacitor.config.json   Configuración del empaquetado Android
.github/workflows/build-apk.yml   Genera el APK en GitHub
```

## Probar en el navegador

Abre `www/index.html` o corre un servidor local:

```
cd www && python3 -m http.server 8000
```

## Subir a GitHub y obtener el APK

1. Crea un repositorio nuevo en GitHub (vacío).
2. Sube todo el contenido de esta carpeta:
   ```
   git init
   git add .
   git commit -m "Primer prototipo"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```
3. En GitHub entra a la pestaña **Actions**. Se ejecuta *Build APK* automáticamente (también puedes lanzarlo con *Run workflow*).
4. Al terminar (unos 5 a 10 min), abre la ejecución y descarga **metrored-debug-apk** en *Artifacts*. Dentro está `app-debug.apk`.
5. Pásalo a tu Android e instálalo (permite "instalar apps de orígenes desconocidos").

## Cómo pasar de simulación a GPS reales

En `www/app.js`, la función `fetchBuses()` genera posiciones falsas. Cámbiala por una llamada a tu servidor, por ejemplo:

```js
async function fetchBuses() {
  const r = await fetch('https://TU-SERVIDOR/api/buses');
  return r.json(); // [{id, line, dir, lat, lng, along, waiting}, ...]
}
```

Y cambia `drawAll()` para esperar con `await`. El servidor (por ejemplo Traccar) recibe los datos de los GPS.

## Pendientes

- Verificar coordenadas reales de cada parada y los minutos entre ellas (`LINES` en `www/app.js`).
- Si obtienes permiso de la SCT, agregar sus logos y créditos con los archivos oficiales que ellos te den.
- Conectar a los GPS reales.
- Íconos y nombre definitivo de la app.
- APK firmado (release) si lo quieres publicar en Play Store.
