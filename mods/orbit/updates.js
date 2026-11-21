// Update notices for the look itself (not for Herdr: Herdr shows its own).
//
// The check: at most once a day while the look runs, one GET of the repo's
// latest release on GitHub's public API, without a login, with a generic
// User-Agent and nothing about the person or their machine. Its answer, the
// time and the release whose card was closed are kept in herdr-app's home
// (data/orbit-updates/state.json). A failed check is silent and tried again
// the next day. The setting "update notices" off (shared "orbit.settings"
// `updates: false`) stops the check and hides the card.
//
// The card (orbit-dialogs' "update"): a window overlay at the bottom right,
// shown while the latest release is newer than this copy (mods/orbit/VERSION)
// and its card wasn't closed. Closing it remembers that release, so each
// release shows once; "stop notifications" turns the setting off.
//
// "update" (asked here: update-apply) runs update.py apply, detached: it
// replaces the look's files only when they hash to what VERSION records (no
// one changed them), and keeps the previous copy. Its answer lands in
// data/orbit-updates/result.json, read here every two seconds, since the
// update reloads this mod midway. The card then says "Updated to Orbit x"
// (with "undo": update-undo), or one error line; for a changed copy, a button
// that copies a prompt for an agent instead.
//
// Where it sits: above the status bar with the look's gap, and never where
// Herdr draws its own notices. Herdr puts those at the window's bottom right,
// 16 px in, from the bottom up: its update pill (34 px tall: "Herdr 0.x is
// ready · Restart", or "Updated to 0.x" after an update), each toast (72 px,
// 8 px apart, above the pill's place when it shows), then a herdr-core update
// error. A mod can't tell whether the pill is showing (it can be closed, and
// "Updated to" has no flag), so the card always keeps clear of the pill's
// place, of every toast open now (orbit-toast lists them in shared
// "orbit.toasts") and of the core error while there is one: its bottom is the
// look's gap above the highest of those and of the status bar. It moves when
// they change, and with the window's size, the zoom and the look.
//
// Install: install.sh --updates on|off writes data/orbit-updates/ask, which is
// taken up here once (the installing agent asks the person).

import { checking, shared, setShared, appHome, readTextFile, writeTextFile, exec, openOverlay, closeOverlay, updates as herdrUpdates, settings as appSettings } from "herdr";
import { settings, lookOf, apply } from "./layout.js";

export const REPO = "https://github.com/Calonca/herdr-orbit-look";
const API = "https://api.github.com/repos/Calonca/herdr-orbit-look/releases/latest";
// Where a release's archive may come from (the answer's tarball_url);
// update.py checks it again, and every redirect (ALLOWED there).
const ARCHIVES = ["https://api.github.com/repos/Calonca/herdr-orbit-look/tarball/", "https://codeload.github.com/Calonca/herdr-orbit-look/"];
const CARD = "orbit.update.card";
const DAY = 24 * 60 * 60 * 1000;
const WIDTH = 280;
// Herdr's own notices (its frame, src/window.rs): 16 px from the window's
// right and bottom; the update pill 34 px tall; toasts 72 px, 8 px apart; the
// core error one line of 13 px text with 12 px padding.
const HERDR = { edge: 16, pill: 34, toast: 72, apart: 8, error: 44 };

const dir = () => `${appHome()}/data/orbit-updates`;

// "v0.5.0" -> [0, 5, 0]; null if it isn't a version.
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

export function newer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// The note lines: the release's first bullets (its CHANGELOG entry), plain
// text, at most three.
export function noteLines(body) {
  const plain = (s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  const lines = String(body ?? "").split("\n");
  let out = lines.filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => plain(l.replace(/^\s*[-*]\s+/, "")));
  if (!out.length) out = lines.filter((l) => l.trim() && !/^\s*#/.test(l)).map(plain);
  return out.filter(Boolean).slice(0, 3);
}

// The prompt "copy update prompt" copies, for when the files were changed:
// one line, as the gallery's install line is.
export function prompt(tag) {
  return `Read ~/.config/herdr-app/AGENTS.md, then update the orbit layout to ${tag} from ${REPO} (read its RECIPE.md); my installed copy was changed, keep those changes`;
}

async function readJson(path) {
  try { return JSON.parse((await readTextFile(path)) ?? "null"); } catch (_) { return null; }
}

export class Updates {
  constructor() {
    this.state = null; // { checked, latest: { tag, notes, archive }, closed, seen }
    this.version = null; // this copy's (mods/orbit/VERSION's first line)
    this.result = null; // update.py's last answer (result.json)
    this.running = null; // { action, since }: update.py started from here and not answered yet
    this.card = null; // { id, key }: the open card and where it is
    this.checking = false;
  }

  async start(cx) {
    if (checking()) return; // herdr-app check: no request, no card
    // A card a copy of this mod opened before it was reloaded (an update
    // replaces this mod): its id is in shared "orbit.update.card".
    if (shared(CARD)) { closeOverlay(shared(CARD)); setShared(CARD, null); }
    this.version = ((await readTextFile(`${appHome()}/mods/orbit/VERSION`)) ?? "").split("\n")[0].trim() || null;
    if (this.version && shared("orbit.version") !== this.version) setShared("orbit.version", this.version);
    this.state = (await readJson(`${dir()}/state.json`)) ?? {};
    await this.takeResult(await readJson(`${dir()}/result.json`));
    await this.takeAsk();
    let tick = 0;
    cx.timer.every(500, () => {
      if (++tick % 4 === 0) this.readResult();
      this.place();
    });
    for (;;) {
      try { await this.takeAsk(); await this.check(false); } catch (e) { console.log(`orbit updates: ${e}`); }
      await cx.sleep(10 * 60 * 1000);
    }
  }

  on() {
    return settings().updates !== false;
  }

  // One write at a time, each of the whole state as it is then (a check and
  // a close can land together).
  save(change) {
    this.state = { ...this.state, ...change };
    const write = async () => {
      await exec("mkdir", ["-p", dir()]);
      const path = `${dir()}/state.json`;
      await writeTextFile(path, JSON.stringify(this.state, null, 2) + "\n", await readTextFile(path));
    };
    this.saving = (this.saving ?? Promise.resolve()).then(write, write);
    return this.saving;
  }

  // install.sh --updates on|off: the person's answer, taken up once.
  async takeAsk() {
    const path = `${dir()}/ask`;
    const ask = ((await readTextFile(path)) ?? "").trim();
    if (ask !== "on" && ask !== "off") return;
    if ((ask === "on") !== this.on()) await apply({ updates: ask === "on" });
    await exec("rm", ["-f", path]);
  }

  async readResult() {
    if (this.reading) return;
    this.reading = true;
    try {
      const r = await readJson(`${dir()}/result.json`);
      if (r?.at && r.at !== this.result?.at) await this.takeResult(r);
    } finally {
      this.reading = false;
    }
  }

  // update.py's answer, new here (read on start too: an update or undo
  // reloads this mod, often before it answers).
  async takeResult(r) {
    this.result = r;
    if (!r?.at) return;
    if (this.running && r.at >= this.running.since) this.running = null;
    // An undo: the release it went back from doesn't come up again.
    if (r.ok && r.action === "undo" && r.at > (this.state?.seen ?? 0) && this.state?.latest?.tag) {
      await this.save({ closed: this.state.latest.tag, seen: r.at });
    }
  }

  // The latest release, unless the last look was less than a day ago (`now`:
  // look anyway, still only with the setting on).
  async check(now) {
    if (!this.on() || this.checking) return;
    if (!now && Date.now() - (this.state?.checked ?? 0) < DAY) return;
    this.checking = true;
    try {
      // tools/regress.py points this at a local fake (shared "orbit.update.api").
      const fake = shared("orbit.probe") === true && shared("orbit.update.api");
      const url = fake || API;
      let latest = this.state?.latest ?? null;
      try {
        const r = await fetch(url, { headers: { "User-Agent": "herdr-orbit-look", Accept: "application/vnd.github+json" } });
        if (r.ok) {
          const j = await r.json();
          const archive = typeof j?.tarball_url === "string" && (fake || ARCHIVES.some((a) => j.tarball_url.startsWith(a))) ? j.tarball_url : null;
          if (j?.tag_name && !j.draft && !j.prerelease) latest = { tag: j.tag_name, notes: noteLines(j.body), archive };
        }
      } catch (_) { /* offline, or GitHub said no: the next day */ }
      await this.save({ checked: Date.now(), latest });
    } finally {
      this.checking = false;
    }
  }

  // What the card shows now, or null: { mode, tag, ... }.
  //   "updated"  update.py replaced the look (this copy is the new one)
  //   "working"  update.py is at it
  //   "error"    it didn't (code: "changed" for a changed copy)
  //   "due"      a newer release
  due() {
    const r = this.result;
    const fresh = r?.at && r.at > (this.state?.seen ?? 0);
    if (fresh && r.ok && r.action === "apply") return { mode: "updated", tag: r.to, from: r.from, at: r.at };
    const latest = this.state?.latest;
    if (!this.on() || !latest?.tag || !this.version || !newer(latest.tag, this.version)) return null;
    if (this.running) return { mode: "working", ...latest };
    if (fresh && r.error && r.action === "apply" && r.tag === latest.tag) return { mode: "error", code: r.error, error: r.message, at: r.at, ...latest };
    if (this.state.closed === latest.tag) return null;
    return { mode: "due", ...latest };
  }

  // The card closed (×): its release won't show again, nor the answer it showed.
  async close(tag) {
    this.hide();
    const seen = Math.max(this.state?.seen ?? 0, this.result?.at ?? 0);
    if (this.state?.closed !== tag || this.state?.seen !== seen) await this.save({ closed: tag, seen });
  }

  // "stop notifications": the setting off (the settings row turns it on again).
  async stop(tag) {
    await this.close(tag);
    await apply({ updates: false });
  }

  // "update": update.py replaces the look in a process of its own.
  async update(tag) {
    const latest = this.state?.latest;
    if (this.running || !latest || latest.tag !== tag) return;
    if (!latest.archive) {
      this.result = { error: "download", action: "apply", tag, message: "the release has no archive to download", at: Date.now() };
      return;
    }
    await this.run("apply", [latest.archive, tag]);
  }

  // "undo": the previous copy back.
  async undo() {
    if (this.running) return;
    const seen = this.result?.at ?? 0;
    if (seen) await this.save({ seen });
    this.hide();
    await this.run("undo", []);
  }

  async run(action, args) {
    this.running = { action, since: Date.now() - 1000 };
    try {
      const r = await exec("python3", [`${appHome()}/mods/orbit/update.py`, action, appHome(), ...args, "--detach"], { timeout: 15000 });
      if (r.code !== 0) throw new Error(r.stderr.trim() || `update.py ${action}: ${r.code}`);
    } catch (e) {
      this.running = null;
      this.result = { error: "failed", action, tag: args[1], message: `couldn't start the update: ${e.message ?? e}`, at: Date.now() };
    }
  }

  hide() {
    if (this.card) closeOverlay(this.card.id);
    if (this.card && shared(CARD)) setShared(CARD, null);
    if (this.card && shared("orbit.probe") === true) setShared("orbit.probe.update", null);
    this.card = null;
  }

  // The card's height (its own lengths, which herdr-app zooms): orbit-dialogs'
  // update.js draws to these. `lines`: the notes, or the one error line.
  static height(lines) {
    return 14 + 20 + (lines ? 4 + 18 * lines : 0) + 12 + 28 + 14;
  }

  static lines(card) {
    if (card.mode === "updated") return 0;
    if (card.mode === "error") return 1;
    return Math.min(3, card.notes?.length ?? 0);
  }

  // Where the card goes (window pixels), or null.
  rect(card) {
    const view = globalThis.window?.viewport_size?.();
    if (!view?.width) return null;
    const z = appSettings()?.zoom || 1;
    const L = lookOf();
    const gap = Math.round((L.gap || 0) * z);
    const apart = L.gap ? gap : Math.round(HERDR.apart * z);
    // The status bar's top (orbit-status' glass.js orbitPlace).
    const bar = Math.round(Math.max(4, L.gap || 0) * z) + Math.round(L.status * z);
    // The top of Herdr's notices at their highest: the pill's place, the toasts open now, the core error.
    // (One listed for longer than two minutes was left by a quit, not on screen.)
    const toasts = Object.values(shared("orbit.toasts") ?? {}).filter((at) => Date.now() - at < 120000).length;
    let herdr = (HERDR.edge + HERDR.pill) * z + toasts * (HERDR.apart + HERDR.toast) * z;
    if (herdrUpdates()?.core?.error) herdr += (HERDR.apart + HERDR.error) * z;
    const bottom = Math.max(bar, Math.ceil(herdr)) + apart;
    const h = Updates.height(Updates.lines(card));
    return { x: Math.round(view.width - (L.gap ? gap : apart) - WIDTH * z), y: Math.round(view.height - bottom - h * z), h };
  }

  // Opens, moves or closes the card to match.
  place() {
    const card = this.due();
    const r = card && this.rect(card);
    if (!r || r.y < 0) return this.hide();
    const key = `${card.mode}|${card.tag}|${card.at ?? ""}|${r.x}|${r.y}|${r.h}`;
    if (this.card?.key === key) return;
    const old = this.card;
    const id = openOverlay({ mod: "orbit-dialogs", kind: "window", frame: "none", width: WIDTH, height: r.h, at: { x: r.x, y: r.y },
      props: { dialog: "update", mode: card.mode, tag: card.tag, version: String(card.tag).replace(/^v/, ""), from: card.from ?? this.version,
        notes: card.notes ?? [], code: card.code ?? null, error: card.error ?? null, prompt: prompt(card.tag) } });
    if (old) closeOverlay(old.id);
    this.card = { id, key };
    setShared(CARD, id);
    if (shared("orbit.probe") === true) setShared("orbit.probe.update", { ...r, w: WIDTH, tag: card.tag, mode: card.mode, id });
  }
}
