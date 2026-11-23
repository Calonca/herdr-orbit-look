import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { shared } from "herdr";
import { LINE } from "./look.js";
import { backdrop, zoom, viewport } from "./glass.js";

export function muted(border, ring, focused) {
  if (!focused) return border;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lerp = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
  const c = lerp(rgb(border), rgb(ring), 0.3);
  const grey = Math.round(0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]);
  return "#" + lerp(c, [grey, grey, grey], 0.6).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function rowKit(t, L, line, low, fillets) {
  const top = L.top;
  const R = L.radius;
  const TAB = Math.min(6, L.radius);
  const band = LINE;
  const glass = t.surface.slice(0, 7) + "9e";

  const bandOf = () => div().w_full().h(band).flex_none().bg(line);
  const lowerOf = (el, first, last) => {
    let b = el.flex_1().min_h(0).border_color(low);
    b = top ? b.border_t(LINE) : b.border_b(LINE);
    if (first) b = top ? b.border_l(LINE).rounded_tl(R) : b.border_l(LINE).rounded_bl(R);
    if (last) b = top ? b.border_r(LINE).rounded_tr(R) : b.border_r(LINE).rounded_br(R);
    return b;
  };

  const stack = (bandEl, lower) => (top ? v_flex().child(lower).child(bandEl) : v_flex().child(bandEl).child(lower));
  const seg = (lower, { first = false, last = false } = {}) =>
    stack(bandOf(), lowerOf(lower, first, last)).h_full().flex_none();

  const shownSeg = (inner) => {
    const curve = (left) => {
      const corner = top ? (left ? "br" : "bl") : (left ? "tr" : "tl");
      let c = div().absolute().w(TAB + LINE).h(TAB + LINE).border_color(line);
      c = left ? c.left(-TAB).border_r(LINE) : c.right(-TAB).border_l(LINE);
      c = top ? c.bottom(band - LINE).border_b(LINE) : c.top(band - LINE).border_t(LINE);
      c = corner === "tr" ? c.rounded_tr(TAB) : corner === "tl" ? c.rounded_tl(TAB)
        : corner === "br" ? c.rounded_br(TAB) : c.rounded_bl(TAB);
      const wedge = svg(`${fillets}/fillet-${corner}.svg`).absolute().size(TAB).text_color(glass)
        .when(corner.endsWith("r"), (el) => el.right(0)).when(corner.endsWith("l"), (el) => el.left(0))
        .when(corner.startsWith("t"), (el) => el.top(0)).when(corner.startsWith("b"), (el) => el.bottom(0));
      return c.child(wedge);
    };
    const beside = () => {
      const rest = lowerOf(div().w_full(), false, false);
      return v_flex().h_full().w(TAB).flex_none().child(rest);
    };
    let body = h_flex().flex_1().min_h(0).items_center().border_color(line).border_l(LINE).border_r(LINE);
    body = top ? body.border_t(LINE).rounded_t(TAB) : body.border_b(LINE).rounded_b(TAB);
    const open = div().w_full().h(band).flex_none().bg(glass);
    const col = v_flex().relative().h_full().flex_none().child(curve(true)).child(curve(false))
      .children(top ? [body.child(inner), open] : [open, body.child(inner)]);
    return h_flex().h_full().flex_none().child(beside()).child(col).child(beside());
  };

  return { band, seg, shownSeg };
}

export function rowGlass(host, L, blockId, fill) {
  const z = zoom();
  const own = host.own;
  const seen = host.at && own && Math.abs(host.at.width - own.width) < 1 && Math.abs(host.at.height - own.height) < 1 ? host.at : null;
  const at = seen ?? shared("orbit.places")?.[blockId] ?? null;
  const w = own?.width ?? at?.width, h = own?.height ?? at?.height;
  if (!w || !h) return null;
  const band = LINE * z;
  const top = L.top;
  const el = backdrop({ x: at?.x, y: at == null ? undefined : top ? at.y : at.y + band, w, h: h - band,
    radius: L.radius * z, corners: top ? "tl tr" : "bl br", fill });
  return top ? el : el.top(band / z);
}

export function remember(host, b, cx) {
  if (!b) return;
  const a = host.at;
  if (a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height) return;
  host.at = { x: b.x, y: b.y, width: b.width, height: b.height };
  cx?.notify?.();
}

export function track(host, el) {
  const keep = (b, cx) => remember(host, b, cx);
  return el.relative()
    .on_size_change((size, cx) => {
      if (size.width !== host.own?.width || size.height !== host.own?.height) { host.own = size; cx.notify(); }
    })
    .on_mouse_move((e, cx) => keep(e?.bounds, cx));
}

export function inColumn(e, L) {
  const b = e?.bounds, p = e?.position;
  if (!b || !p || p.x < b.x || p.x > b.x + b.width) return false;
  if (!L?.top) return p.y < b.y;
  const view = viewport(), z = zoom();
  const floor = view ? view.height - Math.round(L.status * z) - Math.round(Math.max(4, L.gap || 0) * z) : Infinity;
  return p.y > b.y + b.height && p.y < floor;
}

// Drag to reorder a row's tabs (orbit-tabs: the panes' and the side panel's). A press on a
// tab picks it up; moving over another tab shows where it would land, as a
// bar on that tab's far side (after it moving right, before it moving left);
// releasing there calls `drop(from, to, cx)` with the two tabs' places in the
// row. A press and release on the same tab stays a click (GPUI's click needs
// both on one element), and a double-click picks nothing up. Mods hear no
// release outside their own elements, so leaving the row puts the tab back.
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
          const first = host.pressed && Date.now() - host.pressed.at < 600 ? host.pressed.i : i;
          host.pressed = n < 2 ? { i, at: Date.now() } : null;
          if (n === 2 && double) double(first, cx);
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
    field(t, label) {
      const now = host.edit?.input?.value?.() ?? label ?? "";
      const w = Math.max(70, Math.min(260, 7.4 * Math.max(String(label ?? "").length, String(now).length) + 32));
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
