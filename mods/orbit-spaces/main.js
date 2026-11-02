// The sidebar of spaces (a clone of herdr-app's spaces mod, restyled): a
// header per machine, "Local" first; each space with its identity symbol (filled
// by its agents' state), its name, and its branch and ahead/behind under it;
// worktrees hung from their repo with tree lines, foldable. Click to switch,
// right-click for its menu, drag to reorder.
//
// Derived from herdr-app's `spaces` mod (Apache-2.0) and changed: restyled
// rows, identity symbols and colours, worktrees under their repo, the glass
// background.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { look, glass, spaceLook, spaceSymbol } from "./look.js";
import { backdrop, orbitPlace, orbitRadius } from "./glass.js";
import { spaces, machines, panes, run, openOverlay, exec, hc, theme, shared, setShared, watchFolder, window } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
// A row's first line, a further line, the symbol's centre and the gap from
// it to the label.
let LINE = 27, SUB = 16, GAP = 15, K = 1, R = 4;
const DOT_X = 14;
const sz = (n) => Math.round(n * K);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// Why a machine can't be reached.
const AWAY = {
  unreachable: "unreachable: the machine is off, asleep, or on another network",
  refused: "ssh connection refused: is the ssh server running there, on that port?",
};

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    // A render herdr-app cut off (over its 50 ms, e.g. when a garbage
    // collection lands in it) leaves an error banner until the next render;
    // one that never reached its end is retried here.
    this.unfinished = false;
    cx.timer.every(1000, (cx) => { if (this.unfinished) { this.unfinished = false; cx.notify(); } });
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.foldedRepos = new Set(JSON.parse(localStorage.getItem("repos.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      const r = await exec("git", ["--no-optional-locks", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      const first = r.g && !r.g.linked && !placed.has(r.g.repo);
      const kids = first ? list.filter((k) => nested(k) && k.g.repo === r.g.repo) : [];
      out.push({ ...r, tree: null, kids: kids.length });
      if (!first) continue;
      placed.add(r.g.repo);
      if (this.foldedRepos.has(r.g.repo)) continue;
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─", last: n === kids.length - 1 }));
    }
    return out;
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(sz(12)).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    return [null, ...remote].flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find(k => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.folded.has(m);
      const state = machine?.state ?? "unreachable";
      const why = AWAY[state] ?? state.replace(/_/g, " ");
      const head = h_flex().id(`machine-${m ?? "local"}`).h(LINE).flex_none().px(4).gap(8).items_center().rounded(R)
        .text_size(sz(16)).text_color(t.foreground).hover(s => s.bg(t.foreground.slice(0, 7) + "1a"))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(div().w(14).flex_none().text_size(sz(15)).text_color(t.muted).child(folded ? "\u25b8" : "\u25be"))
        .child(div().flex_1().truncate().font_semibold().child(m ?? "Local"))
        .when(!connected, el => el.child(div().flex_none().text_size(sz(15)).text_color(t.ansi1).child("! attention")));
      const note = !connected && !folded
        ? [div().pl(24).pr(8).pb(6).text_size(sz(15)).text_color(t.muted).child(why)]
        : [];
      const body = folded || !connected ? [] : mine.length ? mine.map(draw) : loading(m) ? [loadingRow(m)] : [];
      return [head, ...note, ...body];
    });
  }

  // A space's colour and symbol come from the orbit mod (shared
  // "orbit.identity"): its name, but a worktree and the main checkout it
  // hangs from share their repo's (its git dir).

  // A space's row: the symbol (grey, filled by its agents' state) and
  // the name; under it the branch and how far it is ahead or behind. The shown
  // space's row takes its identity colour: a band behind it, its name bold in
  // it. A worktree is one line, hung from its repo's symbol.
  row({ w, i, g, tree, kids, last }, t) {
    const on = w.active;
    const nested = Boolean(tree);
    const { color } = spaceLook(w);
    const two = !nested && Boolean(g);
    const h = nested ? LINE - 3 : two ? LINE + SUB - 2 : LINE;
    const r = nested ? 12 : 14; // the symbol's box
    const dotX = nested ? DOT_X + GAP + 4 : DOT_X;
    const lineColor = t.muted.slice(0, 7) + "73";
    const folded = this.foldedRepos.has(g?.repo);
    const stub = last ? DOT_X + 4 : DOT_X;
    const symbol = div().absolute().left(dotX - r / 2).top((nested ? h : LINE) / 2 - r / 2).size(r)
      .child(spaceSymbol(w, r, on ? (t.idle ?? t.foreground) : t.muted, "sidebar"));
    const ident = color.slice(0, 7);
    return div()
      .relative()
      .id(`space-${w.id}`)
      .h(h)
      .flex_none()
      .rounded(R)
      .when(on, (el) => el.bg(ident + "29"))
      .when(!on, (el) => el.hover((s) => s.bg(t.foreground.slice(0, 7) + "1a")))
      .when(this.pressed !== null && this.over === i && this.pressed !== i, (el) => el.border_t(2).border_color(t.accent))
      .on_mouse_down("left", () => {
        this.pressed = i;
        this.over = i;
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        this.pressed = null;
        if (from !== null && from !== i) run("space.move", { id: spaces()[from].id, index: i + 1 });
        else run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      // Tree lines: down from the repo's symbol, and across to each worktree's.
      .when(kids > 0 && !folded, (el) => el.child(div().absolute().left(DOT_X).top(LINE / 2 + 8).bottom(0).w(1).bg(lineColor)))
      .when(nested, (el) => el
        .child(div().absolute().left(DOT_X).top(0).h(last ? h / 2 - 4 : h).w(1).bg(lineColor))
        .when(last, (el) => el.child(div().absolute().left(DOT_X).top(h / 2 - 5).size(5).border_l(1).border_b(1).rounded_bl(4).border_color(lineColor)))
        .child(div().absolute().left(stub).top(h / 2).h(1).w(dotX - r / 2 - 2 - stub).bg(lineColor)))
      .child(symbol)
      .child(h_flex().absolute().left(dotX + GAP).right(kids > 0 ? 28 : 8).top(0).h(nested ? h : LINE).items_center()
        .text_size(sz(nested ? 15 : 16)).text_color(on ? ident : t.ansi7).when(on, (el) => el.font_bold())
        .child(div().min_w(0).truncate().child(w.name)))
      .when(two, (el) => el.child(h_flex().absolute().left(dotX + GAP).right(8).top(LINE - 3).h(SUB).items_center().gap(5)
        .text_size(sz(14)).text_color(on ? t.ansi5 : t.muted.slice(0, 7) + "9e")
        .child(div().min_w(0).truncate().child(g.branch ?? "detached"))
        .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`↑${g.ahead}`)))
        .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`↓${g.behind}`)))))
      .when(kids > 0, (el) => el.child(div().id(`fold-${w.id}`).absolute().right(4).top(LINE / 2 - 10).size(20).rounded(3)
        .flex().items_center().justify_center().text_size(sz(15)).text_color(t.accent).hover((s) => s.bg(t.foreground.slice(0, 7) + "1a"))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_mouse_up("left", (_e, cx) => {
          cx.stop_propagation();
          this.pressed = null;
          folded ? this.foldedRepos.delete(g.repo) : this.foldedRepos.add(g.repo);
          localStorage.setItem("repos.folded", JSON.stringify([...this.foldedRepos]));
          cx.notify();
        })
        .child(folded ? "▸" : "▾")));
  }

  compact({ w, i }, t) {
    return h_flex()
      .id(`space-${w.id}`)
      .h(26)
      .flex_none()
      .justify_center()
      .gap(4)
      .when(w.active, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().text_color(tone(t, w.status)).child(glyph(w.status)));
  }

  render() {
    this.unfinished = true;
    const out = this.draw();
    this.unfinished = false;
    return out;
  }

  draw() {
    const t = theme();
    const L = look();
    K = L.scale; R = L.small;
    LINE = sz(27); SUB = sz(16); GAP = sz(15);
    const collapsed = shared("sidebar.collapsed") === true;
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    // The glass: the blurred background under the fill (glass.js).
    const at = orbitPlace(L, "sidebar-top", this.own);
    return v_flex().id("orbit-spaces").size_full().min_h(0).relative().text_size(sz(16))
      .on_size_change((size, cx) => { if (size.width !== this.own?.width || size.height !== this.own?.height) { this.own = size; cx.notify(); } })
      .child(backdrop({ x: at?.x, y: at?.y, w: this.own?.width, h: this.own?.height, radius: orbitRadius(L), corners: "tl tr", fill: glass(t) }))
      .child(v_flex().flex_1().min_h(0).px(11).pt(8).pb(14).gap(1).overflow_y_scrollbar()
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}
