// Splat subjects: load a Gaussian-splat file with Spark, stand it upright, drop its background.
//
// Everything downstream (fit, card placement, the light look) reads the per-splat data cached
// here on the SplatMesh as `userData.holoSplats`, and sees dropped splats as opacity 0.

import * as THREE from 'three';

import { readSplats, isSplatMesh, quantiles, splatBounds } from '../splat/data.js';

export { readSplats, isSplatMesh };

const SPLAT_EXT = /\.(spz|ply|splat|ksplat|sog)(\?|#|$)/i;
export const isSplatUrl = (url) => SPLAT_EXT.test(url);

/**
 * Load a splat file. `flip` turns y-down / z-forward captures (most Spark samples, OpenCV-convention
 * output such as Apple SHARP) into three.js y-up, facing +Z.
 */
export async function loadSplat(url, { flip = true, clean = true, onProgress, ...cleanOpts } = {}) {
  const { SplatMesh } = await import('@sparkjsdev/spark');
  const mesh = new SplatMesh({ url, lod: false, onProgress });
  await mesh.initialized;
  if (flip) mesh.quaternion.set(1, 0, 0, 0);
  const data = readSplats(mesh);
  const report = clean ? dropBackground(mesh, cleanOpts) : null;
  return { mesh, data, report };
}

/**
 * Drop what isn't the subject. Generic, no knowledge of any particular capture:
 *  1. near-invisible splats (opacity below `minOpacity`): haze and training leftovers;
 *  2. everything not connected to the main dense cluster. Splat density (opacity per voxel)
 *     is highest on the subject: object captures pile their splats onto the object, and
 *     single-photo captures spend tiny splats on the near subject while the backdrop gets
 *     fewer, larger ones. Flood-fill from the densest voxel through voxels that hold at least
 *     `keep` x the core density; floaters, backdrops and the stretched "skirt" splats between
 *     a subject and its backdrop are too thin to carry the fill;
 *  3. a support surface: a layer at the bottom that spreads well past the footprint of the
 *     subject standing on it (a table top, a floor). See dropSupport.
 * Dropped splats get opacity 0 in the packed data (Spark skips them) and in the cache.
 */
export function dropBackground(mesh, { minOpacity = 0.03, keep = 0.05, grid = 64, support = true, only = Infinity } = {}) {
  const d = readSplats(mesh);
  const { center: C, opacity: O } = d;
  const n = Math.min(d.n, only);   // `only`: clean the first splats of the file and leave the rest alone
  const t0 = performance.now();

  // robust bounds of the visible splats (a subsample is plenty)
  const step = Math.max(1, Math.floor(n / 150000));
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < n; i += step) {
    if (O[i] < 0.1) continue;
    xs.push(C[i * 3]); ys.push(C[i * 3 + 1]); zs.push(C[i * 3 + 2]);
  }
  const F = [0.002, 0.998];
  const [x0, x1] = quantiles(xs, F), [y0, y1] = quantiles(ys, F), [z0, z1] = quantiles(zs, F);
  const ext = Math.max(x1 - x0, y1 - y0, z1 - z0) || 1;
  const cell = ext / grid;
  const pad = 2;
  const nx = Math.ceil((x1 - x0) / cell) + 2 * pad, ny = Math.ceil((y1 - y0) / cell) + 2 * pad, nz = Math.ceil((z1 - z0) / cell) + 2 * pad;
  const ox = x0 - pad * cell, oy = y0 - pad * cell, oz = z0 - pad * cell;
  const N = nx * ny * nz;
  const voxOf = new Int32Array(n);
  const dens = new Float32Array(N);
  for (let i = 0; i < n; i++) {
    const ix = Math.floor((C[i * 3] - ox) / cell), iy = Math.floor((C[i * 3 + 1] - oy) / cell), iz = Math.floor((C[i * 3 + 2] - oz) / cell);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz || O[i] < minOpacity) { voxOf[i] = -1; continue; }
    const v = (iz * ny + iy) * nx + ix;
    voxOf[i] = v;
    dens[v] += O[i];
  }
  // 3x3x3 box blur, separable
  const blur = (src) => {
    let a = src, b = new Float32Array(N);
    const strides = [1, nx, nx * ny], dims = [nx, ny, nz];
    for (let ax = 0; ax < 3; ax++) {
      const s = strides[ax];
      for (let v = 0; v < N; v++) {
        const c = Math.floor(v / s) % dims[ax];
        b[v] = (a[v] + (c > 0 ? a[v - s] : 0) + (c < dims[ax] - 1 ? a[v + s] : 0)) / 3;
      }
      [a, b] = [b, a];
    }
    return a;
  };
  const sm = blur(dens);

  // core density: the level above which half of all splat mass sits
  const occ = [];
  let total = 0, best = 0;
  for (let v = 0; v < N; v++) if (sm[v] > 0) { occ.push(sm[v]); total += sm[v]; if (sm[v] > sm[best]) best = v; }
  occ.sort((a, b) => b - a);
  let acc = 0, core = occ[0];
  for (const x of occ) { acc += x; if (acc >= total * 0.5) { core = x; break; } }
  const floor = keep * core;

  // flood fill (26-connected) from the densest voxel
  const inMain = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  inMain[best] = 1; queue[qt++] = best;
  while (qh < qt) {
    const v = queue[qh++];
    const ix = v % nx, iy = Math.floor(v / nx) % ny, iz = Math.floor(v / (nx * ny));
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const jx = ix + dx, jy = iy + dy, jz = iz + dz;
      if (jx < 0 || jy < 0 || jz < 0 || jx >= nx || jy >= ny || jz >= nz) continue;
      const w = (jz * ny + jy) * nx + jx;
      if (inMain[w] || sm[w] < floor) continue;
      inMain[w] = 1; queue[qt++] = w;
    }
  }

  // A big splat counts once but fills many voxels: the few large, opaque splats that fill a
  // capture's interior land in "thin" voxels. Keep such a splat when the cluster surrounds it
  // (cluster voxels on both sides along at least two axes, within its extent). A table top or
  // backdrop splat that merely touches the subject has the subject on one side only.
  const S = d.scale;
  const enclosed = (i) => {
    const r = Math.max(S[i * 3], S[i * 3 + 1], S[i * 3 + 2]);
    if (r < cell * 0.5) return false;
    const k = Math.min(6, Math.ceil(r / cell));
    const ix = Math.floor((C[i * 3] - ox) / cell), iy = Math.floor((C[i * 3 + 1] - oy) / cell), iz = Math.floor((C[i * 3 + 2] - oz) / cell);
    let sides = 0;   // bits: -x +x -y +y -z +z
    for (let jz = Math.max(0, iz - k); jz <= Math.min(nz - 1, iz + k); jz++)
      for (let jy = Math.max(0, iy - k); jy <= Math.min(ny - 1, iy + k); jy++)
        for (let jx = Math.max(0, ix - k); jx <= Math.min(nx - 1, ix + k); jx++) {
          if (!inMain[(jz * ny + jy) * nx + jx]) continue;
          if (jx < ix) sides |= 1; else if (jx > ix) sides |= 2;
          if (jy < iy) sides |= 4; else if (jy > iy) sides |= 8;
          if (jz < iz) sides |= 16; else if (jz > iz) sides |= 32;
        }
    const pairs = ((sides & 3) === 3) + ((sides & 12) === 12) + ((sides & 48) === 48);
    return pairs >= 2;
  };

  let byOpacity = 0, byCluster = 0;
  for (let i = 0; i < n; i++) {
    const v = voxOf[i];
    if (O[i] < minOpacity) { O[i] = 0; byOpacity++; }
    else if ((v < 0 || !inMain[v]) && !enclosed(i)) { O[i] = 0; byCluster++; }
  }
  const bySupport = support ? dropSupport(mesh, d) : 0;

  // apply: zero the alpha byte of every dropped splat in Spark's packed data
  const packed = mesh.packedSplats?.packedArray;
  if (packed) {
    for (let i = 0; i < n; i++) if (O[i] === 0) packed[i * 4] &= 0x00ffffff;
    mesh.packedSplats.needsUpdate = true;
    mesh.updateVersion?.();
  } else console.warn('dropBackground: mesh has no packed splats; dropped splats stay visible');
  const report = {
    splats: n, kept: n - byOpacity - byCluster - bySupport, byOpacity, byCluster, bySupport,
    voxels: [nx, ny, nz], ms: Math.round(performance.now() - t0),
  };
  mesh.userData.holoBackground = report;
  return report;
}

/**
 * A support surface (table top, floor) is a layer at the bottom of the capture that spreads
 * well past the footprint of what stands on it. Take the bottom `band` of the subject's height,
 * and the footprint (seen from above) of the body just above that band. If the bottom layer
 * covers a large area outside that footprint (at least `wide` x the footprint's own area), that
 * outside part is a support and is dropped. Small things that stick out at the bottom (feet,
 * a knee, a flared base) cover little area and stay. What lies under the subject stays too;
 * it is hidden. Uses the mesh's orientation for "up" (+Y after loading).
 */
function dropSupport(mesh, d, { band = 0.15, wide = 0.5 } = {}) {
  const { n, center: C, opacity: O } = d;
  const qi = mesh.quaternion.clone().invert();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(qi);
  const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(qi);
  const az = new THREE.Vector3(0, 0, 1).applyQuaternion(qi);
  const h = new Float32Array(n), u = new Float32Array(n), w = new Float32Array(n);
  const hs = [], us = [], ws = [];
  const step = Math.max(1, Math.floor(n / 150000));
  for (let i = 0; i < n; i++) {
    const x = C[i * 3], y = C[i * 3 + 1], z = C[i * 3 + 2];
    h[i] = x * up.x + y * up.y + z * up.z;
    u[i] = x * ax.x + y * ax.y + z * ax.z;
    w[i] = x * az.x + y * az.y + z * az.z;
    if (i % step === 0 && O[i] >= 0.2) { hs.push(h[i]); us.push(u[i]); ws.push(w[i]); }
  }
  if (hs.length < 100) return 0;
  const [h0, h1] = quantiles(hs, [0.002, 0.998]);
  const [u0, u1] = quantiles(us, [0.002, 0.998]);
  const [w0, w1] = quantiles(ws, [0.002, 0.998]);
  const H = h1 - h0;
  const cell = H / 64;
  const gu = Math.ceil((u1 - u0) / cell) + 1, gw = Math.ceil((w1 - w0) / cell) + 1;
  if (gu * gw > 4e6) return 0;
  const idx = (i) => {
    const a = Math.floor((u[i] - u0) / cell), b = Math.floor((w[i] - w0) / cell);
    return a < 0 || b < 0 || a >= gu || b >= gw ? -1 : b * gu + a;
  };
  const cut = h0 + band * H, top = h0 + 0.5 * H;
  const foot = new Uint8Array(gu * gw);
  for (let i = 0; i < n; i++) {
    if (O[i] < 0.2 || h[i] < cut || h[i] > top) continue;
    const k = idx(i);
    if (k >= 0) foot[k] = 1;
  }
  let footArea = 0;
  for (const f of foot) footArea += f;
  // dilate the footprint by two cells so the subject's own lower edge is safely inside
  const near = foot.slice();
  for (let b = 0; b < gw; b++) for (let a = 0; a < gu; a++) {
    if (!foot[b * gu + a]) continue;
    for (let db = -2; db <= 2; db++) for (let da = -2; da <= 2; da++) {
      const A = a + da, B = b + db;
      if (A >= 0 && B >= 0 && A < gu && B < gw) near[B * gu + A] = 1;
    }
  }
  const outside = new Uint8Array(gu * gw);
  let outArea = 0;
  for (let i = 0; i < n; i++) {
    if (O[i] < 0.2 || h[i] >= cut) continue;
    const k = idx(i);
    if (k >= 0 && !near[k] && !outside[k]) { outside[k] = 1; outArea++; }
  }
  if (!footArea || outArea < wide * footArea) return 0;
  let dropped = 0;
  for (let i = 0; i < n; i++) {
    if (O[i] === 0 || h[i] >= cut) continue;
    const k = idx(i);
    if (k < 0 || !near[k]) { O[i] = 0; dropped++; }
  }
  return dropped;
}

/**
 * Bounds of the kept splats in `frame` (robust: a few stray splats can't blow up the fit).
 * frame = null means the mesh's parent space.
 */
export function splatBox(mesh, frame = null, opts) {
  mesh.updateMatrixWorld(true);
  const M = frame ? new THREE.Matrix4().copy(frame.matrixWorld).invert().multiply(mesh.matrixWorld) : mesh.matrix.clone();
  return splatBounds(mesh, M, opts);
}
