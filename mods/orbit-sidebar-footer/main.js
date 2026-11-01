// The foot of the sidebar: "▸ agents" folds herdr's agents list (the
// layout's "agents" block) in and out; "open folder" makes a space in a
// folder from the system's folder picker; "menu" is the sidebar's menu
// (orbit-dialogs' menu): what herdr's stock sidebar has buttons for (search, settings,
// add machine, new space) and the shown space's items. A dot on it while an
// update is ready.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, theme, layout, spaces, panes, pickFolder, openOverlay, updates, machines, exec } from "herdr";
import { look, glass, find } from "./look.js";
import { backdrop, orbitPlace, orbitRadius, zoom } from "./glass.js";

// A space's checkout: "main", "linked" (a worktree) or null (as the menu asks).
async function checkout(space) {
  const tabs = new Set((space.tabs ?? []).map((c) => c.id));
  const folder = panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder;
  if (!folder) return null;
  const on = space.machine;
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on }).catch(() => null);
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on }).catch(() => null);
  if (!top || !common || top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

export default class OrbitSidebarFooter extends View {
  render() {
    const t = theme();
    const open = find(layout(), "agents")?.hidden === false;
    const ghost = (id, text, action) => div().id(id).px(6).py(3).rounded(4).text_size(16).text_color(t.ansi7)
      .hover((s) => s.bg(t.foreground.slice(0, 7) + "1a").text_color(t.foreground)).on_click(action).child(text);
    // The glass: the blurred background under the fill (glass.js).
    const L = look();
    const at = orbitPlace(L, "sidebar-bottom", this.own);
    return v_flex().id("orbit-sidebar-footer").size_full().relative().px(11).pb(8).justify_end().gap(4)
      .on_size_change((size, cx) => { if (size.width !== this.own?.width || size.height !== this.own?.height) { this.own = size; cx.notify(); } })
      .child(backdrop({ x: at?.x, y: at?.y, w: this.own?.width, h: this.own?.height, radius: orbitRadius(L), corners: "bl br", fill: glass(t) }))
      .child(h_flex().id("agents-fold").h(27).px(4).gap(8).items_center().rounded(4).text_size(16).text_color(t.foreground)
        .hover((s) => s.bg(t.foreground.slice(0, 7) + "1a"))
        .on_click(() => run("layout.toggle", { id: "agents" }))
        .child(div().w(14).text_size(15).text_color(t.muted).child(open ? "▾" : "▸"))
        .child("agents"))
      .child(h_flex().justify_between().items_center()
        .child(ghost("open-folder", "open folder", (_e, cx) => {
          cx.spawn(async () => {
            const folder = await pickFolder({ prompt: "open folder" });
            if (folder) run("space.new", { folder });
          });
        }))
        .child(ghost("menu", h_flex().gap(5).items_center().child("menu")
          .when(Boolean(updates()?.app?.ready), (el) => el.child(div().size(6).rounded_full().bg(t.accent))), (_e, cx) => {
          const space = spaces().find((s) => s.active);
          cx.spawn(async () => {
            // Its height: its items (orbit-dialogs' menu), 31 each, two lines, the
            // padding; the worktree items in a git checkout (the menu asks
            // git the same). It opens upwards from the button: the footer is
            // at the window's bottom.
            const away = machines().filter((m) => m.name && m.layout === "ready").length;
            const git = space ? await checkout(space) : null;
            const n = 4 + away + (space ? 2 : 0) + 1 + (git ? 2 : 0) + (git === "linked" ? 1 : 0);
            const height = 10 + n * 31 + 2 * 9, width = 230;
            const b = this.menuAt, z = zoom();
            const at = b ? { x: Math.max(0, b.x), y: Math.max(0, b.y - height * z - 6 * z) } : undefined;
            openOverlay({ mod: "orbit-dialogs", kind: "popup", width, height, ...(at ? { at } : {}), props: { dialog: "menu", tab: "sidebar", target: { id: space?.id } } });
          });
        }).on_mouse_down("left", (e) => { if (e?.bounds) this.menuAt = e.bounds; })));
  }
}
