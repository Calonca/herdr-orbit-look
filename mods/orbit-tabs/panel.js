import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, run, theme, layout, openOverlay, spaces } from "herdr";
import { look, PANEL_MIN, glass, find, ask, keysIn, spaceLook } from "./look.js";
import { tabRow, muted, rowGlass, remember, editKit, inColumn } from "./rowframe.js";
import { dragKit } from "./drag.js";
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
    const id = props()?.stack ?? "panel-body";
    const stack = find(layout(), id);
    if (!stack) return div();
    const active = spaces().find((s) => s.active);
    const focused = keysIn() === "panel";
    const ident = active ? spaceLook(active).color : t.accent;
    const line = focused ? ident : t.border;
    const show = (child) => { ask("focus", { side: "panel" }); run("layout.select", { stack: id, child }); };

    const views = (stack.children ?? []).filter((c) => c.id !== PICK);
    const edit = editKit(this, (key, name) => ask("view-rename", { id: key, name }));
    edit.asked("panel", (key) => { const c = views.find((x) => x.id === key); return c ? c.title ?? c.id : null; });
    const drag = dragKit(this, "panel", ident, (i, cx) => { const c = views[i]; if (c) edit.begin(cx, c.id, c.title ?? c.id); });
    const faces = [...views.map((c) => ({ key: c.id, label: c.title ?? c.id, icon: ICON, tint: true, drag: { to: [] },
      field: edit.on(c.id) ? edit.width(c.title ?? c.id) : null, tip: "drag to move · double-click: rename · middle-click: close" })),
    { key: PICK, label: "+", after: ICON, tint: true, drag: null, tip: "show something else in the panel" }];
    const wire = (el, f) => {
      const editing = Boolean(f.field);
      return el.on_click((ev) => { if ((ev?.click_count ?? 1) < 2 && !editing) show(f.key); })
        .on_mouse_down("middle", (_e, cx) => {
          cx.stop_propagation();
          if (f.key === PICK) run("layout.hide", { id: "panel" });
          else if (!editing) ask("view-close", { id: f.key });
        })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          if (editing || f.key === PICK) return;
          const target = { row: "panel", key: f.key };
          openOverlay({ mod: "orbit-dialogs", kind: "popup", width: 240, height: menuHeight(tabMenuItems(target), 1), props: { dialog: "menu", tab: "orbit-tab", target } });
        });
    };
    const row = tabRow(this, t, L, { block: "panel-tabs", row: "panel", faces, shown: stack.active, line, low: muted(t.border, ident, focused),
      wire, drag, field: (f) => edit.field(t, f.label) });

    const take = () => { if (keysIn() !== "panel") ask("focus", { side: "panel" }); };
    const under = rowGlass(this, L, "panel-tabs", glass(t));
    return drag.root(h_flex().id(`orbit-panel-tabs-${id}`).size_full().min_w(0).overflow_hidden().relative())
      .on_size_change((size, cx) => {
        if (size.width !== this.own?.width || size.height !== this.own?.height) { this.own = size; cx.notify(); }
        this.sized(size.width, cx);
      })
      .on_mouse_down_out((e, cx) => { remember(this, e?.bounds, cx); if (inColumn(e, L)) take(); })
      .on_mouse_down("left", () => take())
      .when(Boolean(under), (el) => el.child(under))
      .children(row);
  }
}
