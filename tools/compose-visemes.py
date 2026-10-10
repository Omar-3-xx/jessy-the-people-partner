r"""Lay the mouth (or the closed eyes) of one render onto the front render, and leave the rest.

Why not simply show the whole frame: two renders of her are NOT the same picture with one thing
changed. Aligned as well as they can be, about a third of the frame still differs -- her hair is
re-drawn every time. Swapping whole frames while she talks would re-draw her hair several times a
second. So only the part that is meant to change is taken, and the rest of her stays the one
picture he approved.

Three things make the join invisible:

  - The frame is SCALED as well as shifted. Her head comes back 1-4% bigger or smaller in every
    render (tools/fit-frames.py measures it), and at that size the lips land in the wrong place
    and the wrong size. The scale is refined here against the thing that actually matters: how
    little the skin just OUTSIDE the cut differs once the two are laid on top of each other.
  - The cut is a feathered ellipse, so there is no edge to see.
  - The ellipse is trimmed to her SKIN. Her hair, her neck in shadow and the collar of her jumper
    are drawn differently in every render, so anywhere the ellipse reaches them the blend smudges
    -- which it visibly did on the neck before the regions were measured off a ruled grid. Keeping
    to skin, and to a region that stops above the collar, means the join only ever crosses cheek
    and chin, which every render agrees about.

It writes two things. The PATCHES in public/images/frames are what the site actually draws: a
small cut-out with the feather in its alpha, laid over the front frame by the canvas, which is a
few kilobytes instead of a second copy of her. The full composites in F:\Jessy\frames\composed
are for looking at.

Run:  python -I tools/compose-visemes.py
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"F:\Jessy\frames"
LOOK = os.path.join(SRC, "composed")
HERE = os.path.dirname(os.path.abspath(__file__))
DST = os.path.join(HERE, "..", "public", "images", "frames")
BASE = "head-front"
N = 1254

"""
The part of her each frame is allowed to replace: centre row, centre column, the two radii, where
the ellipse ends and how much of it is spent fading out -- in head-front's own pixels. Read off a
ruled grid over her face, not guessed: her eyes sit on row 320 and span columns 465 to 795, her
nose tip is on row 400, her lips span rows 420 to 455, her chin ends on row 510, and the collar of
her jumper starts on row 555. The mouth region stops short of that collar on purpose.

`trim` says whether to cut the ellipse back to the mask of her face. For the mouth that is what
keeps the blend off her hair and off her neck. For the eyes it must NOT be done: at eye level the
face mask is the bridge of her nose and nothing else -- her eyes are not skin, and the hole they
punch in it reaches out to her hair, so it is never closed. Trimming the blink to it closed one
eye and left the other open, and she WINKED. So the eye region is sized to stay inside her face
instead, with a short fade that lands on her temples.
"""
REGION = {
    "mouth-A": (448, 625, 68, 95, 1.15, 0.34, True),
    "mouth-O": (448, 625, 68, 95, 1.15, 0.34, True),
    "mouth-MBP": (448, 625, 68, 95, 1.15, 0.34, True),
    "mouth-smile": (448, 625, 68, 95, 1.15, 0.34, True),
    "mouth-E": (448, 625, 68, 95, 1.15, 0.34, True),
    "mouth-U": (448, 625, 68, 95, 1.15, 0.34, True),
    "mouth-FV": (448, 625, 68, 95, 1.15, 0.34, True),
    "eyes-closed": (320, 630, 55, 180, 1.05, 0.14, False),
    # The middle of the blink is cut from exactly the same region as the shut eyes, so the two
    # patches cover the same pixels and one can be laid over the other without a seam moving.
    "eyes-half": (320, 630, 55, 180, 1.05, 0.14, False),
}
RING = (1.1, 1.6)  # just outside the cut, as a multiple of the edge: where a bad fit shows


def rgb(name, folder=SRC):
    return np.asarray(Image.open(os.path.join(folder, name + ".png")).convert("RGB"), dtype=np.float64)


def zoomed(a, scale):
    """The frame scaled about its centre, on a canvas big enough to shift it about in."""
    bg = np.median(np.concatenate([a[:60, :60].reshape(-1, 3), a[:60, -60:].reshape(-1, 3)]), axis=0)
    z = ndimage.zoom(a, (scale, scale, 1), order=1)
    pad = 400
    canvas = np.empty((z.shape[0] + 2 * pad, z.shape[1] + 2 * pad, 3))
    canvas[:] = bg
    canvas[pad:pad + z.shape[0], pad:pad + z.shape[1]] = z
    return canvas


def shifted(canvas, dy, dx):
    cy, cx = canvas.shape[0] // 2 + dy, canvas.shape[1] // 2 + dx
    return canvas[cy - N // 2:cy - N // 2 + N, cx - N // 2:cx - N // 2 + N]


def face(a):
    """The area of her face, hair and jumper excluded -- but her eyes and lips kept.

    A plain skin test throws away exactly the parts a viseme replaces: her lips are not skin
    coloured and her eyes are not skin at all, so a blink cut to a skin mask covered the cheeks
    around her eyes and not her eyes (the first run came back with a 254-pixel-wide eye patch
    where the region asked for 450). So the holes the test punches INSIDE her face -- eyes,
    nostrils, lips -- are filled back in, and only then is the edge pulled in off her hair.
    """
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (r > 150) & (g > 100) & (b > 80) & (r > b + 25) & (r >= g)
    m = ndimage.binary_fill_holes(ndimage.binary_closing(m, np.ones((9, 9))))
    return ndimage.binary_erosion(m, np.ones((9, 9)))


def ellipse(cy, cx, ry, rx):
    yy, xx = np.mgrid[0:N, 0:N]
    return np.sqrt(((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2)


def fit_by_seam(a, fit, t, base, base_face, edge):
    """Refine the fit against the only thing that shows: the skin just outside the cut.

    The scale is searched over its whole plausible range rather than a narrow window around
    fit-frames.py's global number. That window was +/-0.024 and two of the five patches came
    back pinned against its edge -- mouth-A at 0.992 out of a global 0.972, eyes-closed at
    1.016 out of 1.036 -- so the seam had not reached its minimum, only the end of where it was
    allowed to look. The global fit cannot settle it either: it disagrees with itself by band,
    reading 0.972 for mouth-A on the eye-and-nose band and 1.048 on the collar, because the
    generator RE-DREW her instead of zooming her. Only agreement around this one cut matters to
    the composite, so that is measured here and nothing else is believed.

    Coarse over the range, then fine around the winner. Scaling the frame is the slow part, so
    each scale is built once and every shift is tried against it.
    """
    ring = (t > edge * RING[0]) & (t < edge * RING[1]) & base_face
    assert ring.sum() > 2000, "there is not enough skin around this region to judge the fit"
    base_ring = base[ring]

    def sweep(scales, reach, step, centre):
        best = None
        for s in scales:
            canvas = zoomed(a, s)
            for ddy in range(-reach, reach + 1, step):
                for ddx in range(-reach, reach + 1, step):
                    moved = shifted(canvas, centre[0] + ddy, centre[1] + ddx)
                    d = float(np.sqrt(((base_ring - moved[ring]) ** 2).sum(-1)).mean())
                    if best is None or d < best[0]:
                        best = (d, float(s), centre[0] + ddy, centre[1] + ddx)
        return best

    coarse = sweep(np.arange(0.950, 1.0601, 0.005), 20, 4, (fit["dy"], fit["dx"]))
    fine = sweep(np.arange(coarse[1] - 0.005, coarse[1] + 0.0051, 0.001), 3, 1,
                 (coarse[2], coarse[3]))
    seam, scale, dy, dx = fine if fine[0] < coarse[0] else coarse
    return seam, scale, dy, dx, shifted(zoomed(a, scale), dy, dx)


def compose(name, fit, base, base_face):
    cy, cx, ry, rx, edge, feather, trim = REGION[name]
    t = ellipse(cy, cx, ry, rx)
    inside = base_face if trim else np.ones_like(base_face)
    # The fit is judged on SKIN outside the cut, always -- even for the blink, whose own cut
    # must not be trimmed to the face mask. Her hair is re-drawn in every render, so a ring
    # that reaches it measures the generator's imagination instead of the fit.
    seam, scale, dy, dx, moved = fit_by_seam(rgb(name), fit, t, base, base_face, edge)

    m = ndimage.gaussian_filter(np.clip((edge - t) / feather, 0, 1) * inside, 6)

    # For looking at: the whole of her with this one thing changed.
    os.makedirs(LOOK, exist_ok=True)
    whole = np.clip(base * (1 - m[..., None]) + moved * m[..., None], 0, 255).astype(np.uint8)
    Image.fromarray(whole).save(os.path.join(LOOK, name + ".png"))

    # For the site: just the patch, with the feather in its alpha.
    ys, xs = np.nonzero(m > 0.004)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    patch = np.dstack([moved[y0:y1, x0:x1], m[y0:y1, x0:x1] * 255.0]).astype(np.uint8)
    os.makedirs(DST, exist_ok=True)
    Image.fromarray(patch, "RGBA").save(os.path.join(DST, name + ".webp"), quality=92, method=6)
    kb = os.path.getsize(os.path.join(DST, name + ".webp")) / 1024
    return {"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0,
            "scale": round(scale, 4), "dy": dy, "dx": dx, "seam": round(seam, 1), "kb": round(kb, 1)}


if __name__ == "__main__":
    with open(os.path.join(HERE, "frame-fits.json")) as fh:
        fits = json.load(fh)
    base = rgb(BASE)
    base_face = face(base)
    print(f"her face is {base_face.mean() * 100:.1f}% of the front frame\n")
    print(f"{'patch':<14}{'scale':>8}{'dy':>5}{'dx':>5}{'seam':>7}{'at':>12}{'size':>12}{'kb':>7}")
    import sys

    only = sys.argv[1:]
    for name in only:
        assert name in REGION, f"no region for {name}"
    path = os.path.join(HERE, "patches.json")
    out = {}
    if only and os.path.exists(path):
        # One frame asked for: keep every measurement that was already made for the others.
        with open(path) as fh:
            out = json.load(fh)
    for name in only or REGION:
        r = compose(name, fits[name], base, base_face)
        out[name] = r
        print(f"{name:<14}{r['scale']:>8.3f}{r['dy']:>+5d}{r['dx']:>+5d}{r['seam']:>7.1f}"
              f"{str((r['x'], r['y'])):>12}{str((r['w'], r['h'])):>12}{r['kb']:>7.1f}")
    with open(os.path.join(HERE, "patches.json"), "w") as fh:
        json.dump(out, fh, indent=2, sort_keys=True)
    print(f"\npatches -> {os.path.normpath(DST)}\nwhole frames to look at -> {LOOK}")
