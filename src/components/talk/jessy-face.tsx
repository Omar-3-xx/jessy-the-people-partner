'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type RefObject } from 'react';

import type { Mood } from '@/lib/kb';
import { FRAMES, FRAME_SIZE, YAW_WATCH, pickFrames } from '@/lib/talk/frames';
import type { MouthShape } from '@/lib/talk/visemes';
import { cn } from '@/lib/utils';

/*
 * Jessy on the page. Nothing here is warped.
 *
 * The old version took one flat render and bent its pixels into a mouth, eyelids and a head turn,
 * and it looked like what it was. This draws his own renders instead: four of them, one per
 * direction, and the page only ever chooses which to show. She turns her head to follow your
 * mouse, turns away while she thinks, and comes back to you to answer. She breathes and shifts her
 * weight, because that moves all of her at once, which a single picture can do honestly.
 *
 * What is NOT here yet, and why: her mouth and her blink. Both need their own renders -- the mouth
 * in its shapes, the eyes closed -- and until those exist, faking them is the thing he threw out.
 * Her head carries the stress of her voice in the meantime, which is real.
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
    let loaded = 0;

    let yaw = 0;
    let last = performance.now();
    let aim: { x: number; y: number } | null = null;
    let aimedAt = -1e9;
    let wander = 0;
    let nextWander = performance.now() + 2000;

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
      yaw += (TURN[d.state] + follow - yaw) * ease(d.state === 'thinking' ? 3.4 : 4.6);

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
        ctx.globalAlpha = 1;
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

    // Every frame has to be in before the first draw; a missing one would tear a hole in her.
    for (const f of FRAMES) {
      const img = new window.Image();
      img.decoding = 'async';
      img.onload = () => {
        if (gone) return;
        if (++loaded < FRAMES.length) return;
        size();
        ready = true;
        last = performance.now();
        draw(last);
        setLive(true);
      };
      img.src = f.src;
      images.push(img);
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
