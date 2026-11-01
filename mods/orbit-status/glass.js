// Glass for the mods that draw their own block (the sidebar, the status bar,
// the tab rows): a blurred copy of the background under each panel's fill.
// herdr-app has no backdrop blur, so a mod draws, as its bottom layer, the
// background's blurred copy (scripts/blur.py makes it) placed as the window's
// background is, so it lines up with the sharp picture around the block, then
// the glass fill. This file is the same in every orbit mod that uses it.
//
// backdrop({ x, y, w, h, radius, corners, fill }) -> an element to put first
// in a `relative()` block of that size. x, y: the block's place in the window;
// w, h: its size; all in window pixels (what on_size_change and
// viewport_size() report). corners: which are rounded ("tl tr bl br").
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

// The window's drawable size in window pixels; null if the host can't tell.
export function viewport() {
  const size = globalThis.window?.viewport_size?.();
  return size?.width ? size : null;
}

// Where the background picture sits in the window (fit "cover", centred), in
// window pixels: the root background's own placement.
export function cover(picture, view) {
  const scale = Math.max(view.width / picture.width, view.height / picture.height);
  const width = picture.width * scale, height = picture.height * scale;
  return { x: (view.width - width) / 2, y: (view.height - height) / 2, width, height };
}

export function backdrop({ x, y, w, h, radius = 0, corners = "", fill }) {
  const z = zoom();
  const px = (v) => v / z;
  const base = div().absolute().left(0).top(0).w(px(w)).h(px(h));
  // The background's blurred copy; a picture without one gets the plain fill.
  const picture = look().background;
  const view = viewport();
  if (!picture?.blur || !view || !(w > 0) || !(h > 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return base.bg(fill).rounded(px(radius));
  }
  const at = cover(picture, view);
  const r = Math.min(radius, w / 2, h / 2);
  const round = (c) => corners.includes(c);
  // A band of the picture: rows top..top+height, inset left/right (window px).
  const band = (top, height, left, right) => div().absolute().left(px(left)).top(px(top))
    .w(px(Math.max(0, w - left - right))).h(px(height)).overflow_hidden()
    .child(image(picture.blur).absolute()
      .left(px(at.x - x - left)).top(px(at.y - y - top)).w(px(at.width)).h(px(at.height)));
  // How far a corner's curve is in from the side, at row i (0: the edge row).
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
  const rr = (el) => el.when(round("tl"), (e) => e.rounded_tl(px(r))).when(round("tr"), (e) => e.rounded_tr(px(r)))
    .when(round("bl"), (e) => e.rounded_bl(px(r))).when(round("br"), (e) => e.rounded_br(px(r)));
  return base.children(rows).child(rr(div().absolute().left(0).top(0).size_full().bg(fill)));
}

// Where a block of the orbit layout sits in the window, in window pixels,
// from look()'s numbers and the block's own size: the status bar, then the
// orbit block (4px) under it.
//   "sidebar-top": the sidebar's first block; "sidebar-bottom": its last;
//   "status": the status bar block.
export function orbitPlace(L, where, own) {
  const z = zoom(), view = viewport();
  if (!view || !own) return null;
  // herdr-app rounds each zoomed length to whole pixels.
  const status = Math.round(L.status * z), keys = Math.round(4 * z);
  if (where === "sidebar-top") return { x: 0, y: 0 };
  if (where === "sidebar-bottom") return { x: 0, y: view.height - keys - status - own.height };
  if (where === "status") return { x: 0, y: view.height - keys - own.height };
  return null;
}
