// herdr-app has no backdrop blur, so a mod draws, as its bottom layer, the
// background's blurred copy (scripts/blur.py makes it) placed as the window's
// background is, so it lines up with the sharp picture around the block, then
// the glass fill. This file is the same in every orbit mod that uses it.
//
// Units: herdr-app multiplies the lengths a mod writes by its zoom, but reports
// sizes and positions unzoomed, so everything here is in window pixels and is
// divided by the zoom when written.
//
// gpui clips to rectangles only, so a rounded corner is drawn as 1px rows,
// each clipped to the curve: one picture (loaded once), a few dozen copies.

import { div, image } from "gpui-kit";
import { settings } from "herdr";
import { look } from "./look.js";

export function zoom() {
  return settings()?.zoom || 1;
}

export function viewport() {
  const size = globalThis.window?.viewport_size?.();
  return size?.width ? size : null;
}

export function cover(picture, view) {
  const scale = Math.max(view.width / picture.width, view.height / picture.height);
  const width = picture.width * scale, height = picture.height * scale;
  return { x: (view.width - width) / 2, y: (view.height - height) / 2, width, height };
}

export function backdrop({ x, y, w, h, radius = 0, corners = "", fill }) {
  const z = zoom();
  const px = (v) => v / z;
  const base = div().absolute().left(0).top(0).w(px(w)).h(px(h));
  const rr = (el, r) => el.when(corners.includes("tl"), (e) => e.rounded_tl(px(r))).when(corners.includes("tr"), (e) => e.rounded_tr(px(r)))
    .when(corners.includes("bl"), (e) => e.rounded_bl(px(r))).when(corners.includes("br"), (e) => e.rounded_br(px(r)));
  const picture = look().background;
  const view = viewport();
  if (!picture?.blur || !view || !(w > 0) || !(h > 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return rr(base.bg(fill), radius);
  }
  const at = cover(picture, view);
  const r = Math.min(radius, w / 2, h / 2);
  const round = (c) => corners.includes(c);
  const band = (top, height, left, right) => div().absolute().left(px(left)).top(px(top))
    .w(px(Math.max(0, w - left - right))).h(px(height)).overflow_hidden()
    .child(image(picture.blur).absolute()
      .left(px(at.x - x - left)).top(px(at.y - y - top)).w(px(at.width)).h(px(at.height)));
  const inset = (i) => {
    const d = r - i - 0.5;
    return r - Math.sqrt(Math.max(0, r * r - d * d));
  };
  const rows = [];
  const R = Math.ceil(r);
  const topR = round("tl") || round("tr") ? R : 0;
  const botR = round("bl") || round("br") ? R : 0;
  for (let i = 0; i < topR; i++) {
    const k = inset(i);
    rows.push(band(i, 1, round("tl") ? k : 0, round("tr") ? k : 0));
  }
  rows.push(band(topR, h - topR - botR, 0, 0));
  for (let i = 0; i < botR; i++) {
    const k = inset(i);
    rows.push(band(h - 1 - i, 1, round("bl") ? k : 0, round("br") ? k : 0));
  }
  return base.children(rows).child(rr(div().absolute().left(0).top(0).size_full().bg(fill), r));
}

export function orbitPlace(L, where, own) {
  const z = zoom(), view = viewport();
  if (!view || !own) return null;
  const gap = Math.round((L.gap || 0) * z), status = Math.round(L.status * z), keys = Math.round(Math.max(4, L.gap || 0) * z);
  if (where === "sidebar-top") return { x: gap, y: gap };
  if (where === "sidebar-bottom") return { x: gap, y: view.height - keys - status - gap - own.height };
  if (where === "status") return { x: gap, y: view.height - keys - own.height };
  return null;
}

export function orbitRadius(L) {
  return L.gap ? L.radius * zoom() : 0;
}
