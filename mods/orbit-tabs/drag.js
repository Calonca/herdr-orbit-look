// Dragging a tab of a row (orbit-tabs: the panes' and the side panel's).
// A press on a tab and a move pick it up (dragKit). While it lasts, shared
// "orbit.drag" says which tab and where it would land; its row draws the ghost
// (rowframe.js). The tab that follows the pointer and the bar where it would
// land are drawn by a see-through window over everything (DragLayer): a mod
// hears no pointer outside its own elements, and a window stays until closed.
// Nothing changes before the release: a drop asks the orbit mod ("tab-drop").

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, shared, setShared, openOverlay, closeOverlay, focused, run, theme, spaces } from "herdr";
import { look, ask } from "./look.js";
import { zoom, viewport } from "./glass.js";
import { face, remember } from "./rowframe.js";

const DRAG = "orbit.drag";
const START = 5;
// A drag nothing ended (the layer's mod failed, say) is none after this long.
const STALE = 120000;

const pointer = () => globalThis.window?.mouse_position?.() ?? null;

export function dragged() {
  const d = shared(DRAG);
  return d && Date.now() - d.n < STALE && d.space === spaces().find((s) => s.active)?.id ? d : null;
}

// Where a row's tabs are, for the drag (and tools/regress.py's probe).
export function publish(row, g, faces, places, gap, drag) {
  if (g.x === null || (!drag && shared("orbit.probe") !== true)) return;
  const now = { n: drag?.n ?? 0, x: g.x, y: g.y, w: g.W, h: g.H, line: g.line, band: g.band, top: g.top, gap, low: g.lowTop,
    tabs: faces.map((f, i) => ({ key: f.key, label: f.label, x: places[i].x, w: places[i].w, pick: f.drag === null })) };
  const key = `orbit.row.${row}`;
  if (JSON.stringify(shared(key)) !== JSON.stringify(now)) setShared(key, now);
}

export function dragKit(host, row, color, double = null) {
  const begin = (cx, at) => {
    const p = host.press;
    host.press = null;
    const view = viewport(), space = spaces().find((s) => s.active);
    if (!p?.face.drag || !view || !space || dragged()) return;
    const { key, label, dot, ring, icon, tint } = p.face;
    const f = focused();
    setShared(DRAG, { n: Date.now(), space: space.id, row, key, to: p.face.drag.to, color, over: null, at, grab: p.grab, w: p.w,
      face: { key, label, dot, ring, icon, tint }, back: f?.pane ? { pane: f.pane } : f?.terminal ? { terminal: f.terminal } : null });
    host.layer = openOverlay({ mod: "orbit-tabs", kind: "window", frame: "none", at: { x: 0, y: 0 },
      width: view.width / zoom(), height: view.height / zoom(), props: { drag: true } });
    cx.notify();
  };
  const moved = (e, cx) => {
    remember(host, e?.bounds, cx);
    const p = host.press;
    if (p && Math.hypot(e.position.x - p.from.x, e.position.y - p.from.y) > START * zoom()) begin(cx, e.position);
  };
  return {
    tab(el, f, i, place) {
      return el.on_mouse_down("left", (e, cx) => {
        cx.stop_propagation();
        const n = e?.click_count ?? 1;
        host.press = n < 2 && f.drag && !f.field && e.local_position
          ? { face: f, from: e.position, w: place.w, grab: { x: e.local_position.x + 3 * zoom(), y: e.local_position.y } } : null;
        const first = host.pressed && Date.now() - host.pressed.at < 600 ? host.pressed.i : i;
        host.pressed = n < 2 ? { i, at: Date.now() } : null;
        if (n === 2 && double) double(first, cx);
      });
    },
    root(el) {
      return el.on_mouse_move(moved)
        .on_hover((h, cx) => { const at = pointer(); if (!h && host.press && at) begin(cx, at); else if (!h) host.press = null; })
        // A release the layer wasn't there for yet.
        .on_mouse_up("left", () => {
          host.press = null;
          if (host.layer && shared(DRAG)) closeOverlay(host.layer);
          host.layer = null;
        });
    },
  };
}

function target(d, p, L) {
  const z = zoom(), view = viewport();
  const floor = view.height - Math.round(L.status * z) - Math.round(Math.max(4, L.gap || 0) * z);
  for (const row of [d.row, ...d.to]) {
    const r = shared(`orbit.row.${row}`);
    if (r?.n !== d.n || p.x < r.x || p.x > r.x + r.w) continue;
    const inRow = p.y >= r.y && p.y <= r.y + r.h;
    const inPane = p.y >= 0 && p.y < floor && (r.top ? p.y >= r.y : p.y <= r.y + r.h);
    if (row === d.row ? !inRow : !inPane) continue;
    const slots = r.tabs.filter((s) => !s.pick);
    const index = slots.filter((s) => p.x > r.x + s.x + s.w / 2).length;
    const from = row === d.row ? slots.findIndex((s) => s.key === d.key) : -2;
    if (index === from || index === from + 1) return null;
    return { row, index, before: slots[index]?.key ?? null };
  }
  return null;
}

// The bar where the tab would land: between two tabs, or beside the last.
function barAt(over) {
  const r = over && shared(`orbit.row.${over.row}`);
  if (!r) return null;
  const slots = r.tabs.filter((s) => !s.pick), z = zoom(), h = Math.round(26 * z);
  const before = slots[Math.min(over.index, slots.length) - 1], at = before ? before.x + before.w + (r.gap - r.line) / 2 : (slots[0]?.x ?? 0) - (r.gap + r.line) / 2;
  return { x: r.x + Math.round(Math.min(Math.max(at, r.line + 1), r.w - 2 * r.line)), y: r.y + Math.round(r.low + (r.h - r.band - r.line - h) / 2), w: r.line, h };
}

export class DragLayer {
  init(_props, cx) {
    this.d = shared(DRAG);
    if (!this.d) return this.end();
    this.at = this.d.at;
    this.keys = cx.focus_handle();
    this.keys.focus();
    cx.timer.every(50, () => {
      // Outside the window no release is heard: the drag ends there.
      const p = pointer(), view = viewport();
      if (p && view && (p.x < 0 || p.y < 0 || p.x >= view.width || p.y >= view.height)) this.end();
      else if (p) this.follow(p, cx);
    });
  }

  follow(p, cx) {
    if (this.at.x === p.x && this.at.y === p.y && this.looked) return;
    this.at = { x: p.x, y: p.y };
    const d = shared(DRAG);
    if (!d || this.done) return;
    const over = target(d, this.at, look());
    this.looked = [d.row, ...d.to].every((row) => shared(`orbit.row.${row}`)?.n === d.n);
    if (JSON.stringify(over) !== JSON.stringify(d.over)) setShared(DRAG, { ...d, over });
    cx.notify();
  }

  end(drop = null) {
    if (this.done) return;
    this.done = true;
    const d = this.d;
    setShared(DRAG, null);
    if (d?.back) run("pane.focus", d.back);
    if (d && drop) ask("tab-drop", { space: d.space, side: d.row, id: d.key, to: drop.row, before: drop.before });
    if (props()?.overlay) closeOverlay(props().overlay);
  }

  async close() {
    if (!this.done) { this.done = true; setShared(DRAG, null); if (this.d?.back) run("pane.focus", this.d.back); }
  }

  render(cx) {
    const d = this.d, view = viewport();
    if (!d || !view) return div();
    const t = theme(), z = zoom();
    const px = (v) => v / z;
    const h = Math.round(26 * z), bar = barAt(shared(DRAG)?.over);
    return div().id("orbit-drag").w(px(view.width)).h(px(view.height)).relative().overflow_hidden().cursor_grabbing()
      .track_focus(this.keys)
      .on_key_down((e, cx) => { cx.stop_propagation(); if (e.key === "escape") this.end(); })
      .on_mouse_move((e, cx) => this.follow(e.position, cx))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.end(); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.end(); })
      .on_mouse_up("left", (e) => this.end(target(this.d, e.position, look())))
      .child(h_flex().absolute().left(px(Math.round(this.at.x - d.grab.x))).top(px(Math.round(this.at.y - d.grab.y))).w(px(d.w)).h(px(h))
        .px(11).items_center().text_size(12).text_color(t.foreground).rounded(Math.min(6, look().radius)).bg((t.popover ?? t.surface).slice(0, 7) + "f2")
        .child(div().absolute().left(0).top(0).size_full().rounded(Math.min(6, look().radius)).border(1).border_color(d.color))
        .children(face(d.face, t.foreground, t.foreground)))
      .when(Boolean(bar), (el) => el.child(div().absolute().left(px(bar.x)).top(px(bar.y)).w(px(bar.w)).h(px(bar.h)).rounded(1).bg(d.color)));
  }
}
