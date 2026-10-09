"""Lift the full-figure render off the black it was rendered on.

Border-connected fill only, so the navy jumper and the dark hair — both darker than a threshold
would allow — are never touched. The edge is pulled in one pixel and feathered, which also takes
the faint rim the generator left.
"""
from collections import deque
from PIL import Image, ImageFilter
import numpy as np, os

d = os.path.dirname(os.path.abspath(__file__))
im = Image.open(r'F:\Jessy\Warm Brown-Haired Girl in Navy Attire.png').convert('RGB')
w, h = im.size
a = np.asarray(im).astype(np.int16)
seedable = a.max(axis=2) <= 40

seen = np.zeros((h, w), bool)
q = deque()
# NOT the bottom row: she runs off the bottom of the frame, so her jumper touches it, and a seed
# there walks straight up into the dark folds of her clothes and hollows her out.
for x in range(w):
    if seedable[0, x] and not seen[0, x]:
        seen[0, x] = True; q.append((x, 0))
for y in range(h):
    for x in (0, w - 1):
        if seedable[y, x] and not seen[y, x]:
            seen[y, x] = True; q.append((x, y))
while q:
    x, y = q.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < w and 0 <= ny < h and not seen[ny, nx] and seedable[ny, nx]:
            seen[ny, nx] = True; q.append((nx, ny))

mask = Image.fromarray(((~seen) * 255).astype(np.uint8), 'L')
mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.9))
out = im.convert('RGBA'); out.putalpha(mask)
out.save(os.path.join(d, 'body-cut.png'))
dest = r'F:\Jessy\website\public\images\jessy-free.webp'
out.save(dest, 'WEBP', quality=94, method=6, exact=True)
print('kept %.1f%%' % (100 * (~seen).mean()), '->', dest, os.path.getsize(dest)//1024, 'KB')
bb = mask.point(lambda v: 255 if v > 24 else 0).getbbox()
print('she occupies', bb, 'of', (w, h))
bg = Image.new('RGBA', out.size, (255, 0, 255, 255)); bg.alpha_composite(out)
bg.convert('RGB').resize((470, 470)).save(os.path.join(d, 'body-check.png'))
