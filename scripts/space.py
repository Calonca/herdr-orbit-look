#!/usr/bin/env python3
"""Renders the generated space (Milky-Way band, three nebulae, stars and the
planet rising bottom-right) as a still PNG for herdr-app's layout background.

A still picture: herdr-app shows pictures only, so there is no twinkle or
drift.

    scripts/space.py mods/orbit/backgrounds/space.png [width height]
"""
import sys

import numpy as np
from PIL import Image

DESIGN_WIDTH = 1440.0


def linear(hex_):
    return (np.array([(hex_ >> 16) & 255, (hex_ >> 8) & 255, hex_ & 255], float) / 255.0) ** 2.2


# centre, radii (fractions of the screen), rotation (degrees), colour, alpha
GLOWS = [
    ((0.50, 0.43), (0.65, 0.13), -18.0, 0x8FB8FF, 0.16),
    ((0.50, 0.425), (0.45, 0.045), -18.0, 0xD8E6FF, 0.12),
    ((0.70, 0.15), (0.30, 0.30), 0.0, 0x2A5BD7, 0.35),
    ((0.105, 0.775), (0.225, 0.275), 0.0, 0x14A3B8, 0.26),
    ((0.36, 0.24), (0.14, 0.16), 0.0, 0x4A3FC4, 0.22),
]


def render(w, h):
    aspect = h / w
    ys, xs = np.mgrid[0:h, 0:w].astype(float)
    px = (xs + 0.5) / w
    py = (ys + 0.5) / w  # width units, so circles stay round
    img = np.broadcast_to(linear(0x04070F), (h, w, 3)).copy()
    for (cx, cy), (rx_, ry_), rot, color, alpha in GLOWS:
        s, c = np.sin(np.radians(rot)), np.cos(np.radians(rot))
        dx, dy = px - cx, py - cy * aspect
        rx, ry = dx * c + dy * s, -dx * s + dy * c
        d2 = (rx / rx_) ** 2 + (ry / (ry_ * aspect)) ** 2
        a = (alpha * np.exp(-1.6 * d2))[..., None]
        img = img * (1 - a) + linear(color) * a

    # The planet: a 1100px circle (at the design's width) whose box starts at (58%, 70%).
    k = w / DESIGN_WIDTH
    size = 1100.0 * k
    x0, y0 = 0.58 * w, 0.70 * h
    center = np.array([x0 + size / 2, y0 + size / 2])
    radius = size / 2
    light = np.array([x0 + 0.35 * size, y0 + 0.18 * size])
    X, Y = xs + 0.5, ys + 0.5
    dist = np.hypot(X - center[0], Y - center[1])

    # Outer cyan glow (0 0 90px 18px rgba(90,190,255,.28)).
    glow = np.clip(1 - (dist - radius - 18 * k) / (90 * k), 0, 1) ** 2 * 0.28
    glow = np.where(dist >= radius, glow, 0)[..., None]
    img = img * (1 - glow) + linear(0x5ABEFF) * glow

    # Body: radial gradient from the lit side.
    t = np.hypot(X - light[0], Y - light[1]) / (radius * 1.6)
    stops = [(0.0, linear(0x16305C)), (0.35, linear(0x0A1630)), (0.70, linear(0x04070F))]
    body = np.broadcast_to(stops[2][1], (h, w, 3)).copy()
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        f = np.clip((t - t0) / (t1 - t0), 0, 1)[..., None]
        seg = (t <= t1) & (t >= t0)
        body = np.where(seg[..., None], c0 + (c1 - c0) * f, body)
    body = np.where((t < 0)[..., None], stops[0][1], body)
    inside = (dist < radius)[..., None]
    img = np.where(inside, body, img)

    # Inner rim light, stronger at the top (inset 0 10px 40px rgba(125,207,255,.45)).
    dir_y = (Y - center[1]) / np.maximum(dist, 1)
    top = np.clip(0.35 - 0.65 * dir_y, 0, 1)
    rim = np.clip(1 - (radius - dist) / (40 * k), 0, 1) ** 2 * 0.45 * top
    rim = np.where(dist < radius, rim, 0)[..., None]
    img = img * (1 - rim) + linear(0x7DCFFF) * rim

    out = (np.clip(img, 0, 1) ** (1 / 2.2) * 255).round().astype(np.uint8)
    pic = Image.fromarray(out, "RGB")

    # Stars (320, seed 7), drawn at their own size.
    from PIL import ImageDraw

    draw = ImageDraw.Draw(pic, "RGBA")
    state = [7]

    def r():
        state[0] = (state[0] * 1664525 + 1013904223) % 4294967296
        return state[0] / 4294967296

    tints = [0xE6EFFF, 0xE6EFFF, 0xE6EFFF, 0x9FD4FF, 0xBCD0FF, 0xFFF4E0]
    for i in range(320):
        x = r() * 100
        if i % 3 == 0:
            y = r() * 100
        else:
            g = (r() + r() + r() - 1.5) * 9
            y = 52 - (x - 50) * 0.36 + g
        if not 0 <= y <= 100:
            continue
        bright = r() > 0.94
        d = 2.0 if bright else (1.0 if r() < 0.8 else 1.5)
        a = 0.95 if bright else 0.2 + r() * 0.55
        tint = tints[int(r() * len(tints)) % len(tints)]
        rgb = ((tint >> 16) & 255, (tint >> 8) & 255, tint & 255)
        sx, sy = x / 100 * w, y / 100 * h
        if np.hypot(sx - center[0], sy - center[1]) < radius:
            continue
        rr = d / 2 * k
        if bright:
            draw.ellipse([sx - rr * 3, sy - rr * 3, sx + rr * 3, sy + rr * 3], fill=rgb + (int(0.08 * 255),))
        draw.ellipse([sx - rr, sy - rr, sx + rr, sy + rr], fill=rgb + (int(a * 255),))
    return pic


if __name__ == "__main__":
    out = sys.argv[1]
    w, h = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (2560, 1600)
    render(w, h).save(out, optimize=True)
    print(out)
