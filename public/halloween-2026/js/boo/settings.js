// Everything fixed about the party cards: Howard's saved tuning and chosen colour, Contour, the
// card's layers, and each card's photo and words. Nothing here reads the tuning page.

import { PHOTOS } from '../rise/photos.js';

const GROUP = PHOTOS.find((p) => p.id === 'group');
const SANS = 'ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif';
const SERIF = 'ui-serif, "Iowan Old Style", "Palatino", Georgia, serif';

// The cards. Each is served from its own folder (build-boo.sh), which names it on the page.
const CARDS = {
  'boo-2026': {
    title: 'Boo 2026',
    date: 'October 30th, 2026',
    url: './assets/group-sharp-sign-soft.ply',   // the group, with the sign's letters a deeper blue
    bytes: 20678517,
    face: GROUP.face,
    fit: GROUP.fit,
  },
  'halloween-2026': {
    title: 'Halloween 2026',
    date: 'October 31st, 2026',
    url: './assets/halloween-sharp.ply',
    bytes: 37269805,
    face: [0.5, 0.75, 1],
    // the mask already took the room out, and these four stand at very different depths: the
    // usual cleaning would keep whoever is densest and drop the rest
    clean: { keep: 0.004 },
    depth: 1,          // already flattened along the camera's rays (pipeline/roomrelief.py)
    blackPoint: 0.00002,   // a dark room: black trousers are barely above nothing, and must stay
    grade: [1.1, 0.95, 0.9],
    look: { darkHide: 0.85, glow: 0.22, inner: 0.6, density: 0.85 },   // deep pink light, held back
    fit: { height: 1.2, maxWidth: 0.92, centerY: -0.13, fadeBottom: 0.05 },
  },
};
const cardId = new URLSearchParams(location.search).get('card') ?? document.documentElement.dataset.card ?? 'boo-2026';
const CARD = CARDS[cardId] ?? CARDS['boo-2026'];

export const BOO = {
  grade: [1.05, 1.05, 1.08],   // contrast, saturation, level
  depth: GROUP.depth,
  blackPoint: GROUP.blackPoint,
  pop: 0.09,
  speed: 0.8,
  background: { pattern: 'shelves', amount: 1 },
  ...CARD,
};

// Howard's saved tuning, then the colour he chose: just enough less see-through to read the sign
export const LOOK = { ...GROUP.look, ...{"tint": 0, "hue": 113, "saturation": 0, "intensity": 0.58, "glow": 0.62, "density": 0.71, "rim": 0.01, "form": 0, "keepColor": 0.21, "softness": 0.05, "breathing": 0.09, "flickerRate": 11.5, "flickerIntensity": 0.9, "scanlines": 0.38, "scanDensity": 81, "echo": 0, "chromatic": 0.48, "play": 0.63, "inner": 1, "edgeSoft": 0.31, "beam": 0.13, "dust": 0.12}, inner: 0.82, density: 0.75, glow: 0.52, darkHide: 0.26, softness: 0.05, ...CARD.look };

// each stands a little further off the card than the one before; `lift` is in card units
export const LAYERS = [
  { type: 'border', mode: 'light', always: true, lift: 0.015, inset: 0.026, width: 0.0045, radius: 0.01, level: 1.6 },
  { type: 'border', mode: 'light', always: true, lift: 0.03, style: 'corners', inset: 0.045, width: 0.003, corner: 0.06, level: 1.1 },
  { type: 'text', mode: 'print', finish: 'foil', lift: 0.045, text: BOO.title, font: SERIF, style: 'italic', weight: 400, size: 0.04, x: -0.42, y: 0.64, align: 'left', color: '#ddd3ad', opacity: 0.85 },
  { type: 'text', mode: 'print', finish: 'ink', lift: 0.045, text: BOO.date, font: SANS, weight: 500, size: 0.02, letterSpacing: 0.25, upper: true, x: 0.42, y: 0.643, align: 'right', color: '#cfc7a6', opacity: 0.75 },
  { type: 'text', mode: 'print', finish: 'ink', lift: 0.045, text: 'Library of Living Light', font: SANS, weight: 500, size: 0.019, letterSpacing: 0.3, upper: true, x: 0, y: -0.672, color: '#d8d0b0', opacity: 0.75 },
];
