// The taskbar's order and its drag, as plain functions of herdr's spaces()
// and shared "orbit.pinned" (space ids in pin order), so tools/ can test them
// without a window.
//
// The cards, left to right: the pinned spaces in pin order, then the shown
// space, then those whose agents finished or wait for you (done, blocked),
// then those at work (working), each group most recent first. An unpinned
// space whose agents are idle isn't there.

// When anything in a space last changed state (ms; 0: nothing since start).
export function changed(space) {
  return Math.max(0, ...(space.tabs ?? []).map((t) => t.changed_at ?? 0));
}

export function order(spaces, pinned = []) {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const out = pinned.map((id) => byId.get(id)).filter(Boolean);
  const taken = new Set(out.map((s) => s.id));
  const add = (list) => {
    for (const s of list) if (!taken.has(s.id)) { taken.add(s.id); out.push(s); }
  };
  const recent = (list) => [...list].sort((a, b) => changed(b) - changed(a));
  add(spaces.filter((s) => s.active));
  add(recent(spaces.filter((s) => s.status === "done" || s.status === "blocked")));
  add(recent(spaces.filter((s) => s.status === "working")));
  return out;
}

// A card dragged from `from` onto the card at `to` (indices in the shown
// order): it moves there and is pinned. Pinned spaces always lead, so dropped
// past them it lands at their end. Returns the new "orbit.pinned".
export function drop(ids, pinned, from, to) {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return pinned;
  const moved = ids[from];
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, moved);
  const keep = new Set([...pinned.filter((id) => ids.includes(id)), moved]);
  // Pinned spaces not shown now (their space gone) keep their place at the end.
  const gone = pinned.filter((id) => !ids.includes(id));
  return [...next.filter((id) => keep.has(id)), ...gone];
}

// Where the dragged card would land, for the accent bar: { before: id } (the
// card it goes in front of) or { after: id } (it ends the row).
export function landing(ids, pinned, from, to) {
  const lead = drop(ids, pinned, from, to).filter((id) => ids.includes(id));
  const next = [...lead, ...ids.filter((id) => !lead.includes(id))];
  const k = next.indexOf(ids[from]);
  return k + 1 < next.length ? { before: next[k + 1] } : { after: next[k - 1] };
}
