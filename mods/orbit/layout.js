// What the orbit mod writes into layouts/orbit.json: the theme's glass, the
// outline colours (the pane with the keys in the shown space's colour), the
// right pane's children and the side panel's views. Only the orbit mod has
// this file: the other mods ask it for a change (look.js ask).
//
// - apply(next?): writes the layout; `next` is merged into the saved settings
//   first (shared "orbit.settings"). Only what differs is written.
// - The side panel's views: close, rename, move, add (and show).
// - share(): what the other mods would otherwise each work out: the look
//   ("orbit.look") and where the tab rows sit ("orbit.places").

import { shared, setShared, theme, appHome, readTextFile, writeTextFile, layout, run, panes, spaces, settings as appSettings } from "herdr";
import { state as sidesState, termChild, PICK } from "./sides.js";
import { identity, spaceKey } from "./identity.js";
import { glass, keysIn, find, LINE, PANEL_DRAG_MIN, GENERATED } from "./look.js";

export const LAYOUT = "orbit";
export const KEY = "orbit.settings";

export function settings() {
  return { views: null, ...(shared(KEY) ?? {}) };
}

// The side panel's views, in their tabs' order: herdr's files and changes
// until one is closed or another added. [{ title, mod, props }]
const STARTING = [{ title: "files", mod: "files", props: null }, { title: "changes", mod: "changes", props: null }];
export function panelViews(s = settings()) {
  return Array.isArray(s.views) ? s.views.filter((v) => v?.mod) : STARTING;
}

// A view's block id in the panel: the same for the same view.
export function viewId(v) {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify([v.mod, v.props ?? null])) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return `panel-v${h.toString(36)}`;
}

// The layout with the theme's glass, the outline colours, the right pane's
// children and the panel's views in it. A layout can't give a theme colour an
// alpha, so colours are written as hex.
export function shape(root, s, colors) {
  const glassy = glass(colors);
  const edge = colors.border.slice(0, 7);
  const space = spaces().find((x) => x.active);
  const ring = (space ? identity(spaceKey(space)) : colors.accent).slice(0, 7);
  const keys = keysIn();
  const sidebar = find(root, "sidebar");
  if (sidebar) sidebar.background = glassy;
  const sidePanel = find(root, "panel");
  if (sidePanel) sidePanel.min = PANEL_DRAG_MIN;
  for (const [stack, mid, side] of [["left", "left-mid", "left"], ["right", "right-mid", "right"], ["panel-body", "panel-mid", "panel"]]) {
    const st = find(root, stack);
    if (st) st.background = glassy;
    const m = find(root, mid);
    if (m) m.divider = { width: LINE, color: keys === side ? ring : edge };
  }
  // The right pane: every space's terminals and mods, the shown space's pick
  // shown (written with its children: a select sent before the window has
  // loaded a new child fails).
  const right = find(root, "right");
  if (right) {
    right.children = rightChildren(right.children ?? []);
    const want = space && sidesState().shown?.[space.id];
    if (want && right.children.some((c) => c.id === want)) right.active = want;
  }
  // The side panel: a block per view after its picker (orbit-add). With
  // none, the picker shows.
  const body = find(root, "panel-body");
  if (body) {
    const views = panelViews(s);
    body.children = [...body.children.filter((c) => !c.id.startsWith("panel-v")),
      ...views.map((v) => ({ id: viewId(v), type: "block", title: v.title, content: { mod: v.mod, ...(v.props ? { props: v.props } : {}) } }))];
    if (!body.children.some((c) => c.id === body.active)) body.active = views.length ? viewId(views[0]) : "panel-pick";
  }
  return root;
}

// The right pane's children from orbit.sides (sides.js): its picker, a
// terminal block per terminal put there, a block per mod. A block whose
// terminal ended is gone already (herdr takes it out); its tab is too, so it
// isn't written back.
function rightChildren(old) {
  const st = sidesState();
  const live = new Set(panes().map((p) => p.terminal).filter(Boolean));
  const kids = [old.find((c) => c.id === PICK.right) ?? { id: PICK.right, type: "block", content: { mod: "orbit-add", props: { side: "right" } } }];
  for (const terminal of new Set(Object.values(st.right))) {
    if (live.has(terminal)) kids.push({ id: termChild(terminal), type: "block", content: { terminal } });
  }
  for (const m of st.mods) kids.push({ id: m.id, type: "block", title: m.title, content: { mod: m.mod, ...(m.props ? { props: m.props } : {}) } });
  return kids;
}

// The layout file as last read or written here, so a change (the outline on
// each space switch) is one write and no read. The write only lands on that
// text; when the file changed meanwhile it's read again.
let known = null;

// Saves `next` (merged over the settings) and writes the layout. `fresh`
// reads the file first (it was replaced by a new copy).
export async function apply(next, fresh = false) {
  const s = { ...settings(), ...(next ?? {}) };
  if (next) setShared(KEY, s);
  const path = `${appHome()}/layouts/${LAYOUT}.json`;
  for (let tries = 0; tries < 2; tries++) {
    if (fresh || tries || known === null) known = await readTextFile(path);
    const text = known;
    if (!text) return;
    const out = JSON.stringify(shape(JSON.parse(text), s, theme()), null, 2) + "\n";
    if (out === text) return;
    try {
      await writeTextFile(path, out, text);
      known = out;
      return;
    } catch (e) {
      if (tries) throw e;
    }
  }
}

// Closes a side panel view: its tab goes, and if it was the shown one, the
// view beside it shows (the picker once none is left).
export async function closePanelView(id) {
  const views = panelViews();
  const at = views.findIndex((v) => viewId(v) === id);
  const left = views.filter((v) => viewId(v) !== id);
  if (find(layout(), "panel-body")?.active === id) {
    const next = left[Math.min(Math.max(at, 0), left.length - 1)];
    run("layout.select", { stack: "panel-body", child: next ? viewId(next) : "panel-pick" });
  }
  await apply({ views: left });
}

// Renames a side panel view (its tab's label).
export async function renamePanelView(id, title) {
  const name = (title ?? "").trim();
  if (!name) return;
  await apply({ views: panelViews().map((v) => (viewId(v) === id ? { ...v, title: name } : v)) });
}

// Moves a side panel view to where another is (its tab dragged there).
export async function movePanelView(id, to) {
  const views = panelViews();
  const from = views.findIndex((v) => viewId(v) === id);
  const at = views.findIndex((v) => viewId(v) === to);
  if (from < 0 || at < 0 || from === at) return;
  const [view] = views.splice(from, 1);
  views.splice(at, 0, view);
  await apply({ views });
}

// Puts a mod in the side panel as a tab of its own (at the end, unless it's
// there) and shows it, once the window has its block.
export async function addPanelView(cx, view) {
  const id = viewId(view);
  const there = () => Boolean(find(layout(), id));
  if (!there()) {
    const views = panelViews();
    if (!views.some((v) => viewId(v) === id)) await apply({ views: [...views, view] });
    for (let n = 0; n < 50 && !there(); n++) await cx.sleep(100);
  }
  run("layout.select", { stack: "panel-body", child: id });
  run("layout.show", { id: "panel" });
}

// The look the other mods draw with (look.js look()), from the settings.
export function lookOf(s = settings()) {
  return { radius: 4, gap: 0, header: 46, status: 40, footer: 86, scale: 1, small: 4, top: false, background: GENERATED };
}

// The blocks whose place a mod needs before an event tells it its own (the
// tab rows' glass: orbit-tabs' rowframe.js).
const PLACED = ["left-tabs", "right-tabs", "panel-tabs"];

const zoom = () => appSettings()?.zoom || 1;
const viewport = () => { const v = globalThis.window?.viewport_size?.(); return v?.width ? v : null; };

// Shares the look and the tab rows' places, each when it changed.
export function share() {
  const put = (key, value) => { if (JSON.stringify(shared(key)) !== JSON.stringify(value)) setShared(key, value); };
  put("orbit.look", lookOf());
  const L = layout();
  put("orbit.places", Object.fromEntries(PLACED.map((id) => [id, blockPlace(L, id)]).filter(([, at]) => at)));
}

// Where block `id` of the shown layout sits in the window, in window pixels
// ({ x, y, width, height }), worked out from the layout as herdr-app lays it
// out: each row/column's padding and gap, its shown children's px sizes and
// weights (shares of what px siblings leave), min/max, every length zoomed
// and rounded to whole pixels. null without a viewport or that block. Rows
// and columns with a divider (a pane's middle) aren't walked into: the tab
// rows (`<pane>-tabs`) are found without.
export function blockPlace(L, id) {
  const view = viewport();
  if (!view || !L) return null;
  const z = zoom();
  const r = (v) => Math.round((v || 0) * z);
  const walk = (node, box) => {
    if (node.id === id) return box;
    const kids = (node.children ?? []).filter((c) => !c.hidden);
    if (!kids.length || (node.type !== "row" && node.type !== "column")) return null;
    const pad = Array.isArray(node.padding) ? node.padding : [node.padding ?? 0, node.padding ?? 0];
    const inner = { x: box.x + r(pad[1]), y: box.y + r(pad[0]), width: box.width - 2 * r(pad[1]), height: box.height - 2 * r(pad[0]) };
    const across = node.type === "row";
    const main = across ? inner.width : inner.height;
    const between = r(node.gap) + r(node.divider?.width);
    const clamp = (c, v) => Math.min(c.max != null ? r(c.max) : Infinity, Math.max(c.min != null ? r(c.min) : 0, v));
    // The px ones first; the weights share the rest, a weighted one held at
    // its min (or max) taking that out of the share for the others.
    const size = new Map();
    for (const c of kids) if (c.size?.px != null) size.set(c, clamp(c, r(c.size.px)));
    let free = main - between * (kids.length - 1) - [...size.values()].reduce((a, b) => a + b, 0);
    let open = kids.filter((c) => !size.has(c));
    for (let round = 0; round < kids.length && open.length; round++) {
      const total = open.reduce((a, c) => a + (c.size?.weight ?? 1), 0);
      const held = open.filter((c) => clamp(c, free * (c.size?.weight ?? 1) / total) !== free * (c.size?.weight ?? 1) / total);
      if (!held.length) break;
      for (const c of held) { const v = clamp(c, free * (c.size?.weight ?? 1) / total); size.set(c, v); free -= v; }
      open = open.filter((c) => !size.has(c));
    }
    const total = open.reduce((a, c) => a + (c.size?.weight ?? 1), 0);
    for (const c of open) size.set(c, free * (c.size?.weight ?? 1) / total);
    let at = across ? inner.x : inner.y;
    for (const c of kids) {
      const s = size.get(c);
      const childBox = across ? { x: Math.round(at), y: inner.y, width: Math.round(at + s) - Math.round(at), height: inner.height }
        : { x: inner.x, y: Math.round(at), width: inner.width, height: Math.round(at + s) - Math.round(at) };
      if (!c.divider || c.id === id) {
        const found = walk(c, childBox);
        if (found) return found;
      }
      at += s + between;
    }
    return null;
  };
  return walk(L, { x: 0, y: 0, width: view.width, height: view.height });
}
