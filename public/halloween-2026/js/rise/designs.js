// The rises. Each is a group order plus one single-splat motion, written as numbers for
// Rise.js, with the reason it should look good and at most one dial beside speed. A `flip` is
// a switch for the design's other direction.
// Distances are card units (the card is 1.0 x 1.45); points are shares of the figure's box.

const BASE = [0.5, 0, 0.5];        // the middle of the card's lower edge of the figure

export const DESIGNS = [
  {
    id: 'contour', name: 'Contour',
    why: 'The line follows the real shape of the face: brow and nose first, then cheeks, then hair, then shoulders. You see it is 3D before the card moves, which is the point of a hologram.',
    order: 'depth', pace: 2.2, total: 2.1, life: 0.5, fade: 0.04, flash: 2.0, edge: 0.006,
    flip: { name: 'Back to front', set: { order: 'depthBack', pace: 0.45 } },
    dial: { key: 'flash', name: 'Line glow', min: 0, max: 4, step: 0.05 },
  },
  {
    id: 'drawn', name: 'Drawn in',
    why: 'Like a magnet: light gathers just off the card and drifts slowly toward its spot, then hits a tipping point and snaps in, landing as the colour of the photo. The slow part is what makes the snap feel sudden.',
    order: 'up', total: 1.3, life: 1.5, fade: 0.5, flash: 1.3, edge: 0.45, wait: 0.2,
    from: 'above', fall: [0.05, 0.25], tip: 0.75, streak: 0.5, dot: 0.0013, seen: 0.05,
    flip: { name: 'From the card', set: { fromCard: true } },
    dial: { key: 'tip', name: 'Tipping point (early to late)', min: 0.1, max: 0.95, step: 0.01 },
  },
  {
    id: 'curved', name: 'Drawn in, curved',
    why: 'The same magnet, but each light starts over a nearby point on the card and has to bend into its spot along its own arc, some nearly straight, some wide.',
    order: 'up', total: 1.3, life: 1.5, fade: 0.5, flash: 1.3, edge: 0.45, wait: 0.2,
    from: 'above', fall: [0.05, 0.25], side: 0.16, tip: 0.75, streak: 0.5, dot: 0.0013, seen: 0.05,
    flip: { name: 'From the card', set: { fromCard: true } },
    dial: { key: 'tip', name: 'Tipping point (early to late)', min: 0.1, max: 0.95, step: 0.01 },
  },
  {
    id: 'signal', name: 'Signal',
    why: 'Thin lines stutter in and slide sideways until they lock, like a broadcast finding its channel. Flicker is the one thing everybody already knows a hologram does, and lines belong to the scan lines already on the figure.',
    order: 'random', total: 1.1, life: 0.55, stutter: 3.5, lines: 0.011, slide: 0.05, flash: 0.7, ignite: true,
    dial: { key: 'lines', name: 'Line size', min: 0.004, max: 0.04, step: 0.001 },
  },
  {
    id: 'plane', name: 'Rising plane',
    why: 'Your hidden card. It comes up fast and slows as it reaches the head, so your eye lands on the face, and a bright line marks where the light is being made.',
    order: 'up', pace: 0.42, total: 1.9, life: 0.55, fade: 0.04, flash: 2.2, edge: 0.012,
    dial: { key: 'pace', name: 'Slow-down', min: 0.25, max: 1, step: 0.01, flip: true },
  },
  {
    id: 'focus', name: 'Focus pull',
    why: 'Soft colour first, then it sharpens from the eyes outward, like a lens finding focus. People look at eyes first, so the sharpest thing arrives exactly where they are looking.',
    order: 'radial', point: 'face', reach: 0.72, pace: 0.8, total: 1.5, life: 0.9, fade: 0.5, flash: 0.15, wait: 0.2,
    leaders: 0.09, leadSpan: 0.12, fillFrom: 0.1, leadSize: 0.011, leadHold: 0.5, leadShrink: 1.1, leadAlpha: 0.55,
    dial: { key: 'leadSize', name: 'Blur', min: 0.003, max: 0.014, step: 0.0005 },
  },
  {
    id: 'fountain', name: 'Fountain',
    why: 'The film hologram explained, quietly: light leaves one point on the card and travels up into place. It fans sideways, so the motion reads from straight on.',
    order: 'radial', point: BASE, reach: 1.15, pace: 0.7, total: 1.5, life: 1.0, fade: 0.3, flash: 0.1,
    from: 'point', spring: 7, swirl: 0.2,
    dial: { key: 'swirl', name: 'Swirl', min: 0, max: 1, step: 0.02 },
  },
  {
    id: 'blink', name: 'Plain blink',
    why: 'The baseline: every splat blinks on at a random moment, nothing else. Worth seeing to judge how much the others add.',
    order: 'random', total: 2, life: 0.02,
  },
];
