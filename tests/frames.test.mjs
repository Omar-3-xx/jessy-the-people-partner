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
  LIP_PATCH,
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
import { mouthAt as shapeAt, mouthTimeline } from '../src/lib/talk/visemes.ts';

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
 * list -- plus the ones that are particular to a mouth: a rounded sound must never open up into
 * the wide "ah", an "ee" must never come out as an "oh", a pause must never show her teeth, and
 * nothing may be laid over her while her head is turned away.
 */

const shape = (open, wide = 1) => ({ open, wide });

/** Where she is on her ladder, as one number. Only comparable within one ladder. */
const mouthAt = (s) => {
  const { a, b, blend } = pickMouth(s);
  return a + (b - a) * blend;
};

/** The pictures actually laid over her for a shape, in the order they are drawn. */
const drawn = (s) => {
  const { ladder, a, b, blend } = pickMouth(s);
  const rungs = MOUTHS[ladder];
  const out = [];
  if (blend < 1 && rungs[a].patch) out.push(rungs[a].patch);
  if (blend > 0 && rungs[b].patch) out.push(rungs[b].patch);
  if (s.lip > 0) out.push(LIP_PATCH);
  return out;
};

/** The mouth the lip sync asks for at letter `i` of `text`, straight off the timeline. */
const letter = (text, i) => {
  const key = mouthTimeline(text).find((k) => k.i === i && k.t > 0);
  assert.ok(key, `the lip sync has no mouth for letter ${i} of "${text}"`);
  return key;
};

test('every patch his renders produced is on disk, and sits inside her frame', () => {
  const names = Object.keys(PATCHES).filter((k) => k !== 'default');
  assert.ok(names.length >= 8, `only ${names.length} patches were generated`);
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

test('both ladders are in order of how open she is, and the front frame is on each', () => {
  for (const [name, rungs] of Object.entries(MOUTHS)) {
    for (let i = 1; i < rungs.length; i++) {
      assert.ok(rungs[i].open > rungs[i - 1].open, `${name} rung ${i} is not more open than the one before`);
    }
    const own = rungs.filter((m) => m.patch === null);
    assert.equal(own.length, 1, `${name} does not have exactly one rung drawn with no patch`);
  }
});

test('every picture the ladders name was actually generated', () => {
  const named = new Set(Object.values(MOUTHS).flat().map((m) => m.patch).filter(Boolean));
  named.add(LIP_PATCH);
  for (const n of named) {
    const key = n.replace(/-/g, '_').toUpperCase();
    assert.ok(PATCHES[key], `the ladder asks for ${n}, which tools/compose-visemes.py did not write`);
  }
});

test('at a mouth she was rendered in, exactly one picture is on screen', () => {
  for (const [name, rungs] of Object.entries(MOUTHS)) {
    const wide = name === 'round' ? ROUND_BELOW - 0.1 : 1;
    for (const [i, m] of rungs.entries()) {
      const shown = pickMouth(shape(m.open, wide));
      const solid = shown.blend === 0 ? shown.a : shown.blend === 1 ? shown.b : null;
      assert.equal(solid, i, `${name} rung ${i} is drawn at ${shown.blend} over another`);
      assert.equal(shown.ladder, name, `${name} rung ${i} picked the ${shown.ladder} ladder`);
    }
  }
});

test('her mouth never goes backwards as a sound opens', () => {
  for (const wide of [ROUND_BELOW - 0.1, 1, 1.08]) {
    let last = -Infinity;
    for (let open = -0.5; open <= 1.5; open += 0.01) {
      const p = mouthAt(shape(open, wide));
      assert.ok(p >= last - 1e-9, `at width ${wide} the mouth closes again at open=${open.toFixed(2)}`);
      last = p;
    }
  }
});

test('a rounded sound holds the O and never opens into the wide "ah"', () => {
  assert.ok(
    !MOUTHS.round.some((m) => m.patch === 'mouth-A'),
    'the wide-open "ah" is on the rounded ladder, so "oo" can run all the way up into it',
  );
  for (const open of [0.5, 0.55, 0.7, 0.85, 1, 5]) {
    const shown = drawn(shape(open, ROUND_BELOW - 0.05));
    assert.ok(!shown.includes('mouth-A'), `"oo" at open=${open} drew the wide "ah"`);
  }
  // From the top rung upwards it is the O alone, with nothing fading in behind it.
  for (const open of [0.55, 0.7, 0.85, 1, 5]) {
    assert.deepEqual(drawn(shape(open, ROUND_BELOW - 0.05)), ['mouth-O'],
      `"oo" at open=${open} did not hold the O`);
  }
  // The same openness with normal lips DOES reach the wide one, or the rule above means nothing.
  assert.deepEqual(drawn(shape(0.85, 1)), ['mouth-A'], 'a wide "ah" never reaches the open mouth');
});

/*
 * The defect these renders were made to fix. "ee" and "oo" are about as open as each other and
 * are opposite shapes, so one ladder could not tell them apart: with only the O to reach for, it
 * drew three quarters of an "oh" for every "ee" in every sentence. Asserted from the letters,
 * not from a hand-made shape, because the letters are where it went wrong.
 */
test('"ee" and "oo" are drawn as different mouths', () => {
  const ee = letter('fee', 1);
  const oo = letter('you', 2);
  assert.ok(ee.wide >= ROUND_BELOW, `"ee" is on the rounded ladder at width ${ee.wide}`);
  assert.ok(oo.wide < ROUND_BELOW, `"oo" is not rounded at width ${oo.wide}`);
  assert.deepEqual(drawn(ee), ['mouth-E'], 'an "ee" is not drawn as the stretched mouth');
  assert.deepEqual(drawn(oo), ['mouth-U'], 'an "oo" is not drawn as the pursed mouth');
  assert.notDeepEqual(drawn(ee), drawn(oo), '"ee" and "oo" are still the same mouth');
});

/*
 * Her "f". It is as closed as a pause, so if it were a rung on the wide ladder every pause and
 * every rest would land on it and flash her teeth. It comes over the top on its own channel
 * instead, and the ladder underneath has to be drawing nothing where it does.
 */
test('her "f" shows her teeth, and nothing else does', () => {
  const f = letter('fee', 0);
  assert.equal(f.lip, 1, 'the lip sync does not ask for her teeth on an "f"');
  assert.deepEqual(drawn(f), [LIP_PATCH], 'the "f" is drawn over an open mouth');

  for (const [text, i] of [['fee', 1], ['you', 2], ['ma', 0], ['ta', 0]]) {
    assert.equal(letter(text, i).lip, 0, `letter ${i} of "${text}" shows her teeth`);
  }
  // A pause, and the silence after the last word: her teeth must be nowhere near either.
  const keys = mouthTimeline('fee, you');
  assert.equal(shapeAt(keys, keys.at(-1).t + 500).lip, 0, 'her teeth are still up after she stops');
  for (const k of keys) {
    if (k.open <= 0.05) assert.equal(k.lip, 0, 'her teeth are up while her mouth is at rest');
  }
});

test('a shape outside anything rendered holds an end of the ladder', () => {
  const wide = MOUTHS.wide.length - 1;
  assert.deepEqual(pickMouth(shape(-5)), { ladder: 'wide', a: 0, b: 1, blend: 0 }, 'fell off the closed end');
  assert.deepEqual(pickMouth(shape(5)), { ladder: 'wide', a: wide - 1, b: wide, blend: 1 }, 'fell off the open end');
  assert.deepEqual(pickMouth(shape(NaN)), { ladder: 'wide', a: 0, b: 1, blend: 0 }, 'a shape that is not a number');
  assert.deepEqual(pickMouth(shape(NaN, NaN)), { ladder: 'wide', a: 0, b: 1, blend: 0 }, 'a width that is not a number');
  const round = MOUTHS.round.length - 1;
  assert.deepEqual(pickMouth(shape(5, 0.5)), { ladder: 'round', a: round - 1, b: round, blend: 1 },
    'a rounded sound fell off the open end');
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
  assert.ok(calls.length >= 4, `only ${calls.length} patch draws found; the face must have changed`);
  for (const c of calls) {
    assert.match(c, /\bfront\b/, `a patch is drawn without fading with the front frame: lay(${c})`);
  }
});

/*
 * The page's side of the two new things. Everything else here tests the choosing; this tests
 * that the choice reaches the canvas. The lay() guard below cannot do it: her "f" is the fourth
 * lay() call and deleting it leaves three, which the guard is happy with -- so a deleted "f"
 * went unnoticed by the whole suite until this was written.
 */
test('the page draws her "f" from the lip channel, and can reach every other picture', () => {
  const face = readFileSync(new URL('../src/components/talk/jessy-face.tsx', import.meta.url), 'utf8');
  assert.match(
    face,
    /lay\(PATCH\[LIP_PATCH\],[^;]*\bm\.lip\b[^;]*\)/,
    'nothing on the page lays her "f" over her from the lip channel',
  );
  const named = [...new Set(Object.values(MOUTHS).flat().map((m) => m.patch).filter(Boolean)), LIP_PATCH];
  for (const n of named) {
    assert.ok(face.includes(`'${n}':`), `the ladder asks for ${n}, which the page cannot draw`);
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
