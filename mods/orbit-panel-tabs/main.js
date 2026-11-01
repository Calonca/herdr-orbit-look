// The side panel's tab row, drawn as the pane's (orbit-tabs): a tab per view
// in the panel's stack (herdr's files and changes), the shown one a folder
// tab opening into the panel. Click a tab to show it. Too many for the
// panel's width, the tabs scroll sideways.
//
// The orbit layout puts it under the panel's stack:
//   { "id": "panel-tabs", "type": "block", "size": { "px": 52 },
//     "content": { "mod": "orbit-panel-tabs", "props": { "stack": "panel-body" } } }

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, run, theme, layout, spaces } from "herdr";
import { identity, spaceKey } from "./identity.js";
import { look, glass, keysIn, setKeysIn, find } from "./look.js";
import { rowKit, muted, rowGlass, track, remember, inColumn } from "./rowframe.js";

const ICON = "mods/orbit-panel-tabs/widget.svg";

export default class OrbitPanelTabs extends View {
  render() {
    const t = theme();
    const L = look();
    const RADIUS = Math.min(6, L.radius);
    const id = props()?.stack ?? "panel-body";
    const stack = find(layout(), id);
    if (!stack) return div();
    const active = spaces().find((s) => s.active);
    const focused = keysIn() === "panel";
    const ident = active ? identity(spaceKey(active)) : t.accent;
    const line = focused ? ident : t.border;
    const show = (child) => { setKeysIn("panel"); run("layout.select", { stack: id, child }); };

    const kit = rowKit(t, L, line, muted(t.border, ident, focused), "mods/orbit-panel-tabs");
    const seg = kit.seg;
    const views = stack.children ?? [];

    const tab = (c, i) => {
      const shown = stack.active === c.id;
      const color = shown ? (focused ? ident : t.foreground) : t.ansi7;
      const inner = h_flex().id(`panel-tab-${i}`).h(26).px(10).gap(5).items_center().text_size(12).text_color(color)
        .when(!shown, (el) => el.rounded(RADIUS).hover((s) => s.bg(t.foreground.slice(0, 7) + "0f").text_color(t.foreground)))
        .child(svg(ICON).size(11).flex_none().text_color(shown && focused ? ident : t.muted))
        .child(div().min_w(0).truncate().child(c.title ?? c.id))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => show(c.id));
      return shown ? { shown: kit.shownSeg(inner) }
        : seg(h_flex().items_center().min_w(0).overflow_hidden().child(inner.min_w(0))).flex_shrink_1().min_w(0).overflow_hidden();
    };

    const tabs = [];
    views.forEach((c, i) => {
      if (i && stack.active !== c.id && stack.active !== views[i - 1].id) tabs.push(seg(div().w(2)));
      tabs.push(tab(c, i));
    });
    const at = tabs.findIndex((x) => x.shown);
    const strip = (n, items) => h_flex().id(`panel-tabs-${n}`).flex_shrink_1().min_w(0).h_full().items_start().overflow_x_scroll().children(items);
    const row = [seg(div().w(12), { first: true }),
      ...(at < 0 ? [strip(0, tabs)] : [strip(0, tabs.slice(0, at)), tabs[at].shown, strip(1, tabs.slice(at + 1))]),
      seg(div(), { last: true }).flex_1().min_w(2 * L.radius + 4)];

    const under = rowGlass(this, L, layout(), "panel-tabs", glass(t));
    return track(this, h_flex().id("orbit-panel-tabs").size_full().min_w(0).items_start().overflow_x_hidden())
      .on_mouse_down_out((e, cx) => { remember(this, e?.bounds, cx); if (inColumn(e)) setKeysIn("panel"); })
      .on_mouse_down("left", () => setKeysIn("panel"))
      .when(Boolean(under), (el) => el.child(under))
      .children(row);
  }
}
