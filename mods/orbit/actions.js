// What the two panes' rows, keys and pickers do (sides.js has where things
// are). Only the orbit mod has this file: the rows, the picker and the
// dialogs ask it (look.js ask, main.js), so shared "orbit.sides" and the
// layout file have one writer.

import { run, spaces, panes, layout, openOverlay, closeOverlay, shared, setShared } from "herdr";
import { apply } from "./layout.js";
import { find } from "./look.js";
import { state, leftTabs, rightEntries, entries, isSplit, entryLabel, movable, termChild, inLayout, LEFT_TAB, PICK, FRAME, frameOf } from "./sides.js";

export function save(change) {
  setShared("orbit.sides", { ...state(), ...change });
}

// A mod's child id in the right pane.
export function modChild(space, mod, props) {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify([space, mod, props ?? null, Date.now()])) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return `rm-${h.toString(36)}`;
}

// Moves the right row's entry at `from` to `to` (places in rightEntries), and
// keeps that order (orbit.sides' order, so it holds across restarts).
export function reorderRight(space, from, to, st = state()) {
  const ids = rightEntries(space, st).filter((e) => e.kind !== "pick").map((e) => e.id);
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return;
  const [id] = ids.splice(from, 1);
  ids.splice(to, 0, id);
  save({ order: { ...st.order, [space.id]: ids } });
}

const ASK = "orbit.ask"; // the close being asked: { overlay, key }

export const activeSpace = () => spaces().find((s) => s.active);
const sleep = (cx, ms) => (cx?.sleep ? cx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

async function until(cx, ok, ms = 5000) {
  for (let n = 0; n < ms / 50; n++) {
    if (ok()) return true;
    await sleep(cx, 50);
  }
  return ok();
}

// Writes the right pane's children from the state, and waits for the window
// to have `id` (when given).
async function write(cx, id) {
  await apply();
  if (id) await until(cx, () => inLayout(id));
}

// Shows the right pane's `id` for the shown space (and the pane itself).
export function showRight(space, id, focusIt = true) {
  const st = state();
  save({ shown: { ...st.shown, [space.id]: id }, folded: unfold(st, space), focus: "right" });
  run("layout.show", { id: FRAME.right });
  // Not there yet (its write is on the way, and writes the shown one as the
  // stack's active, look.js): a select now would fail.
  const L = layout();
  if (find(L, id) && find(L, "right")?.active !== id) run("layout.select", { stack: "right", child: id });
  const e = rightEntries(space).find((x) => x.id === id);
  if (focusIt && e?.kind === "term") run("pane.focus", { terminal: e.pane.terminal });
}

// Shows a left tab (a herdr tab of the space).
export function showLeft(space, tab) {
  const st = state();
  save({ last: { ...st.last, [space.id]: tab.id }, focus: "left" });
  run("layout.select", { stack: "left", child: LEFT_TAB });
  run("tab.select", { id: tab.id });
  // The keys go with it (a right terminal block keeps them otherwise).
  const pane = panes().find((p) => p.tab === tab.id);
  if (pane) run("pane.focus", { pane: pane.pane });
}

export function show(space, side, e) {
  if (!e) return;
  if (side === "left") {
    if (e.kind === "pick") { save({ focus: "left" }); run("layout.select", { stack: "left", child: PICK.left }); }
    else showLeft(space, e.tab);
  } else {
    showRight(space, e.id);
  }
}

// A new terminal (argv: an agent; none: a shell) in a side, shown.
export async function newTerminal(cx, space, side, extra = {}) {
  const st = state();
  if (st.pending[space.id] === side) await dropPending(cx, space, side, false);
  if (side === "left") {
    save({ focus: "left" });
    run("layout.select", { stack: "left", child: LEFT_TAB });
    run("tab.new", { space: space.id, ...extra });
    return;
  }
  // On the right: a herdr tab of its own (herdr shows it on the left for a
  // moment, then the left's tab is shown again), as a terminal block.
  const before = new Set(space.tabs.map((t) => t.id));
  const back = st.last[space.id] ?? leftTabs(space, st).find((t) => t.active)?.id;
  run("tab.new", { space: space.id, ...extra });
  let tab = null, pane = null;
  await until(cx, () => {
    const s = spaces().find((x) => x.id === space.id);
    tab = s?.tabs.find((t) => !before.has(t.id)) ?? null;
    pane = tab ? panes().find((p) => p.tab === tab.id && p.terminal) : null;
    return Boolean(pane);
  });
  if (!pane) return;
  const now = state();
  save({ right: { ...now.right, [tab.id]: pane.terminal } });
  if (back) run("tab.select", { id: back });
  // Shown from the write on (look.js), not by a select racing it.
  save({ shown: { ...state().shown, [space.id]: termChild(pane.terminal) } });
  await write(cx, termChild(pane.terminal));
  showRight(activeSpace() ?? space, termChild(pane.terminal));
}

// A mod in a side: on the left a herdr tab with the mod as its pane; on the
// right a block of the right pane.
export async function newMod(cx, space, side, title, mod, props) {
  const st = state();
  if (st.pending[space.id] === side) await dropPending(cx, space, side, false);
  if (side === "left") {
    save({ focus: "left" });
    run("layout.select", { stack: "left", child: LEFT_TAB });
    run("tab.new", { space: space.id, name: title, mod, ...(props ? { props } : {}) });
    return;
  }
  const id = modChild(space.id, mod, props);
  save({ mods: [...state().mods, { id, space: space.id, title, mod, props: props ?? null }], shown: { ...state().shown, [space.id]: id } });
  await write(cx, id);
  showRight(space, id);
}

// + ⠿: the pending "new window" tab, its picker shown, at the end of the row.
export function openPending(space, side) {
  const st = state();
  // On the right it's the shown entry from now on (the orbit mod keeps the right
  // pane on the space's shown one), and Esc goes back to the one before.
  const right = side === "right" ? {
    folded: unfold(st, space),
    shown: { ...st.shown, [space.id]: PICK.right },
    back: { ...(st.back ?? {}), [space.id]: st.shown[space.id] === PICK.right ? st.back?.[space.id] : st.shown[space.id] },
  } : {};
  save({ pending: { ...st.pending, [space.id]: side }, focus: side, ...right });
  run("layout.show", { id: frameOf(side) });
  run("layout.select", { stack: side, child: PICK[side] });
}

// Esc on the picker, or its tab closed: what was shown shows again.
export async function dropPending(cx, space, side, showBack = true) {
  const st = state();
  if (st.pending[space.id] !== side) return;
  const pending = { ...st.pending };
  delete pending[space.id];
  save({ pending });
  if (!showBack) return;
  if (side === "left") {
    run("layout.select", { stack: "left", child: LEFT_TAB });
    const tab = leftTabs(space).find((t) => t.active) ?? leftTabs(space)[0];
    if (tab) run("pane.focus", { pane: panes().find((p) => p.tab === tab.id)?.pane });
  } else {
    const list = rightEntries(space);
    const back = list.find((e) => e.id === st.back?.[space.id] && e.kind !== "pick")
      ?? list.find((e) => e.id === st.shown[space.id] && e.kind !== "pick") ?? list.find((e) => e.kind !== "pick");
    if (back) showRight(space, back.id);
    else { run("layout.hide", { id: FRAME.right }); save({ focus: "left" }); focusLeft(space); }
  }
}

const unfold = (st, space) => { const f = { ...st.folded }; delete f[space.id]; return f; };

// The split button at the right end of a pane's row: a full-width pane gets
// the right pane beside it (its entries, or the picker as a "new window" tab
// with none); split, it's put away again (hidden, nothing ends: its entries
// come back with the next split).
export async function toggleSplit(cx, space) {
  const st = state();
  if (isSplit()) {
    if (st.pending[space.id] === "right") await dropPending(cx, space, "right", false);
    save({ folded: { ...state().folded, [space.id]: true }, focus: "left" });
    run("layout.hide", { id: FRAME.right });
    focusLeft(space);
    return;
  }
  const list = rightEntries(space, st).filter((e) => e.kind !== "pick");
  if (!list.length) return openPending(space, "right");
  showRight(space, (list.find((e) => e.id === st.shown[space.id]) ?? list[0]).id);
}

// The side panel (the status bar's toggle, the orbit mod's side-panel key): shown
// with what it showed last (its picker when it has nothing else), or hidden.
export function toggleSidePanel(L = layout()) {
  const panel = find(L, "panel");
  if (!panel) return;
  if (!panel.hidden) {
    if (state().focus === "panel") save({ focus: "left" });
    return run("layout.hide", { id: "panel" });
  }
  save({ focus: "panel" });
  // What it showed last; its first view when that was the picker (or gone);
  // the picker when it has no view.
  const body = find(L, "panel-body");
  const views = (body?.children ?? []).filter((c) => c.id !== "panel-pick");
  if (!body?.active || body.active === "panel-pick" || !find(L, body.active)) {
    run("layout.select", { stack: "panel-body", child: views[0]?.id ?? "panel-pick" });
  }
  run("layout.show", { id: "panel" });
}

export function focusLeft(space) {
  const tab = leftTabs(space).find((t) => t.active) ?? leftTabs(space)[0];
  const pane = tab && panes().find((p) => p.tab === tab.id);
  if (pane) run("pane.focus", { pane: pane.pane });
}

// Renames an entry (its tab's name field, rowframe.js editKit): a left
// tab is a herdr tab (tab.rename); a right terminal keeps its name in
// orbit.sides' names, a right mod its title.
export function renameEntry(side, e, name) {
  if (!e || !name) return;
  if (e.kind === "tab") return run("tab.rename", { id: e.tab.id, name });
  const st = state();
  if (e.kind === "term") save({ names: { ...(st.names ?? {}), [e.id]: name } });
  else if (e.kind === "mod") save({ mods: st.mods.map((m) => (m.id === e.id ? { ...m, title: name } : m)) });
}

// Whether closing ends something running (a terminal): then it asks first.
function runs(e) {
  if (e.kind === "term") return true;
  if (e.kind === "tab") return panes().some((p) => p.tab === e.tab.id && p.terminal);
  return false;
}

// Closes an entry: a mod or the picker at once; a terminal asks first (the
// same close again, or Enter, confirms). Only that entry's own
// terminal ends: a left tab is a herdr tab (tab.close {id}), a right terminal
// a herdr tab of its own. The space's last tab is the space's close (herdr asks).
export async function close(cx, space, side, e, sure = false) {
  if (!e) return;
  if (e.kind === "pick") return dropPending(cx, space, side);
  if (e.kind === "mod") {
    const st = state();
    if (find(layout(), "right")?.active === e.id) {
      const rest = rightEntries(space).filter((x) => x.id !== e.id && x.kind !== "pick");
      if (rest.length) showRight(space, rest[0].id); else { run("layout.hide", { id: FRAME.right }); focusLeft(space); }
    }
    save({ mods: st.mods.filter((m) => m.id !== e.id) });
    await write(cx);
    return;
  }
  const tab = e.tab;
  if (space.tabs.length === 1) return run("space.close", { id: space.id });
  const ask = shared(ASK);
  const key = `${side}:${e.id}`;
  if (runs(e) && !sure && ask?.key !== key) {
    const overlay = openOverlay({ mod: "orbit-dialogs", kind: "dialog", frame: "none", width: 380, height: 150,
      props: { dialog: "confirm", label: entryLabel(e), space: space.id, side, id: e.id } });
    setShared(ASK, { overlay, key });
    return;
  }
  if (ask?.overlay) closeOverlay(ask.overlay);
  setShared(ASK, null);
  if (side === "right" && find(layout(), "right")?.active === e.id) {
    const rest = rightEntries(space).filter((x) => x.id !== e.id && x.kind !== "pick");
    if (rest.length) showRight(space, rest[0].id, false); else run("layout.hide", { id: FRAME.right });
  }
  run("tab.close", { id: tab.id, confirmed: true });
  if (side === "right") {
    const st = state();
    const right = { ...st.right };
    delete right[tab.id];
    save({ right, focus: rightEntries(space).length > 1 ? "right" : "left" });
  }
}

// The close dialog's answer.
export function closeAsked(cx, spaceId, side, id) {
  const space = spaces().find((s) => s.id === spaceId);
  const e = space && entries(space, side).find((x) => x.id === id);
  if (e) return close(cx, space, side, e, true);
  setShared(ASK, null);
}

export function cancelAsk() {
  const ask = shared(ASK);
  if (ask?.overlay) closeOverlay(ask.overlay);
  setShared(ASK, null);
}

// Moves a terminal tab to the other pane (a local tab of one terminal; the
// left keeps one tab at least).
export async function move(cx, space, side, e) {
  if (!e) return;
  const st = state();
  if (side === "left" && e.kind === "tab") {
    const pane = movable(e.tab);
    if (!pane || leftTabs(space, st).length < 2) return;
    const others = leftTabs(space, st).filter((t) => t.id !== e.tab.id);
    save({ right: { ...st.right, [e.tab.id]: pane.terminal } });
    run("tab.select", { id: (others.find((t) => t.id === st.last[space.id]) ?? others[0]).id });
    await write(cx, termChild(pane.terminal));
    showRight(space, termChild(pane.terminal));
  } else if (side === "right" && e.kind === "term") {
    const right = { ...st.right };
    delete right[e.tab.id];
    const rest = rightEntries(space, st).filter((x) => x.id !== e.id && x.kind !== "pick");
    save({ right });
    if (!rest.length) run("layout.hide", { id: FRAME.right });
    else if (find(layout(), "right")?.active === e.id) showRight(space, rest[0].id, false);
    showLeft(space, e.tab);
    await write(cx);
  }
}
