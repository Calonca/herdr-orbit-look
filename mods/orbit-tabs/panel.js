// The side panel's tab row (main.js picks this for props
// { stack: "panel-body" }), drawn as a pane's (pane.js): a tab per view
// in the panel's stack (herdr's files and changes to start with), the shown
// one a folder tab opening into the panel; then + ⠿ to pick another (orbit-add
// in the panel). The panel's stack draws the outline around the panel and
// this row (look.js); the row draws the line between them, open under
// the shown tab. Click a tab to show it; middle-click closes it,
// right-click opens its menu (orbit-dialogs' menu: Rename, Close, Hide the panel);
// double-click renames it; drag moves it. Middle-click + ⠿ to hide the panel.
// Too many for the panel's width, the tabs scroll sideways.

import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, run, theme, layout, openOverlay, spaces } from "herdr";
import { look, PANEL_MIN, glass, find, ask, keysIn, spaceLook } from "./look.js";
import { rowKit, muted, rowGlass, remember, dragKit, editKit, inColumn } from "./rowframe.js";
import { tabMenuItems, menuHeight } from "./tabmenu.js";

const PICK = "panel-pick"; // the stack's picker (orbit-add)
const ICON = "mods/orbit-tabs/widget.svg";

export class PanelRow {
  init(_props, cx) {
    this.acx = cx; // for the menu's Rename (rowframe.js editKit)
    this.settle = null; // the timer that springs a too-narrow panel back
  }

  // Its row is as wide as the panel. Dragged narrower than half its smallest
  // width (the last half of a pane's least width), the panel
  // closes, and opens again at its smallest; left between the two, it springs
  // back to its smallest once the drag rests. Mods see no pointer during
  // herdr-app's divider drag, so the panel can't stop at its smallest while
  // the pointer goes on: it shrinks on until it closes.
  sized(width, cx) {
    if (this.settle) { this.settle.cancel(); this.settle = null; }
    if (width <= 0 || width >= PANEL_MIN) return;
    if (find(layout(), "panel")?.hidden) return;
    if (width < PANEL_MIN / 2) {
      run("layout.hide", { id: "panel" });
      run("layout.resize", { id: "panel", px: PANEL_MIN });
      return;
    }
    this.settle = cx.timer.after(400, () => {
      this.settle = null;
      run("layout.resize", { id: "panel", px: PANEL_MIN });
    });
  }

  render() {
    const t = theme();
    const L = look();
    const RADIUS = Math.min(6, L.radius);
    const id = props()?.stack ?? "panel-body";
    const stack = find(layout(), id);
    if (!stack) return div();
    // The shown space's colour while the keys are in the panel (orbit.sides'
    // focus, as the outline: look.js), else the border's.
    const active = spaces().find((s) => s.active);
    const focused = keysIn() === "panel";
    const ident = active ? spaceLook(active).color : t.accent;
    const line = focused ? ident : t.border;
    const show = (child) => { ask("focus", { side: "panel" }); run("layout.select", { stack: id, child }); };

    // The row is the bottom of the panel's outline (rowframe.js): the
    // line with its corners, open under the shown tab, which has its own edge.
    const kit = rowKit(t, L, line, muted(t.border, ident, focused), "mods/orbit-tabs");
    const seg = kit.seg;

    // Drag a tab onto another to move the view there (the panel's views in
    // orbit.settings: the orbit mod's layout.js).
    const views = (stack.children ?? []).filter((c) => c.id !== PICK);
    const drag = dragKit(this, focused ? ident : t.foreground, (from, to) => {
      const a = views[from], b = views[to];
      if (a && b) ask("view-move", { id: a.id, to: b.id });
    }, (i, cx) => { const c = views[i]; if (c) edit.begin(cx, c.id, c.title ?? c.id); });
    // Renaming a view (its title in orbit.settings).
    const edit = editKit(this, (key, name) => ask("view-rename", { id: key, name }));
    edit.asked("panel", (key) => { const c = views.find((x) => x.id === key); return c ? c.title ?? c.id : null; });

    const tab = (c, i) => {
      const shown = stack.active === c.id;
      const editing = edit.on(c.id);
      const color = shown ? t.foreground : t.ansi7; // as the panes' rows (pane.js)
      const inner = h_flex().id(`panel-tab-${i}`).h(26).px(10).gap(5).items_center().text_size(12)
        .text_color(color)
        .when(!shown, (el) => el.rounded(RADIUS).hover((s) => s.bg(t.foreground.slice(0, 7) + "0f").text_color(t.foreground)))
        .child(svg(ICON).size(11).flex_none().text_color(shown ? t.foreground : t.muted))
        .child(editing ? edit.field(t, c.title ?? c.id) : div().min_w(0).truncate().child(c.title ?? c.id))
        .when(!editing, (el) => el.tooltip("drag to move · double-click: rename · middle-click: close"))
        .on_click((ev) => { if ((ev?.click_count ?? 1) < 2 && !editing) show(c.id); })
        .on_mouse_down("middle", (_e, cx) => {
          cx.stop_propagation();
          if (!editing) ask("view-close", { id: c.id });
        })
        // Right-click: Rename, Close, Hide the panel (orbit-dialogs' menu, tabmenu.js).
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          if (editing) return;
          const target = { row: "panel", key: c.id };
          openOverlay({ mod: "orbit-dialogs", kind: "popup", width: 240, height: menuHeight(tabMenuItems(target), 1), props: { dialog: "menu", tab: "orbit-tab", target } });
        });
      const el = drag.tab(inner, i, !editing);
      return shown ? { shown: kit.shownSeg(el) }
        : seg(h_flex().items_center().min_w(0).overflow_hidden().child(el.min_w(0))).flex_shrink_1().min_w(0).overflow_hidden();
    };

    const tabs = [];
    views.forEach((c, i) => {
      if (i && stack.active !== c.id && stack.active !== views[i - 1].id) tabs.push(seg(div().w(2)));
      tabs.push(tab(c, i));
    });
    // Too many for the panel's width, the tabs before and after the shown one
    // narrow, then scroll sideways; the shown one and + ⠿ stay.
    const at = tabs.findIndex((x) => x.shown);
    const strip = (n, list) => h_flex().id(`panel-tabs-${id}-${n}`).flex_shrink_1().min_w(0).h_full().items_start().overflow_x_scroll().children(list);
    const row = [seg(div().w(12), { first: true }),
      ...(at < 0 ? [strip(0, tabs)] : [strip(0, tabs.slice(0, at)), tabs[at].shown, strip(1, tabs.slice(at + 1))]),
      seg(div().w(4))];
    // + ⠿, a tab like the others while the picker shows.
    const pickOn = stack.active === PICK;
    const plus = h_flex().id("panel-pick").h(26).px(pickOn ? 10 : 6).gap(3).items_center().text_size(12)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => show(PICK))
      // Middle-click: hides the panel, as its menu's Hide does.
      .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); run("layout.hide", { id: "panel" }); })
      .tooltip("show something else in the panel")
      .child("+").child(svg(ICON).size(12));
    row.push(pickOn
      ? kit.shownSeg(plus.text_color(t.foreground))
      : seg(h_flex().px(1).items_center().child(
        plus.rounded(RADIUS).text_color(t.muted).hover((s) => s.bg(t.foreground.slice(0, 7) + "0f").text_color(t.foreground)))));
    row.push(seg(div(), { last: true }).flex_1());

    // A press in the panel's column gives it the keys' outline (herdr's
    // focused() says nothing about a mod): see pane.js.
    const take = () => { if (keysIn() !== "panel") ask("focus", { side: "panel" }); };
    // The row's glass below the tab line (rowframe.js rowGlass).
    const under = rowGlass(this, L, "panel-tabs", glass(t));
    return drag.root(h_flex().id(`orbit-panel-tabs-${id}`).size_full().min_w(0).items_start().overflow_x_hidden().relative())
      .on_size_change((size, cx) => {
        if (size.width !== this.own?.width || size.height !== this.own?.height) { this.own = size; cx.notify(); }
        this.sized(size.width, cx);
      })
      .on_mouse_move((e, cx) => remember(this, e?.bounds, cx))
      .on_mouse_down_out((e, cx) => { remember(this, e?.bounds, cx); if (inColumn(e, L)) take(); })
      .on_mouse_down("left", () => take())
      .when(Boolean(under), (el) => el.child(under))
      .children(row);
  }
}
