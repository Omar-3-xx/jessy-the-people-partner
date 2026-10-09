/*
 * Jessy's talking face: one WebGL fragment shader that bends the approved render
 * (public/images/jessy-free.webp — his full-figure render with the black it was
 * generated on flood-filled away, 1254 x 1254) into a mouth that opens, eyes that
 * blink, look about and smile, brows that lift, and a head that tilts and breathes.
 * Nothing is drawn from scratch except the inside of the mouth and the eyelids;
 * everything else is the render's own pixels, moved.
 *
 * Every landmark below was MEASURED on that render, not guessed: the eyes by
 * fitting the dark lash ring, the mouth off its own lip line, the chin at the row
 * where the face stops narrowing and the neck begins. Change the render and they
 * must all be measured again.
 *
 * S is the one number that carries the tuning over. The distances inside the
 * shader — how far the chin drops, how thick a lid is, how far the brow lifts —
 * were tuned by eye on the earlier head-and-shoulders render, where the face was
 * bigger in the frame. This render holds her whole figure, so the same face is
 * 0.656 of that size: eyes 183 pixels apart against 279. Every tuned distance is
 * multiplied by S, which is why they are still written as the numbers that were
 * tuned.
 *
 * This file imports nothing, so node can read it in tests/.
 */

export const PORTRAIT = '/images/jessy-free.webp';
export const PORTRAIT_SIZE = 1254;

/*
 * She is not framed. The view holds the WHOLE render and lets the page show around it, so there is
 * no crop line anywhere — what used to be a tight box around her face is gone. FACE_CENTRE is the
 * render's own centre, and the numbers below it are landmarks in the render's pixels, which do not
 * move with the framing.
 */
export const FACE_CENTRE = { x: 627, y: 627 };
export const PORTRAIT_HALF = PORTRAIT_SIZE / 2;

/**
 * The rectangle of the render, in its own pixels, the stage shows.
 *
 * She stands on the floor of the page: her height is the stage's height and her feet — the bottom
 * edge of the render, where the jumper is cut — sit on the stage's bottom edge, which the page puts
 * off the end of the screen so that cut is never seen. A stage narrower than she is lets her run
 * off both sides, which is what standing on a page looks like; a wider one leaves clear page beside
 * her. `zoom` above 1 brings her nearer (she leans in to listen) and pulls up towards her face
 * rather than her chest; dx/dy slide her about as she shifts her weight.
 */
export function faceView(aspect: number, zoom = 1, dx = 0, dy = 0): [number, number, number, number] {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const z = zoom > 0.2 ? zoom : 1;
  const h = PORTRAIT_SIZE / z;
  const w = h * a;
  return [FACE_CENTRE.x - w / 2 + dx, (PORTRAIT_SIZE - h) * 0.72 + dy, w, h];
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
uniform float uOpen, uWide, uBlink, uSquint, uBrow, uHead, uBob, uYaw;
uniform vec2 uLook;
varying vec2 vUv;

// Everything below is in the render's own pixels. S scales the distances that were tuned on the
// earlier, larger-in-frame render; the positions are measured on this one and are not scaled.
const float S = 0.656;
// The mouth: its centre, half its width, how far its corners rise, and the bottom of the chin.
const vec2 MC = vec2(646.0, 484.0);
const float HW = 57.0;
const float SMILE = 4.0;
const float CHIN = 552.0;
// The head as a cylinder, for the turn: the axis it spins about and its radius. The axis is the
// midpoint of the two eyes; the radius is the half-width of the face itself, not of the hair,
// because it is the face that has to travel the right distance.
const float HEAD_X = 636.0;
const float HEAD_R = 210.0;
// Each eye's dark lash ring, fitted by least squares. Her head sits about 11 degrees off level,
// so both eyes carry the same tilt, taken from the line between their centres.
const vec2 EL = vec2(546.0, 370.0);
const vec2 ER = vec2(726.0, 334.0);
const vec2 RL = vec2(47.3, 33.0);
const vec2 RR = vec2(57.0, 34.0);
const float TL = -0.1974;
const float TR = -0.1974;
// The skin just above and below each eye, the colour its lids take.
const vec3 FUR_LU = vec3(0.860, 0.441, 0.302);
const vec3 FUR_LD = vec3(0.888, 0.423, 0.338);
const vec3 FUR_RU = vec3(0.968, 0.562, 0.400);
const vec3 FUR_RD = vec3(0.929, 0.507, 0.404);

vec4 texel(vec2 p) {
  if (p.x < 0.0 || p.x > 1254.0 || p.y < 0.0 || p.y > 1254.0) return vec4(0.0);
  return texture2D(uTex, clamp(p, 0.5, 1253.5) / 1254.0);
}
vec3 tex(vec2 p) { return texel(p).rgb; }
float lipLine(float x) { float d = (x - MC.x) / HW; return MC.y - SMILE * min(d * d, 1.4); }

// The eye's contents slide to look about; its outline stays put.
vec2 eyeLook(vec2 p, vec2 c, vec2 r) {
  float e = length((p - c) / r);
  return p - uLook * vec2(7.0, 5.0) * S * (1.0 - smoothstep(0.3, 0.97, e));
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
    vec3 lid = upFur * lit * mix(0.74, 1.0, smoothstep(0.0, 10.0 * S, t));
    float lw = (1.4 + 1.6 * k) * S;
    lid = mix(lid, vec3(0.1, 0.06, 0.045), 1.0 - smoothstep(lw - 0.8 * S, lw + 0.6 * S, t));
    o = vec4(lid, inside * smoothstep(-0.9 * S, 0.5 * S, t));
    if (t < 0.0) shade = inside * 0.38 * (1.0 - smoothstep(0.0, 9.0 * S, -t));
  }
  if (squint > 0.004) {
    float t = p.y - r.y * ((1.0 - 1.25 * squint) + 0.9 * squint * d.x * d.x);
    // A cheek pushed up: its top catches the light, lower down it turns away.
    vec3 lid = loFur * mix(1.03, 0.84, smoothstep(2.0 * S, 20.0 * S, t)) * mix(0.8, 1.0, smoothstep(0.0, 4.0 * S, t)) * mix(0.84, 1.0, k);
    lid = mix(lid, vec3(0.3, 0.17, 0.12), 0.75 * (1.0 - smoothstep(0.6 * S, 1.9 * S, t)));
    float a = inside * smoothstep(-0.9 * S, 0.5 * S, t);
    // The upper lid stays on top where both are down.
    float outA = o.a + a * (1.0 - o.a);
    o = vec4((o.rgb * o.a + lid * a * (1.0 - o.a)) / max(outA, 0.0001), outA);
    if (t < 0.0) shade = max(shade, inside * 0.22 * (1.0 - smoothstep(0.0, 5.0 * S, -t)));
  }
  return o;
}

void main() {
  vec2 p = uView.xy + vec2(vUv.x, 1.0 - vUv.y) * uView.zw;

  // Head: turns about the neck and rises with each breath; the body stays.
  // The head turns; the neck and the body below it do not.
  float wh = 1.0 - smoothstep(CHIN - 123.0 * S, CHIN + 90.0 * S, p.y);
  vec2 pivot = vec2(551.0, 526.0);
  float a = -uHead * wh;
  vec2 d0 = p - pivot;
  p = pivot + vec2(cos(a) * d0.x - sin(a) * d0.y, sin(a) * d0.x + cos(a) * d0.y);
  p.y -= uBob * wh;

  /*
   * And she turns it. Not a slide sideways, which reads as the whole picture sliding: the face is
   * treated as a cylinder, so a point at texture offset u sits at angle asin(u/R) around it and the
   * turn moves it to R*sin(that + yaw). Her near cheek sweeps across while the far one bunches up
   * against the silhouette, which is what a head actually does. The warp is faded out before the
   * silhouette itself, so her hair keeps its own outline instead of folding over at the edge, and
   * wh keeps the neck and the body below it still.
   */
  float yaw = uYaw * wh;
  if (abs(yaw) > 0.0005) {
    float sx = (p.x - HEAD_X) / HEAD_R;
    float turned = HEAD_R * sin(asin(clamp(sx, -1.0, 1.0)) - yaw);
    p.x = HEAD_X + mix(turned, p.x - HEAD_X, smoothstep(0.80, 1.0, abs(sx)));
  }
  vec2 face = p;

  // Brows: the fur over each eye lifts.
  for (int i = 0; i < 2; i++) {
    vec2 c = (i == 0 ? EL : ER) + vec2(0.0, -88.0 * S);
    p.y += uBrow * 9.0 * S * (1.0 - smoothstep(0.0, 1.0, length((p - c) / (vec2(78.0, 46.0) * S))));
  }

  // Mouth. Above the lip line nothing moves; the gap opens as a lens between the corners,
  // the lower lip follows it, and the chin drops, stretching smoothly out to the cheeks.
  float ax = abs(p.x - MC.x);
  float lipZone = (1.0 - smoothstep(24.0 * S, 60.0 * S, abs(p.y - (MC.y - 126.0 * S)))) * (1.0 - smoothstep(HW * 1.1, HW * 1.7, ax));
  vec2 q = vec2(MC.x + (p.x - MC.x) / mix(1.0, uWide, lipZone), p.y);
  float hwO = HW * uWide;
  float u = ax / hwO;
  float o = uOpen * 42.0 * S * max(0.0, 1.0 - u * u);
  float gx = ax / (HW * 1.9);
  float dChin = uOpen * 46.0 * S * (gx < 1.0 ? 0.5 + 0.5 * cos(3.14159 * gx) : 0.0);
  float line = lipLine(MC.x + (p.x - MC.x) / uWide);
  float mouthA = 0.0;
  vec3 mouthC = vec3(0.0);
  if (p.y > line + o * 0.5) {
    float below = max(p.y - line - o, 0.0);
    float D = o + (dChin - o) * smoothstep(0.0, CHIN - line, below);
    D *= 1.0 - smoothstep(CHIN + 5.0 * S, CHIN + 65.0 * S, p.y);
    q.y = p.y - max(D, 0.0);
  }
  if (ax < hwO && o > 0.3 * S && p.y > line - 1.0 * S && p.y < line + o + 1.5 * S) {
    float t = clamp((p.y - line) / o, 0.0, 1.0);
    vec3 c = mix(vec3(0.12, 0.025, 0.03), vec3(0.33, 0.07, 0.08), smoothstep(0.2, 0.95, t));
    vec2 dt = (p - vec2(MC.x, line + o * 1.02)) / vec2(hwO * 0.52, o * 0.48 + 0.5 * S);
    float tongue = (1.0 - smoothstep(0.78, 1.0, length(dt))) * smoothstep(0.15, 0.35, uOpen);
    c = mix(c, vec3(0.72, 0.31, 0.34) * (0.75 + 0.25 * clamp(-dt.y, 0.0, 1.0)), tongue);
    // The upper teeth carry on down into the gap a little.
    float th = min(o * 0.32, 7.0 * S);
    float teeth = (1.0 - smoothstep(th - 1.5 * S, th, p.y - line)) * (1.0 - smoothstep(36.0 * S, 46.0 * S, ax));
    vec3 tcol = tex(vec2(p.x, line - 1.5 * S - (p.y - line) * 0.6)) * mix(1.0, 0.8, clamp((p.y - line) / max(th, 1.0), 0.0, 1.0));
    c = mix(c, tcol, teeth);
    c *= mix(0.6, 1.0, smoothstep(0.0, 0.35, t) * (1.0 - teeth) + teeth);
    mouthA = smoothstep(-0.8 * S, 0.8 * S, p.y - line) * smoothstep(-0.8 * S, 1.2 * S, line + o - p.y) * (1.0 - smoothstep(hwO - 2.5 * S, hwO, ax));
    mouthC = c;
  }

  q = eyeLook(q, EL, RL);
  q = eyeLook(q, ER, RR);

  vec4 sampled = texel(q);
  vec3 col = sampled.rgb;
  // Where she is not, the page shows through. The mouth and the lids are painted inside her face,
  // which is solid, so each of them makes its own pixels solid too.
  float alpha = max(sampled.a, mouthA);
  col = mix(col, mouthC, mouthA);
  float sh1, sh2;
  vec4 l1 = lids(face, EL, RL, TL, FUR_LU, FUR_LD, sh1);
  vec4 l2 = lids(face, ER, RR, TR, FUR_RU, FUR_RD, sh2);
  col *= 1.0 - max(sh1, sh2);
  col = mix(col, l1.rgb, l1.a);
  col = mix(col, l2.rgb, l2.a);
  alpha = max(alpha, max(l1.a, l2.a));
  // Straight alpha, not premultiplied: the canvas is created with premultipliedAlpha false.
  gl_FragColor = vec4(col, alpha);
}
`;
