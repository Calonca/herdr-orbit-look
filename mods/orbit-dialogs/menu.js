// The orbit layout's menus, derived from herdr-app's `menu` mod (Apache-2.0)
// and changed: other items, and Rename opening a tab's name field. Opened as
// a popup with props { dialog: "menu", tab, target }:
//   tab "sidebar" (the sidebar's "menu"): Search, Settings (a dot while an
//     update is ready), Add machine, New space (and on each machine that's
//     connected), then the shown space's own items (Rename, worktrees, Close),
//     Keybinds: what herdr's stock sidebar offers that this one has no button for.
//   tab "orbit-tab" (a tab of the orbit rows, right-clicked): Rename, then
//     herdr's pane items (tabmenu.js).
// The icons are herdr-app's own, from its shipped `workspace-chrome` mod.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args, icon?];
// a command "worktree" opens the worktree dialog, as herdr's menu does.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, spaces, panes, exec, updates, machines, setShared } from "herdr";
import { tabMenuItems, ruleAfterRename } from "./tabmenu.js";
import { ask } from "./look.js";

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

// The menu's space: the target's, else the shown one.
function targetSpace(p) {
  return spaces().find((s) => s.id === p?.target?.id) ?? spaces().find((s) => s.active) ?? null;
}

function spaceItems(space, git) {
  if (!space) return [];
  return [
    ["Rename space", "space.rename", { id: space.id }],
    ...(git ? [["New worktree", "worktree", { space: space.id, action: "new" }], ["Open worktree", "worktree", { space: space.id, action: "open" }]] : []),
    ...(git === "linked" ? [["Remove worktree", "worktree", { space: space.id, action: "remove" }]] : []),
    ["Close space", "space.close", { id: space.id }],
  ];
}

export function items(p, git) {
  p = p ?? {};
  if (p.tab === "sidebar") {
    const away = machines().filter((m) => m.name && m.layout === "ready").map((m) => m.name);
    return [
      ["Search", "mod.open", { name: "picker" }, "search"],
      ["Settings", "app.settings", {}, "settings"],
      ["Add machine", "mod.open", { name: "machine-add" }, "server"],
      ["New space", "space.new", {}],
      ...away.map((m) => [`New space on ${m}`, "space.new", { machine: m }]),
      ...spaceItems(targetSpace(p), git),
      ["Keybinds", "app.help", {}],
    ];
  }
  if (p.tab === "orbit-tab") return tabMenuItems(p.target);
  return [];
}

function menuIcon(it) {
  if (it[3]) return `mods/workspace-chrome/${it[3]}.svg`;
  const command = it[1];
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

// A line before: the space's own items, and Keybinds.
// A tab's: a line after Rename.
const ruleBefore = (list, i) => i > 0 && ((list[i][1] === "space.rename") || list[i][1] === "app.help" || ruleAfterRename(list, i));

export class Menu {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "sidebar" ? targetSpace(p) : null;
    const folder = space && place(space);
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i) {
    const it = items(props(), this.git)[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    // Rename: the row the tab is in opens its name field (orbit-tabs).
    if (it[1] === "orbit-rename") setShared("orbit.rename", { ...it[2], n: Date.now() });
    else if (it[1] === "orbit-close-view") ask("view-close", { id: it[2].id });
    else if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  render() {
    const t = theme();
    const list = items(props(), this.git);
    const ready = Boolean(updates()?.app?.ready);
    return v_flex()
      .id("orbit-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) =>
          v_flex()
            .when(ruleBefore(list, i), (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
            .child(h_flex().id(`om-${i}`)
              .h(31)
              .px(8)
              .gap(9)
              .rounded(7)
              .items_center()
              .justify_between()
              .text_color(t.foreground)
              .when(i === this.at, (el) => el.bg(t.selected))
              .hover((s) => s.bg(t.hover))
              .on_click(() => this.choose(i))
              .child(svg(menuIcon(it)).size(14).flex_none().text_color(t.muted))
              .child(div().flex_1().child(it[0]))
              // Settings: herdr's dot while an update is ready.
              .when(it[1] === "app.settings" && ready, (el) => el.child(div().size(6).rounded_full().flex_none().bg(t.accent)))
              .child(div().text_size(11).text_color(t.dim).child(shortcut(it[1], it[2])))),
        ),
      );
  }
}
