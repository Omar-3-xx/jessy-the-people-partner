/*
 * Jessy's head, as four real renders instead of one bent one.
 *
 * The site used to take a single flat picture of her and warp its pixels into a mouth, eyelids and
 * a head turn. A bent photograph looks like a bent photograph, which is exactly what he said about
 * it. These are his own renders, one per direction, cut off the grey they were generated on
 * (tools/cut-frames.py) and shifted so her body sits in the same place in all four
 * (tools/register-frames.py, anchored on the pearl of her necklace, because a head turn pivots on
 * the neck and the body must not move).
 *
 * Nothing here is warped. The only thing the page does is choose which frame to draw.
 *
 * This file imports nothing, so node can read it in tests/.
 */

export const FRAME_SIZE = 1254;

export interface Frame {
  src: string;
  /** How far her head is turned, in radians. Positive is towards YOUR right, which is her left. */
  yaw: number;
}

/**
 * In order of the turn, which is the order the page walks through them. The angles are the ones
 * the renders were asked for: a three-quarter view either side, and a full profile one way.
 */
export const FRAMES: Frame[] = [
  { src: '/images/frames/head-right34.webp', yaw: -0.61 },
  { src: '/images/frames/head-front.webp', yaw: 0 },
  { src: '/images/frames/head-left34.webp', yaw: 0.61 },
  { src: '/images/frames/head-profile.webp', yaw: 1.57 },
];

export const YAW_MIN = FRAMES[0].yaw;
export const YAW_MAX = FRAMES[FRAMES.length - 1].yaw;
/** As far as she turns while she is simply following you about. The profile is kept for thinking. */
export const YAW_WATCH = 0.61;

/**
 * How much of the gap between two frames is spent showing both of them.
 *
 * Four frames cannot dissolve into one another for long: halfway through a slow dissolve you see
 * two faces at once, which is worse than a cut. Keeping it narrow means she holds one pose, flicks
 * to the next, and holds that — which is how drawn animation has always done a turn.
 */
export const DISSOLVE = 0.3;

export interface Shown {
  /** The frame underneath. */
  a: number;
  /** The frame drawn over it. */
  b: number;
  /** How solid b is, 0 to 1. At 0 only a is seen, at 1 only b. */
  blend: number;
}

/** Which frames to draw for a given turn, and how far between them she is. */
export function pickFrames(yaw: number): Shown {
  /*
   * Written as two upward comparisons so a yaw that is not a number lands on the first frame
   * rather than poisoning the blend: every comparison against NaN is false, and a NaN alpha
   * would quietly stop her being drawn at all.
   */
  const y = yaw > YAW_MIN ? (yaw < YAW_MAX ? yaw : YAW_MAX) : YAW_MIN;
  let i = 0;
  while (i < FRAMES.length - 2 && y > FRAMES[i + 1].yaw) i++;
  const lo = FRAMES[i].yaw;
  const hi = FRAMES[i + 1].yaw;
  const t = hi === lo ? 0 : (y - lo) / (hi - lo);
  const edge = (1 - DISSOLVE) / 2;
  const raw = (t - edge) / DISSOLVE;
  return { a: i, b: i + 1, blend: raw < 0 ? 0 : raw > 1 ? 1 : raw };
}

/*
 * Her mouth and her blink, as patches.
 *
 * The same rule as the head: these are his renders, not a warp. But a whole second copy of her
 * for every mouth shape would be megabytes, and worse, two renders of her are not the same
 * picture with one thing changed -- her hair comes back re-drawn every time, so swapping whole
 * frames while she talks would re-draw her hair several times a second. So the mouth is cut out
 * of each render and laid over the front frame (tools/compose-visemes.py), which is a few
 * kilobytes and leaves the rest of her exactly the picture he approved.
 *
 * A patch only ever goes on the FRONT frame. When her head is turned you are not looking at her
 * mouth straight on, and there is no render of a turned mouth to be honest with.
 */

export interface Patch {
  src: string;
  /** Where it sits inside the FRAME_SIZE square. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The index in FRAMES of the frame the patches belong to. */
export const FRONT = 1;

/**
 * Her mouth, as the pictures of it that exist, in order of how open it is.
 *
 * The lip sync hands over a shape -- how open the mouth is, and how wide -- for every instant of
 * a sentence (src/lib/talk/visemes.ts). There are four pictures of her mouth and one of them is
 * the front frame's own, so the openness is read off this ladder and the two nearest pictures are
 * cross-faded. That is the same thing the head turn does, for the same reason: a picture held and
 * flicked to the next reads as drawn animation, and nothing is deformed to get there.
 *
 * Her closed-lipped smile is NOT on the ladder. It is a thing she does when she is listening to
 * you, not a sound, and flashing it between syllables would be a tic.
 */
export const MOUTHS: { patch: 'mouth-MBP' | 'mouth-O' | 'mouth-A' | null; open: number }[] = [
  { patch: 'mouth-MBP', open: 0 },
  // The front frame's own mouth, closed and faintly smiling. Nothing is drawn over her for this.
  { patch: null, open: 0.1 },
  { patch: 'mouth-O', open: 0.5 },
  { patch: 'mouth-A', open: 0.85 },
];

/** Below this the mouth is rounded, and she holds the O rather than opening into an "ah". */
export const ROUND_BELOW = 0.85;

export interface Mouth {
  /** Index into MOUTHS of the picture underneath. */
  a: number;
  /** Index of the one drawn over it. */
  b: number;
  /** How solid b is, 0 to 1. */
  blend: number;
}

/** Which mouth pictures to draw for a shape the lip sync asked for. */
export function pickMouth(shape: { open: number; wide: number }): Mouth {
  // A rounded sound keeps her lips rounded: it must not run on up into the wide-open "ah".
  const want = shape.wide < ROUND_BELOW ? Math.min(shape.open, MOUTHS[2].open) : shape.open;
  const lo = MOUTHS[0].open;
  const hi = MOUTHS[MOUTHS.length - 1].open;
  const o = want > lo ? (want < hi ? want : hi) : lo;
  let i = 0;
  while (i < MOUTHS.length - 2 && o > MOUTHS[i + 1].open) i++;
  const t = (o - MOUTHS[i].open) / (MOUTHS[i + 1].open - MOUTHS[i].open);
  return { a: i, b: i + 1, blend: t < 0 ? 0 : t > 1 ? 1 : t };
}

/*
 * Her blink. Eyelids close in about the time it takes to say one letter and open a little slower,
 * and she does it every few seconds, never on a fixed beat -- a blink you can predict is worse
 * than none at all.
 */
export const BLINK_SHUT_MS = 90;
export const BLINK_OPEN_MS = 130;
export const BLINK_EVERY_MS: [number, number] = [3200, 6800];

/** How closed her eyes are, 0 to 1, this far into a blink. */
export function blinkAt(ms: number): number {
  if (ms < 0) return 0;
  if (ms < BLINK_SHUT_MS) return ms / BLINK_SHUT_MS;
  const after = ms - BLINK_SHUT_MS;
  if (after < BLINK_OPEN_MS) return 1 - after / BLINK_OPEN_MS;
  return 0;
}
