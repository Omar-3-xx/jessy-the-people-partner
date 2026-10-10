# -*- coding: utf-8 -*-
"""Her mouth, read off the recording instead of guessed from the letters.

The old lip sync wrote a timeline from the TEXT (a letter every 55 to 95 ms) and stretched it onto
the clip. Written Arabic has no short vowels, a speaker pauses where a comma is not, and every
quarter second the page snapped the guess back onto the sound: the mouth flapped at letter speed,
ran ahead of the words, and jumped. A mouth moves with syllables, and the recording already holds
every one of them, so this reads each clip once and writes what the mouth does:

  open   how loud the voice is, scaled by the first formant (an "a" opens the jaw, an "ee" and an
         "oo" do not), with fricatives and stops held small
  wide   the second formant: low is rounded ("oo", "o"), high is spread ("ee"), the middle is as drawn
  lip    left at 0: an "f" and an "s" are both hiss, and a wrong "f" is worse than none

and it smooths them at the speed a jaw can move. One file per clip, 50 frames a second, two bytes a
frame, beside the audio: public/voice/ar-001.mouth. Nothing here runs at build time; it is run by
hand when the recordings change, and its output is committed.

  python tools/mouth-tracks.py                 # every clip in public/voice
  python tools/mouth-tracks.py ar-014 --plot   # one clip, and a picture of it beside the file
"""
import os
import subprocess
import sys

import numpy as np
from scipy.linalg import solve_toeplitz
from scipy.signal import lfilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE = os.path.join(ROOT, "public", "voice")

SR = 16000
FPS = 50
HOP = SR // FPS          # 320 samples: 20 ms
WIN = 2 * HOP            # 40 ms
LEAD_MS = 30             # the eye reads a mouth that starts a hair before the sound as in time
WIDE_LO, WIDE_HI = 0.70, 1.10   # the byte 0..255 maps onto this; 1.0 is her mouth as drawn


def decode(path):
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path, "-ac", "1",
                          "-ar", str(SR), "-f", "f32le", "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def lpc(frame, order=12):
    """Linear prediction by the autocorrelation method; None when the frame is silent."""
    f = frame * np.hanning(len(frame))
    r = np.correlate(f, f, "full")[len(f) - 1:len(f) + order]
    if r[0] < 1e-9:
        return None, 0.0
    r[0] *= 1.0001
    a = solve_toeplitz(r[:order], r[1:order + 1])
    return np.concatenate([[1.0], -a]), r[1] / r[0]


def formants(frame):
    """First and second formant in Hz, or (None, None)."""
    pre = lfilter([1, -0.97], [1], frame)
    a, _ = lpc(pre)
    if a is None:
        return None, None
    roots = [z for z in np.roots(a) if np.imag(z) > 0.01]
    found = sorted(
        (np.angle(z) * SR / (2 * np.pi), -SR / np.pi * np.log(abs(z)))
        for z in roots
    )
    # a formant is a narrow resonance well above the glottal rumble
    peaks = [f for f, bw in found if 250 < f < 3800 and bw < 500]
    if len(peaks) < 2:
        return None, None
    return peaks[0], peaks[1]


def smooth(x, up_ms, down_ms):
    """A one-pole follower: quick to move toward a bigger value, slower to let go."""
    out = np.empty_like(x)
    a_up = 1 - np.exp(-1000.0 / FPS / up_ms)
    a_dn = 1 - np.exp(-1000.0 / FPS / down_ms)
    y = x[0]
    for i, v in enumerate(x):
        y += (v - y) * (a_up if v > y else a_dn)
        out[i] = y
    return out


def track(samples):
    n = max(1, len(samples) // HOP)
    pad = np.concatenate([np.zeros(HOP // 2), samples, np.zeros(WIN)])
    db = np.empty(n)
    voiced = np.zeros(n)
    f1 = np.full(n, np.nan)
    f2 = np.full(n, np.nan)
    hf = np.zeros(n)
    for i in range(n):
        fr = pad[i * HOP:i * HOP + WIN]
        e = float(np.mean(fr ** 2))
        db[i] = 10 * np.log10(e + 1e-10)
        a, rho = lpc(lfilter([1, -0.97], [1], fr), 2)
        voiced[i] = max(0.0, rho)
        spec = np.abs(np.fft.rfft(fr * np.hanning(len(fr)))) ** 2
        hf[i] = spec[len(spec) * 2 // 5:].sum() / (spec.sum() + 1e-12)   # share above 3.2 kHz
        if db[i] > -55:
            f1[i], f2[i] = (v if v is not None else np.nan for v in formants(fr))

    floor = np.percentile(db, 8)
    peak = np.percentile(db, 96)
    gate = max(floor + 13, peak - 30)   # a floor of digital silence must not make room tone speech
    level = np.clip((db - gate) / max(6.0, peak - gate), 0, 1)

    # How wide the jaw goes: F1 runs from about 300 Hz ("ee", "oo") to 800 Hz ("a").
    jaw = np.clip((np.nan_to_num(f1, nan=550) - 300) / 500, 0, 1)
    is_vowel = (voiced > 0.55) & (hf < 0.35)
    open_v = level ** 0.75 * (0.50 + 0.50 * jaw)
    # A hiss ("s", "sh", "f") or a burst is a mouth that is barely open.
    open_c = np.minimum(level, 0.55) * 0.34
    openness = np.where(is_vowel, open_v, open_c)

    wide = np.ones(n)
    f2c = np.nan_to_num(f2, nan=1500)
    r = np.clip((f2c - 1000) / 500, 0, 1)             # 1000 Hz rounded .. 1500 Hz neutral
    s = np.clip((f2c - 1900) / 500, 0, 1)             # 1900 Hz neutral .. 2400 Hz spread
    shape = 0.72 + 0.28 * r + 0.08 * s
    wide = np.where(is_vowel & (level > 0.25), shape, 1.0)

    openness = smooth(openness, up_ms=40, down_ms=60)
    wide = smooth(wide, up_ms=70, down_ms=70)
    openness[openness < 0.07] = 0.0                   # a mouth at rest is shut, not trembling

    lead = int(round(LEAD_MS / 1000 * FPS))
    if lead:
        openness = np.concatenate([openness[lead:], np.zeros(lead)])
        wide = np.concatenate([wide[lead:], np.ones(lead)])
    return openness, wide


def pack(openness, wide):
    o = np.clip(np.round(openness * 255), 0, 255).astype(np.uint8)
    w = np.clip(np.round((wide - WIDE_LO) / (WIDE_HI - WIDE_LO) * 255), 0, 255).astype(np.uint8)
    out = np.empty(len(o) * 2, dtype=np.uint8)
    out[0::2] = o
    out[1::2] = w
    return out.tobytes()


def plot(name, samples, openness, wide, seconds=14):
    """A picture of the first seconds: the voice's loudness above, the mouth's two channels below."""
    from PIL import Image, ImageDraw
    px = 100
    w, h = int(seconds * px), 330
    im = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(im)
    for x in range(w):
        seg = samples[int(x / px * SR):int((x + 1) / px * SR)]
        if len(seg):
            a = min(1.0, float(np.abs(seg).max()) * 2.2) * 90
            d.line([(x, 100 - a), (x, 100 + a)], fill=(120, 120, 120))
    for i in range(1, len(openness)):
        x0, x1 = (i - 1) / FPS * px, i / FPS * px
        if x1 > w:
            break
        d.line([(x0, 320 - openness[i - 1] * 120), (x1, 320 - openness[i] * 120)], fill=(200, 30, 30), width=2)
        d.line([(x0, 320 - (wide[i - 1] - 0.7) / 0.4 * 120), (x1, 320 - (wide[i] - 0.7) / 0.4 * 120)],
               fill=(30, 90, 200), width=1)
    for sec in range(int(seconds)):
        d.line([(sec * px, 0), (sec * px, h)], fill=(225, 225, 225))
        d.text((sec * px + 3, 2), str(sec), fill=(0, 0, 0))
    path = os.path.join(os.environ.get("MOUTH_PLOTS", os.getcwd()), name + "-mouth.png")
    im.save(path)
    return path


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    names = args or sorted(f[:-4] for f in os.listdir(VOICE) if f.endswith(".m4a"))
    for name in names:
        samples = decode(os.path.join(VOICE, name + ".m4a"))
        openness, wide = track(samples)
        data = pack(openness, wide)
        with open(os.path.join(VOICE, name + ".mouth"), "wb") as f:
            f.write(data)
        print("%s  %5.1fs  %4d frames  mean open %.2f  moves/s %.1f" % (
            name, len(samples) / SR, len(openness), openness.mean(),
            np.abs(np.diff(openness)).sum() / (len(openness) / FPS)))
        if "--plot" in sys.argv:
            print("  picture:", plot(name, samples, openness, wide))


if __name__ == "__main__":
    main()
