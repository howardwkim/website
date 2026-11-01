// The Boo 2026 card: one photo, one rise, nothing to tune. The rise plays when loading finishes,
// and the card's layers lift with it; the repeat button starts both again from the beginning.
// `?look=<JSON>`, `?grade=<JSON>` and `?subject=<file>` override those, for comparing colours.
import * as THREE from 'three';
import { HologramLook } from '../hologram/HologramLook.js';
import { createStage, CARD } from '../stage/Card.js';
import { CardFace } from '../stage/CardFace.js';
import { placeOnCard } from '../stage/placeOnCard.js';
import { loadSplat, splatBox } from '../subject/splats.js';
import { Rise } from '../rise/Rise.js';
import { DESIGNS } from '../rise/designs.js';
import { LoadStatus } from '../rise/LoadStatus.js';
import { BOO, LOOK, LAYERS } from './settings.js';

const params = new URLSearchParams(location.search);
const SUBJECT = { rotation: [0, 0, 0], height: 0.9, centerY: -0.22, back: 'auto', maxWidth: 0.9, flipY: true, pop: BOO.pop, blackPoint: BOO.blackPoint, url: new URL(params.get('subject') ?? BOO.url, document.baseURI).href, ...BOO.fit };
const CONTOUR = DESIGNS.find((d) => d.id === 'contour');
const sim = { t: 0 };   // simulation clock (advanced by rAF, or by holo.step() when testing)

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
camera.layers.enableAll();

const look = new HologramLook(renderer, { ...LOOK, ...JSON.parse(params.get('look') ?? '{}') });
look.shared.uDepthScale.value = BOO.depth;
const rise = new Rise(look);
const grade = JSON.parse(params.get('grade') ?? 'null') ?? BOO.grade;
if (grade) rise.uniforms.rGrade.value.set(...grade);
const stage = createStage(look);
scene.add(stage.background);
scene.add(stage.rig);
look.setEmitter(stage.emitter);
if (params.has('tint')) look.params.tint = THREE.MathUtils.clamp(Number(params.get('tint')), 0, 1);

stage.setBackground(BOO.background.pattern, BOO.background.amount);
const face = new CardFace(look, stage, renderer);
const layersReady = face.set(LAYERS);

// ---------------------------------------------------------------- load the subject
async function loadSplatSubject(cfg) {
  const { mesh, report } = await loadSplat(cfg.url, {
    flip: cfg.flipY,
    ...BOO.clean,
    ...JSON.parse(params.get('clean') ?? 'null'),
    onProgress: (e) => {
      const total = e.total || BOO.bytes;
      if (e.loaded >= total) loading.preparing(); else loading.progress(e.loaded, total);
    },
  });
  loading.preparing();
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));   // let the line show before the heavy part;
  if (report) console.info(`splat subject: ${report.kept.toLocaleString()} of ${report.splats.toLocaleString()} splats kept ` +
    `(dropped ${report.byOpacity} faint, ${report.byCluster} off the main cluster, ${report.bySupport} support surface; ${report.ms} ms)`);
  const root = new THREE.Group();
  root.add(mesh);
  return { root, opts: { fadeBottom: cfg.fadeBottom, blackPoint: cfg.blackPoint }, box: (holder) => splatBox(mesh, holder), background: report };
}

async function loadSubject(cfg) {
  const sub = await loadSplatSubject(cfg);
  const { root, opts } = sub;

  // fit onto the card: face +Z, given height (and width), then set the depth the card cuts it at
  const holder = new THREE.Group();
  root.rotation.set(...cfg.rotation);
  holder.add(root);
  holder.updateMatrixWorld(true);
  const box = sub.box ? sub.box(holder) : new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const s = Math.min(cfg.height / size.y, (cfg.maxWidth ?? Infinity) / size.x);
  holder.scale.setScalar(s);
  const auto = cfg.back === 'auto';
  holder.position.set(-c.x * s, cfg.centerY - c.y * s, auto ? -c.z * s : cfg.back - box.min.z * s);
  stage.emitter.add(holder);
  scene.updateMatrixWorld(true);
  if (auto) {
    const p = placeOnCard(holder, stage.emitter);
    console.info(`card placement: air ${p.air.toExponential(2)} (was ${p.airBefore.toExponential(2)} at the centre), ` +
      `${(100 * p.air / p.solidVolume).toFixed(1)}% of the figure's volume`);
    holder.userData.placement = p;
  }
  holder.userData.background = sub.background;
  holder.userData.depth = size.z * s;
  holder.position.z += cfg.pop * holder.userData.depth;
  scene.updateMatrixWorld(true);
  await look.apply(holder, opts);
  return holder;
}

// ---------------------------------------------------------------- sizing
// The view is the canvas's own box: the whole window, or the part above the settings sheet.
function resize() {
  const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, w < 700 ? 2 : 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep the whole card in frame on narrow screens
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const needH = CARD.height * 1.08;
  const needW = CARD.width * (camera.aspect < 0.8 ? 1.22 : 1.45);
  const dH = needH / (2 * Math.tan(fov / 2));
  const dW = needW / (2 * Math.tan(fov / 2) * camera.aspect);
  camera.position.set(0, 0.02, Math.max(dH, dW));
  camera.lookAt(0, 0.02, 0);
  camera.updateProjectionMatrix();
  look.setSize(w, h, dpr);
  stage.setSize(w, h, dpr);
}
new ResizeObserver(resize).observe(canvas);
resize();

// ---------------------------------------------------------------- interaction
const view = {
  yaw: 0, pitch: 0,          // displayed
  baseYaw: 0, basePitch: 0,  // from dragging
  vYaw: 0, vPitch: 0,        // inertia
  dragging: false, lastInput: -100, idleW: 0, idle: false,
  tilt: { active: false, yaw: 0, pitch: 0, base: null },
};
const DEG = Math.PI / 180;
if (params.has('yaw')) view.baseYaw = view.yaw = Number(params.get('yaw')) * DEG;
if (params.has('pitch')) view.basePitch = view.pitch = Number(params.get('pitch')) * DEG;

let last = { x: 0, y: 0, t: 0 };
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  view.dragging = true;
  view.baseYaw = view.yaw - view.tilt.yaw * (view.tilt.active ? 1 : 0);
  view.basePitch = view.pitch - view.tilt.pitch * (view.tilt.active ? 1 : 0);
  view.idleW = 0;
  view.vYaw = view.vPitch = 0;
  last = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointermove', (e) => {
  if (!view.dragging) return;
  const now = performance.now();
  const dx = e.clientX - last.x, dy = e.clientY - last.y;
  const k = 3.2 / Math.max(window.innerWidth, 500);
  view.baseYaw += dx * k * 1.6;
  view.basePitch = THREE.MathUtils.clamp(view.basePitch + dy * k, -0.75, 0.75);
  const dt = Math.max(1, now - last.t) / 1000;
  view.vYaw = THREE.MathUtils.lerp(view.vYaw, (dx * k * 1.6) / dt, 0.5);
  view.vPitch = THREE.MathUtils.lerp(view.vPitch, (dy * k) / dt, 0.5);
  last = { x: e.clientX, y: e.clientY, t: now };
  view.lastInput = sim.t;
});
let lastTap = { t: 0, x: 0, y: 0 };
const endDrag = (e) => {
  view.dragging = false;
  view.lastInput = sim.t;
  const now = performance.now();
  if (now - last.t > 90) view.vYaw = view.vPitch = 0;   // held still before letting go: no fling
  // double-click / double-tap replays the rise
  if (e && e.type === 'pointerup') {
    if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
      playRise();
      lastTap.t = 0;
    } else lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// device orientation (phones)
function onOrient(e) {
  if (e.gamma == null || e.beta == null) return;
  const t = view.tilt;
  if (!t.base) t.base = { b: e.beta, g: e.gamma };
  t.yaw = THREE.MathUtils.clamp((e.gamma - t.base.g) * 1.7 * DEG, -1.5, 1.5);
  t.pitch = THREE.MathUtils.clamp((e.beta - t.base.b) * 0.9 * DEG, -0.6, 0.6);
  if (!t.active) { t.active = true; view.idleW = 0; }
  view.lastInput = sim.t;
}
// Tilt is on from the start. An iPhone only asks for motion access on a tap, so there the page
// shows one button while it loads, and the rise waits for it: nobody misses it behind the prompt.
const hasOrientation = typeof window.DeviceOrientationEvent !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const tilt = () => window.addEventListener('deviceorientation', onOrient);
const started = new Promise((go) => {
  if (!hasOrientation) { go(); return; }
  if (typeof DeviceOrientationEvent.requestPermission !== 'function') { tilt(); go(); return; }
  const startBtn = document.getElementById('start');
  // already allowed in this visit: it answers without a tap, and otherwise simply refuses
  const offer = () => { startBtn.hidden = false; };
  DeviceOrientationEvent.requestPermission()
    .then((res) => { if (res === 'granted') { tilt(); go(); } else offer(); })
    .catch(offer);
  setTimeout(offer, 1000);    // a browser that never answers must not leave anyone on the loader
  startBtn.addEventListener('click', () => {
    startBtn.hidden = true;
    DeviceOrientationEvent.requestPermission()
      .then((res) => { if (res === 'granted') tilt(); })
      .catch(() => {})     // drag still turns the card
      .finally(go);
  });
});

const playRise = () => rise.play(CONTOUR, { speed: BOO.speed, face: BOO.face });
document.getElementById('again').addEventListener('click', playRise);

function setView(yawDeg, pitchDeg, { idle } = {}) {
  view.baseYaw = yawDeg * DEG;
  view.basePitch = pitchDeg * DEG;
  view.vYaw = view.vPitch = 0;
  view.idleW = 0;
  view.lastInput = sim.t;
  if (idle !== undefined) view.idle = idle;
}

// ---------------------------------------------------------------- loop
let idleT = 0;
function tick(dt) {
  sim.t += dt;
  const t = sim.t;

  if (!view.dragging) {
    view.baseYaw += view.vYaw * dt;
    view.basePitch = THREE.MathUtils.clamp(view.basePitch + view.vPitch * dt, -0.75, 0.75);
    const damp = Math.exp(-dt * 3.5);
    view.vYaw *= damp; view.vPitch *= damp;
  }
  // idle: the slow turn from the film, eased in after a few seconds of no input
  const idleOn = view.idle && !view.dragging && !view.tilt.active && t - view.lastInput > 3.5;
  view.idleW = THREE.MathUtils.clamp(view.idleW + (idleOn ? dt / 2.5 : -dt * 4), 0, 1);
  if (idleOn) idleT += dt * view.idleW;
  const w = view.idleW * view.idleW * (3 - 2 * view.idleW);
  const swayY = (0.5 * Math.sin(idleT * 0.33) + 0.12 * Math.sin(idleT * 0.81 + 1.0)) * w;
  const swayP = 0.07 * Math.sin(idleT * 0.27 + 0.5) * w;
  const tY = view.baseYaw + swayY + (view.tilt.active ? view.tilt.yaw : 0);
  const tP = view.basePitch + swayP + (view.tilt.active ? view.tilt.pitch : 0);
  const k = 1 - Math.exp(-dt * 9);
  view.yaw += (tY - view.yaw) * k;
  view.pitch += (tP - view.pitch) * k;

  stage.rig.rotation.set(view.pitch * 0.9, view.yaw, 0, 'YXZ');
  // a held card: slight hand drift
  stage.rig.position.set(Math.sin(t * 0.21) * 0.006, Math.sin(t * 0.17 + 1) * 0.008, 0);
  scene.updateMatrixWorld();

  rise.update(t);
  face.setLift(rise.progress);
  look.update(t, dt);
  look.render(scene, camera);
}
let lastNow = performance.now();
let paused = false;   // tests step the clock themselves
function frame(now) {
  const dt = Math.min(Math.max((now - lastNow) / 1000, 0), 0.05);
  lastNow = now;
  if (!paused) tick(dt);
  requestAnimationFrame(frame);
}

const statusEl = document.getElementById('status');
const loading = new LoadStatus(statusEl, SUBJECT.url, { bar: document.getElementById('bar'), size: BOO.bytes });
Promise.all([loadSubject(SUBJECT), layersReady])
  .then(async ([subject]) => {
    loading.done();
    loading.say('Ready');
    await started;
    document.getElementById('loading').remove();
    rise.bind(look.subjects[0], CARD);
    rise.hide();
    if (!params.has('hold')) playRise();
    if (params.get('flicker') === '0') look.params.flickerRate = 0;
    window.holo = {
      look, view, setView, subject, stage, camera, renderer, SUBJECT, sim, face,
      rise, playRise, DESIGNS, pause: (v) => { paused = v; },
      // advance n frames synchronously (for screenshots when the page is throttled)
      step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) tick(dt); return sim.t; },
    };
  })
  .catch((err) => { statusEl.textContent = 'could not load subject: ' + err.message; console.error(err); });

requestAnimationFrame(frame);
