// Each space keeps its own split: the left and right panes' sizes and the
// side panel's width. Only the orbit mod has this file.
//
// The sizes are herdr's clicks (layout.resize, kept in layouts/.state), one
// set for the layout, so a space switch gives the shown space's set back with
// layout.resize, a click like a drag: no layout write, nothing restarts.
// Kept in shared "orbit.splits":
//   default: { [node]: size }   what the layout had before any space kept one
//                               (a space never resized, a new space)
//   spaces:  { [space id]: { [node]: size } }   each space's, as last dragged

import { shared, setShared, run } from "herdr";
import { find } from "./look.js";

export const KEY = "orbit.splits";
// The nodes and the size each is kept by: the panes share their row by
// weight, the panel has its own width.
const NODES = { "left-frame": "weight", "right-frame": "weight", panel: "px" };

// The sizes in layout L: { [node]: number }, or null without the panes.
export function read(L) {
  const out = {};
  for (const [id, unit] of Object.entries(NODES)) {
    const v = find(L, id)?.size?.[unit];
    if (typeof v === "number") out[id] = v;
  }
  return "left-frame" in out && "right-frame" in out ? out : null;
}

// The same on screen: the panes' share of their row, the panel's width
// (within a pixel). Weights are kept as ratios: 2:1 and 1:0.5 are one split.
export function same(a, b) {
  if (!a || !b) return a === b;
  const share = (s) => s["left-frame"] / (s["left-frame"] + s["right-frame"]);
  return Math.abs(share(a) - share(b)) < 0.002 && Math.abs((a.panel ?? 0) - (b.panel ?? 0)) < 1;
}

// What follow() last gave a space, when, and whether the layout has it yet.
const shown = { space: null, sizes: null, at: 0, settled: false };

// Run on every sync with the shown layout and space. A change of the sizes
// while a space is shown is that space's (kept at once, so a restart has it);
// a switch gives the new space's back.
export function follow(L, spaceId, ids, prune) {
  const now = read(L);
  if (!now || !spaceId) return;
  const st = shared(KEY) ?? {};
  let next = st.default ? st : { ...st, default: now };
  // After a switch, nothing is kept until the layout has the sizes given
  // (the resize lands a moment later; what shows until then is the space
  // before's), or a few seconds have passed (herdr took another size).
  if (shown.space && !shown.settled) shown.settled = same(now, shown.sizes) || Date.now() - shown.at > 3000;
  if (shown.space && shown.settled && !same(now, shown.sizes)) {
    next = { ...next, spaces: { ...(next.spaces ?? {}), [shown.space]: now } };
    shown.sizes = now;
  }
  if (shown.space !== spaceId) {
    const want = next.spaces?.[spaceId] ?? next.default;
    for (const [id, unit] of Object.entries(NODES)) {
      if (want[id] !== undefined && want[id] !== now[id]) run("layout.resize", { id, [unit]: want[id] });
    }
    Object.assign(shown, { space: spaceId, sizes: want, at: Date.now(), settled: same(now, want) });
    // Closed spaces' go (not in the first seconds: herdr is still listing them).
    const kept = !prune ? next.spaces ?? {} : Object.fromEntries(Object.entries(next.spaces ?? {}).filter(([id]) => ids.has(id)));
    if (Object.keys(kept).length !== Object.keys(next.spaces ?? {}).length) next = { ...next, spaces: kept };
  }
  if (next !== st) setShared(KEY, next);
}
