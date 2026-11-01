// GLSL for the hologram look. Nothing in here knows what the subject is.

export const NOISE = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i), b = hash13(i + vec3(1,0,0)), c = hash13(i + vec3(0,1,0)), d = hash13(i + vec3(1,1,0));
  float e = hash13(i + vec3(0,0,1)), g = hash13(i + vec3(1,0,1)), h = hash13(i + vec3(0,1,1)), k = hash13(i + vec3(1,1,1));
  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
}
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s / 0.875;
}
`;

// ---------------------------------------------------------------------------
// Subject material: turns any mesh into light. Works in the emitter's frame
// (the card): local +Z is the direction the light is projected, z = 0 is the
// emitting surface.
// ---------------------------------------------------------------------------
export const subjectVertex = /* glsl */ `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>

uniform mat4 uEmitter;
uniform mat4 uEmitterInv;
uniform float uDepthScale;   // emergence: 0 = flat on the card, 1 = full depth

varying vec3 vWorldPos;      // displayed position
varying vec3 vShadePos;      // full-depth position (shading as if fully formed)
varying vec3 vShadeNormal;   // full-depth normal
varying vec3 vEm;            // emitter-local (full depth)
varying vec2 vUv;
#ifdef USE_COLOR
varying vec3 vColor;
#endif

void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinnormal_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>

  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vec3 wn = normalize(mat3(modelMatrix) * objectNormal);
  vShadePos = wp.xyz;
  vShadeNormal = wn;

  vec4 ep = uEmitterInv * wp;
  vEm = ep.xyz;
  // rise out of the emitter: depth along the projection axis grows from 0 to full
  ep.z *= max(uDepthScale, 0.003);
  wp = uEmitter * ep;
  vWorldPos = wp.xyz;

  vUv = uv;
  #ifdef USE_COLOR
  vColor = color;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const subjectFragment = /* glsl */ `
uniform mat4 uEmitter;
uniform vec3 uTint;          // linear light colour (mid tones)
uniform vec3 uShadowTint;    // linear light colour in the dim parts (warmer)
uniform vec3 uLight;         // colour of the light itself (the tint, or near white at tint 0)
uniform float uTintAmt;      // 0 = the subject's own colours, 1 = recoloured in the light's hue
uniform vec3 uBaseColor;
uniform float uAlbedoNorm;   // normalises the subject's average albedo
uniform float uKeepColor;    // how much of the subject's own chroma survives
uniform float uExposure;
uniform float uRim;
uniform float uScan;
uniform float uScanFreq;
uniform float uBand;
uniform float uPlay;
uniform float uTime;
uniform float uEmerge;
uniform vec2 uFadeY;         // emitter-local y range where the bottom thins out
uniform float uBaseFade;     // depth over which light thins where it meets the emitter
uniform vec3 uKeyDir;        // emitter-local key direction (shading baked into the light)
uniform float uNormalScale;
uniform float uEdgeSoft;
uniform float uForm;
uniform float uInner;
#ifdef USE_HOLO_MAP
uniform sampler2D map;
#endif
#ifdef USE_HOLO_NORMALMAP
uniform sampler2D normalMap;
#endif

varying vec3 vWorldPos;
varying vec3 vShadePos;
varying vec3 vShadeNormal;
varying vec3 vEm;
varying vec2 vUv;
#ifdef USE_COLOR
varying vec3 vColor;
#endif

${NOISE}

vec3 perturb(vec3 N, vec3 p, vec2 uv, vec3 mapN) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float m = max(dot(T, T), dot(B, B));
  if (m < 1e-12) return N;
  float inv = inversesqrt(m);
  return normalize(mat3(T * inv, B * inv, N) * mapN);
}

void main() {
  vec3 albedo = uBaseColor;
  #ifdef USE_HOLO_MAP
  albedo *= texture2D(map, vUv).rgb;
  #endif
  #ifdef USE_COLOR
  albedo *= vColor;
  #endif

  vec3 N = normalize(vShadeNormal);
  if (!gl_FrontFacing) N = -N;
  #ifdef USE_HOLO_NORMALMAP
  vec3 mapN = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
  mapN.xy *= uNormalScale;
  N = perturb(N, vShadePos, vUv, normalize(mapN));
  #endif

  vec3 V = normalize(cameraPosition - vWorldPos);
  mat3 E = mat3(uEmitter);
  vec3 L = normalize(E * uKeyDir);
  vec3 F = normalize(E * vec3(0.0, 0.0, 1.0));

  // Light that has the form baked in, like a photograph made of light:
  // soft wrapped key from the emitter's frame plus fill from the card direction.
  // It emits rather than being lit, so keep the modelling gentle (uForm = 0 is flat light).
  float wrap = 0.6;
  float key = clamp((dot(N, L) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float fill = 0.5 + 0.5 * dot(N, F);
  float modelled = 0.07 + 0.95 * key * key + 0.14 * fill;
  float shade = mix(0.82 + 0.18 * fill, modelled, uForm);

  float lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  // Living light: a slow interference pattern flowing out of the card across the form.
  float play = fbm3(vEm * vec3(3.2, 3.2, 3.2) + vec3(0.0, -uTime * 0.11, -uTime * 0.23));
  float pl = 1.0 + uPlay * 0.32 * (play - 0.5);
  float l = lum * uAlbedoNorm * shade * uExposure * pl;
  // the subject's own colours, as for tint 0: the photo's own levels (the bloom and haze lift it), not
  // normalised like the light (that would blow out the bright parts of a dark photo)
  vec3 photo = albedo * shade * uExposure * pl * 1.0;

  // Map luminance onto the light colour: warm orange in the dim parts, the tint in the
  // lit parts. Highlights roll toward white in the tone curve later.
  // At tint 0 the light keeps the subject's own colour at the same level.
  vec3 ramp = mix(uShadowTint, uTint, smoothstep(0.05, 0.6, l));
  vec3 chroma = albedo / max(lum, 1e-3);
  chroma = clamp(chroma, 0.0, 3.0);
  vec3 col = mix(photo, ramp * l * mix(vec3(1.0), chroma, uKeepColor), uTintAmt);

  // Rim: light is densest where you look through the most of it (the silhouette).
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 2.5);
  col += uLight * rim * uRim * 0.9;

  // Projection structure in the emitter frame: faint fine lines, a slow broad ripple,
  // and the occasional brighter band climbing through.
  float ly = vEm.y * uScanFreq;
  float fw = fwidth(ly);
  float fine = 0.5 + 0.5 * cos(6.28318 * ly - uTime * 1.3);
  fine = mix(fine, 0.5, smoothstep(0.25, 0.7, fw));
  float ripple = 0.5 + 0.5 * sin(vEm.y * 21.0 + uTime * 0.8 + vEm.z * 6.0);
  col *= 1.0 - uScan * (0.45 * fine + 0.25 * ripple);
  float band = exp(-pow((vEm.y - uBand) / 0.05, 2.0));
  col *= 1.0 + (0.3 + uScan) * 0.9 * band;

  // Density: thin out where the figure meets the card and at the cut bottom edge.
  float a = smoothstep(uFadeY.x, uFadeY.y, vEm.y);
  a *= mix(0.45, 1.0, smoothstep(0.0, uBaseFade, abs(vEm.z)));   // light leaves both faces
  // brief flare as it rises out of the flat photograph
  col *= 1.0 + 0.6 * (1.0 - smoothstep(0.0, 0.7, uEmerge)) * smoothstep(0.0, 0.15, uEmerge);
  a *= smoothstep(0.0, 0.08, uEmerge);
  // Soft edge: at the silhouette the light thins out to nothing instead of ending on a hard line.
  a *= mix(1.0, smoothstep(0.0, 0.4, ndv), uEdgeSoft);

  // A projection cannot make black: where the light is dim you see through it.
  float lit = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float occ = a * (0.18 + 0.82 * smoothstep(0.03, 0.55, lit));
  #ifdef HOLO_INNER
  // far side of the form, seen faintly through the near side: gives the light volume
  gl_FragColor = vec4(col * a * uInner, 0.0);
  #else
  gl_FragColor = vec4(col * a, occ);
  #endif
}
`;

// ---------------------------------------------------------------------------
// Fullscreen passes
// ---------------------------------------------------------------------------
export const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const copyFragment = /* glsl */ `
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }
`;

// Light pass: the time behaviour of the light applied to the whole light layer.
export const lightFragment = /* glsl */ `
uniform sampler2D tHolo;
uniform sampler2D tEcho1;
uniform sampler2D tEcho2;
uniform vec2 uRes;
uniform vec2 uCenter;      // screen uv of the subject
uniform vec2 uJitter;      // px
uniform float uBright;
uniform float uHue;       // turns
uniform float uHueMix;
uniform float uDesat;
uniform float uChroma;     // px
uniform float uEcho1;
uniform float uEcho2;
uniform vec2 uGhostOff;    // uv offset of ghosts during bursts
varying vec2 vUv;

// hue shift in HSV (works for HDR values: V may exceed 1)
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
vec3 hueShift(vec3 c, float turns) {
  if (abs(turns) < 1e-4) return c;
  vec3 h = rgb2hsv(max(c, 0.0));
  h.x = fract(h.x + turns);
  return hsv2rgb(h);
}

void main() {
  vec2 px = 1.0 / uRes;
  vec2 uv = vUv + uJitter * px;
  vec2 dir = uv - uCenter;
  dir = length(dir) > 1e-4 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 ca = dir * uChroma * px;

  vec4 h = texture2D(tHolo, uv);
  float r = texture2D(tHolo, uv + ca).r;
  float b = texture2D(tHolo, uv - ca).b;
  h.r = r; h.b = b;

  // stepped ghost copies of the figure where it was a moment ago
  vec4 e1 = texture2D(tEcho1, uv + uGhostOff);
  vec4 e2 = texture2D(tEcho2, uv + uGhostOff * 2.0);
  vec3 rgb = h.rgb;
  rgb += e1.rgb * uEcho1 * (1.0 - 0.65 * h.a);
  rgb += e2.rgb * uEcho2 * (1.0 - 0.65 * h.a);
  float a = max(h.a, max(e1.a * uEcho1, e2.a * uEcho2));

  rgb = mix(rgb, hueShift(rgb, uHue), uHueMix);
  float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(rgb, vec3(l) * vec3(1.02, 0.98, 1.08), uDesat);
  rgb *= uBright;
  gl_FragColor = vec4(rgb, a);
}
`;

// Dual-filter blur for the glow
export const downFragment = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;   // source texel size
varying vec2 vUv;
void main() {
  vec2 o = uTexel;
  vec4 s = texture2D(tSrc, vUv) * 4.0;
  s += texture2D(tSrc, vUv + vec2(-o.x, -o.y));
  s += texture2D(tSrc, vUv + vec2( o.x, -o.y));
  s += texture2D(tSrc, vUv + vec2(-o.x,  o.y));
  s += texture2D(tSrc, vUv + vec2( o.x,  o.y));
  gl_FragColor = s / 8.0;
}
`;

export const upFragment = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexel;   // low texel size
varying vec2 vUv;
void main() {
  vec2 o = uTexel;
  vec4 s = texture2D(tLow, vUv + vec2(-2.0 * o.x, 0.0));
  s += texture2D(tLow, vUv + vec2(-o.x,  o.y)) * 2.0;
  s += texture2D(tLow, vUv + vec2(0.0,  2.0 * o.y));
  s += texture2D(tLow, vUv + vec2( o.x,  o.y)) * 2.0;
  s += texture2D(tLow, vUv + vec2( 2.0 * o.x, 0.0));
  s += texture2D(tLow, vUv + vec2( o.x, -o.y)) * 2.0;
  s += texture2D(tLow, vUv + vec2(0.0, -2.0 * o.y));
  s += texture2D(tLow, vUv + vec2(-o.x, -o.y)) * 2.0;
  gl_FragColor = s / 12.0 + texture2D(tHigh, vUv);
}
`;

// Final composite: stage + light layer (as dense light, not a decal) + glow, tone, grain.
export const compositeFragment = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tLit;
uniform sampler2D tSoft;
uniform sampler2D tGlow;
uniform float uDensity;
uniform float uGlow;
uniform float uSoft;
uniform float uTime;
uniform vec2 uRes;
varying vec2 vUv;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 scene = texture2D(tScene, vUv).rgb;
  vec4 lit = texture2D(tLit, vUv);
  vec4 soft = texture2D(tSoft, vUv);
  vec3 glow = texture2D(tGlow, vUv).rgb * 0.07;

  // soften the light a touch, as in the film
  vec4 L = mix(lit, soft, uSoft);
  vec3 col = scene * (1.0 - clamp(L.a, 0.0, 1.0) * uDensity) + L.rgb + glow * uGlow;

  col = aces(col);
  col = toSRGB(col);
  float g = hash12(vUv * uRes + fract(uTime * 7.13) * 917.0) - 0.5;
  col += g * 0.03;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Gaussian splats. Spark generates every splat each frame through a modifier, then draws
// them sorted. The per-splat part of the light (colour ramp, rim, densities, the rise) runs
// in the modifier; the per-pixel part (scan structure, see-through darks) in the fragment.
// ---------------------------------------------------------------------------

// Per-splat light, as statements for a Spark dyno modifier. `v` maps names to dyno inputs.
// Works in the emitter frame like the mesh material. The splats have colour but no normals:
// the figure's outward direction comes from the gradient of a blurred solid volume of the
// splats (`dens`, object space), weighted by how sharply the volume ends there (`edge`).
export const splatGlobals = /* glsl */ `
float holoHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float holoNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = holoHash13(i), b = holoHash13(i + vec3(1,0,0)), c = holoHash13(i + vec3(0,1,0)), d = holoHash13(i + vec3(1,1,0));
  float e = holoHash13(i + vec3(0,0,1)), g = holoHash13(i + vec3(1,0,1)), h = holoHash13(i + vec3(0,1,1)), k = holoHash13(i + vec3(1,1,1));
  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
}
float holoFbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * holoNoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s / 0.875;
}
`;

export const splatStatements = (v) => /* glsl */ `
${v.out} = ${v.gsplat};
vec3 c = ${v.gsplat}.center;
vec3 e = (${v.objToEm} * vec4(c, 1.0)).xyz;          // emitter frame, full depth

// outward direction of the figure here, from the solid volume
vec3 uvw = (c - ${v.volMin}) * ${v.volInv};
vec3 h = ${v.volTexel};
vec3 grad = vec3(
  texture(${v.dens}, uvw + vec3(h.x, 0.0, 0.0)).r - texture(${v.dens}, uvw - vec3(h.x, 0.0, 0.0)).r,
  texture(${v.dens}, uvw + vec3(0.0, h.y, 0.0)).r - texture(${v.dens}, uvw - vec3(0.0, h.y, 0.0)).r,
  texture(${v.dens}, uvw + vec3(0.0, 0.0, h.z)).r - texture(${v.dens}, uvw - vec3(0.0, 0.0, h.z)).r);
float gl = length(grad);
float edge = smoothstep(0.03, 0.18, gl);
vec3 N = normalize(mat3(${v.objToEm}) * (-grad / max(gl, 1e-5)));
vec3 V = normalize(${v.camEm} - e);
float ndv = mix(1.0, abs(dot(N, V)), edge);

// form, as the mesh: a soft wrapped key from the card's upper left plus fill from the card.
// A capture's colour already carries real light, so it gets half the mesh's modelling.
float key = clamp((dot(N, normalize(vec3(-0.45, 0.55, 1.0))) + 0.6) / 1.6, 0.0, 1.0);
float fill = 0.5 + 0.5 * N.z;
float modelled = 0.07 + 0.95 * key * key + 0.14 * fill;
float shade = mix(1.0, mix(0.82 + 0.18 * fill, modelled, ${v.p1}.w), edge);

// brightness -> light colour, as the mesh: dim parts warm orange, lit parts the tint
vec3 lin = pow(max(${v.gsplat}.rgba.rgb, vec3(0.0)), vec3(2.2));
float lum = dot(lin, vec3(0.2126, 0.7152, 0.0722));
float play = holoFbm3(e * 3.2 + vec3(0.0, -${v.time} * 0.11, -${v.time} * 0.23));
float pl = 1.0 + ${v.p0}.y * 0.32 * (play - 0.5);
float l = lum * ${v.p0}.x * shade * pl;                 // exposure x albedo normalisation x form
vec3 photo = lin * shade * pl * ${v.p2}.y;              // the capture's own colours (tint 0)
// (toward tint 0, p2.x, the capture's own colours)
vec3 ramp = mix(${v.shadowTint}, ${v.tint}, smoothstep(0.05, 0.6, l));
vec3 chroma = clamp(lin / max(lum, 1e-3), 0.0, 3.0);
vec3 col = mix(photo, ramp * l * mix(vec3(1.0), chroma, ${v.p0}.z), ${v.p2}.x);

// rim: light is densest where you look along the figure's surface
col += ${v.light} * pow(1.0 - ndv, 2.5) * ${v.p0}.w * 0.9;

// density: bottom cut-off, thinning where it meets the card, the rise, the soft silhouette
float a = ${v.gsplat}.rgba.a;
a *= smoothstep(${v.fadeY}.x, ${v.fadeY}.y, e.y);
a *= mix(0.45, 1.0, smoothstep(0.0, ${v.p1}.y, abs(e.z)));
float em = ${v.emerge};
col *= 1.0 + 0.6 * (1.0 - smoothstep(0.0, 0.7, em)) * smoothstep(0.0, 0.15, em);
a *= smoothstep(0.0, 0.08, em);
a *= mix(1.0, smoothstep(0.0, 0.4, ndv), ${v.p1}.x);
// a projection can't make black: the darkest parts of a capture are simply not there
a *= smoothstep(${v.p1}.z, ${v.p1}.z * 2.5 + 1e-4, lum);

// rise out of the card: depth along the card normal grows from 0 to full
e.z *= max(${v.depthScale}, 0.003);
${v.rise ?? ''}
${v.out}.center = (${v.emToObj} * vec4(e, 1.0)).xyz;
${v.out}.rgba = vec4(col, clamp(a, 0.0, 1.0));
`;

// Replaces Spark's splat fragment shader (same vertex shader and varyings). Gaussian falloff
// as Spark, then the per-pixel structure of the projection at the pixel's position on the
// card's axes (reconstructed from the splat's NDC), and see-through darks via the alpha.
// With HOLO_DEPTH it writes only the depth of the solid core of each splat, so things in the
// light layer (card attenuation, haze) can depth-test against the figure as with a mesh.
export const splatFragment = /* glsl */ `
precision highp float;
precision highp int;

uniform float falloff;
uniform float minAlpha;
uniform mat4 uNdcToEm;
uniform float uTime;
uniform float uScan;
uniform float uScanFreq;
uniform float uBand;
uniform float uInner;
uniform float uDepthAlpha;
uniform vec2 uWindow;      // half the card, when what is behind it shows only through it (else 0)
uniform vec3 uWindowEye;   // the camera, in the emitter frame

out vec4 fragColor;
in vec4 vRgba;
in vec2 vSplatUv;
in vec3 vNdc;
flat in float adjustedStdDev;

void main() {
  float z2 = dot(vSplatUv, vSplatUv);
  if (z2 > adjustedStdDev * adjustedStdDev) discard;
  float a = vRgba.a;
  if (a <= 1.0) {
    a = mix(a, a * exp(-0.5 * z2), falloff);
  } else {
    float k = exp((a * a - 1.0) / 2.718281828459045);
    a = mix(1.0, 1.0 - pow(1.0 - exp(-0.5 * z2), k), falloff);
  }
  if (a < minAlpha) discard;
#ifdef HOLO_DEPTH
  if (a < uDepthAlpha) discard;
  fragColor = vec4(0.0);
#else
  vec4 pe = uNdcToEm * vec4(vNdc, 1.0);
  vec3 e = pe.xyz / pe.w;
  vec3 col = vRgba.rgb;
  if (uWindow.x > 0.0 && e.z < 0.0) {
    vec2 onCard = uWindowEye.xy + (e.xy - uWindowEye.xy) * uWindowEye.z / (uWindowEye.z - e.z);
    if (any(greaterThan(abs(onCard), uWindow))) discard;
  }

  float ly = e.y * uScanFreq;
  float fw = fwidth(ly);
  float fine = 0.5 + 0.5 * cos(6.28318 * ly - uTime * 1.3);
  fine = mix(fine, 0.5, smoothstep(0.25, 0.7, fw));
  float ripple = 0.5 + 0.5 * sin(e.y * 21.0 + uTime * 0.8 + e.z * 6.0);
  col *= 1.0 - uScan * (0.45 * fine + 0.25 * ripple);
  float band = exp(-pow((e.y - uBand) / 0.05, 2.0));
  col *= 1.0 + (0.3 + uScan) * 0.9 * band;

  // dim light hides little of what is behind it; some of the far side always shows through
  float lit = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float occ = (0.18 + 0.82 * smoothstep(0.03, 0.55, lit)) * (1.0 - 0.6 * uInner);
  fragColor = vec4(col * a, occ * a);
#endif
}
`;
