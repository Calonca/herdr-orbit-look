import { checking, shared, setShared, appHome, readTextFile, writeTextFile, exec, openOverlay, closeOverlay, updates as herdrUpdates, settings as appSettings } from "herdr";
import { settings, lookOf, apply } from "./layout.js";

export const REPO = "https://github.com/Calonca/herdr-orbit-look";
const API = "https://api.github.com/repos/Calonca/herdr-orbit-look/releases/latest";
const ARCHIVES = ["https://api.github.com/repos/Calonca/herdr-orbit-look/tarball/", "https://codeload.github.com/Calonca/herdr-orbit-look/"];
const CARD = "orbit.update.card";
const DAY = 24 * 60 * 60 * 1000;
const WIDTH = 280;
const HERDR = { edge: 16, pill: 34, toast: 72, apart: 8, error: 44 };

const dir = () => `${appHome()}/data/orbit-updates`;

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

export function noteLines(body) {
  const plain = (s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  const lines = String(body ?? "").split("\n");
  let out = lines.filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => plain(l.replace(/^\s*[-*]\s+/, "")));
  if (!out.length) out = lines.filter((l) => l.trim() && !/^\s*#/.test(l)).map(plain);
  return out.filter(Boolean).slice(0, 20);
}

export function rows(text, cols = 33) {
  let n = 1, at = 0;
  for (const word of String(text ?? "").split(/\s+/).filter(Boolean)) {
    const len = word.length;
    if (at && at + 1 + len > cols) { n++; at = 0; }
    at += (at ? 1 : 0) + len;
    while (at > cols) { n++; at -= cols; }
  }
  return n;
}

const NOTE_ROWS = 6, ERROR_ROWS = 3;

export function errorText(card) {
  return card.code === "changed" ? "Not replaced: your copy was changed." : `Not updated: ${card.error ?? "it failed"}.`;
}

export function prompt(tag, code) {
  const why = code === "changed" ? "my installed copy was changed, keep those changes" : "the update button on its card failed, keep my settings";
  return `Read ~/.config/herdr-app/AGENTS.md, then update the orbit layout to ${tag} from ${REPO} (read its RECIPE.md); ${why}`;
}

async function readJson(path) {
  try { return JSON.parse((await readTextFile(path)) ?? "null"); } catch (_) { return null; }
}

export class Updates {
  constructor() {
    this.state = null;
    this.version = null;
    this.result = null;
    this.running = null;
    this.card = null;
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

  async takeResult(r) {
    this.result = r;
    if (!r?.at) return;
    if (this.running && r.at >= this.running.since) this.running = null;
    if (r.ok && r.action === "undo" && r.at > (this.state?.seen ?? 0) && this.state?.latest?.tag) {
      await this.save({ closed: this.state.latest.tag, seen: r.at });
    }
  }

  async check(now) {
    if (!this.on() || this.checking) return;
    if (!now && Date.now() - (this.state?.checked ?? 0) < DAY) return;
    this.checking = true;
    try {
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
      } catch (_) { }
      await this.save({ checked: Date.now(), latest });
    } finally {
      this.checking = false;
    }
  }

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

  async close(tag) {
    this.hide();
    const seen = Math.max(this.state?.seen ?? 0, this.result?.at ?? 0);
    if (this.state?.closed !== tag || this.state?.seen !== seen) await this.save({ closed: tag, seen });
  }

  async stop(tag) {
    await this.close(tag);
    await apply({ updates: false });
  }

  async update(tag) {
    const latest = this.state?.latest;
    if (this.running || !latest || latest.tag !== tag) return;
    if (!latest.archive) {
      this.result = { error: "download", action: "apply", tag, message: "the release has no archive to download", at: Date.now() };
      return;
    }
    await this.run("apply", [latest.archive, tag]);
  }

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

  static height(lines) {
    return 14 + 20 + (lines ? 4 + 18 * lines : 0) + 12 + 28 + 14;
  }

  static lines(card) {
    if (card.mode === "updated") return 0;
    if (card.mode === "error") return Math.min(ERROR_ROWS, rows(errorText(card), 36));
    return Math.min(NOTE_ROWS, (card.notes ?? []).reduce((n, line) => n + rows(line), 0));
  }

  rect(card) {
    const view = globalThis.window?.viewport_size?.();
    if (!view?.width) return null;
    const z = appSettings()?.zoom || 1;
    const L = lookOf();
    const gap = Math.round((L.gap || 0) * z);
    const apart = L.gap ? gap : Math.round(HERDR.apart * z);
    const bar = Math.round(Math.max(4, L.gap || 0) * z) + Math.round(L.status * z);
    const toasts = Object.values(shared("orbit.toasts") ?? {}).filter((at) => Date.now() - at < 120000).length;
    let herdr = (HERDR.edge + HERDR.pill) * z + toasts * (HERDR.apart + HERDR.toast) * z;
    if (herdrUpdates()?.core?.error) herdr += (HERDR.apart + HERDR.error) * z;
    const bottom = Math.max(bar, Math.ceil(herdr)) + apart;
    const lines = Updates.lines(card);
    const h = Updates.height(lines);
    return { x: Math.round(view.width - (L.gap ? gap : apart) - WIDTH * z), y: Math.round(view.height - bottom - h * z), h, lines };
  }

  place() {
    const card = this.due();
    const r = card && this.rect(card);
    if (!r || r.y < 0) return this.hide();
    const key = `${card.mode}|${card.tag}|${card.at ?? ""}|${r.x}|${r.y}|${r.h}`;
    if (this.card?.key === key) return;
    const old = this.card;
    const id = openOverlay({ mod: "orbit-dialogs", kind: "window", frame: "none", width: WIDTH, height: r.h, at: { x: r.x, y: r.y },
      props: { dialog: "update", mode: card.mode, tag: card.tag, version: String(card.tag).replace(/^v/, ""), from: card.from ?? this.version,
        notes: card.notes ?? [], rows: r.lines, code: card.code ?? null, error: card.mode === "error" ? errorText(card) : null,
        prompt: prompt(card.tag, card.code) } });
    if (old) closeOverlay(old.id);
    this.card = { id, key };
    setShared(CARD, id);
    if (shared("orbit.probe") === true) setShared("orbit.probe.update", { ...r, w: WIDTH, tag: card.tag, mode: card.mode, id });
  }
}
