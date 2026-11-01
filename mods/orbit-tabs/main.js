// The pane's tab row, at its bottom as the bottom of its outline: the
// space's symbol and name, then the space's tabs, the shown one a folder tab
// that opens into the content above (the tab line is cut under it): each
// with its program's icon, its name and its agent's state. Click shows a
// tab; right-click opens herdr's tab menu (rename, new tab, close).
// The pane with the keys has its lines in the shown space's colour.
//
// The orbit layout puts it under the pane's stack:
//   { "id": "left-tabs", "type": "block", "size": { "px": 52 },
//     "content": { "mod": "orbit-tabs", "props": { "stack": "left" } } }

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, spaces, run, theme, openOverlay, layout } from "herdr";
import { identity, glyph, glyphPath, spaceKey, statusColor, lookUpRepos } from "./identity.js";
import { look, glass, keysIn, setKeysIn } from "./look.js";
import { mark, label, main } from "./labels.js";
import { rowKit, muted, rowGlass, track, remember, inColumn } from "./rowframe.js";

export default class OrbitTabs extends View {
  render(cx) {
    lookUpRepos(cx);
    const t = theme();
    const L = look();
    const RADIUS = Math.min(6, L.radius);
    const space = spaces().find((s) => s.active);
    if (!space) return div();
    const ps = panes();
    const key = spaceKey(space);
    const ident = identity(key);
    const focused = keysIn() === "left";
    const line = focused ? ident : t.border;

    const kit = rowKit(t, L, line, muted(t.border, ident, focused), "mods/orbit-tabs");
    const seg = kit.seg;

    const lead = seg(h_flex().flex_shrink_1().min_w(48).overflow_hidden().pl(18).pr(12).gap(9).items_center()
      .child(svg(glyphPath(glyph(key), false)).size(13).flex_none().text_color(ident))
      .child(div().min_w(0).max_w(220).truncate().text_size(14).font_bold().text_color(t.foreground).child(space.name)), { first: true })
      .flex_shrink_1().min_w(48);

    const list = space.tabs.filter((tab) => !tab.settled);
    const tabs = [];
    list.forEach((tab, i) => {
      const shown = tab.active;
      const pane = main(tab);
      const dot = statusColor(tab.status);
      const m = mark(pane);
      const color = shown ? (focused ? ident : t.foreground) : t.ansi7;
      const inner = h_flex().id(`tab-${i}`).h(26).px(10).items_center().text_size(12).text_color(color)
        .when(Boolean(dot), (el) => el.child(div().size(6).mr(4).flex_none().rounded(3).bg(dot)))
        .when(!dot && Boolean(pane?.program?.agent), (el) => el.child(div().size(6).mr(4).flex_none().rounded(3).border(1).border_color(t.muted)))
        .when(Boolean(m), (el) => el.child(m.tint
          ? svg(m.icon).size(12).mr(5).flex_none().text_color(shown && focused ? ident : t.muted)
          : image(m.icon).w(12).h(12).mr(5).flex_none()))
        .child(div().min_w(0).truncate().child(label(tab)))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => { setKeysIn("left"); run("tab.select", { id: tab.id }); })
        .on_mouse_down("right", (_e, cx) => {
          cx.stop_propagation();
          openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: tab.id, space: space.id } } });
        });
      if (shown) {
        tabs.push({ shown: kit.shownSeg(inner) });
      } else {
        // Short of room, the others narrow (their names cut short) before
        // the shown one does, so it stays in the row, open into the content.
        if (i && !list[i - 1].active) tabs.push(seg(div().w(2)));
        tabs.push(seg(h_flex().items_center().min_w(0).overflow_hidden()
          .child(inner.min_w(0).rounded(RADIUS).hover((s) => s.bg(t.foreground.slice(0, 7) + "0f").text_color(t.foreground))))
          .flex_shrink_1().min_w(0).overflow_hidden());
      }
    });

    // Too many for the pane's width, the tabs before and after the shown one
    // narrow, then scroll sideways; the shown one and the lead stay.
    const at = tabs.findIndex((x) => x.shown);
    const strip = (n, items) => h_flex().id(`tabs-${n}`).flex_shrink_1().min_w(0).h_full().items_start().overflow_x_scroll().children(items);
    const row = at < 0 ? [lead, strip(0, tabs)]
      : [lead, strip(0, tabs.slice(0, at)), tabs[at].shown, strip(1, tabs.slice(at + 1))];
    // Room for the row's rounded corner.
    row.push(seg(div(), { last: true }).flex_1().min_w(2 * L.radius + 4));

    const under = rowGlass(this, L, layout(), "left-tabs", glass(t));
    return track(this, h_flex().id("orbit-tabs").size_full().min_w(0).items_start().overflow_x_hidden())
      .on_mouse_down_out((e, cx) => { remember(this, e?.bounds, cx); if (inColumn(e)) setKeysIn("left"); })
      .on_mouse_down("left", () => setKeysIn("left"))
      .when(Boolean(under), (el) => el.child(under))
      .children(row);
  }
}
