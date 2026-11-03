// The orbit layout's own block: it draws nothing and keeps the window in step.
// - The layout file (look.js apply): the theme's glass, the outline of the
//   pane with the keys in the shown space's colour, the right pane's children
//   and the side panel's views. Written again when the theme, the shown space
//   or the keys change, and when layouts/ is replaced (a fresh copy).
// - The two panes (sides.js): the shown space's right pane (its pick, or
//   hidden when it has none), which pane has the keys, an agent shown from the
//   agents list or an alert (on the right, its terminal block shows).
// - The order spaces were last shown in (shared "orbit.recent").
// - What the other mods draw with, worked out once: each space's colour and
//   symbol ("orbit.identity"), the look ("orbit.look"), where the tab rows
//   sit ("orbit.places").
// - Commands for keys.json (its "layout:orbit" section), on the focused pane:
//   orbit.tab1..9, .next, .prev   show its tab N, the next, the previous; with
//                                 no tab N on the left, a prompt to make one
//   orbit.new        a new terminal in it    orbit.window   a "new window" tab in it
//   orbit.right      a "new window" tab in the right pane (opens it)
//   orbit.close      close its shown tab (a terminal asks; again confirms)
//   orbit.left-pane, orbit.right-pane   give the keys to that pane
//   orbit.move       move the shown tab to the other pane
//   orbit.split      the right pane beside, or put away
//   orbit.side-panel the side panel, or hidden
//   orbit.recent     the space shown before this one
//   orbit.switcher   the recent spaces, most recent first, to pick from
//   orbit.add        what a new tab should show (the picker, as a dialog)
//   orbit.settings   the look settings ("Orbit look settings", in the right pane)
// - The other orbit mods' asks (look.js ask): the only writer of
//   "orbit.sides", "orbit.settings" and the layout file is this mod.
// Put it in the layout as a small block:
//   { "id": "orbit", "type": "block", "size": { "px": 4 }, "content": { "mod": "orbit" } }

import { View, div } from "gpui-kit";
import { spaces, run, shared, setShared, nextCommand, openOverlay, watchFolder, appHome, theme, layout, focused, panes, readTextFile } from "herdr";
import { state, leftTabs, rightEntries, entries, shownEntry, LEFT_TAB, FRAME } from "./sides.js";
import { save, show, showRight, close, closeAsked, cancelAsk, newTerminal, newMod, openPending, dropPending, move, toggleSplit, toggleSidePanel, renameEntry, reorderRight } from "./actions.js";
import { apply, closePanelView, renamePanelView, movePanelView, addPanelView, share } from "./layout.js";
import { find } from "./look.js";
import { follow } from "./split.js";
import { identity, spaceKey, lookUpRepos, publish } from "./identity.js";

// The look settings (orbit-dialogs' "settings"), in the shown space's right
// pane, as other views open there: shown again if that space has it already.
export const SETTINGS_TITLE = "Orbit look settings";
export async function openSettings(cx) {
  const space = spaces().find((s) => s.active);
  if (!space) return;
  const had = state().mods.find((m) => m.space === space.id && m.mod === "orbit-dialogs" && m.props?.dialog === "settings");
  if (had) { showRight(space, had.id); return; }
  await newMod(cx, space, "right", SETTINGS_TITLE, "orbit-dialogs", { dialog: "settings" });
}

// This build's version, also in shared "orbit.version" (shared.json in
// herdr-app's home), so you can see which one you have.
export const VERSION = 3;

const RECENT = "orbit.recent";

// The shipped themes' old names (before they were called by their palettes),
// and their names now.
const OLD_THEMES = { orbit: "tokyo-night", ...Object.fromEntries(["catppuccin-mocha", "everforest", "gruvbox-dark",
  "kanagawa", "nord", "rose-pine"].map((t) => [`orbit-${t}`, t])) };

// A theme picked for this layout under an old name is picked again under its
// new one (install.sh does it too, when it can).
async function renameTheme(cx) {
  // A moment first: herdr-app takes up newly copied theme files.
  await cx.sleep(3);
  const text = await readTextFile(`${appHome()}/layouts/.state/orbit.json`);
  if (!text) return;
  let picks = null;
  try { picks = JSON.parse(text).theme; } catch (_) { return; }
  for (const v of new Set(Object.values(picks ?? {}))) {
    if (OLD_THEMES[v]) run("app.theme", { name: OLD_THEMES[v] });
  }
}

// Space ids, most recently shown first.
export function recent() {
  const ids = new Set(spaces().map((s) => s.id));
  return (shared(RECENT) ?? []).filter((id) => ids.has(id));
}

export default class Orbit extends View {
  init(_props, cx) {
    if (shared("orbit.version") !== VERSION) setShared("orbit.version", VERSION);
    cx.spawn(async (cx) => { try { await renameTheme(cx); } catch (e) { console.log(`orbit: ${e}`); } });
    this.focus = null; // the outline colour last written
    // Both loops use cx each time round: herdr ends a loop at its next cx use
    // once this block is gone (another layout shown), and without one they
    // would spin on.
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(1);
        try { await apply(undefined, true); } catch (e) { console.log(`orbit: ${e}`); }
        await watchFolder(`${appHome()}/layouts`);
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(1);
        const name = await nextCommand();
        // An ask from another orbit mod: "<what> <args as JSON>". Each runs
        // on its own (a new terminal waits for herdr; the keys don't).
        const sp = name.indexOf(" ");
        if (sp > 0) {
          let args = null;
          try { args = JSON.parse(name.slice(sp + 1)); } catch (_) { continue; }
          cx.spawn(async (cx) => { try { await this.asked(name.slice(0, sp), args, cx); } catch (e) { console.log(`orbit: ${e}`); } });
          continue;
        }
        try { await this.command(name, cx); } catch (e) { console.log(`orbit: ${e}`); }
      }
    });
    this.born = Date.now();
    this.sent = {};
    cx.timer.every(250, () => this.sync(cx));
  }

  // Runs a layout command unless the same one went out just now (the layout
  // answers a moment later).
  once(name, args) {
    const key = name + JSON.stringify(args);
    const now = Date.now();
    if (this.sent[key] && now - this.sent[key] < 800) return;
    this.sent[key] = now;
    run(name, args);
  }

  // What the other mods draw with, worked out here once: the spaces' colours
  // and symbols, the look, the tab rows' places (identity.js, layout.js).
  shareAll(cx) {
    try { lookUpRepos(cx); publish(); share(); } catch (e) { console.log(`orbit: ${e}`); }
  }

  sync(cx) {
    this.shareAll(cx);
    const L = layout();
    if (!find(L, "left") || !find(L, "right")) return;
    const space = spaces().find((s) => s.active);
    if (!space) return;
    // The shown space's split (split.js).
    follow(L, space.id, new Set(spaces().map((s) => s.id)), Date.now() - this.born > 10000);
    const ps = panes();
    let st = state();
    // Each space keeps its pane with the keys: leaving one notes it, coming
    // back gives it again (a terminal there gets herdr's keys too), while
    // herdr's own focus settles on the space's tab, which isn't the keys moving.
    const gone = (id) => find(L, id)?.hidden === true;
    if (this.keysSpace !== space.id) {
      const by = { ...(st.keysBy ?? {}) };
      if (this.keysSpace) by[this.keysSpace] = st.focus;
      this.keysSpace = space.id;
      const want = by[space.id] ?? "left";
      const there = want === "right" ? rightEntries(space, st, ps).some((e) => e.kind !== "pick") && !st.folded[space.id]
        : want === "panel" ? !gone("panel") : true;
      const focus = there ? want : "left";
      save({ keysBy: by, focus });
      st = state();
      this.hold = Date.now() + 1000;
      if (focus === "right") {
        const e = shownEntry(space, "right");
        if (e?.kind === "term") run("pane.focus", { terminal: e.pane.terminal });
      }
    }
    // Gone: a right terminal that ended, a mod of a closed space (not in the
    // first seconds, while herdr is still loading what's there).
    if (Date.now() - this.born > 10000 && ps.length) {
      const live = new Set(ps.map((p) => p.terminal).filter(Boolean));
      const ids = new Set(spaces().map((s) => s.id));
      const right = Object.fromEntries(Object.entries(st.right).filter(([, term]) => live.has(term)));
      const mods = st.mods.filter((m) => ids.has(m.space));
      if (Object.keys(right).length !== Object.keys(st.right).length || mods.length !== st.mods.length) {
        save({ right, mods });
        st = state();
      }
    }
    // The left keeps a tab: when its last one went, the right's first comes back.
    if (!leftTabs(space, st).length) {
      const first = rightEntries(space, st, ps).find((e) => e.kind === "term");
      if (first) {
        const right = { ...st.right };
        delete right[first.tab.id];
        save({ right });
        st = state();
      }
    }
    const active = space.tabs.find((t) => t.active);
    const right = find(L, "right"), rightFrame = find(L, FRAME.right) ?? right;
    if (active && st.right[active.id]) {
      // herdr showed a right tab (an agent from the list or an alert, a key):
      // the left shows its own again, the right shows that terminal, focused.
      const back = leftTabs(space, st).find((t) => t.id === st.last[space.id]) ?? leftTabs(space, st)[0];
      if (back) this.once("tab.select", { id: back.id });
      const e = rightEntries(space, st, ps).find((x) => x.kind === "term" && x.tab.id === active.id);
      if (e) showRight(space, e.id);
      return;
    }
    if (active && st.last[space.id] !== active.id && find(L, "left").active === LEFT_TAB) {
      save({ last: { ...st.last, [space.id]: active.id } });
      st = state();
    }
    // The shown space's right pane: its pick, or hidden with none.
    const list = rightEntries(space, st, ps);
    if (!list.length || st.folded[space.id]) {
      if (!rightFrame.hidden) this.once("layout.hide", { id: rightFrame.id });
    } else {
      const want = list.find((e) => e.id === st.shown[space.id]) ?? list[0];
      if (rightFrame.hidden) this.once("layout.show", { id: rightFrame.id });
      if (right.active !== want.id && find(L, want.id)) this.once("layout.select", { stack: "right", child: want.id });
    }
    // Which pane has the keys. Only a change of herdr's focus counts: a
    // picker or a mod in a pane has the keys without herdr saying so (the
    // rows watch presses for that), and while the pane with the keys shows
    // one, a change of herdr's focus (a layout written again, a space switch)
    // is herdr losing track, not the keys moving.
    const f = focused();
    let side = null;
    if (f?.pane) side = st.right[ps.find((p) => p.pane === f.pane)?.tab] ? "right" : "left";
    else if (f?.terminal) side = Object.values(st.right).includes(f.terminal) ? "right" : "left";
    const fk = `${f?.pane}|${f?.terminal}`;
    if (fk !== this.fk) {
      this.fk = fk;
      const at = st.focus === "panel" ? null : shownEntry(space, st.focus);
      const blind = st.focus === "panel" || at?.kind === "mod" || at?.kind === "pick";
      if (side && side !== st.focus && !blind && Date.now() > (this.hold ?? 0)) save({ focus: side });
    }
    // The keys' pane put away (the split, the panel): the left has them. The
    // panel given the keys is shown a moment after, so it counts as gone only
    // once that moment has passed.
    if (st.focus === "panel" && this.panelKeys !== true) { this.panelKeys = true; this.panelHold = Date.now() + 1500; }
    if (st.focus !== "panel") this.panelKeys = false;
    const rightAway = !rightEntries(space, st, ps).length || st.folded[space.id];
    const panelAway = gone("panel") && Date.now() > (this.panelHold ?? 0);
    if ((st.focus === "right" && rightAway) || (st.focus === "panel" && panelAway)) save({ focus: "left" });
    if (state().focus !== this.drawnSide) this.redraw(cx);
    // A space switch: the picks of the space shown before don't carry over.
    if (this.space !== space.id) {
      this.space = space.id;
      const leftWant = st.pending[space.id] === "left" ? "left-pick" : LEFT_TAB;
      if (find(L, "left").active !== leftWant) this.once("layout.select", { stack: "left", child: leftWant });
    }
  }

  async command(name, cx) {
    const active = spaces().find((s) => s.active);
    if (find(layout(), "left") && active && await this.paneCommand(name, active, cx)) return;
    if (name === "recent") {
      const back = recent().find((id) => id !== active?.id);
      if (back) run("space.select", { id: back });
    } else if (name === "switcher") {
      openOverlay({ mod: "orbit-dialogs", kind: "dialog", frame: "none", width: 560, props: { dialog: "switcher" } });
    } else if (name === "settings") {
      await openSettings(cx);
    } else if (name === "add") {
      openOverlay({ mod: "orbit-add", kind: "dialog", frame: "none", width: 640, height: 480, props: { space: active?.id } });
    }
  }

  // The two panes' keys, on the focused pane (sides.js). True: handled.
  async paneCommand(name, space, cx) {
    const st = state();
    const side = st.focus === "right" && rightEntries(space, st).length && !st.folded[space.id] ? "right" : "left";
    const list = entries(space, side, st);
    const shown = shownEntry(space, side);
    const at = shown ? list.findIndex((e) => e.id === shown.id) : -1;
    if (/^tab[1-9]$/.test(name)) {
      const e = list[Number(name.slice(3)) - 1];
      if (e) { show(space, side, e); return true; }
      if (side === "left") openOverlay({ mod: "orbit-dialogs", kind: "dialog", frame: "none", width: 420, height: 250, props: { dialog: "new-tab", space: space.id, index: Number(name.slice(3)) } });
      return true;
    }
    if (name === "next" || name === "prev") {
      if (list.length) show(space, side, list[(at + (name === "next" ? 1 : list.length - 1) + list.length) % list.length]);
      return true;
    }
    if (name === "new") { await newTerminal(cx, space, side); return true; }
    if (name === "window") { openPending(space, side); return true; }
    if (name === "right") { openPending(space, "right"); return true; }
    if (name === "close") { await close(cx, space, side, shown); return true; }
    if (name === "split") { await toggleSplit(cx, space); return true; }
    if (name === "side-panel") { toggleSidePanel(); return true; }
    if (name === "move") { await move(cx, space, side, shown); return true; }
    if (name === "left-pane" || name === "right-pane") {
      const to = name === "left-pane" ? "left" : "right";
      const e = shownEntry(space, to) ?? entries(space, to)[0];
      if (to === "right" && !rightEntries(space).length) return true;
      if (e) show(space, to, e);
      return true;
    }
    return false;
  }

  // What the other orbit mods ask for (look.js ask): their rows, the
  // picker, the dialogs. `a.space` is a space id (else the shown space),
  // `a.side` "left" | "right", `a.id` an entry of that side's row (sides.js).
  async asked(what, a, cx) {
    const space = spaces().find((s) => s.id === a.space) ?? spaces().find((s) => s.active);
    if (!space) return;
    const entry = () => entries(space, a.side).find((e) => e.id === a.id);
    switch (what) {
      case "focus": if (state().focus !== a.side) save({ focus: a.side }); return;
      case "show": return show(space, a.side, entry());
      case "close": return close(cx, space, a.side, entry());
      case "close-asked": return closeAsked(cx, space.id, a.side, a.id);
      case "cancel-ask": return cancelAsk();
      case "new-terminal": return newTerminal(cx, space, a.side, a.extra ?? {});
      case "new-mod": return newMod(cx, space, a.side, a.title, a.mod, a.props ?? null);
      case "pending": return openPending(space, a.side);
      case "drop-pending": return dropPending(cx, space, a.side);
      case "split": return toggleSplit(cx, space);
      case "rename": return renameEntry(a.side, entry(), a.name);
      case "reorder": return reorderRight(space, a.from, a.to);
      case "view-close": return closePanelView(a.id);
      case "view-rename": return renamePanelView(a.id, a.name);
      case "view-move": return movePanelView(a.id, a.to);
      case "view-add": return addPanelView(cx, { title: a.title, mod: a.mod, props: a.props ?? null });
      // The look settings only (the settings dialog): the panel's views are
      // its tab row's to change.
      case "settings": return apply(Object.fromEntries(Object.entries(a).filter(([k]) => ["density", "rounding", "gap", "tabs", "background"].includes(k))));
    }
  }

  // Writes the layout for the pane with the keys and the outline colour, one
  // write at a time: one begun before the keys moved would otherwise land
  // last with the old colours. Again while either changed during a write.
  redraw(cx) {
    if (this.drawing) { this.again = true; return; }
    this.drawing = true;
    cx.spawn(async () => {
      try {
        do {
          this.again = false;
          this.drawnSide = state().focus;
          const colour = this.focus;
          await apply();
          if (state().focus !== this.drawnSide || colour !== this.focus) this.again = true;
        } while (this.again);
      } catch (e) {
        console.log(`orbit: ${e}`);
      } finally {
        this.drawing = false;
      }
    });
  }

  // Runs on every change of spaces: the shown one goes to the front of the
  // recent ones, and its colour becomes the outline.
  render(cx) {
    const surface = theme().surface;
    const active = spaces().find((s) => s.active);
    const focus = active ? identity(spaceKey(active)) : this.focus;
    if ((this.surface !== undefined && this.surface !== surface) || focus !== this.focus) {
      this.focus = focus;
      this.redraw(cx);
    }
    this.surface = surface;
    // A space switch shows its right pane at once, not at the next tick (and
    // shares the spaces' colours).
    if (this.sent) this.sync(cx);
    else this.shareAll(cx);
    const now = active?.id;
    const list = recent();
    if (now && list[0] !== now) setShared(RECENT, [now, ...list.filter((id) => id !== now)]);
    return div();
  }
}
