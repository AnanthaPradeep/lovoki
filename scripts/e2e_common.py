"""Shared helpers for the browser suites: portable paths and generated fixture images (no Linux-only /tmp paths)."""
import os, tempfile
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SHOTS = os.environ.get('LOVOKI_SHOTS') or os.path.join(ROOT, 'docs', 'screenshots', 'run')
FIX = os.path.join(tempfile.gettempdir(), 'lovoki-e2e-fixtures')
os.makedirs(SHOTS, exist_ok=True); os.makedirs(FIX, exist_ok=True)

def _photo(path, size, fmt, seed):
    im = Image.new('RGB', size, (200, 160, 150))
    d = ImageDraw.Draw(im)
    for i in range(0, size[0], 40): d.rectangle([i, 0, i + 20, size[1]], fill=((seed * 37 + i) % 255, 120, (seed * 91) % 255))
    d.ellipse([size[0] // 4, size[1] // 4, size[0] * 3 // 4, size[1] * 3 // 4], fill=(240, 220, 200))
    im.save(path, fmt)

def make_fixtures():
    _photo(os.path.join(FIX, 'p1.png'), (800, 1000), 'PNG', 1)
    _photo(os.path.join(FIX, 'p2.jpg'), (900, 1100), 'JPEG', 2)
    _photo(os.path.join(FIX, 'upload.png'), (800, 1000), 'PNG', 3)
    _photo(os.path.join(FIX, 'small.png'), (120, 150), 'PNG', 4)
    Image.new('RGB', (600, 600), (10, 20, 30)).save(os.path.join(FIX, 'anim.gif'), 'GIF')
    with open(os.path.join(FIX, 'fake.jpg'), 'wb') as f: f.write(b'this is plain text pretending to be a jpg' * 40)
    return FIX

make_fixtures()
