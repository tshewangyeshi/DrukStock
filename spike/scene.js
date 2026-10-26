// Throwaway spike (eng D23): the opening counter scene built from simple
// shapes (D33), to measure bundle size and, on the founder's phone,
// time to first frame and frame rate. Not production code.

import {
  WebGLRenderer, Scene, PerspectiveCamera, Mesh, Group,
  BoxGeometry, MeshStandardMaterial, AmbientLight, DirectionalLight, Color, SRGBColorSpace,
} from 'three';

const t0 = performance.now();
const hud = document.getElementById('hud');
const canvas = document.getElementById('scene');

let renderer;
try {
  renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
} catch (err) {
  hud.textContent = `WebGL unavailable after ${(performance.now() - t0).toFixed(0)} ms: the real demo shows the still image here (D29)`;
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = SRGBColorSpace;

const scene = new Scene();
scene.background = new Color('#F3F5F1'); // --paper

const camera = new PerspectiveCamera(35, 1, 0.1, 50);
camera.position.set(0, 2.2, 6);
camera.lookAt(0, 0.6, 0);

const mat = hex => new MeshStandardMaterial({ color: hex, roughness: 0.85 });

// Counter, back shelf, and the red baki notebook (cover + page block).
const counter = new Mesh(new BoxGeometry(4.4, 1, 1.6), mat('#8A6A4A'));
counter.position.y = 0;
const shelf = new Mesh(new BoxGeometry(4.4, 2.2, 0.3), mat('#B89F80'));
shelf.position.set(0, 1.4, -1.2);
const book = new Group();
const pages = new Mesh(new BoxGeometry(1.1, 0.08, 0.8), mat('#F3F5F1'));
const cover = new Mesh(new BoxGeometry(1.14, 0.03, 0.84), mat('#9D2129')); // --baki-red
cover.position.y = 0.055;
book.add(pages, cover);
book.position.set(0.4, 0.56, 0.2);
book.rotation.y = -0.25;
scene.add(counter, shelf, book);
scene.add(new AmbientLight('#ffffff', 0.9));
const sun = new DirectionalLight('#ffffff', 1.6);
sun.position.set(2, 4, 3);
scene.add(sun);

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Drag parallax (D28) + slow idle drift (D18: ≤3°, ≥8 s cycle).
let dragX = 0;
canvas.addEventListener('pointermove', e => {
  if (e.buttons || e.pointerType === 'touch') dragX = (e.clientX / window.innerWidth - 0.5) * 2;
});
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const maxRad = (3 * Math.PI) / 180;

let firstFrameMs = null, frames = 0, last = performance.now(), fps = 0;
function frame(now) {
  const drift = reduced ? 0 : Math.sin((now / 9000) * Math.PI * 2) * maxRad;
  scene.rotation.y = drift + dragX * maxRad;
  renderer.render(scene, camera);
  if (firstFrameMs === null) firstFrameMs = performance.now() - t0;
  frames++;
  if (now - last >= 1000) { fps = (frames * 1000) / (now - last); frames = 0; last = now; }
  hud.textContent = `first frame ${firstFrameMs.toFixed(0)} ms · ${fps.toFixed(0)} fps`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
