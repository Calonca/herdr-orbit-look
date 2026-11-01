// The orbit layout's look, and how a mod asks for a change. This file is the
// same in every orbit mod that uses it (a mod can only import from its own
// folder).
//
// - look(): the sizes, for mods drawing themselves.
// - glass(): the theme's surface, a little see-through.
// - keysIn(): which pane has the keys.
// - ask(): a change to the panes, the tabs or the side panel. The orbit mod
//   (the layout's controller) makes every change to the layout file and to
//   shared "orbit.sides" itself; the other mods ask it, through a command.

import { theme, shared, run } from "herdr";

// The width of a pane's outline and of the lines in its tab row.
export const LINE = 2;

// The background picture and its blurred copy (scripts/blur.py), under the
// glass of the mods that draw their own block (glass.js).
export const BACKGROUND = { image: "mods/orbit/backgrounds/space.png", blur: "mods/orbit/backgrounds/space-blur.png", width: 2560, height: 1600 };

const SIZES = { radius: 4, gap: 0, header: 46, status: 40, footer: 86, scale: 1 };

// The side panel's smallest width, and how narrow the layout lets a drag take
// it (past half the smallest, it closes: orbit-tabs' panel row).
export const PANEL_MIN = 280;
export const PANEL_DRAG_MIN = 24;

export function look() {
  return { ...SIZES, small: Math.min(4, SIZES.radius) };
}

export function glass(t = theme()) {
  return t.surface.slice(0, 7) + "9e";
}

// Which pane has the keys: "left", "right" or "panel" (shared "orbit.sides").
// Its outline and its tab row's lines take the shown space's colour.
export function keysIn() {
  const f = shared("orbit.sides")?.focus;
  return f === "right" || f === "panel" ? f : "left";
}

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Asks the orbit mod for a change: the command "orbit.<what> <args as JSON>"
// (a mod's command carries only its name). The orbit mod's main.js lists them.
export function ask(what, args = {}) {
  run(`orbit.${what} ${JSON.stringify(args)}`);
}
