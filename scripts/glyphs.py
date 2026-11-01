#!/usr/bin/env python3
"""Writes the 8 identity symbols (hexagon, triangle, square, circle, star,
plus, cross, diamond) as SVGs into mods/orbit-tabs/glyphs/: <n>.svg outlined,
<n>-fill.svg filled. On a 16px box."""
import math, os, sys

out = sys.argv[1] if len(sys.argv) > 1 else "mods/orbit-tabs/glyphs"
c, r = 8.0, 6.0


def polygon(n, start, radius):
    return [(c + math.cos(start + i / n * math.tau) * radius(i), c + math.sin(start + i / n * math.tau) * radius(i)) for i in range(n)]


def cross(turn):
    a, l = r * 0.42, r * 1.05
    arm = [(a, -l), (a, -a), (l, -a), (l, a), (a, a), (a, l), (-a, l), (-a, a), (-l, a), (-l, -a), (-a, -a), (-a, -l)]
    s, co = math.sin(turn), math.cos(turn)
    return [(c + x * co - y * s, c + x * s + y * co) for x, y in arm]


shapes = [
    polygon(6, -math.pi / 2, lambda i: r),
    polygon(3, -math.pi / 2, lambda i: r * 1.1),
    polygon(4, math.tau / 8, lambda i: r * 1.1),
    None,
    polygon(10, -math.pi / 2, lambda i: r * 1.15 if i % 2 == 0 else r * 0.55),
    cross(0.0),
    cross(math.pi / 4),
    polygon(4, -math.pi / 2, lambda i: r * 1.1),
]
os.makedirs(out, exist_ok=True)
for k, pts in enumerate(shapes):
    for fill in (False, True):
        paint = 'fill="#fff"' if fill else 'fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"'
        if pts is None:
            body = f'<circle cx="{c}" cy="{c}" r="{r * 0.9:.2f}" {paint}/>'
        else:
            d = " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
            body = f'<polygon points="{d}" {paint}/>'
        name = f"{k}-fill.svg" if fill else f"{k}.svg"
        with open(os.path.join(out, name), "w") as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">{body}</svg>\n')
print(out)
