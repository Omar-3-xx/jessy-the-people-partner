/*
 * Her mouth as read off a recording (tools/mouth-tracks.py writes it, one file per clip).
 *
 * 50 frames a second, two bytes a frame: how open the mouth is, and how wide, each 0 to 255.
 * The page plays the track at the audio element's own clock, so the mouth is never a guess about
 * where the sound has got to.
 *
 * This file imports nothing, so node runs it directly in tests/.
 */

export const TRACK_FPS = 50;
/** What byte 0 and byte 255 of the width channel mean; 1 is her mouth as drawn. */
export const WIDE_LO = 0.7;
export const WIDE_HI = 1.1;

export interface MouthTrack {
  /** 0 closed … 1 wide open, one per frame. */
  open: Float32Array;
  /** 0.7 rounded … 1.1 spread, one per frame. */
  wide: Float32Array;
}

export interface TrackShape {
  open: number;
  wide: number;
  lip: number;
}

/** Null when the bytes are not a track: an odd length, or nothing in it. */
export function parseTrack(bytes: Uint8Array): MouthTrack | null {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return null;
  const n = bytes.length / 2;
  const open = new Float32Array(n);
  const wide = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    open[i] = bytes[i * 2] / 255;
    wide[i] = WIDE_LO + (bytes[i * 2 + 1] / 255) * (WIDE_HI - WIDE_LO);
  }
  return { open, wide };
}

export function trackLength(track: MouthTrack): number {
  return (track.open.length / TRACK_FPS) * 1000;
}

/** The mouth at a moment, in milliseconds from the start of the clip: closed after the last frame. */
export function trackAt(track: MouthTrack, ms: number): TrackShape {
  const f = (ms / 1000) * TRACK_FPS;
  const last = track.open.length - 1;
  if (!(f >= 0) || f > last + 1) return { open: 0, wide: 1, lip: 0 };
  const i = Math.min(last, Math.floor(f));
  const j = Math.min(last, i + 1);
  const k = f - i;
  return {
    open: track.open[i] + (track.open[j] - track.open[i]) * k,
    wide: track.wide[i] + (track.wide[j] - track.wide[i]) * k,
    lip: 0,
  };
}
