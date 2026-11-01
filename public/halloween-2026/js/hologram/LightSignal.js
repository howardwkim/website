// LightSignal: the time behaviour of the projected light.
//
// Studied from the Innocence clip (22m28s, every frame between 7.9 s and 10.8 s):
//  - Between events the light is calm. Frame-to-frame luminance varies about 1 %.
//  - Events are rare, short bursts of 3-4 film frames (~40 ms each, stepped, not smooth):
//    a brightness surge of ~10-15 %, the whole figure jumping hue (orange -> green ->
//    violet-white), a desaturated frame, and ghost copies of the figure at earlier positions.
//  - Bursts sometimes come in pairs about 0.4 s apart.
// This class turns that into a per-frame state the shaders read. It knows nothing about
// the subject.

const FRAME = 1 / 24; // the film's frame; glitch steps are held in whole film frames

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CALM = { bright: 1, hue: 0, desat: 0, echo: 0, chroma: 0, jx: 0, jy: 0, ghost: 0 };

export class LightSignal {
  constructor(seed = (Math.random() * 1e9) | 0) {
    this.rand = mulberry32(seed);
    this.steps = [];
    this.stepEnd = 0;
    this.current = { ...CALM };
    this.nextAt = 2.5 + this.rand() * 2;
    this.followUpAt = -1;
    this.crackle = 0;
    this.band = { y: -10, start: -1, dur: 2.6, next: 1.5 + this.rand() * 3 };
    this.ghostDir = [1, 0];
    this.state = { ...CALM, band: -10, active: 0 };
  }

  r(a, b) { return a + (b - a) * this.rand(); }
  frames(a, b) { return FRAME * Math.round(this.r(a, b)); }
  pick(list) { return list[Math.floor(this.rand() * list.length)]; }

  // Build one event as a list of held steps. hue is a shift in degrees.
  makeEvent(type) {
    const types = ['film', 'film', 'surge', 'surge', 'dropout', 'stutter', 'tint', 'tint'];
    type = type || this.pick(types);
    const S = [];
    const step = (o) => S.push({ ...CALM, ...o });
    const a = this.r(0, Math.PI * 2);
    this.ghostDir = [Math.cos(a), Math.sin(a) * 0.4];

    if (type === 'film') {
      // The sequence in the clip: ghosting builds, then orange, green, violet-white, settle.
      step({ dur: this.frames(1, 2), bright: 1.06, echo: 0.6, ghost: 0.5, chroma: 0.3 });
      step({ dur: this.frames(1, 2), bright: 1.12, echo: 0.9, ghost: 1.0, chroma: 0.5 });
      const hues = [
        { hue: -24, desat: 0.1, bright: 1.14 },   // orange
        { hue: 42, bright: 1.1 },                 // green
        { hue: 230, desat: 0.75, bright: 1.05 },  // violet-white
      ];
      const n = 1 + Math.floor(this.rand() * 3);
      for (let i = 0; i < n; i++) step({ dur: FRAME, echo: 0.9, ghost: 1.0, chroma: 0.7, ...hues[i] });
      step({ dur: this.frames(1, 3), bright: 1.04, echo: 0.6, ghost: 0.6 });
    } else if (type === 'surge') {
      step({ dur: this.frames(1, 2), bright: this.r(1.18, 1.32), echo: 0.6, ghost: 0.4, chroma: 0.5 });
      step({ dur: this.frames(2, 4), bright: this.r(1.05, 1.12), echo: 0.4, ghost: 0.3 });
      if (this.rand() < 0.5) step({ dur: this.frames(1, 2), bright: this.r(1.1, 1.2), echo: 0.3 });
    } else if (type === 'dropout') {
      step({ dur: FRAME, bright: this.r(0.35, 0.6), chroma: 0.4 });
      step({ dur: this.frames(1, 2), bright: this.r(0.75, 0.9) });
      step({ dur: FRAME, bright: this.r(1.1, 1.2), echo: 0.5, ghost: 0.5 });
    } else if (type === 'stutter') {
      const n = 3 + Math.floor(this.rand() * 3);
      for (let i = 0; i < n; i++) {
        const lo = i % 2 === 0;
        step({ dur: FRAME, bright: lo ? this.r(0.55, 0.75) : this.r(1.08, 1.18), jx: this.r(-1.5, 1.5), echo: 0.5, ghost: 0.6, chroma: 0.6 });
      }
    } else if (type === 'tint') {
      // A single off-hue frame, like the rosy-hair frame in the clip.
      step({ dur: this.frames(1, 2), hue: this.pick([-18, 30, 300]) * this.r(0.8, 1.1), bright: 1.05, echo: 0.5, ghost: 0.5, chroma: 0.4 });
    } else if (type === 'ignite') {
      // Power-on when the figure first rises out of the card.
      step({ dur: FRAME * 2, bright: 0.3 });
      step({ dur: FRAME, bright: 1.3, echo: 0.6, ghost: 0.8, chroma: 0.6 });
      step({ dur: FRAME * 2, bright: 0.55 });
      step({ dur: FRAME, bright: 1.2, hue: -20, echo: 0.8, ghost: 1 });
      step({ dur: FRAME, bright: 0.8, hue: 40 });
      step({ dur: FRAME * 3, bright: 1.1, echo: 0.5, ghost: 0.5 });
    }
    return S;
  }

  trigger(type) {
    this.steps = this.makeEvent(type);
    this.stepEnd = -1;
  }

  update(t, dt, p) {
    const rate = p.flickerRate; // events per minute
    if (rate > 0 && !this.steps.length) {
      if (t >= this.nextAt || (this.followUpAt > 0 && t >= this.followUpAt)) {
        const wasFollow = this.followUpAt > 0 && t >= this.followUpAt;
        this.followUpAt = -1;
        this.steps = this.makeEvent();
        this.stepEnd = -1;
        if (!wasFollow) {
          const mean = 60 / rate;
          this.nextAt = t + Math.max(0.7, -Math.log(1 - this.rand()) * mean);
          if (this.rand() < 0.3) this.followUpAt = t + this.r(0.3, 0.6); // paired bursts
        }
      }
    } else if (rate <= 0) {
      this.nextAt = t + 1;
    }

    // advance held steps
    if (this.steps.length) {
      if (this.stepEnd < 0) { this.current = this.steps[0]; this.stepEnd = t + this.steps[0].dur; }
      else if (t >= this.stepEnd) {
        this.steps.shift();
        if (this.steps.length) { this.current = this.steps[0]; this.stepEnd = t + this.steps[0].dur; }
        else this.current = { ...CALM };
      }
    }

    const I = p.flickerIntensity;
    const c = this.current;
    // calm breathing: slow, incommensurate drift plus a tiny low-passed crackle (about 1 %)
    const slow = (Math.sin(t * 1.13) + 0.6 * Math.sin(t * 2.71 + 1.3) + 0.8 * Math.sin(t * 0.37 + 4.1)) / 2.4;
    this.crackle += ((this.rand() - 0.5) - this.crackle) * Math.min(1, dt * 18);
    const breathe = 1 + p.breathing * (0.035 * slow + 0.02 * this.crackle);

    const s = this.state;
    s.bright = (1 + (c.bright - 1) * I) * breathe;
    s.hue = c.hue;                       // degrees; applied with hueMix (angles don't scale)
    s.hueMix = c.hue ? Math.min(1, I * 1.2) : 0;
    s.desat = c.desat * I;
    s.echo = c.echo * I;
    s.ghost = c.ghost * I;
    s.chroma = c.chroma * I;
    s.jx = c.jx * I;
    s.jy = c.jy * I;
    s.ghostDirX = this.ghostDir[0];
    s.ghostDirY = this.ghostDir[1];
    s.active = this.steps.length ? 1 : 0;

    // a soft brighter band that occasionally climbs through the figure
    const b = this.band;
    if (b.start < 0 && t >= b.next) { b.start = t; b.dur = this.r(2.0, 3.4); }
    if (b.start >= 0) {
      const k = (t - b.start) / b.dur;
      b.y = -0.9 + 1.9 * k;
      if (k >= 1) { b.start = -1; b.y = -10; b.next = t + this.r(3, 9); }
    }
    s.band = b.y;
    return s;
  }
}
