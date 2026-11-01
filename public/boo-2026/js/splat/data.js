// Splat geometry shared by the look, the card placement and the subject loader.
// Nothing here knows what a subject depicts; it only reads Gaussian splats.

import * as THREE from 'three';

/** A Spark SplatMesh (duck-typed so callers don't need to load Spark to ask). */
export const isSplatMesh = (o) => !!o && typeof o.forEachSplat === 'function' && typeof o.updateGenerator === 'function';

/** Read every splat once into typed arrays (object space). Cached on the mesh. */
export function readSplats(mesh) {
  if (mesh.userData.holoSplats) return mesh.userData.holoSplats;
  const n = mesh.numSplats;
  const center = new Float32Array(n * 3), scale = new Float32Array(n * 3), quat = new Float32Array(n * 4);
  const opacity = new Float32Array(n), color = new Float32Array(n * 3);
  mesh.forEachSplat((i, c, s, q, o, col) => {
    center[i * 3] = c.x; center[i * 3 + 1] = c.y; center[i * 3 + 2] = c.z;
    scale[i * 3] = s.x; scale[i * 3 + 1] = s.y; scale[i * 3 + 2] = s.z;
    quat[i * 4] = q.x; quat[i * 4 + 1] = q.y; quat[i * 4 + 2] = q.z; quat[i * 4 + 3] = q.w;
    opacity[i] = o;
    color[i * 3] = col.r; color[i * 3 + 1] = col.g; color[i * 3 + 2] = col.b;
  });
  return (mesh.userData.holoSplats = { n, center, scale, quat, opacity, color });
}

export function quantiles(vals, fs) {
  const a = Float32Array.from(vals).sort();
  return fs.map((f) => a[Math.min(a.length - 1, Math.max(0, Math.floor(f * (a.length - 1))))]);
}

/**
 * The figure the splats make, as a solid voxel grid in a chosen frame.
 * Each splat with opacity >= minOpacity is a small box (its `sigma` extent along the frame's
 * axes). Boxes are dilated once to close pinholes, then every voxel the figure encloses (see
 * below) is filled: a hollow captured shell becomes a solid figure, even when the capture is
 * open underneath; a one-sided relief stays a thin layer.
 *
 *   toFrame(mesh) -> Matrix4 taking the mesh's object space into the frame
 *   res: cells across the longest of `fit` axes ('xy' = the card's footprint, 'xyz' = any)
 * Returns { solid: Uint8Array, nx, ny, nz, origin: Vector3, cell }.
 */
export function splatSolid(meshes, toFrame, { res = 96, fit = 'xy', minOpacity = 0.25, sigma = 1.0, maxZ = 4, closeDirs = 5 } = {}) {
  const parts = [];
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate();
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const d = readSplats(mesh);
    const M = toFrame(mesh);
    parts.push({ d, M });
    const xs = [], ys = [], zs = [];
    const step = Math.max(1, Math.floor(d.n / 60000));
    for (let i = 0; i < d.n; i += step) {
      if (d.opacity[i] < minOpacity) continue;
      v.fromArray(d.center, i * 3).applyMatrix4(M);
      xs.push(v.x); ys.push(v.y); zs.push(v.z);
    }
    if (!xs.length) continue;
    const F = [0.001, 0.999];
    const [ax, bx] = quantiles(xs, F), [ay, by] = quantiles(ys, F), [az, bz] = quantiles(zs, F);
    lo.min(v.set(ax, ay, az)); hi.max(v.set(bx, by, bz));
  }
  const size = hi.clone().sub(lo);
  const cell = (fit === 'xy' ? Math.max(size.x, size.y) : Math.max(size.x, size.y, size.z)) / res;
  const pad = 3;
  const origin = lo.clone().subScalar(pad * cell);
  const nx = Math.ceil(size.x / cell) + 2 * pad, ny = Math.ceil(size.y / cell) + 2 * pad;
  const nz = Math.min(maxZ * res, Math.ceil(size.z / cell) + 2 * pad);
  const N = nx * ny * nz;
  const occ = new Uint8Array(N);
  const id = (x, y, z) => (z * ny + y) * nx + x;
  const L = new THREE.Matrix3(), R = new THREE.Matrix3(), RS = new THREE.Matrix3();
  const q = new THREE.Quaternion(), rot = new THREE.Matrix4();
  for (const { d, M } of parts) {
    const e = M.elements;
    L.setFromMatrix4(M);
    const lscale = Math.cbrt(Math.abs(L.determinant()));
    for (let i = 0; i < d.n; i++) {
      if (d.opacity[i] < minOpacity) continue;
      const x = d.center[i * 3], y = d.center[i * 3 + 1], z = d.center[i * 3 + 2];
      const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const cz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const sx = d.scale[i * 3], sy = d.scale[i * 3 + 1], sz = d.scale[i * 3 + 2];
      let hx = 0, hy = 0, hz = 0;
      if (Math.max(sx, sy, sz) * lscale * sigma > cell * 0.5) {
        // sigma along each frame axis: diagonal of (L R S)(L R S)^T
        q.fromArray(d.quat, i * 4);
        R.setFromMatrix4(rot.makeRotationFromQuaternion(q));
        RS.multiplyMatrices(L, R);
        const m = RS.elements;   // column-major
        const c0 = sx * sx, c1 = sy * sy, c2 = sz * sz;
        hx = sigma * Math.sqrt(m[0] * m[0] * c0 + m[3] * m[3] * c1 + m[6] * m[6] * c2);
        hy = sigma * Math.sqrt(m[1] * m[1] * c0 + m[4] * m[4] * c1 + m[7] * m[7] * c2);
        hz = sigma * Math.sqrt(m[2] * m[2] * c0 + m[5] * m[5] * c1 + m[8] * m[8] * c2);
      }
      const x0 = Math.max(0, Math.floor((cx - hx - origin.x) / cell)), x1 = Math.min(nx - 1, Math.floor((cx + hx - origin.x) / cell));
      const y0 = Math.max(0, Math.floor((cy - hy - origin.y) / cell)), y1 = Math.min(ny - 1, Math.floor((cy + hy - origin.y) / cell));
      const z0 = Math.max(0, Math.floor((cz - hz - origin.z) / cell)), z1 = Math.min(nz - 1, Math.floor((cz + hz - origin.z) / cell));
      if (x1 < x0 || y1 < y0 || z1 < z0) continue;
      if (x1 - x0 > 16 || y1 - y0 > 16 || z1 - z0 > 16) continue;   // a stray giant splat is not a solid
      for (let Z = z0; Z <= z1; Z++) for (let Y = y0; Y <= y1; Y++) for (let X = x0; X <= x1; X++) occ[id(X, Y, Z)] = 1;
    }
  }
  // close pinholes (dilate once), then flood the outside air in from the grid faces
  const wall = new Uint8Array(N);
  for (let Z = 0; Z < nz; Z++) for (let Y = 0; Y < ny; Y++) for (let X = 0; X < nx; X++) {
    if (!occ[id(X, Y, Z)]) continue;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const A = X + dx, B = Y + dy, C = Z + dz;
      if (A >= 0 && B >= 0 && C >= 0 && A < nx && B < ny && C < nz) wall[id(A, B, C)] = 1;
    }
  }
  // Directional closure: a voxel is inside the figure when the figure blocks it in at least
  // `closeDirs` of the 6 axis directions. A plain flood fill of the outside air would leak into
  // a capture through its open side (an object photographed on a table has no bottom; a
  // single-photo person has no back) and leave it hollow. With 5 of 6, a closed shell or a shell
  // open on one side fills; a one-sided relief stays a thin layer (only its front blocks).
  const blocked = new Uint8Array(N);
  const sxy = nx * ny;
  for (let Z = 0; Z < nz; Z++) for (let Y = 0; Y < ny; Y++) {
    const row = (Z * ny + Y) * nx;
    let seen = 0;
    for (let X = 0; X < nx; X++) { seen |= wall[row + X]; blocked[row + X] += seen; }
    seen = 0;
    for (let X = nx - 1; X >= 0; X--) { seen |= wall[row + X]; blocked[row + X] += seen; }
  }
  for (let Z = 0; Z < nz; Z++) for (let X = 0; X < nx; X++) {
    const base = Z * sxy + X;
    let seen = 0;
    for (let Y = 0; Y < ny; Y++) { const k = base + Y * nx; seen |= wall[k]; blocked[k] += seen; }
    seen = 0;
    for (let Y = ny - 1; Y >= 0; Y--) { const k = base + Y * nx; seen |= wall[k]; blocked[k] += seen; }
  }
  for (let Y = 0; Y < ny; Y++) for (let X = 0; X < nx; X++) {
    const base = Y * nx + X;
    let seen = 0;
    for (let Z = 0; Z < nz; Z++) { const k = base + Z * sxy; seen |= wall[k]; blocked[k] += seen; }
    seen = 0;
    for (let Z = nz - 1; Z >= 0; Z--) { const k = base + Z * sxy; seen |= wall[k]; blocked[k] += seen; }
  }
  // (a wall voxel counts itself in all 6 sweeps, so the dilation skin needs the original
  // splats or a full enclosure to stay)
  const solid = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (occ[k]) solid[k] = 1;
    else if (!wall[k] && blocked[k] >= closeDirs) solid[k] = 1;
    else if (wall[k]) {
      // a dilation voxel: solid only if its neighbours are enclosed too (pinhole fill)
      const X = k % nx, Y = Math.floor(k / nx) % ny, Z = Math.floor(k / sxy);
      let inner = 0, n = 0;
      const nb = [X > 0 ? k - 1 : -1, X < nx - 1 ? k + 1 : -1, Y > 0 ? k - nx : -1, Y < ny - 1 ? k + nx : -1, Z > 0 ? k - sxy : -1, Z < nz - 1 ? k + sxy : -1];
      for (const j of nb) { if (j < 0) continue; n++; if (occ[j] || (!wall[j] && blocked[j] >= closeDirs)) inner++; }
      if (inner === n) solid[k] = 1;
    }
  }
  return { solid, nx, ny, nz, origin, cell };
}

/**
 * Bounds of the visible splats after transform `M` (object -> some frame). Robust: the
 * lo..hi quantile range per axis, so a few stray splats can't blow up a fit.
 */
export function splatBounds(mesh, M, { lo = 0.005, hi = 0.995, minOpacity = 0.2 } = {}) {
  const d = readSplats(mesh);
  const step = Math.max(1, Math.floor(d.n / 200000));
  const xs = [], ys = [], zs = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < d.n; i += step) {
    if (d.opacity[i] < minOpacity) continue;
    v.fromArray(d.center, i * 3).applyMatrix4(M);
    xs.push(v.x); ys.push(v.y); zs.push(v.z);
  }
  if (!xs.length) return new THREE.Box3();
  const [ax, bx] = quantiles(xs, [lo, hi]), [ay, by] = quantiles(ys, [lo, hi]), [az, bz] = quantiles(zs, [lo, hi]);
  return new THREE.Box3(new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz));
}
