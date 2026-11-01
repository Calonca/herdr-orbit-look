// A pane's tab row as the bottom of its outline. The layout frames each pane:
// the outline's top (orbit-edge), the content between the two side lines,
// then this row. This file is the same in every orbit mod that uses it.
//
// The row is segments side by side. Each segment is a band, the pane's glass
// down to the tab line, and under it the segment's own part of the row (a
// tab, the lead). The outline's sides go past the tab line (a T there) and
// down the row, and an edge closes the row with rounded corners: below the
// tab line all of it muted (`muted()`). The shown tab has no tab line: its
// sides come down from the line, curving out of it, to its own edge, bright,
// which lies on the row's edge in place of the muted one.
//
//   ├──────────╯          ╰──────────┤
//   ┊   demo   │ ● claude │ shell    ┊
//   ╰┈┈┈┈┈┈┈┈┈┈┴──────────┴┈┈┈┈┈┈┈┈┈┈╯

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { shared } from "herdr";
import { LINE } from "./look.js";
import { backdrop, blockPlace, zoom } from "./glass.js";

// The colour below the tab line: on a focused pane, `ring` (the space's)
// 0.3 of the way from the border grey, then 0.6 of the way to its own grey;
// else the border.
export function muted(border, ring, focused) {
  if (!focused) return border;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lerp = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
  const c = lerp(rgb(border), rgb(ring), 0.3);
  const grey = Math.round(0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]);
  return "#" + lerp(c, [grey, grey, grey], 0.6).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// t: theme(); L: look(); line: the outline's colour; low: the muted one
// (muted()); fillets: the folder of the mod's fillet-{t,b}{l,r}.svg.
export function rowKit(t, L, line, low, fillets) {
  const R = L.radius; // the outline's corners
  const TAB = Math.min(6, L.radius); // the shown tab's
  const band = R + LINE;
  const glass = t.surface.slice(0, 7) + "9e";

  // The band of a segment: glass, the tab line at its bottom; at the row's
  // ends the outline's sides, bright, meeting it.
  const bandOf = (first, last) => {
    let b = div().w_full().h(band).flex_none().bg(glass).border_color(line).border_b(LINE);
    if (first) b = b.border_l(LINE);
    if (last) b = b.border_r(LINE);
    return b;
  };
  // Below the band: the row's edge, muted; at the ends its sides and corners.
  const lowerOf = (el, first, last) => {
    let b = el.flex_1().min_h(0).border_color(low).border_b(LINE);
    if (first) b = b.border_l(LINE).rounded_bl(R);
    if (last) b = b.border_r(LINE).rounded_br(R);
    return b;
  };

  // A segment: `lower` under the band (its height the row's less the band).
  const seg = (lower, { first = false, last = false } = {}) =>
    v_flex().child(bandOf(first, last)).child(lowerOf(lower, first, last)).h_full().flex_none();

  // The shown tab: open into the content, its sides and rounded edge in the
  // line's colour, glass inside. `inner` is its label. Beside it, the line
  // curves out of the band into its sides (a curve drawn over the tab's top
  // corners, its upright edge on the tab's side; outside the curve nothing,
  // inside it glass, a fillet's shape).
  const shownSeg = (inner) => {
    const curve = (left) => {
      const corner = left ? "tr" : "tl";
      let c = div().absolute().w(TAB + LINE).h(TAB + LINE).border_color(line).top(band - LINE).border_t(LINE);
      c = left ? c.left(-TAB).border_r(LINE).rounded_tr(TAB) : c.right(-TAB).border_l(LINE).rounded_tl(TAB);
      const wedge = svg(`${fillets}/fillet-${corner}.svg`).absolute().size(TAB).text_color(glass).top(0)
        .when(left, (el) => el.right(0)).when(!left, (el) => el.left(0));
      return c.child(wedge);
    };
    // Beside the tab, glass down to where the line starts curving; under
    // that, the row's muted edge.
    const beside = () => v_flex().h_full().w(TAB).flex_none()
      .child(div().w_full().h(band - LINE).flex_none().bg(glass))
      .child(lowerOf(div().w_full(), false, false));
    // Its own edge lies on the row's edge, bright; inside, the row's glass.
    const body = h_flex().flex_1().min_h(0).items_center().border_color(line).border_l(LINE).border_r(LINE)
      .border_b(LINE).rounded_b(TAB);
    const open = div().w_full().h(band).flex_none().bg(glass);
    // The curves first: the tab's side is drawn over their upright edge.
    const col = v_flex().relative().h_full().flex_none().child(curve(true)).child(curve(false))
      .child(open).child(body.child(inner));
    return h_flex().h_full().flex_none().child(beside()).child(col).child(beside());
  };

  return { band, seg, shownSeg };
}

// The row's glass below the tab line: the blurred background with the glass
// fill (glass.js, as the sidebar's), inside the muted frame's rounded
// corners. Put it first in the row's root, which is relative(); `host` keeps
// where the row is: track(host, el) on the root records it, and remember()
// what a press anywhere (on_mouse_down_out) says. L: look(); tree: layout().
//
// Where: the row's own bounds, as the last pointer move over it or press
// anywhere reported them, while its size is still that; else worked out from
// the layout (blockPlace), e.g. before the first.
export function rowGlass(host, L, tree, blockId, fill) {
  const z = zoom();
  const own = host.own;
  const seen = host.at && own && Math.abs(host.at.width - own.width) < 1 && Math.abs(host.at.height - own.height) < 1 ? host.at : null;
  const at = seen ?? blockPlace(tree, blockId) ?? null;
  const w = own?.width ?? at?.width, h = own?.height ?? at?.height;
  if (!w || !h) return null;
  const band = (L.radius + LINE) * z;
  return backdrop({ x: at?.x, y: at == null ? undefined : at.y + band, w, h: h - band,
    radius: L.radius * z, corners: "bl br", fill }).top(band / z);
}

// The row's bounds as an event gave them.
export function remember(host, b, cx) {
  if (!b) return;
  const a = host.at;
  if (a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height) return;
  host.at = { x: b.x, y: b.y, width: b.width, height: b.height };
  cx?.notify?.();
}

// Records the row's size and bounds on `host` (re-rendering when they change).
export function track(host, el) {
  const keep = (b, cx) => remember(host, b, cx);
  return el.relative()
    .on_size_change((size, cx) => {
      if (size.width !== host.own?.width || size.height !== host.own?.height) { host.own = size; cx.notify(); }
    })
    .on_mouse_move((e, cx) => keep(e?.bounds, cx));
}

// A press in the pane above the row (between it and the window's top, in the
// row's columns): herdr's focused() says nothing when a press goes into a mod
// block, so each row watches every press in the window (capture phase: a mod
// stopping it can't hide it) and takes those in its own pane.
export function inColumn(e) {
  const b = e?.bounds, p = e?.position;
  return Boolean(b && p && p.x >= b.x && p.x <= b.x + b.width && p.y < b.y);
}

// Drag to reorder a row's tabs (orbit-tabs: the panes' and the side panel's). A press on a
// tab picks it up; moving over another tab shows where it would land, as a
// bar on that tab's far side (after it moving right, before it moving left);
// releasing there calls `drop(from, to, cx)` with the two tabs' places in the
// row. A press and release on the same tab stays a click (GPUI's click needs
// both on one element), and a double-click picks nothing up. Mods hear no
// release outside their own elements, so leaving the row puts the tab back.
//   const drag = dragKit(host, colour, (from, to, cx) => …);
// A double-click calls `double(i, cx)` instead (the rename, editKit below).
//   drag.tab(tabEl, i, draggable)   each tab;   drag.root(rowEl)
export function dragKit(host, color, drop, double = null) {
  const set = (v, cx) => {
    host.drag = v;
    cx.notify();
  };
  return {
    tab(el, i, ok = true) {
      const g = host.drag;
      const at = g && ok && g.over === i && g.from !== i ? (g.from < i ? "after" : "before") : null;
      return el.relative()
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          const n = e?.click_count ?? 1;
          host.drag = ok && n < 2 ? { from: i, over: i } : null;
          if (n === 2 && double) double(i, cx);
        })
        .on_mouse_move((_e, cx) => {
          const g = host.drag, over = ok ? i : g?.from;
          if (g && g.over !== over) set({ ...g, over }, cx);
        })
        .on_mouse_up("left", (_e, cx) => {
          const g = host.drag;
          if (g) set(null, cx);
          if (g && ok && g.from !== i) drop(g.from, i, cx);
        })
        .when(Boolean(at), (el) => el.child(div().absolute().top(5).bottom(5).w(2).rounded(1).bg(color)
          .when(at === "after", (m) => m.right(0)).when(at === "before", (m) => m.left(0))));
    },
    root(el) {
      return el.on_hover((h, cx) => { if (!h && host.drag) set(null, cx); })
        .on_mouse_up("left", (_e, cx) => { if (host.drag) set(null, cx); });
    },
  };
}

// Renaming a tab where its label is: a name field in its place, the name
// chosen. Enter (or a press anywhere else) keeps the new name, Esc the old one;
// an empty or unchanged name changes nothing. `save(key, name, cx)` stores it.
// Started by a double-click (dragKit's `double`) or the tab's menu's Rename
// (the menu asks through shared "orbit.rename" { row, key, n }, which the
// row takes up on its next render: `edit.asked(row, labelOf)`).
//   const edit = editKit(host, save);   host.acx: an AsyncContext (init's)
//   edit.on(key) ? edit.field(t, label) : label
export function editKit(host, save) {
  const kit = {
    on: (key) => host.edit?.key === key,
    begin(cx, key, value) {
      const input = InputState.new({ value });
      if (value) input.set_selected_range({ start: 0, end: value.length });
      const finish = (cx, keep) => {
        const e = host.edit;
        if (!e || e.input !== input) return;
        host.edit = null;
        const name = input.value().trim();
        if (keep && name && name !== value) save(key, name, cx);
        cx.notify();
      };
      host.edit = { key, input, value, cancel: (cx) => finish(cx, false), keep: (cx) => finish(cx, true) };
      input.on("submit", (_e, cx) => finish(cx, true));
      // herdr moves its focus on its own (the click that showed the tab, a
      // pane.focus): while the field is open it takes the keys back. A press
      // anywhere else ends it (keeping the name), as Enter does.
      input.on("blur", () => { if (host.edit?.input === input) input.focus(); });
      input.focus();
      cx.notify();
    },
    // The field, as wide as the name with room to type.
    field(t, label) {
      const w = Math.max(70, Math.min(220, 7.2 * String(label ?? "").length + 28));
      return div().id("orbit-rename").flex_none()
        .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); host.edit?.cancel(cx); } })
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_mouse_down_out((_e, cx) => host.edit?.keep(cx))
        .child(Input.new(host.edit.input).w(w).h(20).px(4).rounded(4).border(1).border_color(t.border)
          .bg(t.background ?? t.chrome).text_size(12).text_color(t.foreground));
    },
    // The menu's Rename for this row: once per ask, after the menu has gone
    // (closing it gives the keys back to where they were).
    asked(row, labelOf) {
      const ask = shared("orbit.rename");
      if (!ask || ask.row !== row || ask.n === host.renameSeen || !host.acx || Date.now() - ask.n > 5000) return;
      host.renameSeen = ask.n;
      host.acx.timer.after(150, (cx) => {
        const value = labelOf(ask.key);
        if (value !== null && value !== undefined) kit.begin(cx, ask.key, value);
      });
    },
  };
  return kit;
}
