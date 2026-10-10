"""How far, and how much bigger, is her face in one render than in the reference one?

Every render he sends is generated from scratch, so her head comes back a few per cent bigger or
smaller and a few dozen pixels off. For a head turn that does not matter -- the whole frame is
drawn. For a viseme it matters completely: the mouth is cut out of one render and laid on another,
and a 3% difference in head size puts the lips in the wrong place and the wrong size.

So each frame is fitted to head-front before anything is cut out of it. The fit matches EDGES,
which survive a change of expression, over every scale, with the best shift at each scale found
for all shifts at once by FFT. It is matched on the part of her face that the frame did NOT
change: a mouth frame is fitted on her eyes and nose, and the closed-eyes frame on her nose, mouth
and chin. Matching head-front against itself returns scale 1.000, shift 0, correlation 1.000,
which is the check that the method is honest.

Run:  python -I tools/fit-frames.py            (every frame)
      python -I tools/fit-frames.py mouth-O    (one)
Prints a table, and writes it to tools/frame-fits.json for compose-visemes.py to use.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage, signal

SRC = r"F:\Jessy\frames"
HERE = os.path.dirname(os.path.abspath(__file__))
REF = "head-front"

# rows, cols of the part of her face the frame did not change.
EYES = (270, 450, 400, 860)    # eyes, brows, nose bridge
LOWER = (400, 600, 420, 840)   # nose tip, mouth, chin, jaw

BANDS = {
    "mouth-A": EYES, "mouth-O": EYES, "mouth-MBP": EYES, "mouth-smile": EYES,
    "mouth-E": EYES, "mouth-U": EYES, "mouth-FV": EYES,
    "eyes-closed": LOWER, "eyes-half": LOWER,
}
REACH = 110          # how far the band is allowed to have moved, in pixels
LO, HI, STEP = 0.88, 1.12, 0.004


def edges(name):
    g = np.asarray(Image.open(os.path.join(SRC, name + ".png")).convert("L"), dtype=np.float64)
    return np.hypot(ndimage.sobel(g, 1), ndimage.sobel(g, 0))


def best_shift(window, tpl):
    """Normalised cross-correlation of tpl at every position in window, by FFT."""
    n = tpl.size
    t = tpl - tpl.mean()
    ones = np.ones_like(t)
    num = signal.fftconvolve(window, t[::-1, ::-1], mode="valid")
    s1 = signal.fftconvolve(window, ones[::-1, ::-1], mode="valid")
    s2 = signal.fftconvolve(window ** 2, ones[::-1, ::-1], mode="valid")
    var = np.maximum(s2 - s1 ** 2 / n, 1e-9)
    ncc = num / np.sqrt(var * (t ** 2).sum())
    y, x = np.unravel_index(int(np.argmax(ncc)), ncc.shape)
    return float(ncc[y, x]), int(y), int(x)


def fit(ref, other, band):
    """The scale and shift that put `other` on top of `ref`, judged on `band` only."""
    r0, r1, c0, c1 = band
    tpl = ref[r0:r1, c0:c1]
    best = None
    for s in np.arange(LO, HI + 1e-9, STEP):
        b = ndimage.zoom(other, s, order=1)
        oy, ox = b.shape[0] // 2 - ref.shape[0] // 2, b.shape[1] // 2 - ref.shape[1] // 2
        y0, x0, y1, x1 = r0 + oy - REACH, c0 + ox - REACH, r1 + oy + REACH, c1 + ox + REACH
        if y0 < 0 or x0 < 0 or y1 > b.shape[0] or x1 > b.shape[1]:
            continue
        ncc, y, x = best_shift(b[y0:y1, x0:x1], tpl)
        if best is None or ncc > best["ncc"]:
            # dy/dx are measured in the ZOOMED frame, which is where they are applied.
            best = {"ncc": round(ncc, 4), "scale": round(float(s), 4),
                    "dy": y - REACH, "dx": x - REACH}
    return best


if __name__ == "__main__":
    names = sys.argv[1:] or list(BANDS)
    ref = edges(REF)
    out = {}
    # The reference against itself: if this is not 1.000 / 0 / 0, nothing below is worth reading.
    check = fit(ref, ref, EYES)
    print(f"{REF} against itself: scale {check['scale']:.3f} dy {check['dy']:+d} dx {check['dx']:+d} "
          f"ncc {check['ncc']:.3f}")
    assert check["scale"] == 1.0 and check["dy"] == 0 and check["dx"] == 0, "the fit cannot find itself"
    print(f"\n{'frame':<14}{'scale':>8}{'':>10}{'dy':>6}{'dx':>6}{'ncc':>8}  fitted on")
    for n in names:
        band = BANDS[n]
        f = fit(ref, edges(n), band)
        f["band"] = "eyes+nose" if band is EYES else "nose+mouth+chin"
        out[n] = f
        print(f"{n:<14}{f['scale']:>8.3f}{(f['scale'] - 1) * 100:>+9.1f}%{f['dy']:>6}{f['dx']:>6}"
              f"{f['ncc']:>8.3f}  {f['band']}")
    path = os.path.join(HERE, "frame-fits.json")
    if len(names) < len(BANDS) and os.path.exists(path):
        with open(path) as fh:
            out = {**json.load(fh), **out}
    with open(path, "w") as fh:
        json.dump(out, fh, indent=2, sort_keys=True)
    print(f"\nwrote {path}")
