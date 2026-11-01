// The orbit layout's two panes: each a layout stack with its own tab row
// (orbit-tabs). Where things are, read from shared state; only the orbit mod
// changes it (its actions.js). This file is the same in every orbit mod that uses it.
//
// - The left pane shows the space's own herdr tabs (its "left-tab" child is
//   herdr's shown tab), so every tab a space has, wherever it was started
//   (hc run, space.new, an agent's), is a left tab, and nothing moves to get there.
// - The right pane shows, per space, terminals and mods of its own: a terminal
//   is a herdr tab of its own put on the right (a terminal block of its
//   terminal), a mod is a block. One layout serves every space: the right stack
//   holds every space's children, and the controller (the orbit mod) shows the
//   shown space's pick and hides the pane when that space has none.
// - A pending "new window" tab (the picker, orbit-add) can open in either.
//
// What is where is kept in shared "orbit.sides":
//   right:   { [tab id]: terminal id }   herdr tabs shown on the right
//   mods:    [{ id, space, title, mod, props }]   the right pane's mods
//   shown:   { [space id]: child id }    the right pane's pick per space
//   back:    { [space id]: child id }    the one shown before its picker opened
//   last:    { [space id]: tab id }      the left pane's tab, to go back to
//   pending: { [space id]: "left" | "right" }   a "new window" tab open there
//   focus:   "left" | "right" | "panel"  the pane with the keys (its outline
//                                        and row's lines in the space's colour)
//   keysBy:  { [space id]: focus }       each space's, given back on return
//   folded:  { [space id]: true }        the split put away (the right pane
//                                        hidden though it has entries)
//   names:   { [child id]: name }        a right terminal's name, as renamed
//   order:   { [space id]: [child id] }  the right row's order, as dragged
//                                        (the others after, as they come)

import { shared, panes, layout } from "herdr";
import { find } from "./look.js";
import { label, programLabel } from "./labels.js";

export const KEY = "orbit.sides";
export const LEFT_TAB = "left-tab";
export const PICK = { left: "left-pick", right: "right-pick" };
// Each pane's frame: a column of its outline's top (orbit-edge), its content
// (the stack, between the two side lines) and its tab row. Showing or hiding
// a pane is its frame's.
export const FRAME = { left: "left-frame", right: "right-frame" };
export const frameOf = (side) => FRAME[side] ?? side;

export function state() {
  const s = shared(KEY) ?? {};
  return { right: {}, mods: [], shown: {}, last: {}, pending: {}, folded: {}, order: {}, focus: "left", ...s };
}

// The right pane's child of a terminal.
export function termChild(terminal) {
  return `rt-${terminal.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

// A herdr tab that can go to the right: one terminal on this machine (a
// layout terminal block shows a local terminal; remote ones stay herdr tabs).
export function movable(tab, ps = panes()) {
  const mine = ps.filter((p) => p.tab === tab.id);
  return mine.length === 1 && Boolean(mine[0].terminal) && !mine[0].terminal.includes("/") && !tab.id.includes("/") ? mine[0] : null;
}

// The left pane's tabs: the space's herdr tabs not put on the right.
export function leftTabs(space, st = state()) {
  return (space?.tabs ?? []).filter((t) => !st.right[t.id]);
}

// The right pane's entries in its row's order: as dragged (orbit.sides'
// order), else its terminals (in the space's tab order), then its mods; the
// pending picker last.
//   { kind: "term", id, tab, pane } | { kind: "mod", id, mod } | { kind: "pick", id }
export function rightEntries(space, st = state(), ps = panes()) {
  if (!space) return [];
  const out = [];
  for (const tab of space.tabs) {
    if (!st.right[tab.id]) continue;
    const pane = ps.find((p) => p.tab === tab.id && p.terminal);
    if (pane) out.push({ kind: "term", id: termChild(pane.terminal), tab, pane });
  }
  for (const m of st.mods) if (m.space === space.id) out.push({ kind: "mod", id: m.id, mod: m });
  const order = st.order?.[space.id] ?? [];
  if (order.length) {
    const rank = (e, n) => { const k = order.indexOf(e.id); return k < 0 ? order.length + n : k; };
    const ranked = out.map((e, n) => [rank(e, n), e]).sort((a, b) => a[0] - b[0]);
    out.splice(0, out.length, ...ranked.map(([, e]) => e));
  }
  if (st.pending[space.id] === "right") out.push({ kind: "pick", id: PICK.right });
  return out;
}

// The entries of a side's row, for the shown space:
//   { kind: "tab", id, tab } (left) | right's (above) | { kind: "pick", id }
export function entries(space, side, st = state(), ps = panes()) {
  if (!space) return [];
  if (side === "right") return rightEntries(space, st, ps);
  const out = leftTabs(space, st).map((tab) => ({ kind: "tab", id: tab.id, tab }));
  if (st.pending[space.id] === "left") out.push({ kind: "pick", id: PICK.left });
  return out;
}

// Which entry a side shows now.
export function shownEntry(space, side, L = layout()) {
  const list = entries(space, side);
  const stack = find(L, side);
  if (!stack) return null;
  if (side === "left") {
    if (stack.active === PICK.left) return list.find((e) => e.kind === "pick") ?? null;
    return list.find((e) => e.kind === "tab" && e.tab.active) ?? null;
  }
  return list.find((e) => e.id === stack.active) ?? null;
}

// Whether the shown space is split: its right pane shows.
export function isSplit(L = layout()) {
  const right = find(L, FRAME.right);
  return Boolean(right && !right.hidden);
}

// What an entry is called in its row and in the close dialog.
export function entryLabel(e) {
  if (e.kind === "tab") return label(e.tab);
  if (e.kind === "term") return state().names?.[e.id] ?? (e.tab.named ? e.tab.name : programLabel(e.pane) ?? "shell");
  if (e.kind === "mod") return e.mod.title ?? e.mod.mod;
  return "new window";
}

// What the layout's right stack holds now (the file can lag the state).
export function inLayout(id) {
  return Boolean(find(layout(), id));
}
