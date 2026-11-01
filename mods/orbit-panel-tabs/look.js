// The orbit layout's look: its sizes, its glass, and the colours the layout
// file needs from the shown theme and space. This file is the same in every
// orbit mod that uses it (a mod can only import from its own folder).
//
// - look(): the sizes, for mods drawing themselves.
// - glass(): the theme's surface, a little see-through.
// - apply(focus): writes the shown theme's glass and the outline colours into
//   layouts/orbit.json. `focus` is the colour of the pane with the keys (the
//   shown space's). Only what differs is written.

import { shared, setShared, theme, appHome, readTextFile, writeTextFile } from "herdr";

// The width of a pane's outline and of the lines in its tab row.
export const LINE = 2;
export const LAYOUT = "orbit";

// The background picture and its blurred copy (scripts/blur.py), under the
// glass of the mods that draw their own block (glass.js).
export const BACKGROUND = { image: "mods/orbit/backgrounds/space.png", blur: "mods/orbit/backgrounds/space-blur.png", width: 2560, height: 1600 };

const SIZES = { radius: 4, gap: 0, header: 46, status: 40, footer: 86, scale: 1 };

export function look() {
  return { ...SIZES, small: Math.min(4, SIZES.radius) };
}

export function glass(t = theme()) {
  return t.surface.slice(0, 7) + "9e";
}

// Which pane has the keys: "left" or "panel". Its outline and its tab row's
// lines take the shown space's colour. Kept in shared "orbit.sides".
const SIDES = "orbit.sides";
export function keysIn() {
  return shared(SIDES)?.focus === "panel" ? "panel" : "left";
}
export function setKeysIn(side) {
  if (keysIn() !== side) setShared(SIDES, { ...(shared(SIDES) ?? {}), focus: side });
}

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The layout with the theme's glass and the outline colours in it. A layout
// can't give a theme colour an alpha, so they are written as hex.
export function shape(root, colors, focus) {
  const glassy = glass(colors);
  const edge = colors.border.slice(0, 7);
  const ring = (focus ?? colors.accent).slice(0, 7);
  const sidebar = find(root, "sidebar");
  if (sidebar) sidebar.background = glassy;
  for (const [stack, mid, side] of [["left", "left-mid", "left"], ["panel-body", "panel-mid", "panel"]]) {
    const s = find(root, stack);
    if (s) s.background = glassy;
    const m = find(root, mid);
    if (m) m.divider = { width: LINE, color: keysIn() === side ? ring : edge };
  }
  return root;
}

// The layout file as last read or written here, so a change (the outline on
// each space switch) is one write and no read. The write only lands on that
// text; when the file changed meanwhile it's read again.
let known = null;

export async function apply(focus, fresh = false) {
  const path = `${appHome()}/layouts/${LAYOUT}.json`;
  for (let tries = 0; tries < 2; tries++) {
    if (fresh || tries || known === null) known = await readTextFile(path);
    const text = known;
    if (!text) return;
    const out = JSON.stringify(shape(JSON.parse(text), theme(), focus), null, 2) + "\n";
    if (out === text) return;
    try {
      await writeTextFile(path, out, text);
      known = out;
      return;
    } catch (e) {
      if (tries) throw e;
    }
  }
}
