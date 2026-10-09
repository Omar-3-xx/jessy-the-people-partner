"""Cut his rendered frames off the flat grey they were generated on.

The earlier portrait came on BLACK, which is why tools/cut-render.py had to flood-fill from the
border and take only connected pixels: a plain brightness threshold ate her navy jumper and her
dark hair. These frames are different. The background is a flat mid-grey -- about (158,158,159)
with a standard deviation of one -- and nothing she is wearing or made of is anywhere near it, so
the distance from that one colour is enough on its own, with no flood fill and no connectivity.

The edge is feathered rather than cut square: a pixel half way between her hair and the grey gets
half the alpha, which is what stops the hair looking like it was cut out with scissors.

Run:  python -I tools/cut-frames.py [name ...]
With no names it does every PNG in F:\\Jessy\\frames that the site knows about.
"""
import os
import sys

import numpy as np
from PIL import Image

SRC = r"F:\Jessy\frames"
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "images", "frames")

# Below LO away from the background colour is background; above HI is her; between is the edge.
LO, HI = 10.0, 34.0


def cut(name):
    path = os.path.join(SRC, name + ".png")
    im = Image.open(path).convert("RGB")
    a = np.asarray(im, dtype=np.float32)
    # The two corners that are never her. (She can reach the bottom edge.)
    corners = np.concatenate([a[:60, :60].reshape(-1, 3), a[:60, -60:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    # His renders do not all come back on the SAME grey -- the four heads were (158,158,159) and
    # the first mouth frame (136,140,147) -- which is why the colour is read off each image rather
    # than written down. What must hold is that it is FLAT. A contact sheet has cells in its
    # corners, so its corner sample is not flat, and cutting one by colour distance would make
    # confetti of it silently. That is the failure that cost a whole render run, so it stops here.
    spread = float(corners.std(axis=0).max())
    assert spread < 4.0, (
        f"{name}: the corners are not one flat colour (sd {spread:.1f}). "
        "This looks like a contact sheet, not a single render -- ask for it again on its own."
    )
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    alpha = np.clip((dist - LO) / (HI - LO), 0.0, 1.0)

    out = np.dstack([a, alpha * 255.0]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    os.makedirs(DST, exist_ok=True)
    img.save(os.path.join(DST, name + ".webp"), quality=92, method=6)

    opaque = float((alpha > 0.99).mean())
    edge = float(((alpha > 0.01) & (alpha < 0.99)).mean())
    print(f"{name:<14} bg={bg.round(0)}  solid {opaque*100:5.1f}%  soft edge {edge*100:4.2f}%")
    return alpha


if __name__ == "__main__":
    names = sys.argv[1:] or ["head-front", "head-left34", "head-right34", "head-profile"]
    for n in names:
        cut(n)
