import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, run, theme, layout, openOverlay, spaces } from "herdr";
import { look, PANEL_MIN, glass, find, ask, keysIn, spaceLook } from "./look.js";
import { rowKit, muted, rowGlass, remember, dragKit, editKit, inColumn } from "./rowframe.js";
import { tabMenuItems, menuHeight } from "./tabmenu.js";

const PICK = "panel-pick";
const ICON = "mods/orbit-tabs/widget.svg";

export class PanelRow {
  init(_props, cx) {
    this.acx = cx;
    this.settle = null;
  }

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
    const active = spaces().find((s) => s.active);
    const focused = keysIn() === "panel";
    const ident = active ? spaceLook(active).color : t.accent;
    const line = focused ? ident : t.border;
    const show = (child) => { ask("focus", { side: "panel" }); run("layout.select", { stack: id, child }); };

    const kit = rowKit(t, L, line, muted(t.border, ident, focused), "mods/orbit-tabs");
    const seg = kit.seg;

    const views = (stack.children ?? []).filter((c) => c.id !== PICK);
    const drag = dragKit(this, focused ? ident : t.foreground, (from, to) => {
      const a = views[from], b = views[to];
      if (a && b) ask("view-move", { id: a.id, to: b.id });
    }, (i, cx) => { const c = views[i]; if (c) edit.begin(cx, c.id, c.title ?? c.id); });
    const edit = editKit(this, (key, name) => ask("view-rename", { id: key, name }));
    edit.asked("panel", (key) => { const c = views.find((x) => x.id === key); return c ? c.title ?? c.id : null; });

    const tab = (c, i) => {
      const shown = stack.active === c.id;
      const editing = edit.on(c.id);
      const color = shown ? t.foreground : t.ansi7;
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
    const at = tabs.findIndex((x) => x.shown);
    const strip = (n, list) => h_flex().id(`panel-tabs-${id}-${n}`).flex_shrink_1().min_w(0).h_full().items_start().overflow_x_scroll().children(list);
    const row = [seg(div().w(12), { first: true }),
      ...(at < 0 ? [strip(0, tabs)] : [strip(0, tabs.slice(0, at)), tabs[at].shown, strip(1, tabs.slice(at + 1))]),
      seg(div().w(4))];
    const pickOn = stack.active === PICK;
    const plus = h_flex().id("panel-pick").h(26).px(pickOn ? 10 : 6).gap(3).items_center().text_size(12)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => show(PICK))
      .on_mouse_down("middle", (_e, cx) => { cx.stop_propagation(); run("layout.hide", { id: "panel" }); })
      .tooltip("show something else in the panel")
      .child("+").child(svg(ICON).size(12));
    row.push(pickOn
      ? kit.shownSeg(plus.text_color(t.foreground))
      : seg(h_flex().px(1).items_center().child(
        plus.rounded(RADIUS).text_color(t.muted).hover((s) => s.bg(t.foreground.slice(0, 7) + "0f").text_color(t.foreground)))));
    row.push(seg(div(), { last: true }).flex_1());

    const take = () => { if (keysIn() !== "panel") ask("focus", { side: "panel" }); };
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
