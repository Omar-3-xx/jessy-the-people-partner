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
