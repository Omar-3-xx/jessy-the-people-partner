'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type RefObject } from 'react';

import type { Mood } from '@/lib/kb';
import {
  BLINK_EVERY_MS,
  BLINK_OPEN_MS,
  BLINK_SHUT_MS,
  FRAMES,
  FRAME_SIZE,
  FRONT,
  LIP_PATCH,
  MOUTHS,
  YAW_WATCH,
  blinkAt,
  nextSmile,
  pickFrames,
  pickMouth,
  restYaw,
} from '@/lib/talk/frames';
import type { Patch } from '@/lib/talk/frames';
import {
  EYES_CLOSED,
  MOUTH_A,
  MOUTH_E,
  MOUTH_FV,
  MOUTH_MBP,
  MOUTH_O,
  MOUTH_SMILE,
  MOUTH_U,
} from '@/lib/talk/patches';
import type { MouthShape } from '@/lib/talk/visemes';
import { cn } from '@/lib/utils';

/*
 * Jessy on the page. Nothing here is warped.
 *
 * The old version took one flat render and bent its pixels into a mouth, eyelids and a head turn,
 * and it looked like what it was. This draws his own renders instead: four of them for the turn,
 * and eight more for her mouth and her closed eyes. The page only ever chooses which to show.
 *
 * A mouth and a blink are NOT whole frames, though, and that is the one thing worth knowing about
 * this file. Two renders of her are not the same picture with one thing changed -- aligned as well
 * as they can be, about a third of the frame still differs, because her hair comes back re-drawn
 * every time. Swapping whole frames while she talks would re-draw her hair several times a second.
 * So the mouth and the eyes are cut out of their renders and laid over the front frame as small
 * patches (tools/compose-visemes.py, positions in src/lib/talk/patches.ts), which is a few
 * kilobytes each and leaves the rest of her exactly the picture he approved.
 *
 * A patch only ever goes on the FRONT frame, faded out with it. When her head is turned you are
 * not looking at her mouth straight on, and there is no render of a turned mouth to be honest
 * with -- so as she turns away, her mouth and her blink go with her.
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

/** Where her head settles for each state, before you are taken into account. */
const TURN: Record<FaceState, number> = {
  idle: 0,
  listening: 0,
  // Right round to the profile. She is not looking at you and it should be obvious at a glance.
  thinking: 1.57,
  speaking: 0,
};

/** How much of the way to you she turns in each state. Thinking is the one that ignores you. */
const FOLLOWS: Record<FaceState, number> = { idle: 1, listening: 0.45, thinking: 0, speaking: 0.55 };

/** No mouse has moved for this long, so she stops waiting on it and glances about on her own. */
const POINTER_IDLE_MS = 5000;

/** Her patches, by the name the mouth ladder calls them. */
const PATCH: Record<string, Patch> = {
  'mouth-A': MOUTH_A,
  'mouth-E': MOUTH_E,
  'mouth-O': MOUTH_O,
  'mouth-U': MOUTH_U,
  'mouth-FV': MOUTH_FV,
  'mouth-MBP': MOUTH_MBP,
  'mouth-smile': MOUTH_SMILE,
  'eyes-closed': EYES_CLOSED,
};

/** In a fixed order, so one array of loaded images can be indexed by it. */
const PATCH_NAMES = Object.keys(PATCH);

const clamp1 = (n: number) => (n < -1 ? -1 : n > 1 ? 1 : n);

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
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let gone = false;
    let ready = false;

    const images: HTMLImageElement[] = [];
    const patches: Record<string, HTMLImageElement> = {};
    let loaded = 0;
    const wanted = FRAMES.length + PATCH_NAMES.length;

    let yaw = 0;
    let last = performance.now();
    let aim: { x: number; y: number } | null = null;
    let aimedAt = -1e9;
    let wander = 0;
    let nextWander = performance.now() + 2000;

    // A blink you can predict is worse than none at all, so the gap is never the same twice.
    const gap = () => BLINK_EVERY_MS[0] + Math.random() * (BLINK_EVERY_MS[1] - BLINK_EVERY_MS[0]);
    let blinkAtMs = performance.now() + gap();
    // How far she is into the closed-lipped smile she gives you while she is listening.
    let smile = 0;

    let w = 1;
    let h = 1;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const draw = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const d = driver.current;
      const still = reduce.matches;
      const ease = (k: number) => 1 - Math.exp(-dt * k);

      // Somewhere to look when no mouse has offered one.
      if (t >= nextWander) {
        wander = Math.random() < 0.4 ? 0 : (Math.random() * 2 - 1) * 0.7;
        nextWander = t + 2600 + Math.random() * 4000;
      }
      const watching = aim && t - aimedAt < POINTER_IDLE_MS ? aim.x : wander;
      const follow = still ? 0 : FOLLOWS[d.state] * watching * YAW_WATCH;
      yaw += (restYaw(TURN[d.state] + follow) - yaw) * ease(d.state === 'thinking' ? 3.4 : 4.6);

      /*
       * She breathes, shifts her weight and comes a little nearer to listen: three slow waves that
       * never line up, so it never visibly loops. All of her moves at once, which is the only kind
       * of movement a single picture can do without lying about itself.
       */
      const s = t / 1000;
      const m = d.mouth();
      const sway = still ? 0 : 1;
      const dx = sway * (0.021 * Math.sin(s * 0.11) + 0.009 * Math.sin(s * 0.27 + 2.1));
      const dy =
        sway * (0.013 * Math.sin(s * 0.09 + 0.7) + 0.0055 * Math.sin(s * 0.23 + 1.4) + 0.0016 * Math.sin(s * 1.9)) -
        // Her head carries the stress of what she is saying, the way a real one does.
        (m ? m.open * 0.006 : 0);
      const zoom = still ? 1 : d.state === 'listening' ? 1.05 : d.state === 'speaking' ? 1.02 : 1;

      // She stands on the floor of the page: her height is the stage's, her feet on its bottom edge.
      const side = (h / FRAME_SIZE) * zoom * FRAME_SIZE;
      const x = (w - side) / 2 + dx * h;
      const y = h - side + dy * h;

      ctx.clearRect(0, 0, w, h);
      const { a, b, blend } = pickFrames(yaw);
      if (blend < 1) {
        ctx.globalAlpha = 1;
        ctx.drawImage(images[a], x, y, side, side);
      }
      if (blend > 0) {
        ctx.globalAlpha = blend;
        ctx.drawImage(images[b], x, y, side, side);
      }
      ctx.globalAlpha = 1;

      /*
       * How much of the front frame is on screen. Every patch is faded with it, so her mouth and
       * her blink turn away when she does instead of being painted on the side of her head.
       */
      const front = a === FRONT ? 1 - blend : b === FRONT ? blend : 0;

      /** Lay one patch over her, where it was measured to sit. */
      const lay = (p: Patch, alpha: number) => {
        if (!(alpha > 0.004)) return;
        const img = patches[p.src];
        // A patch that failed to decode is simply not drawn: drawImage on a broken image throws,
        // and the rest of her is a complete picture without it.
        if (!img || !img.complete || !img.naturalWidth) return;
        const k = side / FRAME_SIZE;
        ctx.globalAlpha = alpha > 1 ? 1 : alpha;
        ctx.drawImage(img, x + p.x * k, y + p.y * k, p.w * k, p.h * k);
        ctx.globalAlpha = 1;
      };

      if (front > 0.004 && !still) {
        /*
         * Her mouth. The lip sync hands over how open and how wide it is; the ladders in frames.ts
         * turn that into the two nearest pictures of her mouth and how far between them she is,
         * and they are cross-faded. One rung is the front frame's own closed mouth and draws
         * nothing at all.
         *
         * Her "f" is not on a ladder -- it is as closed as a pause and would flash her teeth at
         * every one -- so it comes over the top on its own channel. At the openness an "f" asks
         * for, the ladder underneath is already drawing nothing.
         */
        if (m) {
          const mm = pickMouth(m);
          const rungs = MOUTHS[mm.ladder];
          const under = rungs[mm.a].patch;
          const over = rungs[mm.b].patch;
          if (under) lay(PATCH[under], (1 - mm.blend) * front);
          if (over) lay(PATCH[over], mm.blend * front);
          lay(PATCH[LIP_PATCH], m.lip * front);
        }

        /*
         * The closed-lipped smile is not a sound, so it is not on the ladder -- flashing it between
         * syllables would be a tic. She wears it while she is listening to you, and it fades.
         */
        smile = nextSmile(smile, d.state === 'listening', m !== null, ease(3.2));
        lay(PATCH['mouth-smile'], smile * front);

        // Her blink, on its own clock, and never while her head is turned away from you.
        const into = t - blinkAtMs;
        if (into > BLINK_SHUT_MS + BLINK_OPEN_MS) blinkAtMs = t + gap();
        lay(PATCH['eyes-closed'], blinkAt(into) * front);
      }
    };

    const loop = (t: number) => {
      if (gone) return;
      if (ready && !document.hidden) draw(t);
      frame = requestAnimationFrame(loop);
    };

    const observer = new ResizeObserver(() => ready && size());
    observer.observe(canvas);

    /* She watches the mouse: how far it is from the middle of her stage is how far she turns. */
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      aim = {
        x: clamp1((e.clientX - (r.left + r.width / 2)) / Math.max(300, r.width * 0.6)),
        y: clamp1((e.clientY - (r.top + r.height * 0.28)) / Math.max(240, r.height * 0.45)),
      };
      aimedAt = performance.now();
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    const arrived = () => {
      if (gone) return;
      if (++loaded < wanted) return;
      size();
      ready = true;
      last = performance.now();
      draw(last);
      setLive(true);
    };

    // Every frame has to be in before the first draw; a missing one would tear a hole in her.
    for (const f of FRAMES) {
      const img = new window.Image();
      img.decoding = 'async';
      img.onload = arrived;
      img.src = f.src;
      images.push(img);
    }
    for (const name of PATCH_NAMES) {
      const p = PATCH[name];
      const img = new window.Image();
      img.decoding = 'async';
      img.onload = arrived;
      img.onerror = arrived;
      img.src = p.src;
      patches[p.src] = img;
    }
    frame = requestAnimationFrame(loop);

    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
    };
  }, [driver]);

  return (
    <div role="img" aria-label={label} className={cn('relative', className)}>
      {/* The front frame, still, until all four are in — framed the way the canvas frames her, so
          the swap from one to the other does not move her. */}
      <Image
        src={FRAMES[1].src}
        alt=""
        width={FRAME_SIZE}
        height={FRAME_SIZE}
        priority
        sizes="(max-width: 768px) 90vw, 46vw"
        className={cn(
          'absolute inset-0 h-full w-full object-contain object-bottom transition-opacity duration-300',
          live && 'opacity-0',
        )}
      />
      <canvas
        ref={canvasRef}
        data-face={live ? 'live' : 'still'}
        className={cn(
          'absolute inset-0 h-full w-full transition-opacity duration-300',
          live ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
