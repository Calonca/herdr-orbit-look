import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, spaces, props, theme, openOverlay, layout } from "herdr";
import { look, glass, find, ask, keysIn, spaceLook, statusColor, probeColor } from "./look.js";
import { mark, main, WIDGET } from "./labels.js";
import { state, LEFT_TAB, entries, entryLabel, isSplit, crosses } from "./sides.js";
import { tabRow, muted, rowGlass, track, remember, editKit, inColumn } from "./rowframe.js";
import { dragKit } from "./drag.js";
import { tabMenuItems, menuHeight } from "./tabmenu.js";

const TERMINAL = "mods/orbit-tabs/terminal.svg";

export class PaneRow {
  init(_props, cx) {
    this.acx = cx;
  }

  render(cx) {
    const side = props()?.stack;
    if (side !== "left" && side !== "right") return div();
    const t = theme();
    const L = look();
    const RADIUS = Math.min(6, L.radius);
    const space = spaces().find((s) => s.active);
    const stack = find(layout(), side);
    if (!space || !stack) return div();
    const st = state();
    const ps = panes();
    const list = entries(space, side, st, ps);
    const { color: ident } = spaceLook(space);
    const focused = keysIn() === side;
    const line = focused ? ident : t.border;
    const stop = (_e, cx) => cx.stop_propagation();
    const at = { space: space.id, side };

    const isShown = (e) => side === "left"
      ? (e.kind === "pick" ? stack.active === e.id : stack.active === LEFT_TAB && e.tab.active)
      : stack.active === e.id;

    const edit = editKit(this, (key, name) => ask("rename", { ...at, id: key, name }));
    edit.asked(side, (key) => { const e = list.find((x) => x.id === key); return e ? entryLabel(e) : null; });
    const drag = dragKit(this, side, ident, (i, cx) => {
      const e = list[i];
      if (e && e.kind !== "pick") edit.begin(cx, e.id, entryLabel(e));
    });
    const other = side === "left" ? "right" : "left";
    const paneOf = (e) => (e.kind === "tab" ? main(e.tab) : e.kind === "term" ? e.pane : null);
    const faces = list.map((e) => {
      const pane = paneOf(e);
      const status = e.kind === "tab" ? e.tab.status : pane?.status ?? null;
      const m = e.kind === "mod" || e.kind === "pick" ? { icon: WIDGET, tint: true } : mark(pane);
      const dot = statusColor(status);
      return { key: e.id, label: entryLabel(e), dot, ring: !dot && pane?.program?.agent ? t.muted : null, icon: m?.icon ?? null, tint: m?.tint ?? false,
        field: edit.on(e.id) ? edit.width(entryLabel(e)) : null,
        drag: e.kind === "pick" ? null : { to: isSplit() && crosses(space, side, e, st, ps) ? [other] : [] },
        tip: e.kind === "pick" ? "pick what this window shows · middle-click: put it away" : "drag to move · double-click: rename · middle-click: close" };
    });
    const shown = list.find(isShown);
    if (shown) probeColor(`${side}-text`, t.foreground);

    const plus = (id, icon, tip, f) => h_flex().id(id).h(26).px(6).gap(3).flex_none().items_center().rounded(RADIUS)
      .text_size(12).text_color(t.muted).hover((s) => s.bg(t.foreground.slice(0, 7) + "0f").text_color(t.foreground))
      .tooltip(tip).on_mouse_down("left", stop).on_click((_e, cx) => f(cx))
      .child("+").child(svg(icon).size(12).text_color(t.muted));
    const tail = h_flex().gap(2).items_center()
      .child(plus(`d-plus-term-${side}`, TERMINAL, "a new terminal in this pane", () => ask("new-terminal", at)))
      .child(plus(`d-plus-win-${side}`, WIDGET, "a new window: pick what it shows", () => ask("pending", at)));
    const split = isSplit();
    const end = side !== "left" ? null : h_flex().pr(8).pl(2).items_center()
      .child(h_flex().id("d-split-left").h(28).px(6).flex_none().items_center().rounded(4)
        .hover((s) => s.bg(t.foreground.slice(0, 7) + "24"))
        .tooltip(split ? "put the right pane away (nothing closes)" : "the right pane")
        .on_mouse_down("left", stop).on_click(() => ask("split", at))
        .child(svg(`mods/orbit-tabs/${split ? "split-open" : "split"}.svg`).w(18).h(14).flex_none().text_color(t.ansi7)));
    const wire = (el, f, i) => {
      const e = list[i], editing = Boolean(f.field);
      return el.on_click((ev) => { if ((ev?.click_count ?? 1) < 2 && !editing) ask("show", { ...at, id: e.id }); })
        .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); if (!editing) ask("close", { ...at, id: e.id }); })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          if (e.kind === "pick" || editing) return;
          const pane = paneOf(e);
          const target = { row: side, key: e.id, pane: pane?.pane ?? null, terminal: pane?.terminal ?? null };
          const n = tabMenuItems(target);
          openOverlay({ mod: "orbit-dialogs", kind: "popup", width: 240, height: menuHeight(n, n.length > 1 ? 1 : 0), props: { dialog: "menu", tab: "orbit-tab", target } });
        });
    };
    const row = tabRow(this, t, L, { block: `${side}-tabs`, row: side, faces, shown: shown?.id ?? null, line, low: muted(t.border, ident, focused),
      wire, drag, tail, end, field: (f) => edit.field(t, f.label) });

    // The pane with the keys (orbit.sides' focus, which its outline and these
    // lines go by): herdr's focused() names a terminal or a tab's pane, but
    // says nothing when a press goes into a mod block (the picker, a view).
    // So each row watches every press in the window and takes those in its
    // own pane's column (rowframe.js inColumn).
    const take = () => { if (state().focus !== side) ask("focus", { side }); };
    const under = rowGlass(this, L, `${side}-tabs`, glass(t));
    return drag.root(track(this, h_flex().id(`orbit-tabs-${side}`).size_full().min_w(0).overflow_hidden()))
      .on_mouse_down_out((e, cx) => { remember(this, e?.bounds, cx); if (inColumn(e, L)) take(); })
      .on_mouse_down("left", () => take())
      .when(Boolean(under), (el) => el.child(under))
      .children(row);
  }
}
