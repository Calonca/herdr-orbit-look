// Each space's identity: a stable colour and symbol (FNV-1a of its name; a
// worktree's repo), the same in the tab row and the sidebar. Only the orbit
// mod has this file: it works them out and shares them (publish(), shared
// "orbit.identity"), and the other mods read them (look.js spaceLook()).

import { theme, shared, setShared, panes, spaces, exec } from "herdr";
import { identityKey } from "./repokey.js";

// Each shipped theme's identity colours (purple, cyan, green, yellow, orange,
// red), the theme known by its accent: Tokyo Night, then the six others in
// themes/.
const IDENTITIES = {
  "#7aa2f7": ["#bb9af7", "#7dcfff", "#9ece6a", "#e0af68", "#ff9e64", "#f7768e"], // tokyo-night
  "#89b4fa": ["#cba6f7", "#89dceb", "#a6e3a1", "#f9e2af", "#fab387", "#f38ba8"], // catppuccin-mocha
  "#83a598": ["#d3869b", "#8ec07c", "#b8bb26", "#fabd2f", "#fe8019", "#fb4934"], // gruvbox-dark
  "#88c0d0": ["#b48ead", "#8fbcbb", "#a3be8c", "#ebcb8b", "#d08770", "#bf616a"], // nord
  "#c4a7e7": ["#c4a7e7", "#9ccfd8", "#31748f", "#f6c177", "#ebbcba", "#eb6f92"], // rose-pine
  "#7e9cd8": ["#957fb8", "#7fb4ca", "#98bb6c", "#e6c384", "#ffa066", "#e82424"], // kanagawa
  "#a7c080": ["#d699b6", "#83c092", "#a7c080", "#dbbc7f", "#e69875", "#e67e80"], // everforest
};
// Any other theme: its own ANSI colours.
const ANSI = ["ansi5", "ansi6", "ansi2", "ansi3", "ansi11", "ansi1"];

// The UTF-8 bytes of `s`, as Rust hashes them.
function utf8(s) {
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export function fnv(name) {
  let h = 0x811c9dc5;
  for (const b of utf8(name ?? "")) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

// The shown theme's six, looked up at most every 200 ms: theme() is a host
// call that builds every colour, and a render has 50 ms for all its rows.
let cached = null, cachedAt = 0;
function colors() {
  const now = Date.now();
  if (!cached || now - cachedAt > 200) {
    const t = theme();
    cached = IDENTITIES[t.accent.slice(0, 7).toLowerCase()] ?? ANSI.map((k) => t[k]);
    cachedAt = now;
  }
  return cached;
}

export function identity(name) {
  return colors()[fnv(name) % 6];
}

// One of 8 symbols: hexagon, triangle, square, circle, star, plus, cross, diamond.
export function glyph(name) {
  return (fnv(name) >>> 9) % 8;
}


// A space's identity comes from its repository (repokey.js): the origin's
// name, else the main checkout's folder, so the same repo on another machine,
// and every worktree of it, look the same; a space outside a repo goes by its
// name. Each space's repo is looked up once (on its machine) and kept in
// shared state for every mod.
const GIT = "orbit.git";
const asked = new Set();

export function spaceKey(space) {
  return identityKey(space, (shared(GIT) ?? {})[space?.id]);
}

function spaceFolder(space) {
  const tabs = new Set(space.tabs.map((t) => t.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder || null;
}

// Looks up the repo of every space that has none yet.
export function lookUpRepos(cx) {
  const known = shared(GIT) ?? {};
  const ids = new Set(spaces().map((s) => s.id));
  for (const space of spaces()) {
    // Known, unless looked up before the origin was (an older copy's).
    const k = known[space.id];
    if ((space.id in known && (k === null || "origin" in k)) || asked.has(space.id)) continue;
    const folder = spaceFolder(space);
    if (!folder) continue;
    asked.add(space.id);
    cx.spawn(async () => {
      let git = null;
      try {
        const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--git-dir"], { cwd: folder, on: space.machine });
        const [repo, dir] = r.stdout.trim().split("\n");
        if (r.code === 0 && repo) {
          const o = await exec("git", ["config", "--get", "remote.origin.url"], { cwd: folder, on: space.machine });
          git = { repo, linked: Boolean(dir) && dir !== repo, origin: o.code === 0 ? o.stdout.trim() || null : null };
        }
      } catch (_) { /* not reachable: its name stays its identity */ }
      // Spaces that are gone are dropped on the way.
      const now = Object.fromEntries(Object.entries(shared(GIT) ?? {}).filter(([id]) => ids.has(id)));
      setShared(GIT, { ...now, [space.id]: git });
    });
  }
}

// Every space's colour and symbol, into shared "orbit.identity"
// ({ [space id]: { color, glyph } }) when they changed.
export function publish() {
  const out = {};
  for (const space of spaces()) {
    const key = spaceKey(space);
    out[space.id] = { color: identity(key), glyph: glyph(key) };
  }
  const now = shared("orbit.identity");
  if (JSON.stringify(now) !== JSON.stringify(out)) setShared("orbit.identity", out);
}
