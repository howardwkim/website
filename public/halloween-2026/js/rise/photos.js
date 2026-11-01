// The photos on the dropdown. `face` is where to centre a rise on: a share of the figure's box.
// `fit` overrides how it sits on the card. pipeline/README.md has how a photo becomes a splat.

const GROUP = {
  face: [0.5, 0.82, 1],
  depth: 0.3,           // SHARP stands a wide group far apart; flattened so it sits on the card
  blackPoint: 0.001,    // black clothes stay part of the figure instead of dropping out
  look: { beam: 0.12, rim: 0.12 },
};

export const PHOTOS = [
  { id: 'howard', name: 'Howard', url: './assets/person-sharp.ply', face: [0.5, 0.78, 1] },
  {
    id: 'group', name: 'Group, background removed', url: './assets/group-sharp.ply', ...GROUP,
    fit: { height: 1.2, maxWidth: 0.92, centerY: -0.13, fadeBottom: 0.02 },
  },
  {
    id: 'group-bg', name: 'Group, background kept', url: './assets/group-sharp-bg.ply', ...GROUP,
    // keeps the room, and stands where the group above stands
    people: 369434,     // the file holds the people first, then the room; only the people get cleaned
    look: { beam: 0, dust: 0, rim: 0.12, glow: 0.2, intensity: 0.8, softness: 0.1 },
    fit: { fadeBottom: 0.04 }, place: { scale: 0.5216, position: [-0.0076, -0.009, 1.5755], depth: 0.862 },
  },
];
