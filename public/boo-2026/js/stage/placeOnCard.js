import * as THREE from 'three';

// Card placement: find the depth at which the card should cut through a subject.
// The rule (docs/card-placement-rule.md): light leaves both faces of the card straight
// out, so put the card where the least empty air sits between the figure and the card,
// measured along perpendicular lines. Small leftover gaps are allowed.
//
// Works in the emitter frame (card face = z 0, light along +/-Z). The subject must
// already be parented under `frame` and positioned in x/y; only its depth is solved.
//
// Two ways to find the solid along each perpendicular line, same measure afterwards:
//  - meshes: depth-peel the triangles (inside a closed surface is solid);
//  - Gaussian splats: each splat is a small solid box (its 1-sigma extent along the card's
//    axes); the boxes are voxelised and every voxel the figure encloses is filled, so a hollow
//    captured shell (even one open underneath) counts as a solid figure, while a one-sided
//    relief (a person from a single photo) stays a thin layer. Faint splats don't count.
//    See splatSolid in splat/data.js.

import { isSplatMesh, splatSolid } from '../splat/data.js';

const GRID = 96;   // samples across the subject's footprint (longest side)

// Depth-peel the subject along Z: for each grid cell, every z where the surface crosses.
function peel(subject, frame) {
  const toFrame = new THREE.Matrix4();
  const frameInv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const tris = [];
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  subject.traverse((o) => {
    if (!o.isMesh || o.userData.holoInner || !o.geometry?.attributes?.position) return;
    toFrame.multiplyMatrices(frameInv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    const pts = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toFrame);
      pts[i * 3] = v.x; pts[i * 3 + 1] = v.y; pts[i * 3 + 2] = v.z;
      box.expandByPoint(v);
    }
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      tris.push(pts.subarray(a * 3, a * 3 + 3), pts.subarray(b * 3, b * 3 + 3), pts.subarray(c * 3, c * 3 + 3));
    }
  });

  const size = box.getSize(new THREE.Vector3());
  const cell = Math.max(size.x, size.y) / GRID;
  const nx = Math.ceil(size.x / cell) + 1, ny = Math.ceil(size.y / cell) + 1;
  const hits = Array.from({ length: nx * ny }, () => []);
  for (let t = 0; t < tris.length; t += 3) {
    const A = tris[t], B = tris[t + 1], C = tris[t + 2];
    const det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(det) < 1e-12) continue;   // edge-on to the light: no crossing
    const i0 = Math.max(0, Math.ceil((Math.min(A[0], B[0], C[0]) - box.min.x) / cell - 0.5));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(A[0], B[0], C[0]) - box.min.x) / cell - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(A[1], B[1], C[1]) - box.min.y) / cell - 0.5));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(A[1], B[1], C[1]) - box.min.y) / cell - 0.5));
    for (let j = j0; j <= j1; j++) {
      const y = box.min.y + (j + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const x = box.min.x + (i + 0.5) * cell;
        const l1 = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / det;
        const l2 = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        hits[j * nx + i].push(l1 * A[2] + l2 * B[2] + l3 * C[2]);
      }
    }
  }

  // each cell's crossings -> solid intervals along the line (open meshes: fall back to the hull)
  const lines = [];
  for (const zs of hits) {
    if (zs.length < 2) continue;
    zs.sort((a, b) => a - b);
    const iv = [];
    if (zs.length % 2) iv.push([zs[0], zs[zs.length - 1]]);
    else for (let k = 0; k < zs.length; k += 2) iv.push([zs[k], zs[k + 1]]);
    lines.push(iv);
  }
  return { lines, cellArea: cell * cell, zMin: box.min.z, zMax: box.max.z };
}

// Splats as small solids, voxelised in the frame and closed; read back as solid runs per line.
function voxelSplats(meshes, frame) {
  const frameInv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const g = splatSolid(meshes, (m) => new THREE.Matrix4().multiplyMatrices(frameInv, m.matrixWorld), { res: GRID, fit: 'xy' });
  const { solid, nx, ny, nz, origin, cell } = g;
  const lines = [];
  let zMin = Infinity, zMax = -Infinity;
  for (let Y = 0; Y < ny; Y++) for (let X = 0; X < nx; X++) {
    const iv = [];
    let start = -1;
    for (let Z = 0; Z <= nz; Z++) {
      const on = Z < nz && solid[(Z * ny + Y) * nx + X];
      if (on && start < 0) start = Z;
      if (!on && start >= 0) { iv.push([origin.z + start * cell, origin.z + Z * cell]); start = -1; }
    }
    if (iv.length) { lines.push(iv); zMin = Math.min(zMin, iv[0][0]); zMax = Math.max(zMax, iv[iv.length - 1][1]); }
  }
  return { lines, cellArea: cell * cell, zMin, zMax };
}

// Empty air between the card (at depth c) and the figure, summed over every line.
function airAt(lines, c) {
  let air = 0;
  for (const iv of lines) {
    let reach = c;   // front: walk outward from the card
    for (const [a, b] of iv) {
      if (b <= c) continue;
      if (a > reach) air += a - reach;
      reach = Math.max(reach, b);
    }
    reach = c;       // back: walk outward the other way
    for (let k = iv.length - 1; k >= 0; k--) {
      const [a, b] = iv[k];
      if (a >= c) continue;
      if (b < reach) air += reach - b;
      reach = Math.min(reach, a);
    }
  }
  return air;
}

/**
 * Slide `subject` along Z so the card cuts it where the least air is left.
 * Returns { shift, air, airBefore, solidVolume } (volumes in frame units cubed).
 */
export function placeOnCard(subject, frame, { steps = 240 } = {}) {
  frame.updateMatrixWorld(true);
  subject.updateMatrixWorld(true);
  const splats = [];
  subject.traverse((o) => { if (isSplatMesh(o)) splats.push(o); });
  const { lines, cellArea, zMin, zMax } = splats.length ? voxelSplats(splats, frame) : peel(subject, frame);
  let solid = 0;
  for (const iv of lines) for (const [a, b] of iv) solid += b - a;

  let best = { c: 0, air: Infinity };
  const scores = [];
  for (let s = 0; s <= steps; s++) {
    const c = zMin + (zMax - zMin) * (s / steps);
    const air = airAt(lines, c);
    scores.push([c, air]);
    if (air < best.air - 1e-9) best = { c, air };
  }
  // the minimum is often a plateau: take its middle so the card sits centred in it
  const flat = scores.filter(([, a]) => a <= best.air * 1.002 + 1e-9).map(([c]) => c);
  const c = (Math.min(...flat) + Math.max(...flat)) / 2;

  const airBefore = airAt(lines, 0) * cellArea;
  subject.position.z -= c;
  subject.updateMatrixWorld(true);
  return { shift: -c, air: airAt(lines, c) * cellArea, airBefore, solidVolume: solid * cellArea };
}
