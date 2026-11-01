// HologramLook: makes any Object3D read as projected light.
//
//   const look = new HologramLook(renderer);
//   look.setEmitter(cardFrame);     // the surface the light comes out of (+Z = outward)
//   await look.apply(anyObject3D);  // meshes: swap materials for light, keeping their textures;
//                                   // Gaussian splats (Spark SplatMesh): see SplatLight.js
//   loop: look.update(t, dt); look.render(scene, camera);
//
// The look owns: the subject material, the light-layer render, the time behaviour
// (LightSignal), ghosting, chromatic split, glow and the final composite. It does not
// know what the subject is, and it does not own the card. Other things that are made of
// the same light (beam, dust) live on LAYERS.LIGHT and can read `look.shared` uniforms.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LightSignal } from './LightSignal.js';
import * as S from './shaders.js';
import { isSplatMesh, splatBounds } from '../splat/data.js';

export const LAYERS = { STAGE: 0, SUBJECT: 1, LIGHT: 2 };

export const DEFAULT_PARAMS = {
  tint: 1,               // 0 = the subject's own photo colours, 1 = recoloured in the light's hue;
                         // glow, flicker, ghosting and the chromatic split apply at every value
  hue: 50,               // degrees, sRGB HSV hue of the light (52 = the film's lemon yellow)
  saturation: 0.75,
  intensity: 1.0,        // exposure of the light
  glow: 1.0,            // halo / bloom
  density: 0.62,         // how much the light hides what is behind it
  rim: 0.45,
  form: 0.6,             // 0 = flat emitted light, 1 = strongly modelled like a lit object
  keepColor: 0.3,        // how much of the subject's own colour survives
  softness: 0.32,
  flickerRate: 9,        // flicker events per minute (irregular, Poisson with pairs)
  flickerIntensity: 0.7,
  breathing: 0.5,        // calm-state luminance drift
  scanlines: 0.16,
  scanDensity: 110,      // lines per emitter unit
  echo: 0.32,            // ghost copies of where the figure was a moment ago
  chromatic: 0.35,
  play: 0.55,            // slow interference flowing over the form
  inner: 0.22,           // far side of the form glowing through the near side
  edgeSoft: 0.7,         // silhouette thins out instead of ending on a hard line
  beam: 0.4,
  dust: 0.45,
};

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360 / 60;
  const c = v * s, x = c * (1 - Math.abs((h % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 1) [r, g, b] = [c, x, 0]; else if (h < 2) [r, g, b] = [x, c, 0];
  else if (h < 3) [r, g, b] = [0, c, x]; else if (h < 4) [r, g, b] = [0, x, c];
  else if (h < 5) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}
// the light's own colour when the subject keeps its photo colours: a pale, slightly cool white,
// a little dimmer than the tint so its haze doesn't veil the photo
const NEUTRAL_LIGHT = [0.6, 0.67, 0.78];
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function averageLuminance(tex) {
  try {
    const img = tex && tex.image;
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 48, 48);
    const d = g.getImageData(0, 0, 48, 48).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      s += 0.2126 * srgbToLin(d[i] / 255) + 0.7152 * srgbToLin(d[i + 1] / 255) + 0.0722 * srgbToLin(d[i + 2] / 255);
      n++;
    }
    return n ? s / n : null;
  } catch (e) { return null; }
}

export class HologramLook {
  constructor(renderer, params = {}) {
    this.renderer = renderer;
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.signal = new LightSignal();
    this.emitter = null;
    this.subjects = [];
    this.time = 0;

    this.shared = {
      uTime: { value: 0 },
      uTint: { value: new THREE.Vector3(1, 0.8, 0.06) },
      uShadowTint: { value: new THREE.Vector3(1, 0.4, 0.03) },
      uTintAmt: { value: 1 },                          // params.tint
      uLight: { value: new THREE.Vector3(1, 0.8, 0.06) },  // colour of the light itself (rim, haze,
                                                           // card glow): the tint, or near white at tint 0
      uBright: { value: 1 },
      uEmerge: { value: 1 },
      uDepthScale: { value: 1 },
      uEmitter: { value: new THREE.Matrix4() },
      uEmitterInv: { value: new THREE.Matrix4() },
      uExposure: { value: 1 },
      uRim: { value: 0.45 },
      uScan: { value: 0.16 },
      uScanFreq: { value: 110 },
      uBand: { value: -10 },
      uPlay: { value: 0.5 },
      uKeepColor: { value: 0.3 },
      uBeam: { value: 0.35 },
      uDust: { value: 0.45 },
      uEdgeSoft: { value: 0.6 },
      uForm: { value: 0.6 },
      uInner: { value: 0.2 },
    };

    this.emergence = { start: -1, delay: 0, duration: 2.6 };
    this.ring = [];
    this.ringTimes = [];
    this.ringIdx = 0;
    this.size = new THREE.Vector2(1, 1);
    this.center = new THREE.Vector2(0.5, 0.5);
    this.centerWorld = new THREE.Vector3();

    this._makeTargets();
    this._makePasses();
  }

  // ---------------------------------------------------------------- setup
  setEmitter(obj) { this.emitter = obj; }

  /**
   * Turn every mesh and every Gaussian-splat object under `root` into light.
   * options.map / options.normalMap override textures the meshes carry.
   * options.fadeBottom: fraction of the subject's height (from the bottom, in emitter
   *   space) over which the light thins out to nothing, like a bust cut-off.
   * Async because the splat path loads Spark only when a splat object is present.
   */
  async apply(root, options = {}) {
    root.updateMatrixWorld(true);
    const box = this._emitterBox(root);
    const h = box.max.y - box.min.y;
    const fade = options.fadeBottom ?? 0.18;
    const entry = { root, meshes: [], splats: [], fadeY: new THREE.Vector2(box.min.y, box.min.y + h * fade), box };

    const meshes = [], splats = [];
    root.traverse((o) => {
      if (isSplatMesh(o)) splats.push(o);
      else if (o.isMesh && !o.userData.holoInner) meshes.push(o);
    });
    if (splats.length) {
      if (!this.splatLight) {
        const { SplatLight } = await import('./SplatLight.js');
        this.splatLight = new SplatLight(this, LAYERS.SUBJECT);
      }
      for (const o of splats) this.splatLight.attach(o, entry, options);
      entry.splats = splats;
      if (!this.splatLight.spark.parent) root.add(this.splatLight.spark);
      // MSAA buys nothing for blended Gaussians and multiplies their (heavy) blending cost
      if (this.holoRT.samples) { this.holoRT.samples = 0; this.holoRT.dispose(); }
    }
    for (const o of meshes) {
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      const map = options.map ?? src?.map ?? null;
      const normalMap = options.normalMap ?? src?.normalMap ?? null;
      if (map) map.colorSpace = THREE.SRGBColorSpace;
      const base = new THREE.Color(1, 1, 1);
      if (src?.color && !options.map) base.copy(src.color);
      if (options.map) base.set(1, 1, 1);
      let avg = averageLuminance(map);
      const baseLum = 0.2126 * base.r + 0.7152 * base.g + 0.0722 * base.b;
      avg = (avg ?? 1) * baseLum;

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...this.shared,
          uBaseColor: { value: base },
          uAlbedoNorm: { value: 1.0 / Math.max(avg, 0.02) },
          uFadeY: { value: entry.fadeY },
          uBaseFade: { value: options.baseFade ?? 0.1 },
          uKeyDir: { value: new THREE.Vector3(-0.45, 0.55, 1.0).normalize() },
          uNormalScale: { value: options.normalScale ?? 0.35 },
          map: { value: map },
          normalMap: { value: normalMap },
        },
        vertexShader: S.subjectVertex,
        fragmentShader: S.subjectFragment,
        side: THREE.FrontSide,
        blending: THREE.NoBlending,
        depthWrite: true,
        depthTest: true,
      });
      if (map) mat.defines.USE_HOLO_MAP = '';
      if (normalMap) mat.defines.USE_HOLO_NORMALMAP = '';
      if (o.geometry.attributes.color) mat.vertexColors = true;
      mat.extensions = { derivatives: true };

      o.userData.holoOriginalMaterial = o.material;
      o.material = mat;
      o.layers.set(LAYERS.SUBJECT);
      o.frustumCulled = false;
      entry.meshes.push(o);

      // the far side of the form, added faintly through the near side (plain meshes only)
      if (!o.isSkinnedMesh) {
        const innerMat = mat.clone();
        innerMat.uniforms = mat.uniforms;
        innerMat.defines = { ...mat.defines, HOLO_INNER: '' };
        innerMat.side = THREE.BackSide;
        innerMat.depthTest = false;
        innerMat.depthWrite = false;
        innerMat.transparent = true;
        innerMat.blending = THREE.CustomBlending;
        innerMat.blendEquation = THREE.AddEquation;
        innerMat.blendSrc = THREE.OneFactor; innerMat.blendDst = THREE.OneFactor;
        innerMat.blendSrcAlpha = THREE.ZeroFactor; innerMat.blendDstAlpha = THREE.OneFactor;
        const inner = new THREE.Mesh(o.geometry, innerMat);
        inner.layers.set(LAYERS.LIGHT);
        inner.renderOrder = -1;
        inner.frustumCulled = false;
        inner.userData.holoInner = true;
        o.add(inner);
        entry.inners = entry.inners || [];
        entry.inners.push(inner);
      }
    }
    this.subjects.push(entry);
    return entry;
  }

  /** Give the object back its original materials. */
  remove(root) {
    const i = this.subjects.findIndex((s) => s.root === root);
    if (i < 0) return;
    for (const o of this.subjects[i].splats || []) this.splatLight.detach(o);
    if (this.splatLight?.spark.parent === root) this.splatLight.spark.removeFromParent();
    for (const inner of this.subjects[i].inners || []) { inner.removeFromParent(); inner.material.dispose(); }
    for (const m of this.subjects[i].meshes) {
      m.material.dispose();
      m.material = m.userData.holoOriginalMaterial;
      m.layers.set(LAYERS.STAGE);
    }
    this.subjects.splice(i, 1);
  }

  _emitterBox(root) {
    const inv = new THREE.Matrix4();
    if (this.emitter) { this.emitter.updateMatrixWorld(true); inv.copy(this.emitter.matrixWorld).invert(); }
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    root.traverse((o) => {
      if (isSplatMesh(o)) { box.union(splatBounds(o, m.multiplyMatrices(inv, o.matrixWorld))); return; }
      if (!o.isMesh || o.userData.holoInner) return;
      const p = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(p.count / 4000));
      for (let i = 0; i < p.count; i += step) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
        box.expandByPoint(v);
      }
    });
    return box;
  }

  /** Play the rise out of the card: the flat photograph pushes out into full depth. */
  emerge({ delay = 0.4, duration = 2.6 } = {}) {
    this.emergence = { start: this.time, delay, duration, ignited: false };
    this.shared.uDepthScale.value = 0;
    this.shared.uEmerge.value = 0;
  }

  triggerFlicker(type) { this.signal.trigger(type); }

  // ---------------------------------------------------------------- targets / passes
  _rt(w, h, opts = {}) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: !!opts.depth,
      samples: opts.samples || 0,
    });
  }

  _makeTargets() {
    this.sceneRT = this._rt(1, 1, { depth: true, samples: 4 });
    this.holoRT = this._rt(1, 1, { depth: true, samples: 4 });
    this.litRT = this._rt(1, 1);
    this.down = [this._rt(1, 1), this._rt(1, 1), this._rt(1, 1), this._rt(1, 1), this._rt(1, 1)];
    this.up = [this._rt(1, 1), this._rt(1, 1), this._rt(1, 1), this._rt(1, 1)];
    for (let i = 0; i < 12; i++) { this.ring.push(this._rt(1, 1)); this.ringTimes.push(-1e9); }
  }

  _quad(fragmentShader, uniforms) {
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: S.quadVertex, fragmentShader,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    return new FullScreenQuad(mat);
  }

  _makePasses() {
    this.copyPass = this._quad(S.copyFragment, { tSrc: { value: null } });
    this.lightPass = this._quad(S.lightFragment, {
      tHolo: { value: null }, tEcho1: { value: null }, tEcho2: { value: null },
      uRes: { value: new THREE.Vector2() }, uCenter: { value: this.center },
      uJitter: { value: new THREE.Vector2() }, uBright: { value: 1 }, uHue: { value: 0 },
      uHueMix: { value: 0 }, uDesat: { value: 0 }, uChroma: { value: 0 }, uEcho1: { value: 0 }, uEcho2: { value: 0 },
      uGhostOff: { value: new THREE.Vector2() },
    });
    this.downPass = this._quad(S.downFragment, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upPass = this._quad(S.upFragment, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.compositePass = this._quad(S.compositeFragment, {
      tScene: { value: null }, tLit: { value: null }, tSoft: { value: null }, tGlow: { value: null },
      uDensity: { value: 0.7 }, uGlow: { value: 0.8 }, uSoft: { value: 0.2 }, uTime: { value: 0 },
      uRes: { value: new THREE.Vector2() },
    });
  }

  setSize(w, h, dpr) {
    const W = Math.max(1, Math.floor(w * dpr)), H = Math.max(1, Math.floor(h * dpr));
    this.size.set(W, H);
    this.sceneRT.setSize(W, H);
    this.holoRT.setSize(W, H);
    this.litRT.setSize(W, H);
    let dw = W, dh = H;
    for (let i = 0; i < this.down.length; i++) {
      dw = Math.max(1, dw >> 1); dh = Math.max(1, dh >> 1);
      this.down[i].setSize(dw, dh);
      if (i < this.up.length) this.up[i].setSize(dw, dh);
    }
    for (const r of this.ring) r.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.lightPass.material.uniforms.uRes.value.set(W, H);
    this.compositePass.material.uniforms.uRes.value.set(W, H);
    this.dpr = dpr;
  }

  // ---------------------------------------------------------------- per frame
  update(t, dt) {
    this.time = t;
    const p = this.params;
    const sh = this.shared;

    // colours from hue / saturation (sRGB HSV, converted to linear)
    const tint = hsvToRgb(p.hue, p.saturation, 1).map(srgbToLin);
    const shadow = hsvToRgb(p.hue - 18, Math.min(1, p.saturation + 0.08), 1).map(srgbToLin);
    sh.uTint.value.set(...tint);
    sh.uShadowTint.value.set(...shadow);
    sh.uTintAmt.value = p.tint;
    sh.uLight.value.set(...NEUTRAL_LIGHT).lerp(sh.uTint.value, p.tint);

    sh.uTime.value = t;
    sh.uExposure.value = p.intensity;
    sh.uRim.value = p.rim;
    sh.uScan.value = p.scanlines;
    sh.uScanFreq.value = p.scanDensity;
    sh.uPlay.value = p.play;
    sh.uKeepColor.value = p.keepColor;
    sh.uBeam.value = p.beam;
    sh.uDust.value = p.dust;
    sh.uInner.value = p.inner;
    sh.uEdgeSoft.value = p.edgeSoft;
    sh.uForm.value = p.form;

    // emergence
    const em = this.emergence;
    if (em.start >= 0) {
      const k = Math.min(1, Math.max(0, (t - em.start - em.delay) / em.duration));
      if (k > 0 && !em.ignited) { em.ignited = true; this.signal.trigger('ignite'); }
      const ease = 1 - Math.pow(1 - k, 3);
      sh.uEmerge.value = Math.min(1, k * 1.6);
      sh.uDepthScale.value = ease;
      if (k >= 1) em.start = -1;
    }

    const s = this.signal.update(t, dt, p);
    sh.uBright.value = s.bright;
    sh.uBand.value = s.band;

    if (this.emitter) {
      sh.uEmitter.value.copy(this.emitter.matrixWorld);
      sh.uEmitterInv.value.copy(this.emitter.matrixWorld).invert();
    }
    return s;
  }

  _pickEcho(delay) {
    const target = this.time - delay;
    let best = 0, bestD = 1e9;
    for (let i = 0; i < this.ring.length; i++) {
      const d = Math.abs(this.ringTimes[i] - target);
      if (d < bestD) { bestD = d; best = i; }
    }
    return this.ring[best].texture;
  }

  render(scene, camera) {
    const r = this.renderer;
    const p = this.params;
    const s = this.signal.state;
    const prevAuto = r.autoClear;
    const prevBg = scene.background;
    const savedMask = camera.layers.mask;
    r.setClearColor(0x000000, 0);

    // 1. stage (background, card) ------------------------------------------
    camera.layers.set(LAYERS.STAGE);
    r.setRenderTarget(this.sceneRT);
    r.autoClear = true;
    r.render(scene, camera);

    // 2. light layer: the subject as light (nearest surface only) ----------
    scene.background = null;
    camera.layers.set(LAYERS.SUBJECT);
    this.splatLight?.beforeRender(camera);
    r.setRenderTarget(this.holoRT);
    r.clear(true, true, true);
    r.render(scene, camera);
    // splats blend without depth; lay down the depth of their solid core afterwards
    r.autoClear = false;
    if (this.splatLight?.items.length) this.splatLight.renderDepth(r, scene, camera);
    // then things made of the same light, and the card attenuating light seen through it
    camera.layers.set(LAYERS.LIGHT);
    r.autoClear = false;
    r.render(scene, camera);
    r.autoClear = true;
    scene.background = prevBg;
    camera.layers.mask = savedMask;

    // 3. remember this frame for ghosting (half res ring) -------------------
    this.ringIdx = (this.ringIdx + 1) % this.ring.length;
    this.copyPass.material.uniforms.tSrc.value = this.holoRT.texture;
    r.setRenderTarget(this.ring[this.ringIdx]);
    this.copyPass.render(r);
    this.ringTimes[this.ringIdx] = this.time;

    // screen-space centre of the subject for the chromatic split
    if (this.subjects.length) {
      const sub = this.subjects[0];
      sub.box.getCenter(this.centerWorld);
      if (this.emitter) this.centerWorld.applyMatrix4(this.emitter.matrixWorld);
      this.centerWorld.project(camera);
      this.center.set(this.centerWorld.x * 0.5 + 0.5, this.centerWorld.y * 0.5 + 0.5);
    }

    // 4. light pass: flicker, hue jumps, chromatic split, ghosts -------------
    const lu = this.lightPass.material.uniforms;
    lu.tHolo.value = this.holoRT.texture;
    lu.tEcho1.value = this._pickEcho(0.075);
    lu.tEcho2.value = this._pickEcho(0.16);
    lu.uBright.value = s.bright;
    lu.uHue.value = s.hue / 360;
    lu.uHueMix.value = s.hueMix;
    lu.uDesat.value = s.desat;
    const dpr = this.dpr || 1;
    lu.uChroma.value = (0.6 + 3.5 * s.chroma) * p.chromatic * dpr;
    lu.uJitter.value.set(s.jx * dpr, s.jy * dpr);
    lu.uEcho1.value = Math.min(1, p.echo * (0.55 + 1.2 * s.echo));
    lu.uEcho2.value = Math.min(1, p.echo * (0.3 + 0.9 * s.echo));
    const go = 0.03 * s.ghost * p.echo;
    lu.uGhostOff.value.set(s.ghostDirX * go * (this.size.y / this.size.x), s.ghostDirY * go);
    r.setRenderTarget(this.litRT);
    this.lightPass.render(r);

    // 5. glow --------------------------------------------------------------
    let src = this.litRT;
    for (let i = 0; i < this.down.length; i++) {
      this.downPass.material.uniforms.tSrc.value = src.texture;
      this.downPass.material.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      r.setRenderTarget(this.down[i]);
      this.downPass.render(r);
      src = this.down[i];
    }
    let low = this.down[this.down.length - 1];
    for (let i = this.up.length - 1; i >= 0; i--) {
      this.upPass.material.uniforms.tLow.value = low.texture;
      this.upPass.material.uniforms.tHigh.value = this.down[i].texture;
      this.upPass.material.uniforms.uTexel.value.set(1 / low.width, 1 / low.height);
      r.setRenderTarget(this.up[i]);
      this.upPass.render(r);
      low = this.up[i];
    }

    // 6. composite to screen -------------------------------------------------
    const cu = this.compositePass.material.uniforms;
    cu.tScene.value = this.sceneRT.texture;
    cu.tLit.value = this.litRT.texture;
    cu.tSoft.value = this.down[0].texture;
    cu.tGlow.value = this.up[0].texture;
    cu.uDensity.value = p.density;
    cu.uGlow.value = p.glow;
    cu.uSoft.value = p.softness;
    cu.uTime.value = this.time;
    r.setRenderTarget(null);
    this.compositePass.render(r);
    r.autoClear = prevAuto;
  }
}
