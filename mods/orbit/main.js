import { View, div } from "gpui-kit";
import { spaces, run, shared, setShared, nextCommand, openOverlay, watchFolder, appHome, theme, layout, focused, panes, readTextFile } from "herdr";
import { state, leftTabs, rightEntries, entries, shownEntry, LEFT_TAB, FRAME } from "./sides.js";
import { save, show, showRight, giveKeys, close, closeAsked, cancelAsk, newTerminal, newMod, openPending, dropPending, move, toggleSplit, toggleSidePanel, renameEntry, dropTab } from "./actions.js";
import { apply, closePanelView, renamePanelView, movePanelView, addPanelView, share } from "./layout.js";
import { find } from "./look.js";
import { follow } from "./split.js";
import { lookUpRepos, publish } from "./identity.js";
import { Updates } from "./updates.js";

export const SETTINGS_TITLE = "Orbit look settings";
export async function openSettings(cx) {
  const space = spaces().find((s) => s.active);
  if (!space) return;
  const had = state().mods.find((m) => m.space === space.id && m.mod === "orbit-dialogs" && m.props?.dialog === "settings");
  if (had) { showRight(space, had.id); return; }
  await newMod(cx, space, "right", SETTINGS_TITLE, "orbit-dialogs", { dialog: "settings" });
}

const RECENT = "orbit.recent";

const OLD_THEMES = { orbit: "tokyo-night", ...Object.fromEntries(["catppuccin-mocha", "everforest", "gruvbox-dark",
  "kanagawa", "nord", "rose-pine"].map((t) => [`orbit-${t}`, t])) };

async function renameTheme(cx) {
  await cx.sleep(3);
  const text = await readTextFile(`${appHome()}/layouts/.state/orbit.json`);
  if (!text) return;
  let picks = null;
  try { picks = JSON.parse(text).theme; } catch (_) { return; }
  for (const v of new Set(Object.values(picks ?? {}))) {
    if (OLD_THEMES[v]) run("app.theme", { name: OLD_THEMES[v] });
  }
}

export function recent() {
  const ids = new Set(spaces().map((s) => s.id));
  return (shared(RECENT) ?? []).filter((id) => ids.has(id));
}

export default class Orbit extends View {
  init(_props, cx) {
    this.updates = new Updates();
    if (shared("orbit.drag")) setShared("orbit.drag", null);
    cx.spawn(async (cx) => { try { await this.updates.start(cx); } catch (e) { console.log(`orbit updates: ${e}`); } });
    cx.spawn(async (cx) => { try { await renameTheme(cx); } catch (e) { console.log(`orbit: ${e}`); } });
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

  once(name, args) {
    const key = name + JSON.stringify(args);
    const now = Date.now();
    if (this.sent[key] && now - this.sent[key] < 800) return;
    this.sent[key] = now;
    run(name, args);
  }

  shareAll(cx) {
    try { lookUpRepos(cx); publish(); share(); } catch (e) { console.log(`orbit: ${e}`); }
  }

  sync(cx) {
    this.shareAll(cx);
    const L = layout();
    if (!find(L, "left") || !find(L, "right")) return;
    const space = spaces().find((s) => s.active);
    if (!space) return;
    follow(L, space.id, new Set(spaces().map((s) => s.id)), Date.now() - this.born > 10000);
    const ps = panes();
    let st = state();
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
      this.arrived = true;
    }
    if (Date.now() - this.born > 10000 && ps.length) {
      const live = new Set(ps.map((p) => p.terminal).filter(Boolean));
      const ids = new Set(spaces().map((s) => s.id));
      const right = Object.fromEntries(Object.entries(st.right).filter(([, term]) => live.has(term)));
      const mods = st.mods.filter((m) => ids.has(m.space));
      const tabs = new Set(spaces().flatMap((s) => s.tabs.map((t) => t.id)));
      const views = Object.fromEntries(Object.entries(st.views).filter(([id]) => tabs.has(id)));
      if (Object.keys(right).length !== Object.keys(st.right).length || mods.length !== st.mods.length || Object.keys(views).length !== Object.keys(st.views).length) {
        save({ right, mods, views });
        st = state();
      }
    }
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
    const list = rightEntries(space, st, ps);
    if (!list.length || st.folded[space.id]) {
      if (!rightFrame.hidden) this.once("layout.hide", { id: rightFrame.id });
    } else {
      const want = list.find((e) => e.id === st.shown[space.id]) ?? list[0];
      if (rightFrame.hidden) this.once("layout.show", { id: rightFrame.id });
      if (right.active !== want.id && find(L, want.id)) this.once("layout.select", { stack: "right", child: want.id });
      if (this.arrived && st.focus === "right") giveKeys(want);
    }
    if (this.arrived && st.focus === "left") giveKeys({ tab: active });
    this.arrived = false;
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
    if (st.focus === "panel" && this.panelKeys !== true) { this.panelKeys = true; this.panelHold = Date.now() + 1500; }
    if (st.focus !== "panel") this.panelKeys = false;
    const rightAway = !rightEntries(space, st, ps).length || st.folded[space.id];
    const panelAway = gone("panel") && Date.now() > (this.panelHold ?? 0);
    if ((st.focus === "right" && rightAway) || (st.focus === "panel" && panelAway)) save({ focus: "left" });
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

  async asked(what, a, cx) {
    if (what === "update-close") return this.updates.close(a.tag);
    if (what === "update-stop") return this.updates.stop(a.tag);
    if (what === "update-apply") return this.updates.update(a.tag);
    if (what === "update-undo") return this.updates.undo();
    if (what === "update-check") return this.updates.check(true);
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
      case "view-close": return closePanelView(a.id);
      case "view-rename": return renamePanelView(a.id, a.name);
      case "tab-drop": return a.side === "panel" ? movePanelView(a.id, a.before) : dropTab(cx, space, a.side, entry(), a.to, a.before ?? null);
      case "view-add": return addPanelView(cx, { title: a.title, mod: a.mod, props: a.props ?? null });
      case "settings": return apply(Object.fromEntries(Object.entries(a).filter(([k]) => ["density", "rounding", "gap", "tabs", "background", "notify", "updates", "opacity"].includes(k))));
    }
  }

  redraw(cx) {
    if (this.drawing) { this.again = true; return; }
    this.drawing = true;
    cx.spawn(async () => {
      try {
        do {
          this.again = false;
          const surface = this.surface;
          await apply();
          if (surface !== this.surface) this.again = true;
        } while (this.again);
      } catch (e) {
        console.log(`orbit: ${e}`);
      } finally {
        this.drawing = false;
      }
    });
  }

  render(cx) {
    const surface = theme().surface;
    const active = spaces().find((s) => s.active);
    const changed = this.surface !== undefined && this.surface !== surface;
    this.surface = surface;
    if (changed) this.redraw(cx);
    if (this.sent) this.sync(cx);
    else this.shareAll(cx);
    const now = active?.id;
    const list = recent();
    if (now && list[0] !== now) setShared(RECENT, [now, ...list.filter((id) => id !== now)]);
    return div();
  }
}
