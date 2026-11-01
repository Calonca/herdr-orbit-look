// The foot of the sidebar: "▸ agents" folds herdr's agents list (the
// layout's "agents" block) in and out; "open folder" makes a space in a
// folder from the system's folder picker.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, theme, layout, pickFolder } from "herdr";
import { look, glass, find } from "./look.js";
import { backdrop, orbitPlace } from "./glass.js";

export default class OrbitSidebarFooter extends View {
  render() {
    const t = theme();
    const open = find(layout(), "agents")?.hidden === false;
    // The glass: the blurred background under the fill (glass.js).
    const L = look();
    const at = orbitPlace(L, "sidebar-bottom", this.own);
    return v_flex().id("orbit-sidebar-footer").size_full().relative().px(11).pb(8).justify_end().gap(4)
      .on_size_change((size, cx) => { if (size.width !== this.own?.width || size.height !== this.own?.height) { this.own = size; cx.notify(); } })
      .child(backdrop({ x: at?.x, y: at?.y, w: this.own?.width, h: this.own?.height, radius: 0, fill: glass(t) }))
      .child(h_flex().id("agents-fold").h(27).px(4).gap(8).items_center().rounded(4).text_size(16).text_color(t.foreground)
        .hover((s) => s.bg(t.foreground.slice(0, 7) + "1a"))
        .on_click(() => run("layout.toggle", { id: "agents" }))
        .child(div().w(14).text_size(15).text_color(t.muted).child(open ? "▾" : "▸"))
        .child("agents"))
      .child(h_flex().items_center()
        .child(div().id("open-folder").px(6).py(3).rounded(4).text_size(16).text_color(t.ansi7)
          .hover((s) => s.bg(t.foreground.slice(0, 7) + "1a").text_color(t.foreground))
          .on_click((_e, cx) => {
            cx.spawn(async () => {
              const folder = await pickFolder({ prompt: "open folder" });
              if (folder) run("space.new", { folder });
            });
          })
          .child("open folder")));
  }
}
