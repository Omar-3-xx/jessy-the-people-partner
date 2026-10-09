'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type RefObject } from 'react';

import type { Mood } from '@/lib/kb';
import { FRAGMENT_SHADER, PORTRAIT, PORTRAIT_SIZE, VERTEX_SHADER, faceView } from '@/lib/talk/face-shader';
import type { MouthShape } from '@/lib/talk/visemes';
import { cn } from '@/lib/utils';

/*
 * Jessy, alive on the page. The chat writes what she is doing into a FaceDriver
 * (quiet, listening, thinking or speaking, and her mood); she reads it every
 * frame, so talking never re-renders React.
 *
 * She is not in a frame and not on a card: the canvas is transparent and she
 * stands on the page itself. Between words she blinks, breathes, glances about,
 * tilts her head and shifts her weight, and she leans in when she is listening
 * to you. Without WebGL the same cut-out render stands in, still.
 */

export type FaceState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface FaceDriver {
  state: FaceState;
  mood: Mood;
  /** The mouth while she speaks, or null when she is quiet. */
  mouth: () => MouthShape | null;
}

export function createFaceDriver(): FaceDriver {
  return { state: 'idle', mood: 'calm', mouth: () => null };
}

/** Where the face settles for each mood: how much the eyes smile, the brows rise, the lids droop, where she looks. */
interface Pose {
  squint: number;
  brow: number;
  lid: number;
  tilt: number;
  lx: number;
  ly: number;
  open: number;
  wide: number;
}

/*
 * Jessy is not Tigo: she answers questions about someone's rights at work, so her
 * resting face is attentive rather than delighted, and the big grins are pulled in.
 */
const POSES: Record<Mood, Pose> = {
  happy: { squint: 0.1, brow: 0.08, lid: 0, tilt: 0, lx: 0, ly: 0, open: 0, wide: 1 },
  laugh: { squint: 0.34, brow: 0.22, lid: 0.12, tilt: 0, lx: 0, ly: 0, open: 0.14, wide: 1 },
  think: { squint: 0.04, brow: 0.45, lid: 0.1, tilt: 0.03, lx: -0.55, ly: -0.85, open: 0, wide: 0.92 },
  calm: { squint: 0.03, brow: 0.02, lid: 0.05, tilt: 0, lx: 0, ly: 0.04, open: 0, wide: 1 },
  surprised: { squint: 0, brow: 1, lid: 0, tilt: -0.02, lx: 0, ly: -0.1, open: 0.3, wide: 0.8 },
};
const LISTENING: Pose = { squint: 0.08, brow: 0.3, lid: 0, tilt: 0.045, lx: 0.1, ly: 0.05, open: 0, wide: 1 };

/** A blink: down fast, up a little slower. */
function blinkCurve(ms: number): number {
  if (ms < 0 || ms > 170) return 0;
  return ms < 70 ? ms / 70 : 1 - (ms - 70) / 100;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
}

export function JessyFace({
  driver,
  label,
  className,
}: {
  driver: RefObject<FaceDriver>;
  label: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Transparent, and NOT premultiplied: the shader writes straight alpha, and the page shows
    // through wherever she is not.
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      powerPreference: 'low-power',
    });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!vs || !fs || !program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(program, 'a');
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);

    const u = (name: string) => gl.getUniformLocation(program, name);
    const U = {
      view: u('uView'),
      open: u('uOpen'),
      wide: u('uWide'),
      blink: u('uBlink'),
      squint: u('uSquint'),
      brow: u('uBrow'),
      head: u('uHead'),
      bob: u('uBob'),
      look: u('uLook'),
    };

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let ready = false;
    let gone = false;

    // The face as it is now, easing toward where the driver wants it.
    const now = { squint: 0.03, brow: 0.02, lid: 0.05, tilt: 0, lx: 0, ly: 0.04, open: 0, wide: 1, zoom: 1 };
    let nextBlink = performance.now() + 1200;
    let blinkAt = -1e9;
    let nextDart = performance.now() + 1500;
    let dart = { x: 0, y: 0 };
    let last = performance.now();

    let aspect = 1;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      aspect = w / h;
    };

    const draw = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const d = driver.current;
      const still = reduce.matches;
      const pose = d.state === 'listening' ? LISTENING : d.state === 'thinking' ? POSES.think : POSES[d.mood];
      const mouth = d.mouth();

      // Blinks every few seconds, now and then twice over.
      if (t >= nextBlink) {
        blinkAt = t;
        nextBlink = t + (Math.random() < 0.18 ? 260 : 2400 + Math.random() * 3200);
      }
      // A glance somewhere, and back; while she talks or listens she mostly looks at you.
      if (t >= nextDart) {
        const engaged = d.state === 'speaking' || d.state === 'listening';
        const r = engaged ? 0.18 : 0.45;
        dart = Math.random() < 0.35 ? { x: 0, y: 0 } : { x: (Math.random() * 2 - 1) * r, y: (Math.random() * 2 - 1) * r * 0.6 };
        nextDart = t + 900 + Math.random() * 2600;
      }

      const ease = (k: number) => 1 - Math.exp(-dt * k);
      const target = {
        squint: pose.squint,
        brow: pose.brow,
        lid: pose.lid,
        tilt: pose.tilt,
        lx: pose.lx + (d.state === 'thinking' || still ? 0 : dart.x),
        ly: pose.ly + (d.state === 'thinking' || still ? 0 : dart.y),
        open: mouth ? Math.min(1, mouth.open + pose.open * 0.4) : d.state === 'speaking' ? 0 : pose.open,
        wide: mouth ? mouth.wide : pose.wide,
      };
      for (const k of ['squint', 'brow', 'lid', 'tilt'] as const) now[k] += (target[k] - now[k]) * ease(5);
      for (const k of ['lx', 'ly'] as const) now[k] += (target[k] - now[k]) * ease(18);
      now.open += (target.open - now.open) * ease(mouth ? 22 : 10);
      now.wide += (target.wide - now.wide) * ease(16);

      const s = t / 1000;
      const sway = still ? 0 : 0.012 * Math.sin(s * 0.53) + 0.007 * Math.sin(s * 1.31 + 1);
      const breath = still ? 0 : 1.6 * Math.sin(s * 1.9);

      /*
       * She shifts her weight. Three slow waves that never line up, so it never loops visibly, and
       * she comes nearer while she listens — the one movement anyone reads as paying attention.
       */
      const sway2 = still ? 0 : 1;
      const driftX = sway2 * (26 * Math.sin(s * 0.11) + 11 * Math.sin(s * 0.27 + 2.1));
      const driftY = sway2 * (17 * Math.sin(s * 0.09 + 0.7) + 7 * Math.sin(s * 0.23 + 1.4));
      now.zoom += ((d.state === 'listening' ? 1.06 : d.state === 'speaking' ? 1.02 : 1) - now.zoom) * ease(3);
      gl.uniform4fv(U.view, faceView(aspect, now.zoom, driftX, driftY));

      gl.uniform1f(U.open, now.open);
      gl.uniform1f(U.wide, now.wide);
      gl.uniform1f(U.blink, Math.max(now.lid, blinkCurve(t - blinkAt)));
      gl.uniform1f(U.squint, now.squint);
      gl.uniform1f(U.brow, now.brow);
      gl.uniform1f(U.head, now.tilt + sway);
      gl.uniform1f(U.bob, breath + now.open * 2.5);
      gl.uniform2f(U.look, now.lx, now.ly);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const loop = (t: number) => {
      if (gone) return;
      if (ready && !document.hidden) draw(t);
      frame = requestAnimationFrame(loop);
    };

    const observer = new ResizeObserver(() => ready && size());
    observer.observe(canvas);

    const onLost = (e: Event) => {
      e.preventDefault();
      ready = false;
      setLive(false);
    };
    canvas.addEventListener('webglcontextlost', onLost);

    const img = new window.Image();
    img.decoding = 'async';
    img.onload = () => {
      if (gone) return;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      size();
      ready = true;
      last = performance.now();
      draw(last);
      setLive(true);
    };
    img.src = PORTRAIT;
    frame = requestAnimationFrame(loop);

    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [driver]);

  return (
    <div role="img" aria-label={label} className={cn('relative', className)}>
      {/* The same cut-out render, still, until she is drawn, and for good where WebGL is missing.
          Framed as the live view frames her — her height fills the stage and she stands on its
          bottom edge — so the swap from one to the other does not move her. */}
      <Image
        src={PORTRAIT}
        alt=""
        width={PORTRAIT_SIZE}
        height={PORTRAIT_SIZE}
        priority
        sizes="(max-width: 768px) 90vw, 46vw"
        className={cn('absolute inset-0 h-full w-full object-cover object-bottom transition-opacity duration-300', live && 'opacity-0')}
      />
      <canvas
        ref={canvasRef}
        data-face={live ? 'live' : 'still'}
        className={cn('absolute inset-0 h-full w-full transition-opacity duration-300', live ? 'opacity-100' : 'opacity-0')}
      />
    </div>
  );
}
