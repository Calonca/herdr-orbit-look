import { run, spaces, panes, layout, openOverlay, closeOverlay, shared, setShared } from "herdr";
import { apply } from "./layout.js";
import { find } from "./look.js";
import { state, leftTabs, rightEntries, entries, isSplit, entryLabel, movable, crosses, termChild, inLayout, LEFT_TAB, PICK, FRAME, frameOf } from "./sides.js";

export function save(change) {
  const space = "focus" in change ? spaces().find((s) => s.active) : null;
  setShared("orbit.sides", { ...state(), ...change, ...(space ? { keysSpace: space.id } : {}) });
}

export function modChild(space, mod, props) {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify([space, mod, props ?? null, Date.now()])) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return `rm-${h.toString(36)}`;
}

// The right pane's order with `id` put before `before` (or last).
function ordered(space, id, before, st = state()) {
  const ids = rightEntries(space, st).filter((e) => e.kind !== "pick" && e.id !== id).map((e) => e.id);
  const at = ids.indexOf(before);
  ids.splice(at < 0 ? ids.length : at, 0, id);
  return { ...st.order, [space.id]: ids };
}

// herdr's place (from 1) for a left tab put before the tab `before`, or after
// the left pane's last: the tabs shown on the right count too.
function leftPlace(space, id, before) {
  const tabs = space.tabs.filter((t) => t.id !== id);
  const left = new Set(leftTabs(space).filter((t) => t.id !== id).map((t) => t.id));
  const at = tabs.findIndex((t) => t.id === before && left.has(t.id));
  return (at >= 0 ? at : tabs.findLastIndex((t) => left.has(t.id)) + 1) + 1;
}

// A tab dropped in a row, before the entry `before` (null: last).
export async function dropTab(cx, space, side, e, to, before) {
  if (!e || e.kind === "pick") return;
  if (side === to) {
    if (side === "left") run("tab.move", { id: e.tab.id, index: leftPlace(space, e.tab.id, before) });
    else save({ order: ordered(space, e.id, before) });
    return;
  }
  if (!crosses(space, side, e)) return;
  if (to === "right") {
    const view = e.tab.panes === 1 ? state().views[e.tab.id] : null;
    if (!view) return move(cx, space, side, e, before);
    await newMod(cx, space, "right", entryLabel(e), view.mod, view.props ?? null, before);
    run("tab.close", { id: e.tab.id, confirmed: true });
    return;
  }
  if (e.kind === "term") {
    const name = state().names?.[e.id];
    run("tab.move", { id: e.tab.id, index: leftPlace(space, e.tab.id, before) });
    if (name) run("tab.rename", { id: e.tab.id, name });
    return move(cx, space, side, e);
  }
  const tab = await newMod(cx, space, "left", entryLabel(e), e.mod.mod, e.mod.props ?? null);
  if (!tab) return;
  await close(cx, space, "right", e);
  const now = spaces().find((s) => s.id === space.id) ?? space;
  run("tab.move", { id: tab, index: leftPlace(now, tab, before) });
  showLeft(now, { id: tab });
}

const ASK = "orbit.ask";

export const activeSpace = () => spaces().find((s) => s.active);
const sleep = (cx, ms) => (cx?.sleep ? cx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

async function until(cx, ok, ms = 5000) {
  for (let n = 0; n < ms / 50; n++) {
    if (ok()) return true;
    await sleep(cx, 50);
  }
  return ok();
}

async function write(cx, id) {
  await apply();
  if (id) await until(cx, () => inLayout(id));
}

// Herdr gives a mod view no keys: one the person shows is asked to take them.
export function giveKeys(e) {
  const mod = e?.mod?.mod ?? state().views[e?.tab?.id]?.mod;
  if (mod) run(`${mod}.focus`);
}

export function showRight(space, id, focusIt = true) {
  const st = state();
  const here = activeSpace()?.id === space.id;
  save({ shown: { ...st.shown, [space.id]: id }, folded: unfold(st, space), ...(here ? { focus: "right" } : {}) });
  run("layout.show", { id: FRAME.right });
  const L = layout();
  if (find(L, id) && find(L, "right")?.active !== id) run("layout.select", { stack: "right", child: id });
  const e = rightEntries(space).find((x) => x.id === id);
  if (focusIt && here && e?.kind === "term") run("pane.focus", { terminal: e.pane.terminal });
  if (focusIt && here && e?.kind === "mod") giveKeys(e);
}

export function showLeft(space, tab) {
  const st = state();
  save({ last: { ...st.last, [space.id]: tab.id }, focus: "left" });
  run("layout.select", { stack: "left", child: LEFT_TAB });
  run("tab.select", { id: tab.id });
  const pane = panes().find((p) => p.tab === tab.id);
  if (pane) run("pane.focus", { pane: pane.pane });
  giveKeys({ tab });
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

export async function newTerminal(cx, space, side, extra = {}) {
  const st = state();
  if (st.pending[space.id] === side) await dropPending(cx, space, side, false);
  if (side === "left") {
    save({ focus: "left" });
    run("layout.select", { stack: "left", child: LEFT_TAB });
    run("tab.new", { space: space.id, ...extra });
    return;
  }
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
  save({ shown: { ...state().shown, [space.id]: termChild(pane.terminal) } });
  await write(cx, termChild(pane.terminal));
  showRight(activeSpace() ?? space, termChild(pane.terminal));
}

export async function newMod(cx, space, side, title, mod, props, before = null) {
  const st = state();
  if (st.pending[space.id] === side) await dropPending(cx, space, side, false);
  if (side === "left") {
    save({ focus: "left" });
    run("layout.select", { stack: "left", child: LEFT_TAB });
    const before = new Set(space.tabs.map((t) => t.id));
    run("tab.new", { space: space.id, name: title, mod, ...(props ? { props } : {}) });
    let tab = null;
    await until(cx, () => {
      tab = spaces().find((s) => s.id === space.id)?.tabs.find((t) => !before.has(t.id)) ?? null;
      return Boolean(tab);
    });
    if (tab) save({ views: { ...state().views, [tab.id]: { mod, props: props ?? null } } });
    if (tab && activeSpace()?.id === space.id && state().focus === "left") giveKeys({ tab });
    return tab?.id ?? null;
  }
  const id = modChild(space.id, mod, props);
  save({ mods: [...state().mods, { id, space: space.id, title, mod, props: props ?? null }], shown: { ...state().shown, [space.id]: id } });
  if (before) save({ order: ordered(space, id, before) });
  await write(cx, id);
  showRight(space, id);
}

export function openPending(space, side) {
  const st = state();
  const right = side === "right" ? {
    folded: unfold(st, space),
    shown: { ...st.shown, [space.id]: PICK.right },
    back: { ...(st.back ?? {}), [space.id]: st.shown[space.id] === PICK.right ? st.back?.[space.id] : st.shown[space.id] },
  } : {};
  save({ pending: { ...st.pending, [space.id]: side }, focus: side, ...right });
  run("layout.show", { id: frameOf(side) });
  run("layout.select", { stack: side, child: PICK[side] });
}

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

export function toggleSidePanel(L = layout()) {
  const panel = find(L, "panel");
  if (!panel) return;
  if (!panel.hidden) {
    if (state().focus === "panel") save({ focus: "left" });
    return run("layout.hide", { id: "panel" });
  }
  save({ focus: "panel" });
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

export function renameEntry(side, e, name) {
  if (!e || !name) return;
  if (e.kind === "tab") return run("tab.rename", { id: e.tab.id, name });
  const st = state();
  if (e.kind === "term") save({ names: { ...(st.names ?? {}), [e.id]: name } });
  else if (e.kind === "mod") save({ mods: st.mods.map((m) => (m.id === e.id ? { ...m, title: name } : m)) });
}

function runs(e) {
  if (e.kind === "term") return true;
  if (e.kind === "tab") return panes().some((p) => p.tab === e.tab.id && p.terminal);
  return false;
}

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

export async function move(cx, space, side, e, before = null) {
  if (!e) return;
  const st = state();
  if (side === "left" && e.kind === "tab") {
    const pane = movable(e.tab);
    if (!pane || leftTabs(space, st).length < 2) return;
    const others = leftTabs(space, st).filter((t) => t.id !== e.tab.id);
    save({ right: { ...st.right, [e.tab.id]: pane.terminal } });
    save({ order: ordered(space, termChild(pane.terminal), before) });
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
