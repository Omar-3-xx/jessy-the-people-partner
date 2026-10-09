import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * The face is a GLSL string in one file and a render loop in another, and nothing connects the two
 * but the spelling of a uniform's name. getUniformLocation returns null for a name the shader does
 * not declare, and gl.uniform1f(null, x) is a no-op that throws nothing and logs nothing: the face
 * just quietly stops doing that one thing. These read both files and check they still agree.
 */

const shader = readFileSync(new URL('../src/lib/talk/face-shader.ts', import.meta.url), 'utf8');
const face = readFileSync(new URL('../src/components/talk/jessy-face.tsx', import.meta.url), 'utf8');

/** Every uniform the fragment shader declares, whatever it is called or how many share a line. */
function declared(src) {
  const out = new Set();
  for (const m of src.matchAll(/^\s*uniform\s+\w+\s+([^;]+);/gm)) {
    for (const name of m[1].split(',')) out.add(name.trim());
  }
  return out;
}

/** Every uniform the loop asks for, as u('uName'). */
function asked(src) {
  return new Set([...src.matchAll(/\bu\('(\w+)'\)/g)].map((m) => m[1]));
}

test('the loop asks for no uniform the shader does not declare', () => {
  const have = declared(shader);
  const missing = [...asked(face)].filter((n) => !have.has(n));
  assert.deepEqual(missing, [], `jessy-face.tsx sets ${missing.join(', ')}, which face-shader.ts never declares`);
});

test('the shader declares no uniform nothing ever sets', () => {
  // uTex is the texture, bound rather than set through a location.
  const want = asked(face);
  const unused = [...declared(shader)].filter((n) => n !== 'uTex' && !want.has(n));
  assert.deepEqual(unused, [], `face-shader.ts declares ${unused.join(', ')}, which nothing writes to`);
});

test('the head turns about the face, not about the edge of the render', () => {
  // The turn spins the head about HEAD_X with radius HEAD_R. Put the axis off the face and she
  // swings sideways instead of turning; make the radius too small and the face folds in on itself.
  const x = Number(shader.match(/const float HEAD_X = ([\d.]+);/)?.[1]);
  const r = Number(shader.match(/const float HEAD_R = ([\d.]+);/)?.[1]);
  const el = shader.match(/const vec2 EL = vec2\(([\d.]+), ([\d.]+)\);/);
  const er = shader.match(/const vec2 ER = vec2\(([\d.]+), ([\d.]+)\);/);
  assert.ok(Number.isFinite(x) && Number.isFinite(r), 'the head cylinder is not declared');
  assert.ok(el && er, 'the eyes are not declared');
  const between = (Number(el[1]) + Number(er[1])) / 2;
  assert.ok(Math.abs(x - between) < 20, `the turn spins about x=${x}, but the eyes sit about x=${between}`);
  // Wider apart than the eyes are, or the cheeks travel further than the face is wide.
  assert.ok(r > Math.abs(Number(er[1]) - Number(el[1])), `a radius of ${r} is narrower than the face`);
});
