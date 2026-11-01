// CardFace: draws a list of card layers (stage/cardLayers.js) onto the card.
//
// Each layer is painted once into its own canvas the size of the card and shown on a plane
// just in front of the card face. Only the canvas alpha is used; colour comes from the shader:
//   print -> LAYERS.STAGE, drawn with the card into the scene: ink or foil, static.
//   light -> LAYERS.LIGHT, drawn into the light layer with the figure, so the look's light
//            pass (flicker, hue jumps, ghosts, chromatic split) and glow treat it as the figure.
// Layers are drawn in list order within their mode. set() swaps the whole list at run time.
// A layer with `lift` (card units) stands that far off the card once setLift(1) has been called;
// with `always` a light layer shows from the start instead of arriving with the figure.

import * as THREE from 'three';
import { LAYERS } from '../hologram/HologramLook.js';
import { NOISE } from '../hologram/shaders.js';
import { CARD } from './Card.js';

const PX = 1024;   // canvas pixels per card unit
const FACE_Z = 0.0006;   // just off the card's front face

const faceVertex = /* glsl */ `
varying vec2 vUv; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vWorldN;
void main() {
  vUv = uv; vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz; vWorldN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Ink or foil on the card. Foil catches a broad soft highlight from an imagined window up
// and to the left, so it brightens and dims as the card turns; ink stays matte.
const printFragment = /* glsl */ `
uniform sampler2D map; uniform vec3 uInk; uniform float uOpacity; uniform float uFoil;
varying vec2 vUv; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vWorldN;
void main() {
  float m = texture2D(map, vUv).a * uOpacity;
  if (m < 0.002) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vWorldN);
  if (dot(N, V) < 0.0) N = -N;
  vec3 R = reflect(-V, N);
  float spec = pow(max(dot(R, normalize(vec3(-0.4, 0.6, 0.7))), 0.0), 5.0);
  float grain = 0.5 + 0.5 * sin(dot(vLocal.xy, vec2(310.0, 170.0)) + dot(V.xy, vec2(40.0, 25.0)));
  vec3 col = uInk * mix(1.0, 0.4 + 1.9 * spec + 0.12 * grain, uFoil);
  gl_FragColor = vec4(col, m);
}`;

// Light: the light's colour, with the same projection structure as the figure (fine lines,
// slow ripple, the band that climbs through) and a faint shimmer. Rises with the figure.
const lightFragment = /* glsl */ `
uniform sampler2D map; uniform vec3 uLight; uniform float uLevel; uniform float uOpacity;
uniform float uTime; uniform float uEmerge; uniform float uScan; uniform float uScanFreq; uniform float uBand;
varying vec2 vUv; varying vec3 vLocal; varying vec3 vWorld; varying vec3 vWorldN;
${NOISE}
void main() {
  float m = texture2D(map, vUv).a * uOpacity;
  if (m < 0.002) discard;
  float ly = vLocal.y * uScanFreq;
  float fw = fwidth(ly);
  float fine = 0.5 + 0.5 * cos(6.28318 * ly - uTime * 1.3);
  fine = mix(fine, 0.5, smoothstep(0.25, 0.7, fw));
  float ripple = 0.5 + 0.5 * sin(vLocal.y * 21.0 + uTime * 0.8);
  float band = exp(-pow((vLocal.y - uBand) / 0.05, 2.0));
  float shimmer = 0.85 + 0.3 * vnoise(vec3(vLocal.xy * 14.0, uTime * 0.6));
  float k = (1.0 - uScan * (0.45 * fine + 0.25 * ripple)) * (1.0 + (0.3 + uScan) * 0.9 * band) * shimmer;
  float em = smoothstep(0.1, 0.6, uEmerge);
  gl_FragColor = vec4(uLight * m * uLevel * k * em, m * 0.6 * em);
}`;

const loadImage = (src) => new Promise((res, rej) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('card layer image: ' + src));
  img.src = src;
});

// ---------------------------------------------------------------- painting one layer
function cardPx(x, y) { return [(x + CARD.width / 2) * PX, (CARD.height / 2 - y) * PX]; }

function paintBorder(g, L) {
  const W = CARD.width * PX, H = CARD.height * PX;
  const lw = (L.width ?? 0.003) * PX;
  const r = (L.radius ?? 0) * PX;
  const rect = (inset) => {
    const i = inset * PX + lw / 2;
    g.beginPath();
    g.roundRect(i, i, W - 2 * i, H - 2 * i, Math.max(0, r - inset * PX * 0.3));
    g.stroke();
  };
  g.lineWidth = lw;
  const inset = L.inset ?? 0.03;
  if (L.style === 'corners') {
    const c = (L.corner ?? 0.05) * PX, i = inset * PX + lw / 2;
    g.lineCap = 'square';
    g.beginPath();
    for (const [x, y, dx, dy] of [[i, i, 1, 1], [W - i, i, -1, 1], [i, H - i, 1, -1], [W - i, H - i, -1, -1]]) {
      g.moveTo(x + dx * c, y); g.lineTo(x, y); g.lineTo(x, y + dy * c);
    }
    g.stroke();
    return;
  }
  rect(inset);
  if (L.style === 'double') rect(inset + (L.width ?? 0.003) * 3);
}

async function paintText(g, L) {
  const size = (L.size ?? 0.03) * PX;
  const family = L.font ?? 'ui-sans-serif, system-ui, sans-serif';
  if (L.fontUrl) {
    const face = new FontFace(family.split(',')[0].replace(/["']/g, '').trim(), `url(${L.fontUrl})`);
    document.fonts.add(await face.load());
  }
  g.font = `${L.style ?? 'normal'} ${L.weight ?? 400} ${size}px ${family}`;
  await document.fonts.load(g.font).catch(() => {});
  g.font = `${L.style ?? 'normal'} ${L.weight ?? 400} ${size}px ${family}`;
  const spacing = (L.letterSpacing ?? 0) * size;
  g.letterSpacing = `${spacing}px`;
  const align = L.align ?? 'center';
  g.textAlign = align;
  g.textBaseline = 'middle';
  const text = L.upper ? String(L.text).toUpperCase() : String(L.text);
  const lines = text.split('\n');
  const [x0, y0] = cardPx(L.x ?? 0, L.y ?? 0);
  // canvas adds the spacing after the last letter too; shift so the words sit where asked
  const shift = align === 'center' ? spacing / 2 : align === 'right' ? spacing : 0;
  lines.forEach((line, i) => g.fillText(line, x0 + shift, y0 + (i - (lines.length - 1) / 2) * size * 1.3));
}

async function paintImage(g, L) {
  const img = await loadImage(L.src);
  const w = (L.width ?? 0.2) * PX;
  const h = w * (img.naturalHeight || img.height) / (img.naturalWidth || img.width);
  const [x, y] = cardPx(L.x ?? 0, L.y ?? 0);
  g.drawImage(img, x - w / 2, y - h / 2, w, h);
}

async function paintLayer(L) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(CARD.width * PX);
  canvas.height = Math.round(CARD.height * PX);
  const g = canvas.getContext('2d');
  g.fillStyle = g.strokeStyle = '#fff';
  if (L.type === 'border') paintBorder(g, L);
  else if (L.type === 'text') await paintText(g, L);
  else if (L.type === 'image') await paintImage(g, L);
  else throw new Error('card layer: unknown type ' + L.type);
  return canvas;
}

// ---------------------------------------------------------------- the face
export class CardFace {
  /** `stage` from createStage(); the layers sit on its emitter (the card's front surface). */
  constructor(look, stage, renderer) {
    this.look = look;
    this.group = new THREE.Group();
    stage.emitter.add(this.group);
    this.aniso = renderer.capabilities.getMaxAnisotropy();
    this.items = [];
    this.layers = [];
    this.version = 0;
  }

  /** Replace every layer on the card. Resolves when the new ones are showing. */
  async set(layers) {
    const version = ++this.version;
    const canvases = await Promise.all(layers.map((L) => paintLayer(L).catch((err) => { console.warn(err.message); return null; })));
    if (version !== this.version) return;   // a newer set() overtook this one
    this.clear();
    this.layers = layers;
    layers.forEach((L, i) => { if (canvases[i]) this.items.push(this._mesh(L, canvases[i], i)); });
  }

  /** How far the lifting layers have come: 0 flat on the card, 1 at their full height. */
  setLift(k) {
    for (const m of this.items) m.position.z = FACE_Z + (m.userData.lift ?? 0) * k;
  }

  clear() {
    for (const m of this.items) {
      m.removeFromParent();
      m.material.uniforms.map.value.dispose();
      m.material.dispose();
      m.geometry.dispose();
    }
    this.items = [];
  }

  _mesh(L, canvas, order) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = this.aniso;
    tex.colorSpace = THREE.NoColorSpace;   // only the alpha is read
    const sh = this.look.shared;
    const light = L.mode === 'light';
    const mat = new THREE.ShaderMaterial({
      uniforms: light ? {
        map: { value: tex }, uLight: sh.uLight, uLevel: { value: L.level ?? 1.4 }, uOpacity: { value: L.opacity ?? 1 },
        uTime: sh.uTime, uEmerge: L.always ? { value: 1 } : sh.uEmerge, uScan: sh.uScan, uScanFreq: sh.uScanFreq, uBand: sh.uBand,
      } : {
        map: { value: tex }, uInk: { value: new THREE.Color(L.color ?? '#d8d0b0') },
        uOpacity: { value: L.opacity ?? 1 }, uFoil: { value: L.finish === 'foil' ? 1 : 0 },
      },
      vertexShader: faceVertex,
      fragmentShader: light ? lightFragment : printFragment,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    if (light) {
      // added into the light layer like the haze; alpha adds too, so it hides what is behind a little
      Object.assign(mat, {
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      });
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CARD.width, CARD.height), mat);
    mesh.position.z = FACE_Z;
    mesh.userData.lift = L.lift;
    mesh.layers.set(light ? LAYERS.LIGHT : LAYERS.STAGE);
    mesh.renderOrder = 3 + order;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }
}
