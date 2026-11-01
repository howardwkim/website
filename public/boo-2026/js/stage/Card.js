// The stage: the photo card the light comes out of, the haze of light rising from it,
// dust in that light, and a dim room behind. Reads the look's shared uniforms so the
// card glow, beam and motes flicker with the figure (same light source).

import * as THREE from 'three';
import { LAYERS } from '../hologram/HologramLook.js';
import { NOISE } from '../hologram/shaders.js';

export const CARD = { width: 1.0, height: 1.45, thickness: 0.012 };

const cardVertex = /* glsl */ `
varying vec3 vLocal; varying vec3 vLocalN; varying vec3 vWorld; varying vec3 vWorldN;
void main() {
  vLocal = position; vLocalN = normal;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz; vWorldN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const cardFragment = /* glsl */ `
uniform vec3 uTint; uniform float uBright; uniform float uTime; uniform vec2 uSize; uniform float uEmerge;
varying vec3 vLocal; varying vec3 vLocalN; varying vec3 vWorld; varying vec3 vWorldN;
${NOISE}
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vWorldN);
  float ndv = abs(dot(N, V));
  float fres = pow(1.0 - ndv, 4.0);
  vec2 p = vLocal.xy / uSize;                       // -0.5..0.5
  float edgeDist = min((0.5 - abs(p.x)) * uSize.x, (0.5 - abs(p.y)) * uSize.y);
  float border = exp(-edgeDist / 0.007);
  // the acrylic tint: the light's own colour, a bit muted toward olive
  float tl = dot(uTint, vec3(0.2126, 0.7152, 0.0722));
  vec3 acrylic = mix(uTint, vec3(tl) * vec3(0.85, 1.0, 0.5), 0.55);
  // light spilling into the card from where the figure stands
  vec2 q = (p - vec2(0.0, -0.08)) * vec2(1.9, 1.25);
  float spill = exp(-dot(q, q) * 2.2);
  float grain = vnoise(vec3(vLocal.xy * 60.0, 1.0));
  float b = uBright;
  vec3 col = acrylic * (0.11 + 0.15 * spill * b + 0.015 * grain) + vec3(0.004, 0.01, 0.008);
  col += acrylic * border * 0.22 * b;
  col += vec3(0.25, 0.28, 0.3) * fres * 0.25;       // a sheen of the room on the surface
  float alpha = 0.3 + 0.45 * fres + 0.2 * border;
  if (abs(vLocalN.z) < 0.5) {                        // the thin edges: light piped through acrylic
    col = acrylic * (0.25 + 0.3 * spill) * b;
    alpha = 0.95;
  }
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}`;

// The card seen in front of the light attenuates it (multiply into the light layer).
const attenFragment = /* glsl */ `
uniform vec3 uTint;
void main() {
  float tl = dot(uTint, vec3(0.2126, 0.7152, 0.0722));
  vec3 t = mix(vec3(1.0), mix(uTint, vec3(tl), 0.2) / max(tl, 0.01), 0.35);
  gl_FragColor = vec4(clamp(t * 0.62, 0.0, 1.0), 1.0);
}`;

// Light rising out of the card: raymarched haze in the emitter frame.
const beamVertex = /* glsl */ `
varying vec3 vLocal;
void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const beamFragment = /* glsl */ `
uniform vec3 uCamLocal; uniform vec3 uBMin; uniform vec3 uBMax;
uniform vec3 uTint; uniform float uBright; uniform float uTime; uniform float uBeam; uniform float uEmerge;
uniform vec2 uCenter; uniform vec2 uRadius;
varying vec3 vLocal;
${NOISE}
float density(vec3 p) {
  vec2 q = (p.xy - uCenter) / (uRadius * (1.0 + p.z * 0.35));
  float prof = exp(-dot(q, q) * 1.8);
  float fall = exp(-p.z * 4.2) * smoothstep(0.0, 0.025, p.z);
  // rays: noise stretched along the projection axis, streaming outward
  float rays = fbm3(vec3(p.xy * 7.0, p.z * 0.9 - uTime * 0.22));
  float puffs = vnoise(vec3(p.xy * 3.0, p.z * 2.5 - uTime * 0.35));
  // fade to nothing at the proxy box so its faces never show
  vec3 lo = smoothstep(uBMin, uBMin + vec3(0.18, 0.18, 0.0), p);
  vec3 hi = 1.0 - smoothstep(uBMax - vec3(0.18, 0.18, 0.3), uBMax, p);
  float win = lo.x * lo.y * hi.x * hi.y * hi.z;
  return prof * fall * win * (0.2 + 1.4 * rays * rays * (0.6 + 0.6 * puffs));
}
void main() {
  vec3 ro = uCamLocal;
  vec3 rd = normalize(vLocal - ro);
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBMin - ro) * inv, t1 = (uBMax - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tn = max(max(tmin.x, tmin.y), tmin.z);
  float tf = min(min(tmax.x, tmax.y), tmax.z);
  tn = max(tn, 0.0);
  if (tf <= tn) discard;
  const int STEPS = 22;
  float dt = (tf - tn) / float(STEPS);
  float j = hash13(vec3(gl_FragCoord.xy, uTime * 60.0));
  float sum = 0.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (tn + (float(i) + j) * dt);
    sum += density(p) * dt;
  }
  vec3 col = uTint * sum * uBeam * uBright * 1.4 * smoothstep(0.2, 1.0, uEmerge);
  gl_FragColor = vec4(col, 0.0);
}`;

const dustVertex = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime; uniform float uSize; uniform vec2 uCenter; uniform vec2 uRadius;
varying float vB;
void main() {
  vec3 box = vec3(1.2, 1.6, 0.9);
  vec3 p = aSeed.xyz * box - vec3(box.x * 0.5, box.y * 0.5, 0.0);
  float sp = 0.012 + 0.02 * aSeed.w;
  p.y = mod(p.y + box.y * 0.5 + uTime * sp, box.y) - box.y * 0.5;
  p.z = mod(p.z + uTime * sp * 0.6, box.z);
  p += 0.025 * vec3(sin(uTime * 0.31 + aSeed.w * 40.0), sin(uTime * 0.23 + aSeed.x * 30.0), sin(uTime * 0.27 + aSeed.y * 20.0));
  vec2 q = (p.xy - uCenter) / (uRadius * (1.0 + p.z * 0.5));
  float prof = exp(-dot(q, q) * 1.4);
  float fall = exp(-p.z * 2.4);
  float tw = 0.5 + 0.5 * sin(uTime * (0.6 + aSeed.w * 1.7) + aSeed.x * 50.0);
  vB = prof * fall * (0.15 + 0.85 * tw * tw * tw);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (0.5 + aSeed.w) / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const dustFragment = /* glsl */ `
uniform vec3 uTint; uniform float uBright; uniform float uDust; uniform float uEmerge;
varying float vB;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = exp(-d * d * 18.0);
  vec3 c = mix(uTint, vec3(1.0, 0.97, 0.85), 0.35) * vB * a * uDust * uBright * 2.2 * smoothstep(0.4, 1.0, uEmerge);
  gl_FragColor = vec4(c, 0.0);
}`;

// A dim, out-of-focus room like the film's library: dark olive-grey, cooler window light.
// Over it an optional pattern, far enough behind the card that it shows through the card's
// acrylic (dimmed and tinted by it), which is what makes the card read as translucent:
//   uPattern 1 'shelves' - the library's book stacks, out of focus: rows of spines with the
//                          odd gilt title, the shelf boards catching the window light
//   uPattern 2 'grid'    - a faint drafting grid with small crosses, like a light table
// uAmt fades the pattern from nothing (0) to full (1).
export const BG_PATTERNS = ['none', 'shelves', 'grid'];

const bgFragment = /* glsl */ `
uniform vec2 uRes; uniform float uPattern; uniform float uAmt;
varying vec2 vUv;
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float softRect(vec2 p, vec2 c, vec2 h, float blur) {
  vec2 d = abs(p - c) - h;
  float o = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-blur, blur, o);
}
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

// brightness multiplier of the shelves at p (1 = the room as it was), and gilt light in .y
vec2 shelves(vec2 p) {
  float rowH = 0.21;
  float ry = (p.y + 0.06) / rowH;
  float row = floor(ry), fy = fract(ry);          // fy 0 = the board the books stand on
  // books: narrow cells of uneven width (x is warped per row), soft-edged as if out of focus
  float bx = p.x / 0.026 + row * 7.31 + 0.9 * sin(p.x * 6.0 + row * 2.1);
  float cell = floor(bx), fx = fract(bx);
  float h1 = hash21(vec2(cell, row)), h2 = hash21(vec2(cell + 17.0, row * 3.1)), h3 = hash21(vec2(row, cell * 0.37));
  float top = 0.1 + 0.62 + 0.24 * h2;              // spine height within the row
  float gap = step(0.93, h3);                     // the odd missing book
  float body = smoothstep(0.03, 0.16, fy) * (1.0 - smoothstep(top - 0.1, top + 0.06, fy));
  float seam = smoothstep(0.0, 0.45, fx) * smoothstep(1.0, 0.55, fx);
  float spine = body * (1.0 - gap) * mix(0.7, 1.0, seam) * (0.6 + 0.5 * h1);
  // the front edge of each shelf board catches the window light: long soft horizontals that
  // still read through the card's acrylic
  float board = smoothstep(0.0, 0.02, fy) * (1.0 - smoothstep(0.035, 0.075, fy));
  float m = mix(0.5, 1.0, spine) + 1.1 * board;    // deep shadow behind the books
  float gilt = body * (1.0 - gap) * step(0.6, h1) * exp(-pow((fy - top * 0.72) / 0.04, 2.0)) * seam;
  return vec2(m, gilt);
}

float grid(vec2 p) {
  float px = 1.0 / uRes.y;
  vec2 g = abs(fract(p / 0.06 + 0.5) - 0.5) * 0.06;
  float line = 1.0 - smoothstep(0.4 * px, 1.6 * px, min(g.x, g.y));
  vec2 G = abs(fract(p / 0.24 + 0.5) - 0.5) * 0.24;   // crosses every fourth line
  float cross = (1.0 - smoothstep(0.6 * px, 2.0 * px, min(G.x, G.y))) * step(max(G.x, G.y), 0.012);
  return 0.35 * line + cross;
}

void main() {
  float asp = uRes.x / uRes.y;
  vec2 p = vec2((vUv.x - 0.5) * asp, vUv.y - 0.5);
  vec3 col = mix(lin(vec3(0.09, 0.085, 0.07)), lin(vec3(0.13, 0.145, 0.15)), smoothstep(-0.5, 0.45, p.y));
  // blurred window panes and mullions
  float w = 0.0;
  for (int i = -2; i <= 2; i++) {
    float x = float(i) * 0.36 + 0.12;
    w += softRect(p, vec2(x, 0.12), vec2(0.13, 0.22), 0.09);
  }
  col += lin(vec3(0.17, 0.22, 0.25)) * w * 0.55;
  col += lin(vec3(0.1, 0.12, 0.13)) * softRect(p, vec2(0.0, -0.27), vec2(2.0, 0.015), 0.04);
  if (uPattern > 0.5 && uPattern < 1.5) {
    vec2 s = shelves(p);
    col = col * mix(1.0, s.x, uAmt) + lin(vec3(0.22, 0.18, 0.1)) * s.y * uAmt * (0.4 + w);
  } else if (uPattern > 1.5) {
    col += lin(vec3(0.2, 0.25, 0.26)) * grid(p) * uAmt * (0.6 + 0.6 * w);
  }
  float v = 1.0 - smoothstep(0.35, 1.0, length(p * vec2(0.8, 1.1)));
  col *= 0.45 + 0.55 * v;
  gl_FragColor = vec4(col, 1.0);
}`;

export function createStage(look) {
  const sh = look.shared;
  const rig = new THREE.Group();          // what the hand turns
  const { width: W, height: H, thickness: T } = CARD;

  // card body
  const geo = new THREE.BoxGeometry(W, H, T);
  const cardMat = new THREE.ShaderMaterial({
    uniforms: { uTint: sh.uLight, uBright: sh.uBright, uTime: sh.uTime, uEmerge: sh.uEmerge, uSize: { value: new THREE.Vector2(W, H) } },
    vertexShader: cardVertex, fragmentShader: cardFragment,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const card = new THREE.Mesh(geo, cardMat);
  card.layers.set(LAYERS.STAGE);
  card.renderOrder = 2;
  rig.add(card);

  // the same card, multiplying the light behind it
  const attenMat = new THREE.ShaderMaterial({
    uniforms: { uTint: sh.uLight },
    vertexShader: /* glsl */ `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: attenFragment,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const atten = new THREE.Mesh(new THREE.PlaneGeometry(W, H), attenMat);
  atten.layers.set(LAYERS.LIGHT);
  atten.renderOrder = 0;
  rig.add(atten);

  // emitter frame: the card's front surface; +Z is the way the light goes
  const emitter = new THREE.Group();
  emitter.position.z = T / 2;
  rig.add(emitter);

  // haze of light rising out of the card
  const bMin = new THREE.Vector3(-0.62, -0.74, 0.0), bMax = new THREE.Vector3(0.62, 0.74, 0.9);
  const bGeo = new THREE.BoxGeometry(bMax.x - bMin.x, bMax.y - bMin.y, bMax.z - bMin.z);
  bGeo.translate((bMin.x + bMax.x) / 2, (bMin.y + bMax.y) / 2, (bMin.z + bMax.z) / 2);
  const center = new THREE.Vector2(0, -0.05), radius = new THREE.Vector2(0.32, 0.5);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: {
      uCamLocal: { value: new THREE.Vector3() }, uBMin: { value: bMin }, uBMax: { value: bMax },
      uTint: sh.uLight, uBright: sh.uBright, uTime: sh.uTime, uBeam: sh.uBeam, uEmerge: sh.uEmerge,
      uCenter: { value: center }, uRadius: { value: radius },
    },
    vertexShader: beamVertex, fragmentShader: beamFragment,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.FrontSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  // one haze per face: the light leaves the back of the card too (mirrored along Z)
  const invM = new THREE.Matrix4();
  for (const side of [1, -1]) {
    const mat = side === 1 ? beamMat : beamMat.clone();
    if (side === -1) {   // share the live uniforms; only the camera position is per mesh
      mat.uniforms = { ...beamMat.uniforms, uCamLocal: { value: new THREE.Vector3() } };
    }
    const beam = new THREE.Mesh(bGeo, mat);
    beam.scale.z = side;
    beam.layers.set(LAYERS.LIGHT);
    beam.renderOrder = 1;
    beam.frustumCulled = false;
    beam.onBeforeRender = (r, s, cam) => {
      invM.copy(beam.matrixWorld).invert();
      mat.uniforms.uCamLocal.value.copy(cam.position).applyMatrix4(invM);
    };
    emitter.add(beam);
  }

  // dust motes caught in the light
  const N = 170;
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) seeds[i] = Math.random();
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  dGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const dustMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sh.uTime, uTint: sh.uLight, uBright: sh.uBright, uDust: sh.uDust, uEmerge: sh.uEmerge,
      uSize: { value: 6.0 }, uCenter: { value: center }, uRadius: { value: radius },
    },
    vertexShader: dustVertex, fragmentShader: dustFragment,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const dust = new THREE.Points(dGeo, dustMat);
  dust.layers.set(LAYERS.LIGHT);
  dust.renderOrder = 2;
  dust.frustumCulled = false;
  emitter.add(dust);
  const dustBack = dust.clone();   // motes in the light behind the card
  dustBack.scale.z = -1;
  dustBack.rotation.z = Math.PI;   // so the two sides don't mirror each other's motes
  emitter.add(dustBack);

  // background
  const bgMat = new THREE.ShaderMaterial({
    uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uPattern: { value: 1 }, uAmt: { value: 0.65 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: bgFragment, depthTest: false, depthWrite: false,
  });
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  bg.frustumCulled = false;
  bg.renderOrder = -10;
  bg.layers.set(LAYERS.STAGE);

  return {
    rig, card, emitter, background: bg,
    setSize(w, h, dpr) { bgMat.uniforms.uRes.value.set(w, h); dustMat.uniforms.uSize.value = 11.0 * dpr * (h / 900); },
    /** Background pattern behind the card: one of BG_PATTERNS, amount 0..1. */
    setBackground(pattern, amount) {
      const i = BG_PATTERNS.indexOf(pattern);
      if (i >= 0) bgMat.uniforms.uPattern.value = i;
      if (amount != null) bgMat.uniforms.uAmt.value = amount;
    },
  };
}
