// Rise: how the figure arrives, decided splat by splat.
//
// Every splat gets a start time from where it sits in the group (order, pacing), then plays
// one short motion from that moment (fade, travel, size, flash). A design in designs.js is
// only numbers for those two parts, so any order runs with any motion and no design needs
// its own shader. All of it runs in the same per-splat modifier as the light (SplatLight),
// in the emitter frame. Once a rise ends the block is switched off: every splat is exactly
// where and what the resting card has it.

import * as THREE from 'three';
import { dyno } from '@sparkjsdev/spark';

const ORDER = { random: 0, up: 1, depth: 2, radial: 3, depthBack: 4 };
const FROM = { here: 0, point: 1, above: 2 };
const LAND = 0.85;   // drawn in: the share of a splat's time spent getting there; the rest is the landing
const DRIFT = '0.08';  // drawn in: how much of the way it covers before the tipping point
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const globals = /* glsl */ `
float riseHash(int i, uint salt) {
  uint x = uint(i) * 2654435761u + salt;
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return float(x) / 4294967295.0;
}
`;

const statements = (v) => /* glsl */ `
// a colour grade: contrast, saturation, level. Off unless a page asks for it.
if (${v.rGrade}.x > 0.0) {
  float grey = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = pow(max(mix(vec3(grey), col, ${v.rGrade}.y), vec3(0.0)), vec3(${v.rGrade}.x)) * ${v.rGrade}.z;
}

// a kept background always lives behind the card, so it only ever shows through the window
if (float(${v.gsplat}.index) >= ${v.rPeople}) { e.z = min(e.z, -0.2); col *= 0.62; }

if (${v.rOn} > 0.5) {
  float t = ${v.rT};
  float h = riseHash(${v.gsplat}.index, 1u);
  float grain = ${v.rGroup}.w;
  // a clump, or a horizontal line, shares one timing
  float own = grain <= 0.0 ? h
    : ${v.rGroup}.z > 0.5 ? holoHash13(vec3(floor(e.y / grain), 3.0, 7.0)) : holoHash13(floor(e / grain) + 7.0);

  // where this splat sits in the group
  vec3 uv = clamp((e - ${v.rMin}) * ${v.rInv}, 0.0, 1.0);
  int kind = int(${v.rGroup}.x);
  float q = own;
  if (kind == 1) q = uv.y;
  else if (kind == 2) q = 1.0 - uv.z;
  else if (kind == 3) q = clamp(distance(e.xy, ${v.rPoint}.xy) / ${v.rPoint}.w, 0.0, 1.0);
  else if (kind == 4) q = uv.z;
  q = 1.0 - pow(1.0 - q, ${v.rGroup}.y);           // pacing: below 1 starts fast and slows down
  q = mix(q, own, ${v.rEdge}.x);                   // how clean the front is

  // when it starts: leaders are a sparse set that go first, the rest fill in behind them
  bool lead = h < ${v.rLead}.x;
  float s = lead ? q * ${v.rLead}.y : mix(${v.rLead}.z, 1.0, q);
  float begin = s * ${v.rTime}.x;
  float p = clamp((t - begin) / ${v.rTime}.y, 0.0, 1.0);
  float pe = 1.0 - pow(1.0 - p, 3.0);

  // arriving: nothing before its moment, then a blink, a fade or a stutter
  float vis = t < begin ? 0.0 : (${v.rTime}.z > 0.0 ? smoothstep(0.0, ${v.rTime}.z, p) : 1.0);
  if (${v.rTime}.w > 0.0 && p < 0.75) vis *= step(0.5, fract(p * ${v.rTime}.w + own * 5.0));

  // a line of the signal slides sideways until it locks
  e.x += (own - 0.5) * ${v.rEdge}.w * (1.0 - pe);

  // drawn in: light on a line straight out from the card. Sucked in, it gathers out in the air,
  // hangs, then falls toward the card; from the card, it leaves the surface and climbs. The
  // offset is where on the card that line stands, and what makes the path curve.
  bool drawn = ${v.rPath}.x > 1.5;
  if (drawn) {
    // like a magnet: a slow drift, a tipping point, then it all goes at once. The landing stays
    // put, so moving the tipping point changes only how long the slow part lasts.
    float m = min(p / ${LAND}, 1.0);
    float tip = ${v.rDrawn}.y;
    float x = max(m - tip, 0.0) / (1.0 - tip);
    float slope = ${DRIFT} / tip;
    float pull = 1.0 - ${DRIFT} - slope * (1.0 - tip);
    float k = m < tip ? slope * m : ${DRIFT} + slope * (1.0 - tip) * x + pull * x * x * x * x;
    float rate = m < tip ? slope : slope + 4.0 * pull * x * x * x / (1.0 - tip);   // how fast it is going
    float ang = 6.2832 * riseHash(${v.gsplat}.index, 3u);
    float side = ${v.rPath}.w * riseHash(${v.gsplat}.index, 4u);
    vec2 aside = vec2(cos(ang), sin(ang)) * side;
    float u = 1.0 - k;
    vec3 way;
    if (${v.rDrawn}.z > 0.5) {
      // leaves the card straight, then bends over into its spot
      float z = e.z;
      way = vec3(aside * -2.0 * k, z * 2.0 * u);
      e = vec3(e.xy + aside * (1.0 - k * k), z * (1.0 - u * u));
    } else {
      // comes from straight out in the air and goes in along that line at the end
      float up = mix(${v.rFall}.x, ${v.rFall}.y, riseHash(${v.gsplat}.index, 2u));
      way = vec3(aside * -2.0 * u, -up);
      e += vec3(aside * u * u, up * u);
    }
    // a streak along the way it is moving, longer the faster it goes
    way = normalize(mat3(${v.emToObj}) * way + vec3(1e-5, 2e-5, 0.0));
    if (way.y < 0.0) way = -way;
    float r = ${v.rFall}.w / length(${v.objToEm}[0].xyz);
    float tall = r * (1.0 + ${v.rFall}.z * rate);
    ${v.out}.scales = mix(${v.gsplat}.scales, vec3(r, tall, r), 1.0 - smoothstep(0.9, 1.0, k));
    if (k < 1.0) ${v.out}.quaternion = normalize(vec4(way.z, 0.0, -way.x, 1.0 + way.y));
    col = mix(col, ${v.light} * 0.9, 0.5 * u);   // light first, the colour of the photo as it lands
    // only a sparse few are seen in the air, or they add up to a white wall; the rest arrive unseen
    a *= mix(riseHash(${v.gsplat}.index, 5u) < ${v.rDrawn}.x ? 0.5 : 0.0, 1.0, smoothstep(0.75, 1.0, k));
  }

  // travelling: out of a point on the card to where it belongs
  if (${v.rPath}.x > 0.5 && !drawn) {
    float k = ${v.rPath}.y > 0.0 ? 1.0 - exp(-5.0 * p) * cos(${v.rPath}.y * p) * (1.0 - p) : pe;
    vec3 target = e;
    e = mix(${v.rPoint}.xyz, target, k);
    float ang = ${v.rPath}.z * (1.0 - k);
    float ca = cos(ang), sa = sin(ang);
    vec2 r = e.xz - ${v.rPoint}.xz;
    e.xz = ${v.rPoint}.xz + vec2(ca * r.x - sa * r.y, sa * r.x + ca * r.y);
  }

  // size: start as a visible dot, end at the splat's own size
  float r0 = lead ? ${v.rLead}.w : ${v.rEdge}.y;
  if (r0 > 0.0) {
    float sp = lead ? clamp((t - begin - ${v.rSize}.x) / ${v.rSize}.y, 0.0, 1.0) : pe;
    float big = (1.0 - sp) * (1.0 - sp);
    ${v.out}.scales = mix(${v.gsplat}.scales, vec3(r0 / length(${v.objToEm}[0].xyz)), big);
    if (lead) a *= mix(1.0, ${v.rSize}.z, big);
  }

  // a flash that decays leaves a bright band on a moving front and a spark on a lone dot
  float fl = ${v.rEdge}.z * vis * (drawn
    ? smoothstep(${(LAND - 0.1).toFixed(3)}, ${LAND}, p) * (1.0 - smoothstep(${LAND}, 1.0, p))   // a touch on landing
    : pow(1.0 - p, 3.0));
  col = col * (1.0 + fl) + ${v.light} * fl * 0.5;
  a *= vis;
}

// The card is a window onto what is behind it: that part shows only from the front, and only
// where your line of sight crosses the card (cut pixel by pixel in the splat fragment shader, so
// the frame is sharp however big the splat). What stands in front of the card is never hidden.
if (e.z < 0.0 && ${v.camEm}.z <= 0.0) a = 0.0;
`;

export class Rise {
  constructor(look) {
    this.look = look;
    this.uniforms = {
      rOn: dyno.dynoFloat(0),
      rT: dyno.dynoFloat(0),
      rGrade: dyno.dynoVec3(new THREE.Vector3()),    // contrast, saturation, level
      rPeople: dyno.dynoFloat(1e9),                  // splats from this index on are the room
      rWindow: dyno.dynoVec2(new THREE.Vector2(0.5, 0.725)),   // half the card
      rMin: dyno.dynoVec3(new THREE.Vector3()),
      rInv: dyno.dynoVec3(new THREE.Vector3(1, 1, 1)),
      rPoint: dyno.dynoVec4(new THREE.Vector4()),    // xyz: the origin in the card frame, w: reach of a radial order
      rGroup: dyno.dynoVec4(new THREE.Vector4()),    // order, pacing, -, clump size
      rTime: dyno.dynoVec4(new THREE.Vector4()),     // group seconds, splat seconds, fade (share of the splat's time), stutter
      rPath: dyno.dynoVec4(new THREE.Vector4()),     // here / a point / above, spring, swirl, offset to the side
      rFall: dyno.dynoVec4(new THREE.Vector4()),     // drawn in: lowest start, highest start (card units out), streak, dot size
      rDrawn: dyno.dynoVec4(new THREE.Vector4(0, 0.75, 0, 0)),    // drawn in: share seen in the air, tipping point, from the card?, -
      rLead: dyno.dynoVec4(new THREE.Vector4()),     // leader share, leaders' share of the group time, when the rest start, leader size
      rSize: dyno.dynoVec4(new THREE.Vector4()),     // leader hold, leader shrink (seconds), leader opacity when big, -
      rEdge: dyno.dynoVec4(new THREE.Vector4()),     // front softness, start size, flash, sideways slide
    };
    this.types = {
      rOn: 'float', rT: 'float', rGrade: 'vec3', rPeople: 'float', rWindow: 'vec2', rMin: 'vec3', rInv: 'vec3', rPoint: 'vec4',
      rGroup: 'vec4', rTime: 'vec4', rPath: 'vec4', rFall: 'vec4', rDrawn: 'vec4', rLead: 'vec4', rSize: 'vec4', rEdge: 'vec4',
    };
    this.globals = globals;
    this.statements = statements;
    this.state = null;
    this.progress = 0;     // 0 to 1 through the rise, for what moves with it
    this.onEnd = null;
    look.splatRise = this;
  }

  /** The card's size, for the window; the look's subject record: the figure's box in the card frame. */
  bind(entry, card) {
    this.uniforms.rWindow.value.set(card.width / 2, card.height / 2);
    const u = this.uniforms, depth = this.look.shared.uDepthScale.value;
    const b = entry.box.clone();
    b.min.z *= depth; b.max.z *= depth;      // the same flattening the splats get
    u.rMin.value.copy(b.min);
    u.rInv.value.set(1 / (b.max.x - b.min.x), 1 / (b.max.y - b.min.y), 1 / (b.max.z - b.min.z));
    this.box = b;
  }

  /** A point given as a share of the figure's box, in the card frame. */
  at([x, y, z]) {
    const { min, max } = this.box;
    return new THREE.Vector3(min.x + x * (max.x - min.x), min.y + y * (max.y - min.y), min.z + z * (max.z - min.z));
  }

  /** Hold every splat back, ready for play(): the card with nothing on it. */
  hide() {
    this.uniforms.rOn.value = 1;
    this.uniforms.rT.value = -1;
    this.uniforms.rTime.value.x = 1;
    this.uniforms.rLead.value.set(0, 0, 0, 0);
    this.look.shared.uEmerge.value = 0;
  }

  play(design, { speed = 1, dial, flipped, face = [0.5, 0.78, 1] } = {}) {
    const d = {
      ...design,
      ...(design.dial && dial !== undefined ? { [design.dial.key]: dial } : null),
      ...(flipped ? design.flip?.set : null),
    };
    const u = this.uniforms;
    const point = this.at(d.point === 'face' ? face : d.point ?? [0.5, 0.5, 0.5]);
    u.rPoint.value.set(point.x, point.y, point.z, d.reach ?? 1);
    u.rGroup.value.set(ORDER[d.order], d.pace ?? 1, d.lines ? 1 : 0, d.lines ?? d.clump ?? 0);
    u.rTime.value.set(d.total, d.life, d.fade ?? 0, d.stutter ?? 0);
    u.rPath.value.set(FROM[d.from ?? 'here'], d.spring ?? 0, d.swirl ?? 0, d.side ?? 0);
    u.rFall.value.set(d.fall?.[0] ?? 0, d.fall?.[1] ?? 0, d.streak ?? 0, d.dot ?? 0);
    u.rDrawn.value.set(d.seen ?? 0, d.tip ?? 0.75, d.fromCard ? 1 : 0, 0);
    u.rLead.value.set(d.leaders ?? 0, d.leadSpan ?? 1, d.fillFrom ?? 0, d.leadSize ?? 0);
    u.rSize.value.set(d.leadHold ?? 0, d.leadShrink ?? 1, d.leadAlpha ?? 1, 0);
    u.rEdge.value.set(d.edge ?? 0, d.size ?? 0, d.flash ?? 0, d.slide ?? 0);
    u.rOn.value = 1;
    u.rT.value = -1;
    const end = d.total + d.life + (d.leaders ? d.leadHold + d.leadShrink : 0);
    this.progress = 0;
    this.state = { start: this.look.time + (d.wait ?? 0.35), end, speed, cardTime: Math.min(end * 0.6, 1.2), ignite: d.ignite };
    this.look.shared.uEmerge.value = 0;
    if (this.look.params.flickerRate > 0) { this.flickerRate = this.look.params.flickerRate; this.look.params.flickerRate = 0; }
  }

  /** Per frame, before the look renders. */
  update(time) {
    const st = this.state;
    if (!st) return;
    const t = (time - st.start) * st.speed;
    this.progress = clamp01(t / st.end);
    this.uniforms.rT.value = t;
    this.look.shared.uEmerge.value = clamp01((time - st.start + 0.3) / (st.cardTime + 0.3));
    if (st.ignite && t > 0) { st.ignite = false; this.look.triggerFlicker('ignite'); }
    if (t >= st.end) {
      this.state = null;
      this.uniforms.rOn.value = 0;
      this.look.shared.uEmerge.value = 1;
      if (this.flickerRate) { this.look.params.flickerRate = this.flickerRate; this.flickerRate = 0; }
      this.onEnd?.();
    }
  }
}
