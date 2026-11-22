import { div, svg } from "gpui-kit";
import { theme, shared, setShared, run, spaces } from "herdr";

export const LINE = 2;

export const GENERATED = { image: "mods/orbit/backgrounds/space.png", blur: "mods/orbit/backgrounds/space-blur.png", width: 2560, height: 1600 };

const START = { radius: 16, gap: 14, header: 46, status: 40, footer: 86, scale: 1, small: 4, top: false, background: GENERATED };

export const PANEL_MIN = 280;
export const PANEL_DRAG_MIN = 24;

export function look() {
  return { ...START, ...(shared("orbit.look") ?? {}) };
}

export function glass(t = theme()) {
  return t.surface.slice(0, 7) + "9e";
}

export function keysIn() {
  const st = shared("orbit.sides");
  let f = st?.focus;
  const space = spaces().find((s) => s.active);
  if (st?.keysSpace && space && st.keysSpace !== space.id) f = st.keysBy?.[space.id];
  return f === "right" || f === "panel" ? f : "left";
}

export function spaceLook(space) {
  return shared("orbit.identity")?.[space?.id] ?? { color: theme().accent, glyph: 0 };
}

export function glyphPath(kind, filled) {
  return `mods/orbit-tabs/glyphs/${kind}${filled ? "-fill" : ""}.svg`;
}

export function statusColor(status) {
  const k = { blocked: "ansi1", working: "ansi3", done: "ansi2" }[status];
  return k ? theme()[k] : null;
}

export function accentBand(color) {
  return color.slice(0, 7) + "29";
}

export function probeColor(where, color) {
  if (shared("orbit.probe") !== true) return;
  const all = shared("orbit.probe.colors") ?? {};
  if (all[where] !== color) setShared("orbit.probe.colors", { ...all, [where]: color });
}

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
