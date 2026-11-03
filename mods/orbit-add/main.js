// "what should this window show?": the picker for a new tab. Type to
// filter, ↑/↓ to choose, Enter to open, Esc to close. With props {panel: true}
// (the orbit layout's side panel: its tab row's or the status bar's + ⠿) it
// picks what the panel shows instead: the views only, each picked one a tab
// of the panel. With props {side: "left" | "right"} it's the content of a
// pane's pending "new window" tab (sides.js): a pick opens in that pane,
// Esc puts back what it showed. A shell, the agents installed here (herdr's
// knownAgents), herdr's files, changes and agents, then the person's own list
// (orbit-windows.json in the app's folder, windows.js: any mod or command),
// herdr's settings, and "configure windows…" (copies a prompt for the
// person's agent to add to that list).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, theme, props, closeOverlay, spaces, panes, knownAgents, shared, setShared, layout, notify } from "herdr";
import { look, find, ask } from "./look.js";
import { readWindows, fill, configurePrompt, windowsPath } from "./windows.js";

const ICON = "mods/orbit-add";
const KNOWN = "orbit.add.known"; // the agents found last time
// Each pane's frame and its picker's place in its stack (sides.js).
const FRAME = { left: "left-frame", right: "right-frame" };
const PICK = { left: "left-pick", right: "right-pick" };

export default class OrbitAdd extends View {
  init(_props, cx) {
    this.filter = "";
    this.at = 0;
    // The agents found last time show at once (kept in shared state, so also
    // after a restart); looking them up again can take herdr-app a while, and
    // the rows update when it answers.
    // Agents are per machine (a space can be on another one).
    const machine = this.space()?.machine ?? "";
    const known = shared(KNOWN) ?? {};
    this.agents = known.agents?.[machine] ?? [];
    this.windows = { windows: [], error: null }; // the person's list (windows.js)
    const keep = (cx, change) => {
      Object.assign(this, change);
      const now = shared(KNOWN) ?? {};
      setShared(KNOWN, { agents: { ...now.agents, [machine]: this.agents } });
      cx.notify();
    };
    this.load(cx);
    this.input = InputState.new({ placeholder: "search" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(this.rows()[this.at], cx));
    if (this.panel() || this.side()) {
      // In the side panel or a pane it's kept while hidden: it takes the keys
      // each time it's shown.
      this.was = false;
      // The box that shows and hides is the pane's frame (its stack stays).
      const [box, stack, me] = this.panel() ? ["panel", "panel-body", "panel-pick"] : [FRAME[this.side()], this.side(), PICK[this.side()]];
      cx.timer.every(100, () => {
        const L = layout();
        const now = find(L, box) && !find(L, box).hidden && find(L, stack)?.active === me;
        // Each time it shows: the keys, a fresh search (it's the same picker,
        // kept while hidden), and the list read again (edits to the file show
        // without a restart).
        if (now && !this.was) {
          if (this.filter) { this.input.set_value(""); this.filter = ""; this.at = 0; cx.notify(); }
          this.input.focus();
          this.load(cx);
        }
        this.was = now;
      });
    } else {
      this.input.focus();
      cx.timer.after(300, () => this.input.focus());
    }
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      try {
        const agents = (await knownAgents({ on: this.space()?.machine ?? null })).filter((a) => a.installed);
        keep(cx, { agents: agents.map((a) => ({ name: a.name, key: a.key ?? null, run: a.run })) });
      } catch (_) {}
    });
  }

  // Reads orbit-windows.json (windows.js); a broken file shows its error
  // above the rows, and the rest of the picker works on.
  load(cx) {
    cx.spawn(async (cx) => {
      let next;
      try { next = await readWindows(); } catch (e) { next = { windows: [], error: String(e?.message ?? e) }; }
      if (JSON.stringify(next) !== JSON.stringify(this.windows)) { this.windows = next; cx.notify(); }
    });
  }

  space() {
    return spaces().find((s) => s.id === props()?.space) ?? spaces().find((s) => s.active);
  }

  folder() {
    const space = this.space();
    const tabs = new Set(space?.tabs.map((t) => t.id) ?? []);
    const ps = panes().filter((p) => tabs.has(p.tab) && p.cwd);
    return (ps.find((p) => p.focused) ?? ps[0])?.cwd ?? space?.folder ?? null;
  }

  panel() {
    return Boolean(props()?.panel);
  }

  side() {
    const side = props()?.side;
    return side === "left" || side === "right" ? side : null;
  }

  rows() {
    const space = this.space()?.id;
    const panel = this.panel();
    const side = this.side();
    // In a pane: a terminal or mod opens in that pane (the orbit mod opens
    // it there: look.js ask).
    const term = (extra) => () => side ? ask("new-terminal", { space, side, extra }) : run("tab.new", { space, ...extra });
    // In a tab, or (panel) in the side panel.
    const view = (name, mod, about, extra = {}) => ({ name, mark: "widget", about,
      open: () => panel
        ? ask("view-add", { title: name, mod, props: extra.props ?? null })
        : side ? ask("new-mod", { space, side, title: name, mod, props: extra.props ?? null })
        : run("tab.new", { space, name, mod, ...extra }) });
    const tabsOnly = panel ? [] : null;
    const all = [
      ...(tabsOnly ?? [{ name: "shell", mark: "terminal", about: "a new tab with a terminal", open: term({}) },
        ...this.agents.map((a) => ({ name: a.name.toLowerCase(), mark: "terminal", about: `a new tab running ${a.run.join(" ")}`,
          open: term({ name: a.key ?? a.name, argv: a.run }) }))]),
      // herdr-app's own: what its status bar opens, as a tab.
      { ...view("files", "files", "this space's files"), pill: "herdr" },
      { ...view("changes", "changes", "unpushed changes, file by file"), pill: "herdr" },
      { ...view("agents", "agents", "every agent and what it's doing"), pill: "herdr" },
      // The person's own (orbit-windows.json): a mod opens like the views
      // above, a command runs; "$folder" is this pane's folder.
      ...this.windows.windows.map((w) => {
        const about = w.about ?? (w.mod ? `the ${w.mod} mod` : w.command);
        const vars = { folder: this.folder() };
        const row = w.mod
          ? view(w.title, w.mod, about, w.props ? { props: fill(w.props, vars) } : {})
          : { name: w.title, mark: "widget", about,
            // The picker's tab goes first (what it showed comes back), then the
            // command: a dialog it opens stays on top.
            open: (cx) => {
              if (side) ask("drop-pending", { space, side });
              cx.spawn(async (cx) => { await cx.sleep(300); run(w.command, fill(w.args ?? {}, vars)); });
            } };
        return { ...row, icon: typeof w.icon === "string" && w.icon.endsWith(".svg") ? w.icon : null };
      }),
      ...(tabsOnly ?? [view("Orbit look settings", "orbit-dialogs", "orbit's look: theme, density, corners, gap, tab rows, background",
        { props: { dialog: "settings" } }),
      { name: "herdr settings", mark: "widget", about: "herdr-app's own: layouts, keys, machines", open: () => run("app.settings") }]),
      // Last: a prompt for the person's own agent to add to that list.
      { name: "configure windows…", mark: "widget", about: "add any mod here: copies a prompt for your agent", stay: true,
        open: (cx) => {
          cx.write_to_clipboard(configurePrompt());
          notify({ title: "Prompt copied", body: `Paste it to your agent, or edit ${windowsPath()}`, level: "info" });
        } },
    ];
    const f = this.filter.toLowerCase();
    return f ? all.filter((r) => `${r.name} ${r.about}`.toLowerCase().includes(f)) : all;
  }

  // A picked row opens; the dialog closes (the panel's picker hides the panel on Esc).
  go(row, cx) {
    // Enter reaches both the search field and the list: one pick per press.
    if (Date.now() - (this.lastGo ?? 0) < 300) return;
    this.lastGo = Date.now();
    if (row?.stay) return row.open(cx); // configure windows…: the picker stays
    if (this.side()) {
      if (!row) ask("drop-pending", { space: this.space()?.id, side: this.side() });
    } else if (this.panel()) {
      if (!row) run("layout.hide", { id: "panel" });
    } else {
      closeOverlay(props().overlay);
    }
    row?.open(cx);
  }

  render() {
    const t = theme();
    const rows = this.rows();
    this.at = Math.min(this.at, Math.max(0, rows.length - 1));
    const hint = (key, what) => h_flex().gap(5).child(div().text_color(t.accent).child(key)).child(div().child(what));
    // In a pane or the side panel, their frame and glass are its own.
    const boxed = !this.side() && !this.panel();
    return v_flex().id("orbit-add").track_focus(this.handle).size_full().min_h(0).p(18).gap(12).text_color(t.foreground)
      .when(boxed, (el) => el.bg(t.surface.slice(0, 7) + "f2").border(2).border_color(t.border).rounded(look().radius))
      .on_key_down((e, cx) => {
        if (e.key === "escape") return this.go(null, cx);
        if (e.key === "enter") return this.go(rows[this.at], cx);
        if (e.key === "down") this.at = (this.at + 1) % rows.length;
        else if (e.key === "up") this.at = (this.at + rows.length - 1) % rows.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().text_size(16).font_semibold().child(this.panel() ? "what should the panel show?" : "what should this window show?"))
      .when(Boolean(this.windows.error), (el) => el.child(div().text_size(12).text_color(t.ansi3).child(this.windows.error ?? "")))
      .child(Input.new(this.input).h(36).px(12).rounded(4).border(1).border_color(t.input).bg(t.chrome).text_size(14).text_color(t.foreground))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(rows.map((r, i) => {
        const on = i === this.at;
        return h_flex().id(`add-${i}`).h(32).px(10).gap(10).items_center().rounded(4).flex_none()
          .when(on, (el) => el.bg(t.accent).text_color(t.accent_foreground))
          .when(!on, (el) => el.hover((s) => s.bg(t.foreground.slice(0, 7) + "1a")))
          .on_click((_e, cx) => this.go(r, cx))
          .child(svg(r.icon ?? `${ICON}/${r.mark}.svg`).size(13).flex_none().text_color(on ? t.accent_foreground : t.muted))
          .child(div().flex_none().text_size(14).child(r.name))
          .when(Boolean(r.pill), (el) => el.child(div().flex_none().px(6).rounded(999).border(1)
            .border_color(on ? t.accent_foreground : t.border).text_size(11)
            .text_color(on ? t.accent_foreground : t.muted).child(r.pill)))
          .child(div().flex_1().min_w(0).truncate().text_right().text_size(13).text_color(on ? t.accent_foreground : t.muted).child(r.about));
      })))
      .child(h_flex().gap(18).text_size(12).text_color(t.muted)
        .child(hint("esc", "close")).child(hint("⏎", "open")).child(hint("↑↓", "choose")));
  }
}
