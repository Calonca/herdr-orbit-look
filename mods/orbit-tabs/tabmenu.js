// A tab's right-click menu in the orbit tab rows (orbit-tabs), shown by
// orbit-dialogs' menu: Rename first (the tab's name field, where its label
// is), then what herdr's own pane menu has for the tab's pane; a side panel
// view's: Rename, Close, Hide the panel. This file is the same in every orbit
// mod that uses it. The pane items are herdr-app's own pane menu's (its
// `menu` mod, Apache-2.0), as they are in herdr-app 0.1.11.
//   target { row: "left" | "right" | "panel", key, pane?, terminal? }
// An item is [label, command, args, icon?]; the menu runs "orbit-rename"
// and "orbit-close-view" itself.

import { terminals } from "herdr";

export function tabMenuItems(target) {
  const tg = target ?? {};
  const rename = ["Rename", "orbit-rename", { row: tg.row, key: tg.key }, "square-pen"];
  if (tg.row === "panel") {
    return [rename, ["Close", "orbit-close-view", { id: tg.key }, "x"], ["Hide the panel", "layout.hide", { id: "panel" }, "panel-left"]];
  }
  if (!tg.pane) return [rename];
  // herdr-app's pane menu (its `menu` mod).
  const all = terminals();
  const term = tg.terminal ? all.find((t) => t.address === tg.terminal) : null;
  const parent = term?.parent && all.find((t) => t.address === term.parent);
  const toProgram = term?.labels?.["herdr.right-click"] === "program";
  return [
    rename,
    ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
    ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
    ["Zoom", "pane.zoom", { pane: tg.pane }],
    ...(term
      ? [toProgram
        ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
        : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }]]
      : []),
    ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
    ["Close pane", "pane.close", { pane: tg.pane }],
  ];
}

// A line after Rename: herdr's items below it.
export const ruleAfterRename = (list, i) => i === 1 && list[0]?.[1] === "orbit-rename";

// The popup's height for its items (the menu: 31 a row, 9 a line, 5 padding).
export function menuHeight(list, rules = 0) {
  return 10 + list.length * 31 + rules * 9;
}
