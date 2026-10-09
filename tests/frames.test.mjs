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

import {
  BLINK_OPEN_MS,
  BLINK_SHUT_MS,
  FRAMES,
  FRONT,
  MOUTHS,
  ROUND_BELOW,
  YAW_MAX,
  YAW_MIN,
  YAW_WATCH,
  blinkAt,
  nextSmile,
  pickFrames,
  pickMouth,
} from '../src/lib/talk/frames.ts';
import * as PATCHES from '../src/lib/talk/patches.ts';

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

/*
 * Her mouth and her blink. The same three things have to hold as for the head turn -- one picture
 * at a shape she was actually rendered in, no doubling back, and no running off the end of the
 * list -- plus the two that are particular to a mouth: a rounded sound must never open up into
 * the wide "ah", and nothing may be laid over her while her head is turned away.
 */

const shape = (open, wide = 1) => ({ open, wide });

/** Where she is on the ladder of mouths, as one number. */
const mouthAt = (s) => {
  const { a, b, blend } = pickMouth(s);
  return a + (b - a) * blend;
};

test('every patch his renders produced is on disk, and sits inside her frame', () => {
  const names = Object.keys(PATCHES).filter((k) => k !== 'default');
  assert.ok(names.length >= 5, `only ${names.length} patches were generated`);
  for (const name of names) {
    const p = PATCHES[name];
    assert.ok(
      existsSync(new URL(`../public${p.src}`, import.meta.url)),
      `${name} points at ${p.src}, which is not in public/`,
    );
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= 1254 && p.y + p.h <= 1254,
      `${name} is not inside the frame: ${p.x},${p.y} ${p.w}x${p.h}`);
    assert.ok(p.w > 60 && p.h > 60, `${name} is ${p.w}x${p.h}, too small to be the real region`);
  }
});

test('the mouth ladder is in order of how open it is, and the front frame is on it', () => {
  for (let i = 1; i < MOUTHS.length; i++) {
    assert.ok(MOUTHS[i].open > MOUTHS[i - 1].open, `rung ${i} is not more open than the one before`);
  }
  const own = MOUTHS.filter((m) => m.patch === null);
  assert.equal(own.length, 1, "exactly one rung is the front frame's own mouth, drawn with no patch");
});

test('at a mouth she was rendered in, exactly one picture is on screen', () => {
  for (const [i, m] of MOUTHS.entries()) {
    const shown = pickMouth(shape(m.open));
    const solid = shown.blend === 0 ? shown.a : shown.blend === 1 ? shown.b : null;
    assert.equal(solid, i, `rung ${i} is drawn at ${shown.blend} over another`);
  }
});

test('her mouth never goes backwards as a sound opens', () => {
  let last = -Infinity;
  for (let open = -0.5; open <= 1.5; open += 0.01) {
    const p = mouthAt(shape(open));
    assert.ok(p >= last - 1e-9, `the mouth closes again at open=${open.toFixed(2)}`);
    last = p;
  }
});

test('a rounded sound holds the O and never opens into the wide "ah"', () => {
  const round = MOUTHS.findIndex((m) => m.patch === 'mouth-O');
  for (const open of [0.5, 0.7, 0.85, 1]) {
    const p = mouthAt(shape(open, ROUND_BELOW - 0.05));
    assert.ok(p <= round + 1e-9, `"oo" at open=${open} reached rung ${p}, past the O`);
  }
  // The same openness with normal lips DOES reach the wide one, or the rule above means nothing.
  assert.ok(mouthAt(shape(0.85, 1)) > round, 'a wide "ah" never reaches the open mouth');
});

test('a shape outside anything rendered holds an end of the ladder', () => {
  const last = MOUTHS.length - 1;
  assert.deepEqual(pickMouth(shape(-5)), { a: 0, b: 1, blend: 0 }, 'fell off the closed end');
  assert.deepEqual(pickMouth(shape(5)), { a: last - 1, b: last, blend: 1 }, 'fell off the open end');
  assert.deepEqual(pickMouth(shape(NaN)), { a: 0, b: 1, blend: 0 }, 'a shape that is not a number');
});

test('a blink shuts and opens and then leaves her eyes alone', () => {
  assert.equal(blinkAt(-50), 0, 'her eyes are shut before the blink starts');
  assert.equal(blinkAt(0), 0);
  assert.equal(blinkAt(BLINK_SHUT_MS), 1, 'the blink is not fully shut at its shut time');
  assert.equal(blinkAt(BLINK_SHUT_MS + BLINK_OPEN_MS), 0, 'the blink never finishes opening');
  assert.equal(blinkAt(10_000), 0, 'her eyes stay shut long after the blink');
  assert.ok(BLINK_OPEN_MS > BLINK_SHUT_MS, 'a real eye opens slower than it closes');
});

test('the patches are laid on the front frame, and only on it', () => {
  assert.equal(FRAMES[FRONT].yaw, 0, 'FRONT no longer names the frame she faces you in');
  const face = readFileSync(new URL('../src/components/talk/jessy-face.tsx', import.meta.url), 'utf8');
  assert.match(face, /const front = [^;]*FRONT/, 'nothing works out how much of the front frame is up');

  /*
   * Every patch is drawn through lay(), and every one of those has to be faded by `front`, or a
   * mouth would be painted on the side of her head as she turns. Checked as text because the
   * thing being guarded is a canvas, and there is no canvas in node.
   */
  const calls = [...face.matchAll(/\blay\(([^;]*?)\);/g)].map((m) => m[1]);
  assert.ok(calls.length >= 3, `only ${calls.length} patch draws found; the face must have changed`);
  for (const c of calls) {
    assert.match(c, /\bfront\b/, `a patch is drawn without fading with the front frame: lay(${c})`);
  }
});

test('her smile is gone the instant she has something to say', () => {
  /*
   * The smile patch and the mouth patches cover the same part of her face. If the smile eased out
   * while a mouth eased in, a closed mouth would be laid over her open one for about a third of a
   * second at the start of every answer -- which is the moment you are looking straight at it.
   */
  assert.equal(nextSmile(1, true, true, 0.1), 0, 'the smile lingers over her open mouth');
  assert.equal(nextSmile(1, false, true, 0.1), 0);
  assert.equal(nextSmile(0.4, true, true, 1), 0);

  // Going the other way it eases, because a smile that snaps on is a twitch.
  let smile = 0;
  const climb = [];
  for (let i = 0; i < 4; i++) {
    smile = nextSmile(smile, true, false, 0.2);
    climb.push(smile);
  }
  assert.ok(climb[0] > 0 && climb[0] < 0.5, `the smile snapped straight to ${climb[0]}`);
  for (let i = 1; i < climb.length; i++) {
    assert.ok(climb[i] > climb[i - 1], 'the smile stopped growing while she listens');
    assert.ok(climb[i] <= 1, 'the smile overshoots a whole smile');
  }
  // And it leaves again when she is no longer being spoken to.
  assert.ok(nextSmile(climb.at(-1), false, false, 0.2) < climb.at(-1), 'the smile never fades');
});

test('the page gets the smile from that rule rather than its own', () => {
  const face = readFileSync(new URL('../src/components/talk/jessy-face.tsx', import.meta.url), 'utf8');
  assert.match(face, /smile = nextSmile\(/, 'jessy-face.tsx eases the smile on its own again');
});
