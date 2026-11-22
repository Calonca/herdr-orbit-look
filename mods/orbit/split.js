import { shared, setShared, run } from "herdr";
import { find } from "./look.js";

export const KEY = "orbit.splits";
const NODES = { "left-frame": "weight", "right-frame": "weight", panel: "px" };

export function read(L) {
  const out = {};
  for (const [id, unit] of Object.entries(NODES)) {
    const v = find(L, id)?.size?.[unit];
    if (typeof v === "number") out[id] = v;
  }
  return "left-frame" in out && "right-frame" in out ? out : null;
}

export function same(a, b) {
  if (!a || !b) return a === b;
  const share = (s) => s["left-frame"] / (s["left-frame"] + s["right-frame"]);
  return Math.abs(share(a) - share(b)) < 0.002 && Math.abs((a.panel ?? 0) - (b.panel ?? 0)) < 1;
}

const shown = { space: null, sizes: null, at: 0, settled: false };

export function follow(L, spaceId, ids, prune) {
  const now = read(L);
  if (!now || !spaceId) return;
  const st = shared(KEY) ?? {};
  let next = st.default ? st : { ...st, default: now };
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
    const kept = !prune ? next.spaces ?? {} : Object.fromEntries(Object.entries(next.spaces ?? {}).filter(([id]) => ids.has(id)));
    if (Object.keys(kept).length !== Object.keys(next.spaces ?? {}).length) next = { ...next, spaces: kept };
  }
  if (next !== st) setShared(KEY, next);
}
