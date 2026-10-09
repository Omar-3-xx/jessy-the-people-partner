/*
 * The page no longer bends a picture of her; it chooses which of his renders to draw. So the only
 * thing left to get wrong is the choosing, and that is what this tests.
 *
 * Three things have to hold or she visibly breaks:
 *   - at an angle a render was actually made for, ONE frame is on screen. A dissolve sitting on top
 *     of an exact pose means two faces at once at the moment she is meant to be holding a pose.
 *   - the turn only ever goes the way the turn goes. A non-monotonic pick would make her head snap
 *     back mid-turn.
 *   - past either end she stops at the end frame instead of running off the list.
 * And the files have to be on disk, because a missing one tears a hole in her at runtime.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { FRAMES, YAW_MAX, YAW_MIN, YAW_WATCH, pickFrames } from '../src/lib/talk/frames.ts';

/** Where she is on the strip of frames, as one number, so the turn can be compared to itself. */
const position = (yaw) => {
  const { a, b, blend } = pickFrames(yaw);
  return a + (b - a) * blend;
};

test('every frame his renders produced is on disk', () => {
  const missing = FRAMES.map((f) => f.src).filter(
    (s) => !existsSync(new URL(`../public${s}`, import.meta.url)),
  );
  assert.deepEqual(missing, [], `frames.ts points at ${missing.join(', ')}, which is not in public/`);
});

test('the frames are in order of the turn, and none repeats an angle', () => {
  for (let i = 1; i < FRAMES.length; i++) {
    assert.ok(FRAMES[i].yaw > FRAMES[i - 1].yaw, `${FRAMES[i].src} is not past ${FRAMES[i - 1].src}`);
  }
  assert.equal(YAW_MIN, FRAMES[0].yaw);
  assert.equal(YAW_MAX, FRAMES[FRAMES.length - 1].yaw);
});

test('at an angle she was rendered at, exactly one frame is on screen', () => {
  for (const [i, f] of FRAMES.entries()) {
    const shown = pickFrames(f.yaw);
    const solid = shown.blend === 0 ? shown.a : shown.blend === 1 ? shown.b : null;
    assert.equal(solid, i, `${f.src} is drawn at ${shown.blend} over another frame`);
  }
});

test('she never turns back on herself part-way through a turn', () => {
  let last = -Infinity;
  for (let yaw = YAW_MIN - 0.4; yaw <= YAW_MAX + 0.4; yaw += 0.01) {
    const p = position(yaw);
    assert.ok(p >= last - 1e-9, `the turn goes backwards at ${yaw.toFixed(2)}: ${p} after ${last}`);
    last = p;
  }
});

test('past either end she holds the end frame instead of running off the list', () => {
  // NaN among them on purpose: a yaw that is not a number must not reach the canvas as an alpha.
  for (const yaw of [YAW_MIN - 0.01, YAW_MIN - 3, -Infinity, NaN]) {
    assert.deepEqual(pickFrames(yaw), { a: 0, b: 1, blend: 0 }, `${yaw} fell off the near end`);
  }
  const last = FRAMES.length - 1;
  for (const yaw of [YAW_MAX + 0.01, YAW_MAX + 3, Infinity]) {
    const shown = pickFrames(yaw);
    assert.deepEqual(shown, { a: last - 1, b: last, blend: 1 }, `${yaw} fell off the far end`);
  }
});

test('following the mouse never asks for a frame outside the renders', () => {
  // The page turns her FOLLOWS * pointer * YAW_WATCH, and the pointer is clamped to -1..1.
  assert.ok(YAW_WATCH <= YAW_MAX && -YAW_WATCH >= YAW_MIN, 'watching her turn runs past the frames');
  for (const yaw of [-YAW_WATCH, 0, YAW_WATCH]) {
    const { a, b } = pickFrames(yaw);
    assert.ok(a >= 0 && b < FRAMES.length, `${yaw} indexes outside the frames`);
  }
});

test('the page draws the frames it declares', () => {
  const face = readFileSync(new URL('../src/components/talk/jessy-face.tsx', import.meta.url), 'utf8');
  assert.match(face, /pickFrames\(/, 'jessy-face.tsx no longer picks frames');
  assert.doesNotMatch(face, /face-shader/, 'jessy-face.tsx still reaches for the deleted shader');
  // The still shown before the frames load has to be the front one, or she jumps when they arrive.
  assert.match(face, /FRAMES\[1\]\.src/, 'the placeholder is not the front frame');
  assert.equal(FRAMES[1].yaw, 0, 'FRAMES[1] is no longer the front frame the placeholder assumes');
});
