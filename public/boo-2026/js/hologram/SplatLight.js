// SplatLight: the light look for Gaussian splats (Spark SplatMesh objects).
//
// HologramLook hands it any SplatMesh it finds under a subject. It owns one SparkRenderer
// (drawn on the subject layer, so the splats land in the look's light layer like a mesh would)
// with the light fragment shader, and gives each SplatMesh a modifier that turns its splats
// into light. Everything after that (time behaviour, ghosting, chromatic split, glow,
// composite) is the look's ordinary post chain; nothing there knows splats are involved.
//
// Translation from the mesh material:
//   colour ramp   -> per splat, from the splat's own (captured) brightness
//   form          -> already in the captured colour; not added again
//   rim, soft edge-> per splat, from the outward direction of a blurred solid volume of the splats
//   scan lines    -> per pixel, at the pixel's position on the card's axes
//   rise          -> per splat, depth along the card normal scaled 0..1
//   inner volume  -> the far side shows through: occlusion reduced by `inner`
//   depth         -> a second, depth-only pass of the solid core of each splat

import * as THREE from 'three';
import { SparkRenderer, dyno } from '@sparkjsdev/spark';
import { readSplats, splatSolid } from '../splat/data.js';
import * as S from './shaders.js';

const LUMA = [0.2126, 0.7152, 0.0722];
const toLin = (c) => Math.pow(Math.max(c, 0), 2.2);

// Blurred solid volume of the figure, object space, as a 3D texture.
function solidVolume(mesh, res = 56) {
  const g = splatSolid([mesh], () => new THREE.Matrix4(), { res, fit: 'xyz', minOpacity: 0.2, maxZ: 1 });
  const { nx, ny, nz, cell, origin } = g;
  let a = Float32Array.from(g.solid), b = new Float32Array(a.length);
  const dims = [nx, ny, nz], strides = [1, nx, nx * ny];
  for (let pass = 0; pass < 2; pass++) {
    for (let ax = 0; ax < 3; ax++) {
      const s = strides[ax], dim = dims[ax];
      for (let v = 0; v < a.length; v++) {
        const c = Math.floor(v / s) % dim;
        b[v] = (a[v] + (c > 0 ? a[v - s] : a[v]) + (c < dim - 1 ? a[v + s] : a[v])) / 3;
      }
      [a, b] = [b, a];
    }
  }
  const data = new Uint8Array(a.length);
  for (let v = 0; v < a.length; v++) data[v] = Math.round(Math.min(1, a[v]) * 255);
  const tex = new THREE.Data3DTexture(data, nx, ny, nz);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  const size = new THREE.Vector3(nx, ny, nz).multiplyScalar(cell);
  return {
    tex,
    min: origin.clone(),
    inv: new THREE.Vector3(1 / size.x, 1 / size.y, 1 / size.z),
    texel: new THREE.Vector3(1 / nx, 1 / ny, 1 / nz),
  };
}

export class SplatLight {
  constructor(look, layer) {
    this.look = look;
    this.layer = layer;
    this.items = [];
    const sh = look.shared;
    this.uniforms = {
      uNdcToEm: { value: new THREE.Matrix4() },
      uTime: sh.uTime, uScan: sh.uScan, uScanFreq: sh.uScanFreq, uBand: sh.uBand, uInner: sh.uInner,
      uDepthAlpha: { value: 0.3 },
      uWindow: { value: new THREE.Vector2() },
      uWindowEye: { value: new THREE.Vector3() },
    };
    this.spark = new SparkRenderer({
      renderer: look.renderer,
      accumExtSplats: true,          // float colour in the accumulator: the light is HDR
      fragmentShader: S.splatFragment,
      extraUniforms: this.uniforms,
    });
    this.spark.layers.set(layer);
    this.spark.renderOrder = 1;
    this.spark.userData.holoInner = true;   // a helper, not part of any subject
    this.colorMaterial = this.spark.material;
    this.depthMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: this.colorMaterial.vertexShader,
      fragmentShader: S.splatFragment,
      uniforms: this.colorMaterial.uniforms,
      defines: { HOLO_DEPTH: '' },
      transparent: false, depthTest: true, depthWrite: true, colorWrite: false,
      side: THREE.DoubleSide,
    });
    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
  }

  /** Turn one SplatMesh into light. `entry` is the look's subject record (fadeY etc.). */
  attach(mesh, entry, options = {}) {
    const d = readSplats(mesh);
    // the subject's average brightness maps to the middle of the ramp, as for meshes
    let sum = 0, wsum = 0;
    const step = Math.max(1, Math.floor(d.n / 200000));
    for (let i = 0; i < d.n; i += step) {
      const o = d.opacity[i];
      if (o <= 0) continue;
      const c = d.color;
      sum += o * (LUMA[0] * toLin(c[i * 3]) + LUMA[1] * toLin(c[i * 3 + 1]) + LUMA[2] * toLin(c[i * 3 + 2]));
      wsum += o;
    }
    const avg = wsum ? sum / wsum : 0.3;
    const vol = solidVolume(mesh);

    const u = {
      objToEm: dyno.dynoMat4(new THREE.Matrix4()),
      emToObj: dyno.dynoMat4(new THREE.Matrix4()),
      camEm: dyno.dynoVec3(new THREE.Vector3()),
      time: dyno.dynoFloat(0),
      depthScale: dyno.dynoFloat(1),
      emerge: dyno.dynoFloat(1),
      tint: dyno.dynoVec3(new THREE.Vector3()),
      shadowTint: dyno.dynoVec3(new THREE.Vector3()),
      light: dyno.dynoVec3(new THREE.Vector3()),
      p0: dyno.dynoVec4(new THREE.Vector4()),   // exposure*albedoNorm, play, keepColor, rim
      p1: dyno.dynoVec4(new THREE.Vector4()),   // edgeSoft, baseFade, black point, form
      p2: dyno.dynoVec4(new THREE.Vector4()),   // tint, photo exposure, -, -
      fadeY: dyno.dynoVec2(entry.fadeY.clone()),
      dens: dyno.dynoSampler3D(vol.tex),
      volMin: dyno.dynoVec3(vol.min),
      volInv: dyno.dynoVec3(vol.inv),
      volTexel: dyno.dynoVec3(vol.texel),
    };
    const inTypes = {
      gsplat: dyno.Gsplat, objToEm: 'mat4', emToObj: 'mat4', camEm: 'vec3', time: 'float',
      depthScale: 'float', emerge: 'float', tint: 'vec3', shadowTint: 'vec3', light: 'vec3', p0: 'vec4', p1: 'vec4', p2: 'vec4',
      fadeY: 'vec2', dens: 'sampler3D', volMin: 'vec3', volInv: 'vec3', volTexel: 'vec3',
    };
    // a page can replace the rise with its own per-splat timing (rise.html, js/rise/Rise.js)
    const rise = this.look.splatRise;
    if (rise) { Object.assign(u, rise.uniforms); Object.assign(inTypes, rise.types); }
    mesh.objectModifier = dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
      const light = new dyno.Dyno({
        inTypes,
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => (rise ? [S.splatGlobals, rise.globals] : [S.splatGlobals]),
        statements: ({ inputs, outputs }) => {
          const v = { ...inputs, out: outputs.gsplat };
          return dyno.unindentLines(`{\n${S.splatStatements({ ...v, rise: rise?.statements(v) })}\n}`);
        },
      });
      return { gsplat: light.apply({ ...u, gsplat }).gsplat };
    });
    mesh.updateGenerator();
    mesh.layers.set(this.layer);
    mesh.frustumCulled = false;
    this.items.push({
      mesh, u, entry, vol,
      // the mesh's average comes out near 0.6 after its form shading; a capture's colour already
      // carries most of its form, so it gets less shading and a lower level to match
      albedoNorm: 0.7 / Math.max(avg, 0.02),
      baseFade: options.baseFade ?? 0.1,
      black: options.blackPoint ?? 0.012,
    });
    return this.spark;
  }

  detach(mesh) {
    const i = this.items.findIndex((it) => it.mesh === mesh);
    if (i < 0) return;
    const it = this.items[i];
    mesh.objectModifier = undefined;
    mesh.updateGenerator();
    it.vol.tex.dispose();
    this.items.splice(i, 1);
  }

  /** Per frame, before the light layer is drawn. */
  beforeRender(camera) {
    const look = this.look, sh = look.shared, p = look.params;
    const emInv = sh.uEmitterInv.value;
    camera.updateMatrixWorld();
    this.uniforms.uNdcToEm.value.copy(emInv).multiply(camera.matrixWorld).multiply(camera.projectionMatrixInverse);
    const camEm = this._v.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(emInv);
    this.uniforms.uWindowEye.value.copy(camEm);
    if (look.splatRise) this.uniforms.uWindow.value.copy(look.splatRise.uniforms.rWindow.value);
    for (const it of this.items) {
      const { mesh, u } = it;
      mesh.updateMatrixWorld();
      u.objToEm.value.copy(emInv).multiply(mesh.matrixWorld);
      u.emToObj.value.copy(u.objToEm.value).invert();
      u.camEm.value.copy(camEm);
      u.time.value = sh.uTime.value;
      u.depthScale.value = sh.uDepthScale.value;
      u.emerge.value = look.splatRise ? 1 : sh.uEmerge.value;   // uEmerge then only times the card's glow
      u.tint.value.copy(sh.uTint.value);
      u.shadowTint.value.copy(sh.uShadowTint.value);
      u.light.value.copy(sh.uLight.value);
      u.p0.value.set(p.intensity * it.albedoNorm, p.play, p.keepColor, p.rim);
      u.p1.value.set(p.edgeSoft, it.baseFade, it.black, p.form * 0.5);
      u.p2.value.set(p.tint, p.intensity, 0, 0);   // photo colours at the capture's own level, as the mesh
      u.fadeY.value.copy(it.entry.fadeY);
      mesh.updateVersion();   // regenerate: time, view and the rise change every frame
    }
  }

  /** Depth of the figure's solid core into the current target, so the light layer can test against it. */
  renderDepth(renderer, scene, camera) {
    const s = this.spark;
    const auto = s.autoUpdate;
    s.autoUpdate = false;
    s.material = this.depthMaterial;
    renderer.render(scene, camera);
    s.material = this.colorMaterial;
    s.autoUpdate = auto;
  }

  dispose() {
    for (const it of [...this.items]) this.detach(it.mesh);
    this.spark.removeFromParent();
    this.spark.dispose();
    this.depthMaterial.dispose();
  }
}
