import { div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex, InputState, Input } from "gpui-base";
import { shared } from "herdr";
import { LINE } from "./look.js";
import { backdrop, zoom, viewport } from "./glass.js";
import { dragged, publish } from "./drag.js";

export function muted(border, ring, focused) {
  if (!focused) return border;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lerp = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
  const c = lerp(rgb(border), rgb(ring), 0.3);
  const grey = Math.round(0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]);
  return "#" + lerp(c, [grey, grey, grey], 0.6).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// A row's measures in window pixels (see glass.js for the units), each a whole
// number of the screen's (`dots` to one of them), as herdr lays blocks out: so
// the pane's outline is one line however the zoom rounds. `W`, `H`: the row;
// `band`: the row's first strip, the tab line; `low`: where the
// tabs are.
export function rowGeom(host, L, blockId) {
  const z = zoom();
  const own = host.own;
  const seen = host.at && own && Math.abs(host.at.width - own.width) < 1 && Math.abs(host.at.height - own.height) < 1 ? host.at : null;
  const at = seen ?? shared("orbit.places")?.[blockId] ?? null;
  const dots = host.dots ?? 1;
  const snap = (v) => Math.round(v * dots) / dots;
  const W = snap(own?.width ?? at?.width ?? 0), H = snap(own?.height ?? at?.height ?? 0);
  if (!W || !H) return null;
  const px = (v) => snap(v * z);
  const line = Math.max(1 / dots, px(LINE)), band = line;
  return { z, W, H, px, snap, line, band, radius: px(L.radius), curve: px(Math.min(6, L.radius)), top: Boolean(L.top),
    lowTop: L.top ? line : band, lowHeight: Math.max(0, H - band - line), x: at?.x ?? null, y: at?.y ?? null };
}

const PAD = 11, GAP = 4, DOT = 10, ICON = 17, NARROW = 60;

// Where each tab of a row is: {x, w} in whole pixels from the row's left edge,
// by its label alone, so showing another tab moves nothing. Too many for
// `room`: the widest narrow first, then the row scrolls (`host.scroll`).
export function tabPlaces(host, g, faces, room, shownAt) {
  const natural = faces.map((f) => g.px(2 * PAD + (f.dot || f.ring ? DOT : 0) + (f.icon ? ICON : 0) + (f.after ? 15 : 0))
    + (f.field ? g.px(f.field) : g.snap((host.texts?.[f.key] ?? 7.4 * g.z * f.label.length) + 1)));
  const gap = g.px(GAP), gaps = gap * Math.max(0, faces.length - 1);
  const wide = (i, cap) => (faces[i].field ? natural[i] : Math.min(natural[i], cap));
  const sum = (cap) => natural.reduce((a, _w, i) => a + wide(i, cap), 0) + gaps;
  let cap = Math.max(0, ...natural);
  while (cap > g.px(NARROW) && sum(cap) > room) cap = g.snap(cap - 1);
  const total = sum(cap), over = Math.max(0, total - room);
  let x = 0;
  const places = natural.map((_w, i) => { const p = { x, w: wide(i, cap) }; x += p.w + gap; return p; });
  const shown = places[shownAt];
  if (shown && host.scrolledTo !== `${faces[shownAt].key}/${room}`) {
    host.scrolledTo = `${faces[shownAt].key}/${room}`;
    host.scroll = Math.max(shown.x + shown.w - room, Math.min(shown.x, host.scroll ?? 0));
  }
  host.scroll = g.snap(Math.min(over, Math.max(0, host.scroll ?? 0)));
  return { places: places.map((p) => ({ x: p.x - host.scroll, w: p.w })), width: Math.min(total, room), over, gap };
}

export function rulers(host, faces) {
  // An element half a pixel wide is laid out one screen pixel wide.
  const dot = div().id("ruler-dot").absolute().left(0).top(0).w(0.51 / zoom()).h(0).on_size_change((size, cx) => {
    const dots = size.width > 0 ? Math.round(120 / size.width) / 120 : 1;
    if (host.dots !== dots) { host.dots = dots; cx.notify(); }
  });
  return div().absolute().left(0).top(0).w(0).h(0).overflow_hidden().child(dot).children(faces.filter((f) => !f.field).map((f) =>
    div().absolute().left(0).top(0).whitespace_nowrap().text_size(12).invisible().id(`ruler-${f.key}`)
      .on_size_change((size, cx) => {
        if (host.texts?.[f.key] === size.width) return;
        host.texts = { ...(host.texts ?? {}), [f.key]: size.width };
        cx.notify();
      }).child(f.label)));
}

export function face(f, color, tint, { ghost = false, field = null } = {}) {
  return [
    f.dot || f.ring ? div().size(6).mr(4).flex_none().rounded(3)
      .when(Boolean(f.dot), (el) => el.bg(ghost ? color : f.dot)).when(!f.dot, (el) => el.border(1).border_color(ghost ? color : f.ring)) : null,
    f.icon ? (f.tint || ghost ? svg(f.icon).size(12).mr(5).flex_none().text_color(ghost ? color : tint)
      : image(f.icon).w(12).h(12).mr(5).flex_none()) : null,
    field ?? div().min_w(0).truncate().child(f.label),
    f.after ? svg(f.after).size(12).ml(3).flex_none().text_color(tint) : null,
  ].filter(Boolean);
}

const GHOST = 0.3;

export function grey(color) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const v = Math.round(0.3 * r + 0.59 * g + 0.11 * b).toString(16).padStart(2, "0");
  return `#${v}${v}${v}`;
}

const faded = (color) => grey(color) + Math.round(GHOST * 255).toString(16).padStart(2, "0");

// A line of square corners ([x, y, corner radius], the line's middle) as a
// filled path `width` thick: its two edges, not a stroke, since herdr puts a
// path's coordinates on whole pixels and an odd stroke's middle is between two.
function linePath(points, width, at) {
  const n = points.length, h = width / 2;
  const dir = (i) => [Math.sign(points[i + 1][0] - points[i][0]), Math.sign(points[i + 1][1] - points[i][1])];
  const edge = (d) => points.map(([x, y, r = 0], i) => {
    const before = i > 0 ? dir(i - 1) : null, after = i < n - 1 ? dir(i) : null;
    const normals = [before, after].filter(Boolean).map(([dx, dy]) => [-dy, dx]);
    const turn = before && after ? before[0] * after[1] - before[1] * after[0] : 0;
    const off = turn ? normals : normals.slice(0, 1);
    return { x: x + d * off.reduce((v, m) => v + m[0], 0), y: y + d * off.reduce((v, m) => v + m[1], 0),
      r: r > 0 ? Math.max(0, r - d * turn) : 0, turn, before, after };
  });
  let p = PathBuilder.fill();
  const draw = (list, back, first) => {
    for (const v of list) {
      const into = back ? v.after && v.after.map((c) => -c) : v.before, out = back ? v.before && v.before.map((c) => -c) : v.after;
      if (!(v.r > 0) || !into || !out || !v.turn) {
        p = first ? p.move_to(...at(v.x, v.y)) : p.line_to(...at(v.x, v.y));
      } else {
        p = p.line_to(...at(v.x - into[0] * v.r, v.y - into[1] * v.r));
        p = p.arc_to(at(v.r, 0)[0], at(v.r, 0)[0], 0, false, (back ? -v.turn : v.turn) > 0 !== at.flipped, ...at(v.x + out[0] * v.r, v.y + out[1] * v.r));
      }
      first = false;
    }
  };
  draw(edge(h), false, true);
  draw(edge(-h).reverse(), true, false);
  return p.close().build();
}

// The row's part of the pane's outline, each line one path: the tab line with
// the shown tab's sides and bottom (`line`), and the row's edge round the rest
// (`low`). `shown`: the shown tab's {x, w}; at the row's left edge its side is
// the pane's own and its corner the row's. `ghost`: that tab is being dragged.
export function outline(g, { shown, line, low, ghost = false }) {
  const { W, H, z, top } = g, h = g.line / 2;
  const at = (x, y) => [x / z, (top ? H - y : y) / z];
  at.flipped = top;
  const draw = (color, ...points) => globalThis.window.paint_path(linePath(points, g.line, at), color).absolute().left(0).top(0).w(W / z).h(H / z);
  const left = h, right = W - h, tabLine = g.band - h, edge = H - h;
  const round = (r) => Math.max(0, Math.min(r, edge - tabLine) - h);
  const R = round(g.radius), r = round(g.curve);
  if (!shown) {
    return [draw(low, [left, g.band], [left, edge, R], [right, edge, R], [right, g.band]),
      draw(line, [left, 0], [left, tabLine], [right, tabLine], [right, 0])];
  }
  const first = shown.x <= 0;
  const a = first ? left : shown.x + h, b = Math.min(shown.x + shown.w - h, right - 2 * g.curve);
  const ra = first ? R : r, rl = first ? 0 : Math.max(0, Math.min(r, a - left - h));
  const lows = [draw(low, [b - r, edge], [right, edge, R], [right, g.band])];
  if (!first) lows.push(draw(low, [left, g.band], [left, edge, R], [a + ra, edge]));
  const lead = first ? [[left, 0]] : [[left, 0], [left, tabLine], [a, tabLine, rl]];
  const tab = [[a, edge, ra], [b, edge, r], [b, tabLine, r]];
  const tail = [[right, tabLine], [right, 0]];
  if (!ghost) return [...lows, draw(line, ...lead, ...tab, ...tail)];
  const start = first ? [left, g.band] : [a - rl, tabLine];
  return [...lows, draw(faded(line), start, ...(first ? [] : [[a, tabLine, rl]]), ...tab, [b + r, tabLine]),
    draw(line, [left, 0], ...(first ? [] : [[left, tabLine]]), start), draw(line, [b + r, tabLine], ...tail)];
}

// A row of tabs (a pane's, the side panel's): `faces` are its tabs' looks
// ({key, label, dot, ring, icon, tint, color, tip, drag, field}), `wire` adds
// a tab's clicks, `tail` what stands after the tabs, `end` at the right end.
export function tabRow(host, t, L, o) {
  const g = rowGeom(host, L, o.block);
  if (!g) return [];
  const px = (v) => v / g.z;
  const drag = dragged();
  const mine = drag && drag.row === o.row;
  const tailW = host.tailW ?? g.px(96), endW = host.endW ?? g.px(40);
  const shownAt = o.faces.findIndex((f) => f.key === o.shown);
  const room = Math.max(g.px(NARROW), g.W - tailW - endW - g.curve);
  const { places, width, over, gap } = tabPlaces(host, g, o.faces, room, shownAt);
  publish(o.row, g, o.faces, places, gap, drag);
  const shown = shownAt < 0 ? null : places[shownAt];
  const clipped = shown && (shown.x + shown.w > 0 && shown.x < width)
    ? { x: Math.max(0, shown.x), w: Math.min(shown.x + shown.w, width) - Math.max(0, shown.x) } : null;
  const ghost = mine ? o.faces.findIndex((f) => f.key === drag.key) : -1;

  const tabs = o.faces.map((f, i) => {
    const p = places[i], isGhost = i === ghost, on = i === shownAt;
    const color = isGhost ? grey(t.foreground) : on ? t.foreground : t.ansi7;
    const pill = h_flex().id(`d-tab-${o.row}-${i}`).absolute().left(px(g.px(3))).top(px(g.snap((g.lowHeight - g.px(26)) / 2)))
      .w(px(p.w - 2 * g.px(3))).h(px(g.px(26))).px(PAD - 3).items_center().text_size(12).text_color(color).rounded(Math.min(6, L.radius))
      .when(!on && !drag, (el) => el.hover((s) => s.bg(t.foreground.slice(0, 7) + "0f").text_color(t.foreground)))
      .when(Boolean(f.tip) && !f.field, (el) => el.tooltip(f.tip))
      .when(isGhost, (el) => el.opacity(GHOST))
      .when(isGhost && !on, (el) => el.bg(grey(t.foreground) + "18"))
      .children(face(f, color, on ? t.foreground : t.muted, { ghost: isGhost, field: f.field ? o.field(f) : null }));
    const el = o.drag.tab(o.wire(pill, f, i), f, i, p);
    return div().absolute().left(px(p.x)).top(0).w(px(p.w)).h_full().child(el);
  });

  const low = div().absolute().left(0).w(px(g.W)).top(px(g.lowTop)).h(px(g.lowHeight));
  return [
    rulers(host, o.faces),
    div().absolute().left(0).w(px(g.W)).top(px(g.top ? g.H - g.band : 0)).h(px(g.band)).bg(t.surface.slice(0, 7) + "9e"),
    ...outline(g, { shown: clipped, line: o.line, low: o.low, ghost: ghost >= 0 && ghost === shownAt }),
    low.child(div().id(`d-tabs-${o.row}`).absolute().left(0).top(0).w(px(width)).h_full().overflow_hidden().children(tabs)
      .when(over > 0, (el) => el.on_scroll_wheel((e, cx) => {
        const d = Math.abs(e.delta.x) > Math.abs(e.delta.y) ? e.delta.x : e.delta.y;
        host.scroll = g.snap(Math.min(over, Math.max(0, (host.scroll ?? 0) - d)));
        cx.notify();
      })))
      .child(measured(host, "tailW", `d-tail-${o.row}`).absolute().left(px(width)).top(0).pl(6).child(o.tail ?? div()))
      .child(measured(host, "endW", `d-end-${o.row}`).absolute().right(0).top(0).child(o.end ?? div())),
  ];
}

function measured(host, key, id) {
  return h_flex().id(id).h_full().flex_none().items_center().on_size_change((size, cx) => {
    if (host[key] !== size.width) { host[key] = size.width; cx.notify(); }
  });
}

export function rowGlass(host, L, blockId, fill) {
  const g = rowGeom(host, L, blockId);
  if (!g) return null;
  const el = backdrop({ x: g.x ?? undefined, y: g.y === null ? undefined : g.top ? g.y : g.y + g.band, w: g.W, h: g.H - g.band,
    radius: g.radius, corners: g.top ? "tl tr" : "bl br", fill });
  return g.top ? el : el.top(g.band / g.z);
}

export function remember(host, b, cx) {
  if (!b) return;
  const a = host.at;
  if (a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height) return;
  host.at = { x: b.x, y: b.y, width: b.width, height: b.height };
  cx?.notify?.();
}

export function track(host, el) {
  return el.relative()
    .on_size_change((size, cx) => {
      if (size.width !== host.own?.width || size.height !== host.own?.height) { host.own = size; cx.notify(); }
    });
}

export function inColumn(e, L) {
  const b = e?.bounds, p = e?.position;
  if (!b || !p || p.x < b.x || p.x > b.x + b.width) return false;
  if (!L?.top) return p.y < b.y;
  const view = viewport(), z = zoom();
  const floor = view ? view.height - Math.round(L.status * z) - Math.round(Math.max(4, L.gap || 0) * z) : Infinity;
  return p.y > b.y + b.height && p.y < floor;
}

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
      input.on("change", (_e, cx) => cx.notify());
      input.on("blur", () => { if (host.edit?.input === input) input.focus(); });
      input.focus();
      cx.notify();
    },
    width(label) {
      const now = host.edit?.input?.value?.() ?? label ?? "";
      return Math.max(70, Math.min(260, 7.4 * Math.max(String(label ?? "").length, String(now).length) + 32));
    },
    field(t, label) {
      const w = kit.width(label);
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
