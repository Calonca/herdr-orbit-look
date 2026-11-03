// The orbit layout's look, and how a mod asks for a change. This file is the
// same in every orbit mod that uses it (a mod can only import from its own
// folder).
//
// - look(): the sizes and the background, for mods drawing themselves.
// - glass(): the theme's surface, a little see-through.
// - keysIn(): which pane has the keys.
// - spaceLook(space): its colour and symbol.
// - spaceSymbol(): a space's symbol as the sidebar and the taskbar draw it.
// - ask(): a change to the panes, the tabs or the side panel.
// The orbit mod (the layout's controller) works out the look, the spaces'
// colours and where the tab rows sit once, and shares them ("orbit.look",
// "orbit.identity", "orbit.places"); this file only reads them. It makes
// every change to the layout file and to shared "orbit.sides" itself; the
// other mods ask it, through a command.

import { div, svg } from "gpui-kit";
import { theme, shared, setShared, run } from "herdr";

// The width of a pane's outline and of the lines in its tab row.
export const LINE = 2;

// The generated background and its blurred copy (scripts/blur.py), under the
// glass of the mods that draw their own block (glass.js).
export const GENERATED = { image: "mods/orbit/backgrounds/space.png", blur: "mods/orbit/backgrounds/space-blur.png", width: 2560, height: 1600 };

// Until the orbit mod has shared its own: the comfortable density, corners 4,
// no gap, the tabs at the bottom, the generated background.
const START = { radius: 16, gap: 14, header: 46, status: 40, footer: 86, scale: 1, small: 4, top: false, background: GENERATED };

// The side panel's smallest width, and how narrow the layout lets a drag take
// it (past half the smallest, it closes: orbit-tabs' panel row).
export const PANEL_MIN = 280;
export const PANEL_DRAG_MIN = 24;

export function look() {
  return { ...START, ...(shared("orbit.look") ?? {}) };
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

// A space's colour and symbol (one of 8: glyphs/ in orbit-tabs).
export function spaceLook(space) {
  return shared("orbit.identity")?.[space?.id] ?? { color: theme().accent, glyph: 0 };
}

export function glyphPath(kind, filled) {
  return `mods/orbit-tabs/glyphs/${kind}${filled ? "-fill" : ""}.svg`;
}

// An agent's state as a colour: blocked red, working yellow, done green.
export function statusColor(status) {
  const k = { blocked: "ansi1", working: "ansi3", done: "ansi2" }[status];
  return k ? theme()[k] : null;
}

// The shown space's accent where it's listed (the sidebar's row, the
// taskbar's card): a band of its colour behind it, the text staying white.
export function accentBand(color) {
  return color.slice(0, 7) + "29";
}

// For tools/regress.py (shared "orbit.probe" on): a colour a place drew
// ("sidebar-band", "taskbar-text", ...), in shared "orbit.probe.colors".
export function probeColor(where, color) {
  if (shared("orbit.probe") !== true) return;
  const all = shared("orbit.probe.colors") ?? {};
  if (all[where] !== color) setShared("orbit.probe.colors", { ...all, [where]: color });
}

// A space's symbol, `r` px: filled in its agents' state colour while one is
// blocked, working or done (finished while you weren't looking), else empty;
// its outline in `outline` over it. The sidebar and the taskbar both draw it
// with this, so they show the same. `where`: tools/regress.py's probe
// (shared "orbit.probe.symbols", what was drawn for each space).
export function spaceSymbol(space, r, outline, where = null) {
  const { glyph } = spaceLook(space);
  const fill = statusColor(space?.status);
  if (where && shared("orbit.probe") === true) {
    const key = `${where}:${space.id}`, all = shared("orbit.probe.symbols") ?? {};
    const now = { glyph, fill: fill ?? null };
    if (JSON.stringify(all[key]) !== JSON.stringify(now)) setShared("orbit.probe.symbols", { ...all, [key]: now });
  }
  return div().relative().size(r).flex_none()
    .when(Boolean(fill), (el) => el.child(svg(glyphPath(glyph, true)).absolute().top(0).left(0).size(r).text_color(fill)))
    .child(svg(glyphPath(glyph, false)).absolute().top(0).left(0).size(r).text_color(outline));
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
