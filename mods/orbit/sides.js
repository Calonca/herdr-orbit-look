import { shared, panes, layout } from "herdr";
import { find } from "./look.js";
import { label, programLabel } from "./labels.js";

export const KEY = "orbit.sides";
export const LEFT_TAB = "left-tab";
export const PICK = { left: "left-pick", right: "right-pick" };
export const FRAME = { left: "left-frame", right: "right-frame" };
export const frameOf = (side) => FRAME[side] ?? side;

export function state() {
  const s = shared(KEY) ?? {};
  return { right: {}, mods: [], shown: {}, last: {}, pending: {}, folded: {}, order: {}, views: {}, focus: "left", ...s };
}

export function termChild(terminal) {
  return `rt-${terminal.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export function movable(tab, ps = panes()) {
  const mine = ps.filter((p) => p.tab === tab.id);
  return mine.length === 1 && mine[0].terminal ? mine[0] : null;
}

// Whether a pane's entry can go to the other pane: a terminal alone in its tab
// (on any machine), or a view orbit opened (it knows its props); the left pane
// keeps one tab of its own.
export function crosses(space, side, e, st = state(), ps = panes()) {
  if (side === "right") return e.kind === "term" || e.kind === "mod";
  if (e.kind !== "tab" || leftTabs(space, st).length < 2) return false;
  return Boolean(movable(e.tab, ps) || (e.tab.panes === 1 && st.views?.[e.tab.id]));
}

export function leftTabs(space, st = state()) {
  return (space?.tabs ?? []).filter((t) => !st.right[t.id]);
}

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

export function entries(space, side, st = state(), ps = panes()) {
  if (!space) return [];
  if (side === "right") return rightEntries(space, st, ps);
  const out = leftTabs(space, st).map((tab) => ({ kind: "tab", id: tab.id, tab }));
  if (st.pending[space.id] === "left") out.push({ kind: "pick", id: PICK.left });
  return out;
}

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

export function isSplit(L = layout()) {
  const right = find(L, FRAME.right);
  return Boolean(right && !right.hidden);
}

export function entryLabel(e) {
  if (e.kind === "tab") return label(e.tab);
  if (e.kind === "term") return state().names?.[e.id] ?? (e.tab.named ? e.tab.name : programLabel(e.pane) ?? "shell");
  if (e.kind === "mod") return e.mod.title ?? e.mod.mod;
  return "new window";
}

export function inLayout(id) {
  return Boolean(find(layout(), id));
}
