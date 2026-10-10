import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CLIPS } from '../src/lib/talk/clips.ts';
import { TRACK_FPS, WIDE_HI, WIDE_LO, parseTrack, trackAt, trackLength } from '../src/lib/talk/mouth-track.ts';

/*
 * Her mouth, read off each recording (tools/mouth-tracks.py). The page plays these at the audio's own
 * clock, so what has to hold is: every recording has a track of its own length, the numbers mean
 * what the page thinks they mean, and a track really moves with a voice and rests between phrases.
 */

const voice = new URL('../public/voice/', import.meta.url);
const read = (file) => new Uint8Array(readFileSync(new URL(file, voice)));

test('bytes become an open and a wide channel, and a bad file is refused', () => {
  const t = parseTrack(Uint8Array.from([0, 0, 255, 255, 128, 128]));
  assert.equal(t.open.length, 3);
  assert.equal(t.open[0], 0);
  assert.equal(t.open[1], 1);
  assert.ok(Math.abs(t.wide[0] - WIDE_LO) < 1e-6);
  assert.ok(Math.abs(t.wide[1] - WIDE_HI) < 1e-6);
  assert.equal(parseTrack(Uint8Array.from([1, 2, 3])), null, 'an odd number of bytes is not a track');
  assert.equal(parseTrack(new Uint8Array(0)), null);
});

test('between frames the mouth is a straight line, and it is shut before and after', () => {
  const t = parseTrack(Uint8Array.from([0, 128, 255, 128, 0, 128]));
  const half = trackAt(t, 1000 / TRACK_FPS / 2);
  assert.ok(Math.abs(half.open - 0.5) < 1e-6, `halfway to the open frame is ${half.open}`);
  assert.equal(trackAt(t, -50).open, 0);
  assert.equal(trackAt(t, trackLength(t) + 500).open, 0);
  assert.equal(trackAt(t, Number.NaN).open, 0, 'a clock that is not a number must not poison the mouth');
  assert.equal(trackAt(t, 20).lip, 0);
});

test('every recording has its mouth track, as long as the recording', () => {
  for (const [id, clip] of Object.entries(CLIPS)) {
    const t = parseTrack(read(`${clip.file}.mouth`));
    assert.ok(t, `${id}: public/voice/${clip.file}.mouth is missing or not a track`);
    const frames = Math.round(clip.seconds * TRACK_FPS);
    assert.ok(Math.abs(t.open.length - frames) <= 6, `${id}: ${t.open.length} frames for ${clip.seconds}s`);
  }
});

test('a track follows a voice: it moves, it opens wide, and it rests between phrases', () => {
  for (const [id, clip] of Object.entries(CLIPS)) {
    const t = parseTrack(read(`${clip.file}.mouth`));
    const n = t.open.length;
    const shut = t.open.filter((v) => v === 0).length / n;
    const wide = t.open.filter((v) => v > 0.6).length / n;
    let travel = 0;
    for (let i = 1; i < n; i++) travel += Math.abs(t.open[i] - t.open[i - 1]);
    const perSecond = travel / (n / TRACK_FPS);
    assert.ok(shut > 0.03, `${id}: the mouth is never shut (${(shut * 100).toFixed(1)}% of frames)`);
    assert.ok(shut < 0.6, `${id}: the mouth is shut ${(shut * 100).toFixed(0)}% of the time`);
    assert.ok(wide > 0.02, `${id}: the mouth never opens wide`);
    // A jaw moves with syllables, about two to four full swings a second; letter speed is a flap.
    assert.ok(perSecond > 1.2 && perSecond < 5, `${id}: the mouth travels ${perSecond.toFixed(1)} per second`);
    assert.ok(Math.max(...t.wide) <= WIDE_HI + 1e-6 && Math.min(...t.wide) >= WIDE_LO - 1e-6);
  }
});
