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

/**
 * How far past the edge of a dissolve a resting angle is pushed, so the frame it lands on is the
 * ONLY one on screen. Landing exactly on the edge leaves a blend of 0.0000001, and a yaw that eases
 * in from inside the band spends its last moments there as a faint second face.
 */
const REST_MARGIN = 0.02;

/**
 * Where she may come to REST for a wanted angle.
 *
 * A turn is allowed to dissolve: she holds one pose, flicks to the next and holds that. What she
 * must never do is STOP in the middle of the flick. The angle she settles at is her pose plus
 * where she is glancing, and the glance can land anywhere -- measured on the live page, a glance
 * of 0.35 to 0.65 of the way to one side leaves her at half a dissolve for the 2.6 to 6.6 seconds
 * until the next one, which is two heads on one body and read on a phone as a second, washed-out
 * woman standing behind her. So a wanted angle that falls inside a dissolve is moved to the nearer
 * side of it, where exactly one render is on screen. Everywhere else it is returned untouched, and
 * the turn itself still dissolves on the way through.
 */
export function restYaw(want: number): number {
  // Not a number, or no number at all: face the front, as pickFrames does for the same input.
  if (!Number.isFinite(want)) return 0;
  const y = want > YAW_MIN ? (want < YAW_MAX ? want : YAW_MAX) : YAW_MIN;
  const edge = (1 - DISSOLVE) / 2;
  for (let i = 0; i < FRAMES.length - 1; i++) {
    const lo = FRAMES[i].yaw;
    const span = FRAMES[i + 1].yaw - lo;
    const from = lo + edge * span;
    const to = lo + (1 - edge) * span;
    if (y > from && y < to) return y - from < to - y ? from - REST_MARGIN : to + REST_MARGIN;
  }
  return y;
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
 * Her mouth, as the pictures of it that exist.
 *
 * The lip sync hands over a shape -- how open the mouth is, how wide, and whether her teeth are
 * on her lip -- for every instant of a sentence (src/lib/talk/visemes.ts). The openness is read
 * off a ladder of the pictures that exist and the two nearest are cross-faded. That is the same
 * thing the head turn does, for the same reason: a picture held and flicked to the next reads as
 * drawn animation, and nothing is deformed to get there.
 *
 * There are TWO ladders, because openness alone cannot tell "oo" from "ee". Both are roughly as
 * open as each other and they are opposite shapes -- one pursed forward, one stretched sideways
 * with both rows of teeth -- so one ladder has to choose between them, and before these renders
 * existed it chose wrong: every "ee" in every sentence came out as three quarters of an "oh".
 * Which ladder she is on is her lip WIDTH, which is the one thing that does separate them.
 *
 * Her closed-lipped smile is NOT on either ladder. It is a thing she does when she is listening
 * to you, not a sound, and flashing it between syllables would be a tic. Nor is her "f": see
 * LIP_PATCH below.
 */
export type MouthPatch = 'mouth-MBP' | 'mouth-U' | 'mouth-O' | 'mouth-E' | 'mouth-A';

export interface Rung {
  /** The picture to lay over her, or null for the front frame's own mouth. */
  patch: MouthPatch | null;
  /** How open this picture of her mouth is, 0 to 1. The ladder is in this order. */
  open: number;
}

/**
 * Both ladders start closed and end at the most open picture of that shape. The rung with no
 * patch is the front frame's own mouth, closed and faintly smiling: nothing is drawn over her
 * for it, which is why the quiet, resting mouth costs nothing at all.
 */
export const MOUTHS: { round: Rung[]; wide: Rung[] } = {
  // Lips rounded and pushed forward. It tops out at the "oh" and never opens into the "ah".
  round: [
    { patch: 'mouth-MBP', open: 0 },
    { patch: null, open: 0.1 },
    { patch: 'mouth-U', open: 0.35 },
    { patch: 'mouth-O', open: 0.55 },
  ],
  // Lips as drawn or stretched sideways: everything that is not a rounded sound.
  wide: [
    { patch: 'mouth-MBP', open: 0 },
    { patch: null, open: 0.1 },
    { patch: 'mouth-E', open: 0.4 },
    { patch: 'mouth-A', open: 0.85 },
  ],
};

/** Below this width her lips are rounded, and she is on the ladder that holds the O. */
export const ROUND_BELOW = 0.85;

/**
 * Her upper teeth on her lower lip -- "f", "v", Arabic "ف" -- which is not on either ladder.
 *
 * That mouth is barely open and not rounded, which is exactly where her resting mouth already
 * sits, so a rung for it would be indistinguishable from a pause and every pause would flash her
 * teeth. It is laid over her by its own channel instead (MouthShape.lip), on top of a ladder that
 * at that openness is drawing nothing anyway.
 */
export const LIP_PATCH = 'mouth-FV';

export interface Mouth {
  /** Which ladder her lips are on: rounded, or as drawn. */
  ladder: 'round' | 'wide';
  /** Index into that ladder of the picture underneath. */
  a: number;
  /** Index of the one drawn over it. */
  b: number;
  /** How solid b is, 0 to 1. */
  blend: number;
}

/** Which mouth pictures to draw for a shape the lip sync asked for. */
export function pickMouth(shape: { open: number; wide: number }): Mouth {
  const ladder = shape.wide < ROUND_BELOW ? 'round' : 'wide';
  const rungs = MOUTHS[ladder];
  const lo = rungs[0].open;
  const hi = rungs[rungs.length - 1].open;
  /*
   * Written as two upward comparisons so an openness that is not a number lands on the closed
   * end rather than poisoning the blend: every comparison against NaN is false, and a NaN alpha
   * would quietly stop her mouth being drawn at all.
   */
  const o = shape.open > lo ? (shape.open < hi ? shape.open : hi) : lo;
  let i = 0;
  while (i < rungs.length - 2 && o > rungs[i + 1].open) i++;
  const t = (o - rungs[i].open) / (rungs[i + 1].open - rungs[i].open);
  return { ladder, a: i, b: i + 1, blend: t < 0 ? 0 : t > 1 ? 1 : t };
}

/**
 * How far into her closed-lipped smile she is on the next frame.
 *
 * It eases in while she listens to you, because a smile that snaps on is a twitch. It leaves at
 * ONCE the moment she has a sound to make, which is not symmetric and is not an oversight: the
 * smile patch and the mouth patches cover the same part of her face, so an eased exit would lay
 * a closed mouth over an open one for about a third of a second at the start of every answer.
 * The mouth patch arriving in the same frame is what hides the cut.
 */
export function nextSmile(current: number, listening: boolean, hasMouth: boolean, ease: number): number {
  if (hasMouth) return 0;
  const want = listening ? 1 : 0;
  return current + (want - current) * ease;
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
