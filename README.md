<div align="center">

# 🚌 Metro Red Rioverde — ¡Tu próximo autobús, a un toque!

**Prototipo independiente para Android y web pensado para moverse más fácil entre Rioverde y Ciudad Fernández (Zona Media, SLP).**

[![Estado](https://img.shields.io/badge/Estado-Prototipo%20Activo-brightgreen?style=for-the-badge)]()
[![Plataforma](https://img.shields.io/badge/Plataforma-Android%20%7C%20Web-blue?style=for-the-badge)]()
[![Compilación](https://img.shields.io/badge/APK-GitHub%20Actions-orange?style=for-the-badge)]()

*Mira dónde viene tu camión, revisa las paradas y calcula cuánto falta para que llegue sin quedarte esperando bajo el sol.*

</div>

---

## 🌟 ¿Por qué usar Metro Red?

Ya sea que vayas a clases, al trabajo, de compras o a visitar a alguien entre **Rioverde** y **Ciudad Fernández**, esperar sin saber cuándo pasa la unidad hace perder tiempo. Este prototipo reúne en una pantalla clara:

* 🗺️ **Mapa interactivo + lista de paradas:** Ubica el recorrido y revisa los puntos clave del mapa público de la SCT.
* ⏱️ **Tiempos estimados de llegada (ETA):** Mira en cuánto tiempo llega el siguiente autobús a tu parada.
* 🚍 **Dos rutas principales cubiertas:** **L1 Rioverde–Ciudad Fernández** y **L2 Eje Norte–Sur**.
* 📡 **Listo para crecer a GPS real:** Hoy funciona con una simulación fluida (4 unidades por línea, ~50 min de ida y ~17 min de espera en base) y está preparado para conectarse a un servidor de ubicación real.

---

## 📸 Vista previa de la app

> *Tip: Cuando tengas tus capturas de pantalla, súbelas a una carpeta `assets/` en tu repositorio y reemplaza los enlaces de abajo para que se vean aquí.*

<div align="center">
  <img src="assets/captura-mapa.png" alt="Mapa de Metro Red" width="280" />
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="assets/captura-paradas.png" alt="Paradas y tiempos de llegada" width="280" />
</div>


---

## 🗺️ Rutas incluidas en el prototipo

| Línea | Recorrido | Unidades simuladas | Tiempo de ida aprox. | Espera en base aprox. |
| :--- | :--- | :---: | :---: | :---: |
| **L1** | **Rioverde – Ciudad Fernández** | 4 autobuses | ~50 min | ~17 min |
| **L2** | **Eje Norte – Sur** | 4 autobuses | ~50 min | ~17 min |

> ⚠️ **Nota importante:** Este es un proyecto independiente y **no utiliza logos ni marcas oficiales**. Las ubicaciones de las paradas en el prototipo son aproximaciones tomadas del mapa público de la SCT y están pensadas para validarse con coordenadas exactas.

app de Android
.github/workflows/build-apk.yml # Flujo automático en GitHub para crear el APK
