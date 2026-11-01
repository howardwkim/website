// Card layers: what is printed on the card, or projected from it, besides the figure.
//
// A card face is an ordered list of layers, drawn bottom to top. Each layer is plain data,
// here or in a JSON file, so a new card is a new list, not new code. Pick one with
//   ?layers=<preset name>            a preset below (default, demo, logo, none)
//   ?layers=<path or URL to .json>   a JSON array of layers (or { "layers": [...] })
//   ?layers=[{...}, ...]             the JSON itself, URL-encoded
// Units are card units: the card is 1.0 wide and 1.45 tall, origin at its centre, +y up.
//
// Every layer has a `mode`:
//   'print' - ink or foil on the card itself. Drawn with the stage, so it never flickers,
//             takes no tint, leaves no ghosts and doesn't glow; the light passes over it as it
//             passes over the card. `finish`: 'ink' (matte) or 'foil' (a sheen that moves as
//             the card turns). `color` is the ink.
//   'light' - made of the hologram's light. Drawn into the light layer with the figure, so it
//             takes the tint, flickers, ghosts, splits and glows exactly as the figure does.
//             `level` is its brightness; its colour is always the light's.
//
// Layer types (besides mode / color / opacity / finish / level):
//   border { inset, width, radius, style: 'solid' | 'double' | 'corners', corner }
//          inset from the card edge to the line; `corner` is the tick length for 'corners'
//   text   { text, font, weight, style, size, x, y, align, letterSpacing, upper, fontUrl }
//          size is the em height; letterSpacing in em; '\n' breaks lines; fontUrl loads a
//          web font under the family name given in `font`
//   image  { src, x, y, width }   centred at x, y; height follows the image. Only the image's
//          alpha is used: print gives it the ink colour, light gives it the light's colour.

const SANS = 'ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif';
const SERIF = 'ui-serif, "Iowan Old Style", "Palatino", Georgia, serif';

export const PRESETS = {
  // the everyday card: a thin printed foil frame and a small printed caption
  default: [
    { type: 'border', mode: 'print', finish: 'foil', inset: 0.03, width: 0.003, radius: 0.012, color: '#d6cca4', opacity: 0.75 },
    { type: 'text', mode: 'print', finish: 'ink', text: 'Holo Photo · No. 0001', font: SANS, weight: 500, size: 0.021, letterSpacing: 0.3, upper: true, x: 0, y: -0.678, color: '#d8d0b0', opacity: 0.6 },
  ],
  // both modes on one card: the frame is light (it flickers with the figure), the words are ink
  demo: [
    { type: 'border', mode: 'light', inset: 0.026, width: 0.0045, radius: 0.01, level: 1.6 },
    { type: 'border', mode: 'light', style: 'corners', inset: 0.045, width: 0.003, corner: 0.06, level: 1.1 },
    { type: 'text', mode: 'print', finish: 'foil', text: 'Archive 23', font: SERIF, style: 'italic', weight: 400, size: 0.04, x: -0.42, y: 0.64, align: 'left', color: '#ddd3ad', opacity: 0.8 },
    { type: 'text', mode: 'print', finish: 'ink', text: '07 · 2026', font: SANS, weight: 500, size: 0.02, letterSpacing: 0.25, upper: true, x: 0.42, y: 0.643, align: 'right', color: '#cfc7a6', opacity: 0.55 },
    { type: 'text', mode: 'print', finish: 'ink', text: 'Library of the living light', font: SANS, weight: 500, size: 0.019, letterSpacing: 0.3, upper: true, x: 0, y: -0.672, color: '#d8d0b0', opacity: 0.55 },
  ],
  // the other way round: a printed foil mark and frame, a title made of light
  logo: [
    { type: 'border', mode: 'print', finish: 'ink', inset: 0.03, width: 0.0025, radius: 0.012, color: '#c9bf98', opacity: 0.5 },
    { type: 'image', mode: 'print', finish: 'foil', src: './assets/logo-mark.svg', x: 0, y: 0.625, width: 0.075, color: '#e0d5a8', opacity: 0.85 },
    { type: 'text', mode: 'light', text: 'Holo Photo', font: SERIF, weight: 400, size: 0.03, letterSpacing: 0.14, x: 0, y: 0.55, level: 1.4 },
  ],
  none: [],
};

/** The layer list for a ?layers= value (preset name, JSON, or a path/URL to JSON). */
export async function resolveLayers(spec) {
  if (!spec) return PRESETS.default;
  if (PRESETS[spec]) return PRESETS[spec];
  let data;
  if (/^\s*[[{]/.test(spec)) data = JSON.parse(spec);
  else {
    const res = await fetch(spec);
    if (!res.ok) throw new Error(`card layers: ${spec}: ${res.status}`);
    data = await res.json();
  }
  const list = Array.isArray(data) ? data : data.layers;
  if (!Array.isArray(list)) throw new Error('card layers: expected an array of layers');
  return list;
}
