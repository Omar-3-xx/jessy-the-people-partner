/*
 * Jessy's talking face: one WebGL fragment shader that bends the approved
 * portrait (public/images/jessy-portrait.webp, 1254 x 1254) into a mouth that
 * opens, eyes that blink, look about and smile, brows that lift, and a head
 * that tilts and breathes. Nothing is drawn from scratch except the inside of
 * the mouth and the eyelids; everything else is the portrait's own pixels,
 * moved.
 *
 * Every landmark below was MEASURED on that portrait, not guessed: the mouth
 * and chin off a pixel grid, the eyes by fitting the dark lash ring. Change the
 * picture and they must all be measured again.
 *
 * The eye half-widths include the outer lash, which runs past the lid, so they
 * read a little wide; they are the one pair of numbers worth nudging by eye
 * against the running page. Everything else is a direct reading.
 *
 * This file imports nothing, so node can read it in tests/.
 */

export const PORTRAIT = '/images/jessy-portrait.webp';
export const PORTRAIT_SIZE = 1254;

/** The part of the portrait the face shows: centred on the face, tall enough for the chin to drop. */
export const FACE_CENTRE = { x: 641, y: 619 };
export const FACE_HALF_HEIGHT = 255;

/**
 * The rectangle of the portrait, in its own pixels, that fills a stage of this width-to-height
 * ratio. A stage wider than the portrait allows (a phone on its side) shows its full width and a
 * thinner band of the face, never a stretched one.
 */
export function faceView(aspect: number): [number, number, number, number] {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const w = Math.min(PORTRAIT_SIZE, FACE_HALF_HEIGHT * 2 * a);
  const h = w / a;
  return [FACE_CENTRE.x - w / 2, FACE_CENTRE.y - h / 2, w, h];
}

export const VERTEX_SHADER = `
attribute vec2 a;
varying vec2 vUv;
void main() { vUv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }
`;

export const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D uTex;
uniform vec4 uView;
uniform float uOpen, uWide, uBlink, uSquint, uBrow, uHead, uBob;
uniform vec2 uLook;
varying vec2 vUv;

// The mouth: its centre, half its width, how far its corners rise, and the bottom of the chin.
const vec2 MC = vec2(660.0, 716.0);
const float HW = 95.0;
const float SMILE = 6.0;
const float CHIN = 830.0;
// Each eye's dark lash ring, fitted by least squares. Her head sits about 7 degrees off level,
// so both eyes carry the same tilt.
const vec2 EL = vec2(502.0, 540.0);
const vec2 ER = vec2(781.0, 506.0);
const vec2 RL = vec2(79.0, 47.5);
const vec2 RR = vec2(72.5, 53.5);
const float TL = -0.1204;
const float TR = -0.1204;
// The skin just above and below each eye, the colour its lids take.
const vec3 FUR_LU = vec3(0.903, 0.509, 0.354);
const vec3 FUR_LD = vec3(0.891, 0.468, 0.356);
const vec3 FUR_RU = vec3(0.987, 0.647, 0.491);
const vec3 FUR_RD = vec3(0.963, 0.596, 0.468);

vec3 tex(vec2 p) { return texture2D(uTex, clamp(p, 0.5, 1253.5) / 1254.0).rgb; }
float lipLine(float x) { float d = (x - MC.x) / HW; return MC.y - SMILE * min(d * d, 1.4); }

// The eye's contents slide to look about; its outline stays put.
vec2 eyeLook(vec2 p, vec2 c, vec2 r) {
  float e = length((p - c) / r);
  return p - uLook * vec2(7.0, 5.0) * (1.0 - smoothstep(0.3, 0.97, e));
}

// Lids, painted inside the eye's dark outline. The upper lid is the eye's own top arch slid down,
// so half-closed it curves like a real lid; the lower lid rises as an arch for a smile or a laugh,
// and comes up to meet the upper one when the eye shuts, leaving a curved lash line.
// shade darkens the eyeball just under a lid edge: the shadow the lid casts.
vec4 lids(vec2 pw, vec2 c, vec2 r, float tilt, vec3 upFur, vec3 loFur, out float shade) {
  shade = 0.0;
  vec2 w = pw - c;
  vec2 p = vec2(cos(tilt) * w.x + sin(tilt) * w.y, -sin(tilt) * w.x + cos(tilt) * w.y);
  vec2 d = p / r;
  float s = 1.0 - d.x * d.x;
  if (s <= 0.0) return vec4(0.0);
  float k = sqrt(s);
  float inside = 1.0 - smoothstep(0.955, 1.005, length(d));
  if (inside <= 0.0) return vec4(0.0);
  vec4 o = vec4(0.0);
  float squint = max(uSquint, 0.42 * smoothstep(0.55, 1.0, uBlink));
  if (uBlink > 0.004) {
    float top = -r.y * k;
    float t = top + uBlink * 1.52 * r.y - p.y;
    // Round like the eye under it: lit from above, darker where it curls under at its edge.
    vec3 n = normalize(vec3(d.x, d.y, 1.2 * sqrt(max(0.0, 1.0 - dot(d, d)))));
    float lit = 0.66 + 0.42 * max(dot(n, normalize(vec3(-0.35, -0.6, 0.75))), 0.0);
    vec3 lid = upFur * lit * mix(0.74, 1.0, smoothstep(0.0, 10.0, t));
    float lw = 1.4 + 1.6 * k;
    lid = mix(lid, vec3(0.1, 0.06, 0.045), 1.0 - smoothstep(lw - 0.8, lw + 0.6, t));
    o = vec4(lid, inside * smoothstep(-0.9, 0.5, t));
    if (t < 0.0) shade = inside * 0.38 * (1.0 - smoothstep(0.0, 9.0, -t));
  }
  if (squint > 0.004) {
    float t = p.y - r.y * ((1.0 - 1.25 * squint) + 0.9 * squint * d.x * d.x);
    // A cheek pushed up: its top catches the light, lower down it turns away.
    vec3 lid = loFur * mix(1.03, 0.84, smoothstep(2.0, 20.0, t)) * mix(0.8, 1.0, smoothstep(0.0, 4.0, t)) * mix(0.84, 1.0, k);
    lid = mix(lid, vec3(0.3, 0.17, 0.12), 0.75 * (1.0 - smoothstep(0.6, 1.9, t)));
    float a = inside * smoothstep(-0.9, 0.5, t);
    // The upper lid stays on top where both are down.
    float outA = o.a + a * (1.0 - o.a);
    o = vec4((o.rgb * o.a + lid * a * (1.0 - o.a)) / max(outA, 0.0001), outA);
    if (t < 0.0) shade = max(shade, inside * 0.22 * (1.0 - smoothstep(0.0, 5.0, -t)));
  }
  return o;
}

void main() {
  vec2 p = uView.xy + vec2(vUv.x, 1.0 - vUv.y) * uView.zw;

  // Head: turns about the neck and rises with each breath; the body stays.
  float wh = 1.0 - smoothstep(640.0, 780.0, p.y);
  vec2 pivot = vec2(512.0, 790.0);
  float a = -uHead * wh;
  vec2 d0 = p - pivot;
  p = pivot + vec2(cos(a) * d0.x - sin(a) * d0.y, sin(a) * d0.x + cos(a) * d0.y);
  p.y -= uBob * wh;
  vec2 face = p;

  // Brows: the fur over each eye lifts.
  for (int i = 0; i < 2; i++) {
    vec2 c = (i == 0 ? EL : ER) + vec2(0.0, -88.0);
    p.y += uBrow * 9.0 * (1.0 - smoothstep(0.0, 1.0, length((p - c) / vec2(78.0, 46.0))));
  }

  // Mouth. Above the lip line nothing moves; the gap opens as a lens between the corners,
  // the lower lip follows it, and the chin drops, stretching smoothly out to the cheeks.
  float ax = abs(p.x - MC.x);
  float lipZone = (1.0 - smoothstep(24.0, 60.0, abs(p.y - 590.0))) * (1.0 - smoothstep(HW * 1.1, HW * 1.7, ax));
  vec2 q = vec2(MC.x + (p.x - MC.x) / mix(1.0, uWide, lipZone), p.y);
  float hwO = HW * uWide;
  float u = ax / hwO;
  float o = uOpen * 42.0 * max(0.0, 1.0 - u * u);
  float gx = ax / (HW * 1.9);
  float dChin = uOpen * 46.0 * (gx < 1.0 ? 0.5 + 0.5 * cos(3.14159 * gx) : 0.0);
  float line = lipLine(MC.x + (p.x - MC.x) / uWide);
  float mouthA = 0.0;
  vec3 mouthC = vec3(0.0);
  if (p.y > line + o * 0.5) {
    float below = max(p.y - line - o, 0.0);
    float D = o + (dChin - o) * smoothstep(0.0, CHIN - line, below);
    D *= 1.0 - smoothstep(CHIN + 5.0, CHIN + 65.0, p.y);
    q.y = p.y - max(D, 0.0);
  }
  if (ax < hwO && o > 0.3 && p.y > line - 1.0 && p.y < line + o + 1.5) {
    float t = clamp((p.y - line) / o, 0.0, 1.0);
    vec3 c = mix(vec3(0.12, 0.025, 0.03), vec3(0.33, 0.07, 0.08), smoothstep(0.2, 0.95, t));
    vec2 dt = (p - vec2(MC.x, line + o * 1.02)) / vec2(hwO * 0.52, o * 0.48 + 0.5);
    float tongue = (1.0 - smoothstep(0.78, 1.0, length(dt))) * smoothstep(0.15, 0.35, uOpen);
    c = mix(c, vec3(0.72, 0.31, 0.34) * (0.75 + 0.25 * clamp(-dt.y, 0.0, 1.0)), tongue);
    // The upper teeth carry on down into the gap a little.
    float th = min(o * 0.32, 7.0);
    float teeth = (1.0 - smoothstep(th - 1.5, th, p.y - line)) * (1.0 - smoothstep(36.0, 46.0, ax));
    vec3 tcol = tex(vec2(p.x, line - 1.5 - (p.y - line) * 0.6)) * mix(1.0, 0.8, clamp((p.y - line) / max(th, 1.0), 0.0, 1.0));
    c = mix(c, tcol, teeth);
    c *= mix(0.6, 1.0, smoothstep(0.0, 0.35, t) * (1.0 - teeth) + teeth);
    mouthA = smoothstep(-0.8, 0.8, p.y - line) * smoothstep(-0.8, 1.2, line + o - p.y) * (1.0 - smoothstep(hwO - 2.5, hwO, ax));
    mouthC = c;
  }

  q = eyeLook(q, EL, RL);
  q = eyeLook(q, ER, RR);

  vec3 col = tex(q);
  col = mix(col, mouthC, mouthA);
  float sh1, sh2;
  vec4 l1 = lids(face, EL, RL, TL, FUR_LU, FUR_LD, sh1);
  vec4 l2 = lids(face, ER, RR, TR, FUR_RU, FUR_RD, sh2);
  col *= 1.0 - max(sh1, sh2);
  col = mix(col, l1.rgb, l1.a);
  col = mix(col, l2.rgb, l2.a);
  gl_FragColor = vec4(col, 1.0);
}
`;
