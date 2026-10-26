# 3D spike (throwaway, eng review D23)

Measures the opening counter scene built from simple shapes (D33) before the
real 3D renderer is built.

- Build: `npm install && npm run build`
- Measured 2026-10-26: `dist/scene.js` = 120,801 bytes gzipped (Three.js 0.170 + scene),
  under the 180 KB Three.js line (ER-D13b). No photo textures yet.
- Still needed, on the founder's phone: time to first frame and fps.
  Run `python3 -m http.server 8765 --bind 0.0.0.0` here, open
  `http://<this-computer's-LAN-IP>:8765` on the phone (same Wi-Fi), and read the line under the scene.
  The headless test browser on the dev machine has no WebGL, so it can't measure this.
