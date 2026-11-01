// The left and right panes' tab rows (main.js picks this for props
// { stack: "left" | "right" }), at a pane's bottom as the bottom of its
// outline. The row lists that pane's tabs for the shown space (sides.js: the
// left the space's herdr tabs, the right its own terminals and mods), the
// shown one a folder tab that opens into the content above (the tab line is
// cut under it); then + >_ (a new terminal in this pane) and + ⠿ (a "new
// window" tab with the picker), and at the left row's right end the split
// toggle. Click shows a tab, double-click renames it, drag moves it,
// middle-click closes it (a terminal asks first), right-click opens its menu
// (orbit-dialogs' menu). The space's symbol and name lead the left row when
// it holds a terminal.

import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, spaces, props, run, theme, openOverlay, layout } from "herdr";
import { identity, glyph, glyphPath, spaceKey, statusColor, lookUpRepos } from "./identity.js";
import { look, glass, find, ask } from "./look.js";
import { mark, main, WIDGET } from "./labels.js";
import { state, LEFT_TAB, entries, entryLabel, isSplit } from "./sides.js";
import { rowKit, muted, rowGlass, track, remember, dragKit, editKit, inColumn } from "./rowframe.js";
import { tabMenuItems, menuHeight } from "./tabmenu.js";

const TERMINAL = "mods/orbit-tabs/terminal.svg";

export class PaneRow {
  init(_props, cx) {
    this.acx = cx; // for the menu's Rename (rowframe.js editKit)
  }

  render(cx) {
    const side = props()?.stack;
    if (side !== "left" && side !== "right") return div();
    lookUpRepos(cx);
    const t = theme();
    const L = look();
    const RADIUS = Math.min(6, L.radius);
    const space = spaces().find((s) => s.active);
    const stack = find(layout(), side);
    if (!space || !stack) return div();
    const st = state();
    const ps = panes();
    const list = entries(space, side, st, ps);
    const key = spaceKey(space);
    const ident = identity(key);
    const focused = st.focus === side;
    const line = focused ? ident : t.border;
    const stop = (_e, cx) => cx.stop_propagation();
    // A change asks the orbit mod (look.js ask): it shows, closes and makes tabs.
    const at = { space: space.id, side };

    // The row is the bottom of the pane's outline (rowframe.js): the line
    // with its corners, open under the shown tab, which has its own edge.
    const kit = rowKit(t, L, line, muted(t.border, ident, focused), "mods/orbit-tabs");
    const seg = kit.seg;

    // The shown entry: on the left herdr's shown tab (while the stack shows it).
    const isShown = (e) => side === "left"
      ? (e.kind === "pick" ? stack.active === e.id : stack.active === LEFT_TAB && e.tab.active)
      : stack.active === e.id;

    const terminal = list.some((e) => e.kind === "term" || (e.kind === "tab" && ps.some((p) => p.tab === e.tab.id && p.terminal)));
    const lead = side === "left" && terminal
      ? seg(h_flex().flex_shrink_1().min_w(48).overflow_hidden().pl(18).pr(12).gap(9).items_center()
        .child(svg(glyphPath(glyph(key), false)).size(13).flex_none().text_color(ident))
        .child(div().min_w(0).max_w(220).truncate().text_size(14).font_bold().text_color(t.foreground).child(space.name)), { first: true })
        .flex_shrink_1().min_w(48)
      : seg(div().w(12), { first: true });

    // Drag a tab onto another to move it there (rowframe.js dragKit): on
    // the left herdr's tab order (tab.move, as herdr's tab bar), on the right
    // orbit.sides' order. The picker's tab stays last.
    const drag = dragKit(this, focused ? ident : t.foreground, (from, to) => {
      const a = list[from], b = list[to];
      if (!a || !b || a.kind === "pick" || b.kind === "pick") return;
      if (side === "left") run("tab.move", { id: a.tab.id, index: b.tab.index });
      else ask("reorder", { ...at, from, to });
    }, (i, cx) => {
      // A double-click: the tab's name field.
      const e = list[i];
      if (e && e.kind !== "pick") edit.begin(cx, e.id, entryLabel(e));
    });
    // Renaming (rowframe.js editKit): on the left herdr's tab name, on
    // the right orbit.sides' (the orbit mod's actions.js renameEntry).
    const edit = editKit(this, (key, name) => ask("rename", { ...at, id: key, name }));
    edit.asked(side, (key) => { const e = list.find((x) => x.id === key); return e ? entryLabel(e) : null; });
    const tabs = [];
    list.forEach((e, i) => {
      const shown = isShown(e);
      const editing = edit.on(e.id);
      const pane = e.kind === "tab" ? main(e.tab) : e.kind === "term" ? e.pane : null;
      const status = e.kind === "tab" ? e.tab.status : pane?.status ?? null;
      const m = e.kind === "mod" || e.kind === "pick" ? { icon: WIDGET, tint: true } : mark(pane);
      const dot = statusColor(status);
      const color = shown ? (focused ? ident : t.foreground) : t.ansi7;
      const inner = h_flex().id(`d-tab-${side}-${i}`).h(26).px(10).items_center().text_size(12).text_color(color)
        .when(Boolean(dot), (el) => el.child(div().size(6).mr(4).flex_none().rounded(3).bg(dot)))
        .when(!dot && Boolean(pane?.program?.agent), (el) => el.child(div().size(6).mr(4).flex_none().rounded(3).border(1).border_color(t.muted)))
        .when(Boolean(m), (el) => el.child(m.tint
          ? svg(m.icon).size(12).mr(5).flex_none().text_color(e.kind === "pick" ? ident : shown && focused ? ident : t.muted)
          : image(m.icon).w(12).h(12).mr(5).flex_none()))
        .child(editing ? edit.field(t, entryLabel(e)) : div().min_w(0).truncate().child(entryLabel(e)))
        .when(!editing, (el) => el.tooltip(e.kind === "pick" ? "pick what this window shows · middle-click: put it away"
          : "drag to move · double-click: rename · middle-click: close"))
        // The second click of a double-click, or one in the name field, shows nothing.
        .on_click((ev, cx) => { if ((ev?.click_count ?? 1) < 2 && !editing) ask("show", { ...at, id: e.id }); })
        .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); if (!editing) ask("close", { ...at, id: e.id }); })
        // Right-click: Rename, then herdr's pane items (orbit-dialogs' menu, tabmenu.js).
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          if (e.kind === "pick" || editing) return;
          const target = { row: side, key: e.id, pane: pane?.pane ?? null, terminal: pane?.terminal ?? null };
          const n = tabMenuItems(target);
          openOverlay({ mod: "orbit-dialogs", kind: "popup", width: 240, height: menuHeight(n, n.length > 1 ? 1 : 0), props: { dialog: "menu", tab: "orbit-tab", target } });
        });
      const el = drag.tab(inner, i, e.kind !== "pick" && !editing);
      if (shown) {
        tabs.push({ shown: kit.shownSeg(el) });
      } else {
        // Short of room, the others narrow (their names cut short) before
        // the shown one does, so it stays in the row, open into the content.
        if (i && !isShown(list[i - 1])) tabs.push(seg(div().w(2)));
        tabs.push(seg(h_flex().items_center().min_w(0).overflow_hidden()
          .child(el.min_w(0).rounded(RADIUS).hover((s) => s.bg(t.foreground.slice(0, 7) + "0f").text_color(t.foreground))))
          .flex_shrink_1().min_w(0).overflow_hidden());
      }
    });

    // Too many for the pane's width, the tabs before and after the shown one
    // narrow, then scroll sideways; the shown one, the lead, + >_ + ⠿ and the
    // split stay.
    const k = tabs.findIndex((x) => x.shown);
    const strip = (n, list) => h_flex().id(`d-tabs-${side}-${n}`).flex_shrink_1().min_w(0).h_full().items_start().overflow_x_scroll().children(list);
    const row = k < 0 ? [lead, strip(0, tabs)]
      : [lead, strip(0, tabs.slice(0, k)), tabs[k].shown, strip(1, tabs.slice(k + 1))];
    // + >_ and + ⠿.
    const plus = (id, icon, tip, f) => h_flex().id(id).h(26).px(6).gap(3).flex_none().items_center().rounded(RADIUS)
      .text_size(12).text_color(t.muted).hover((s) => s.bg(t.foreground.slice(0, 7) + "0f").text_color(t.foreground))
      .tooltip(tip).on_mouse_down("left", stop).on_click((_e, cx) => f(cx))
      .child("+").child(svg(icon).size(12).text_color(t.muted));
    row.push(seg(h_flex().pl(6).gap(2).items_center()
      .child(plus(`d-plus-term-${side}`, TERMINAL, "a new terminal in this pane", () => ask("new-terminal", at)))
      .child(plus(`d-plus-win-${side}`, WIDGET, "a new window: pick what it shows", () => ask("pending", at)))));
    row.push(seg(div()).flex_1());
    // At the left row's right end, the split toggle (as the status bar's
    // sidebar toggle, mirrored): the right pane beside, or put away (nothing
    // ends). One icon each way. The right row and the side panel's have none.
    if (side === "left") {
      const split = isSplit();
      row.push(seg(h_flex().pr(6).pl(2).items_center()
        .child(h_flex().id("d-split-left").h(28).px(6).flex_none().items_center().rounded(4)
          .hover((s) => s.bg(t.foreground.slice(0, 7) + "24"))
          .tooltip(split ? "put the right pane away (nothing closes)" : "the right pane")
          .on_mouse_down("left", stop).on_click(() => ask("split", at))
          .child(svg(`mods/orbit-tabs/${split ? "split-open" : "split"}.svg`).w(18).h(14).flex_none().text_color(t.ansi7))), { last: true }));
    } else {
      // Room for the row's rounded corner: a box narrower than twice its
      // radius gets a smaller one.
      row.push(seg(div().w(2 * L.radius + 4), { last: true }));
    }

    // The pane with the keys (orbit.sides' focus, which its outline and these
    // lines go by): herdr's focused() names a terminal or a tab's pane, but
    // says nothing when a press goes into a mod block (the picker, a view).
    // So each row watches every press in the window and takes those in its
    // own pane's column (rowframe.js inColumn).
    const take = () => { if (state().focus !== side) ask("focus", { side }); };
    const under = rowGlass(this, L, layout(), `${side}-tabs`, glass(t));
    return drag.root(track(this, h_flex().id(`orbit-tabs-${side}`).size_full().min_w(0).items_start().overflow_x_hidden()))
      .on_mouse_down_out((e, cx) => { remember(this, e?.bounds, cx); if (inColumn(e)) take(); })
      .on_mouse_down("left", () => take())
      .when(Boolean(under), (el) => el.child(under))
      .children(row);
  }
}
