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
  DISSOLVE,
  FRAMES,
  FRONT,
  LIP_PATCH,
  MOUTHS,
  ROUND_BELOW,
  YAW_MAX,
  YAW_MIN,
  YAW_WATCH,
  blinkAt,
  blinkLids,
  nextSmile,
  pickFrames,
  pickMouth,
  restYaw,
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

/*
 * Where she may come to REST. A turn dissolves two renders into one another, and that is fine for
 * the instant she is moving. But the angle she settles at is her pose plus a random glance, and a
 * glance can land in the middle of a dissolve and be held for seconds: two heads on one body, which
 * is what the live site showed on a phone. Everything below is derived from FRAMES and DISSOLVE, so
 * it keeps meaning the same thing if either changes.
 */
const faceSource = () => readFileSync(new URL('../src/components/talk/jessy-face.tsx', import.meta.url), 'utf8');

/** The open stretches of yaw in which two frames are on screen at once, worked out from the definition. */
const bands = () => {
  const edge = (1 - DISSOLVE) / 2;
  const out = [];
  for (let i = 0; i < FRAMES.length - 1; i++) {
    const lo = FRAMES[i].yaw;
    const span = FRAMES[i + 1].yaw - lo;
    out.push({ from: lo + edge * span, to: lo + (1 - edge) * span });
  }
  return out;
};

/** The numbers the page uses for each state, read off the page itself so this cannot drift from it. */
const readRecord = (name) => {
  const m = faceSource().match(new RegExp(String.raw`const ${name}: Record<FaceState, number> = \{([\s\S]*?)\};`));
  assert.ok(m, `jessy-face.tsx no longer declares ${name}`);
  const out = {};
  for (const [, key, num] of m[1].matchAll(/\b(idle|listening|thinking|speaking):\s*(-?[\d.]+)/g)) out[key] = Number(num);
  assert.deepEqual(Object.keys(out).sort(), ['idle', 'listening', 'speaking', 'thinking'], `${name} is missing a state`);
  return out;
};

test('a dissolve really is a stretch of angles where two frames are on screen', () => {
  // The premise of everything below. If this stopped holding the sweeps would pass for nothing.
  for (const { from, to } of bands()) {
    const mid = pickFrames((from + to) / 2);
    assert.ok(mid.blend > 0 && mid.blend < 1, `the middle of a band is not a dissolve: ${mid.blend}`);
  }
});

test('she never comes to rest in the middle of a dissolve', () => {
  const turn = readRecord('TURN');
  const follows = readRecord('FOLLOWS');
  let rested = 0;
  for (const state of Object.keys(turn)) {
    // Every pointer position and every glance, over the whole -1..1 range the page clamps them to.
    for (let i = 0; i <= 200; i++) {
      const w = -1 + i / 100;
      const want = turn[state] + follows[state] * w * YAW_WATCH;
      const at = restYaw(want);
      for (const { from, to } of bands()) {
        assert.ok(
          !(at > from && at < to),
          `${state}, pointer ${w.toFixed(2)}: rests at ${at.toFixed(4)}, inside the dissolve ${from.toFixed(3)}..${to.toFixed(3)}`,
        );
      }
      const { blend } = pickFrames(at);
      assert.ok(blend === 0 || blend === 1, `${state}, pointer ${w.toFixed(2)}: rests at ${at.toFixed(4)} with two frames showing (${blend})`);
      rested++;
    }
  }
  assert.ok(rested > 400, 'the sweep did not look at anything');
});

test('the same holds for any angle at all, not only the ones the page asks for today', () => {
  for (let i = 0; i <= 4000; i++) {
    const y = YAW_MIN - 0.3 + (i / 4000) * (YAW_MAX - YAW_MIN + 0.6);
    const at = restYaw(y);
    assert.ok(at >= YAW_MIN && at <= YAW_MAX, `${y.toFixed(3)} rests outside the frames at ${at}`);
    const { blend } = pickFrames(at);
    assert.ok(blend === 0 || blend === 1, `${y.toFixed(3)} rests at ${at.toFixed(4)} with two frames showing (${blend})`);
  }
});

test('an angle that is not in a dissolve is left exactly where it was', () => {
  // Her poses, and the runs of angles around each one, are what she is following you through.
  for (const f of FRAMES) assert.equal(restYaw(f.yaw), f.yaw, `${f.yaw} was moved`);
  let kept = 0;
  for (let i = 0; i <= 1000; i++) {
    const y = YAW_MIN + (i / 1000) * (YAW_MAX - YAW_MIN);
    if (bands().some(({ from, to }) => y > from - 0.03 && y < to + 0.03)) continue;
    // The sweep's own arithmetic can overshoot the last frame by a rounding error; that is not a move.
    assert.ok(Math.abs(restYaw(y) - y) < 1e-9, `${y.toFixed(3)} was moved though no dissolve is near it`);
    kept++;
  }
  assert.ok(kept > 100, 'the sweep did not look at anything');
});

test('she is moved to the NEARER side of a dissolve, never across it', () => {
  for (const { from, to } of bands()) {
    const mid = (from + to) / 2;
    assert.ok(restYaw(mid - 0.01) < from, 'just before the middle should rest on the side it came from');
    assert.ok(restYaw(mid + 0.01) > to, 'just after the middle should rest on the far side');
    assert.ok(Math.abs(restYaw(from + 0.001) - from) < 0.05, 'a glance at the edge moved her a long way');
  }
});

test('an angle that is not a number faces the front instead of poisoning the turn', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined]) assert.equal(restYaw(bad), 0, `${bad} did not face the front`);
});

test('the page rests her through restYaw, so a glance cannot park her mid-dissolve', () => {
  const face = faceSource();
  assert.match(face, /restYaw\(TURN\[d\.state\] \+ follow\)/, 'the resting angle no longer goes through restYaw');
  assert.match(face, /\brestYaw,/, 'restYaw is not imported');
  // Nothing may steer her by the raw angle again: the unfiltered form is the bug.
  assert.doesNotMatch(face, /\(TURN\[d\.state\] \+ follow - yaw\)/, 'the page steers her by the raw angle again');
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

/*
 * The middle of her blink. With only an open and a shut render, the lid is a cross-fade: her iris
 * shows THROUGH it for about 130 ms either side of the shut frame. The half-lidded render puts a
 * real picture in the middle. What must hold is derived below from how much of the OPEN eye is
 * still visible, never from a list of closures.
 */
const lidsSwept = () => Array.from({ length: 1001 }, (_, i) => ({ c: i / 1000, ...blinkLids(i / 1000) }));

/** How much of her open eye can still be seen, 0 to 1: what is left after both pictures are laid over it. */
const openEyeVisible = ({ half, shut }) => (1 - half) * (1 - shut);

test('a blink passes through her half-lidded render on the way down', () => {
  assert.deepEqual(blinkLids(0), { half: 0, shut: 0 }, 'an open eye has something laid over it');
  assert.deepEqual(blinkLids(0.5), { half: 1, shut: 0 }, 'the middle of the blink is not the half-lidded render alone');
  assert.deepEqual(blinkLids(1), { half: 1, shut: 1 }, 'a shut eye is not the shut render');
});

test('once her lid has reached half, her open eye is never seen through it again', () => {
  for (const l of lidsSwept()) {
    if (l.c >= 0.5) assert.equal(openEyeVisible(l), 0, `at closure ${l.c} the open eye still shows (${JSON.stringify(l)})`);
  }
});

test('neither eye picture fades out while she is closing, so nothing is seen coming back', () => {
  const all = lidsSwept();
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i].half >= all[i - 1].half, `the half-lid fades out at closure ${all[i].c}`);
    assert.ok(all[i].shut >= all[i - 1].shut, `the shut eye fades out at closure ${all[i].c}`);
  }
  for (const l of all) assert.ok(l.half >= 0 && l.half <= 1 && l.shut >= 0 && l.shut <= 1, `an alpha is out of range at ${l.c}`);
});

test('only one pair of eye pictures dissolves at a time, and at a rendered lid there is none', () => {
  const partial = (a) => a > 0 && a < 1;
  for (const l of lidsSwept()) {
    assert.ok(!(partial(l.half) && partial(l.shut)), `both lids are mid-dissolve at closure ${l.c}`);
  }
  for (const c of [0, 0.5, 1]) {
    const l = blinkLids(c);
    assert.ok(!partial(l.half) && !partial(l.shut), `a pose she was rendered at is mid-dissolve at ${c}`);
  }
});

test('the open eye is a ghost for no more of the blink than the dissolve allows', () => {
  // The cross-fade it replaces had the open eye on screen for ALL of the first half (alpha 1 - c).
  const all = lidsSwept();
  const ghost = all.filter((l) => openEyeVisible(l) > 0.1 && openEyeVisible(l) < 0.9).length / all.length;
  assert.ok(ghost <= DISSOLVE / 2 + 0.01, `the open eye is half-seen for ${(ghost * 100).toFixed(0)}% of the blink`);
  assert.ok(ghost > 0, 'the sweep never saw a dissolve, so it proves nothing');
});

test('a closure that is not a number is an open eye', () => {
  for (const bad of [NaN, undefined, -1, -Infinity]) assert.deepEqual(blinkLids(bad), { half: 0, shut: 0 }, `${bad} laid something over her`);
  assert.deepEqual(blinkLids(7), { half: 1, shut: 1 }, 'a closure past shut is not shut');
});

test('the page lays the half-lidded eye first and the shut one over it, both with the front frame', () => {
  const face = readFileSync(new URL('../src/components/talk/jessy-face.tsx', import.meta.url), 'utf8');
  const half = face.search(/lay\(PATCH\['eyes-half'\],[^;]*\bfront\b[^;]*\);/);
  const shut = face.search(/lay\(PATCH\['eyes-closed'\],[^;]*\bfront\b[^;]*\);/);
  assert.ok(half >= 0, 'the page never lays the half-lidded eye over her');
  assert.ok(shut > half, 'the shut eye is laid UNDER the half-lidded one, or not at all');
  assert.match(face, /blinkLids\(blinkAt\(into\)\)/, 'the page does not take its lids from blinkLids');
  assert.doesNotMatch(face, /lay\(PATCH\['eyes-closed'\], blinkAt\(/, 'the page blinks by cross-fading open and shut again');
  assert.ok(face.includes("'eyes-half':"), 'the half-lidded patch is not in the table the page loads from');
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
