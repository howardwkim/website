// Everything fixed about the Boo 2026 card: Howard's saved tuning, the group photo with its
// background removed, Contour, and the card itself. Nothing here reads the tuning page.

import { PHOTOS } from '../rise/photos.js';

const GROUP = PHOTOS.find((p) => p.id === 'group');
const SANS = 'ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif';
const SERIF = 'ui-serif, "Iowan Old Style", "Palatino", Georgia, serif';

// Howard's saved tuning, then the colour he chose: just enough less see-through to read the sign
export const LOOK = { ...GROUP.look, ...{"tint": 0, "hue": 113, "saturation": 0, "intensity": 0.58, "glow": 0.62, "density": 0.71, "rim": 0.01, "form": 0, "keepColor": 0.21, "softness": 0.05, "breathing": 0.09, "flickerRate": 11.5, "flickerIntensity": 0.9, "scanlines": 0.38, "scanDensity": 81, "echo": 0, "chromatic": 0.48, "play": 0.63, "inner": 1, "edgeSoft": 0.31, "beam": 0.13, "dust": 0.12}, inner: 0.82, density: 0.75, glow: 0.52, darkHide: 0.26, softness: 0.05 };

export const BOO = {
  url: './assets/group-sharp-sign-soft.ply',   // the group, with the sign's letters a deeper blue
  grade: [1.05, 1.05, 1.08],   // contrast, saturation, level
  bytes: 20678517,
  face: GROUP.face,
  depth: GROUP.depth,
  blackPoint: GROUP.blackPoint,
  fit: GROUP.fit,
  pop: 0.09,
  speed: 0.8,
  background: { pattern: 'shelves', amount: 1 },
};

// each stands a little further off the card than the one before; `lift` is in card units
export const LAYERS = [
  { type: 'border', mode: 'light', always: true, lift: 0.015, inset: 0.026, width: 0.0045, radius: 0.01, level: 1.6 },
  { type: 'border', mode: 'light', always: true, lift: 0.03, style: 'corners', inset: 0.045, width: 0.003, corner: 0.06, level: 1.1 },
  { type: 'text', mode: 'print', finish: 'foil', lift: 0.045, text: 'Boo 2026', font: SERIF, style: 'italic', weight: 400, size: 0.04, x: -0.42, y: 0.64, align: 'left', color: '#ddd3ad', opacity: 0.85 },
  { type: 'text', mode: 'print', finish: 'ink', lift: 0.045, text: 'October 30th, 2026', font: SANS, weight: 500, size: 0.02, letterSpacing: 0.25, upper: true, x: 0.42, y: 0.643, align: 'right', color: '#cfc7a6', opacity: 0.75 },
  { type: 'text', mode: 'print', finish: 'ink', lift: 0.045, text: 'Library of Living Light', font: SANS, weight: 500, size: 0.019, letterSpacing: 0.3, upper: true, x: 0, y: -0.672, color: '#d8d0b0', opacity: 0.75 },
];
