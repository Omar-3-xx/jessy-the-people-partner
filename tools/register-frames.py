"""Put her body in the same place in every frame, so a cut between them turns her head only.

A head turn pivots on the neck: the body must not move. His four renders disagree about where the
body is by as much as 162 px, because each was framed on its own. The pearl on her necklace is the
anchor -- near-white, a few hundred pixels, sitting on a navy jumper that is nothing like it, and
on the part of her that is supposed to stay still.

Every frame is shifted so its pearl lands where head-front's does. Run it after cut-frames.py; it
reads and rewrites the cut-outs in public/images/frames.

Run:  python -I tools/register-frames.py
"""
import os

import numpy as np
from PIL import Image

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "images", "frames")
NAMES = ["head-front", "head-left34", "head-right34", "head-profile"]
ANCHOR = "head-front"


def pearl(a):
    """The median position of the pearl, in pixels, or None."""
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bright = (al > 250) & (r > 205) & (g > 198) & (b > 180) & (np.abs(r - g) < 26) & (r - b < 55)
    # Below her chin and above her belt: nothing else up there is this bright.
    bright[: int(a.shape[0] * 0.42), :] = False
    bright[int(a.shape[0] * 0.62):, :] = False
    ys, xs = np.nonzero(bright)
    if len(xs) < 40:
        return None
    return int(np.median(xs)), int(np.median(ys))


def load(name):
    return np.asarray(Image.open(os.path.join(D, name + ".webp")).convert("RGBA"), dtype=np.int16)


def shift(img, dx, dy):
    """Move the picture inside its own frame, leaving transparent where it came from."""
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (dx, dy))
    return out


if __name__ == "__main__":
    ref = pearl(load(ANCHOR))
    assert ref, "the pearl was not found in the anchor frame"
    print(f"anchor {ANCHOR}: pearl at {ref}")
    for n in NAMES:
        a = load(n)
        p = pearl(a)
        assert p, f"the pearl was not found in {n}"
        dx, dy = ref[0] - p[0], ref[1] - p[1]
        if dx == 0 and dy == 0:
            print(f"{n:<14} already in place")
            continue
        im = Image.open(os.path.join(D, n + ".webp")).convert("RGBA")
        shift(im, dx, dy).save(os.path.join(D, n + ".webp"), quality=92, method=6)
        print(f"{n:<14} moved dx {dx:+5d}  dy {dy:+5d}")
