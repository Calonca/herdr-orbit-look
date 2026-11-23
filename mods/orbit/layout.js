import { shared, setShared, theme, appHome, readTextFile, writeTextFile, layout, run, panes, spaces, settings as appSettings } from "herdr";
import { state as sidesState, termChild, PICK } from "./sides.js";
import { glass, find, LINE, PANEL_DRAG_MIN, GENERATED } from "./look.js";

export const LAYOUT = "orbit";
export const KEY = "orbit.settings";

export const DEFAULTS = { density: "comfortable", rounding: null, gap: null, tabs: "bottom", background: null, notify: "all", updates: true, opacity: 0, views: null };

export const DENSITIES = {
  compact: { radius: 4, gap: 6, header: 30, status: 28, padding: [2, 0], footer: 67, scale: 0.9 / 1.15 },
  default: { radius: 12, gap: 10, header: 38, status: 34, padding: [4, 0], footer: 75, scale: 1 / 1.15 },
  comfortable: { radius: 16, gap: 14, header: 46, status: 40, padding: [8, 0], footer: 86, scale: 1 },
};

export function settings() {
  return { ...DEFAULTS, ...(shared(KEY) ?? {}) };
}

const STARTING = [{ title: "files", mod: "files", props: null }, { title: "changes", mod: "changes", props: null }];
export function panelViews(s = settings()) {
  return Array.isArray(s.views) ? s.views.filter((v) => v?.mod) : STARTING;
}

export function viewId(v) {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify([v.mod, v.props ?? null])) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return `panel-v${h.toString(36)}`;
}

export function shape(root, s, colors) {
  const L = lookOf(s);
  const { radius, gap, top } = L;
  const glassy = glass(colors);
  root.background = { image: L.background.image, fit: "cover" };
  root.terminal_padding = L.padding;
  root.terminal_opacity = L.opacity;
  const put = (node, key, value) => { if (!node) return; if (value) node[key] = value; else delete node[key]; };
  put(root, "padding", gap ? [0, gap] : null);
  const row = find(root, "body");
  put(row, "gap", gap);
  put(row, "padding", gap ? [gap, 0] : null);
  put(find(root, "work"), "gap", gap);
  const block = find(root, "orbit");
  if (block) block.size = { px: Math.max(4, gap) };
  const status = find(root, "status");
  if (status) status.size = { px: L.status };
  const footer = find(root, "sidebar-footer");
  if (footer) footer.size = { px: L.footer };
  for (const id of ["left-frame", "right-frame", "panel"]) {
    const frame = find(root, id);
    const kids = frame?.children ?? [];
    const cap = kids.find((c) => c.id.endsWith("-cap")), mid = kids.find((c) => c.id.endsWith("-mid")), row = kids.find((c) => c.id.endsWith("-tabs"));
    const corners = kids.find((c) => c.id.endsWith("-corners"));
    if (!cap || !mid || !row || !corners) continue;
    cap.size = { px: LINE };
    row.size = { px: L.header + LINE };
    frame.children = [...(top ? [row, corners, mid, cap] : [cap, corners, mid, row]), ...kids.filter((c) => c !== cap && c !== mid && c !== row && c !== corners)];
  }
  const space = spaces().find((x) => x.active);
  const sidebar = find(root, "sidebar");
  if (sidebar) {
    sidebar.background = glassy;
    put(sidebar, "radius", gap ? radius : null);
  }
  const sidePanel = find(root, "panel");
  if (sidePanel) sidePanel.min = PANEL_DRAG_MIN;
  for (const [stack, pane] of [["left", "left"], ["right", "right"], ["panel-body", "panel"]]) {
    const st = find(root, stack);
    if (st) delete st.background;
    const m = find(root, `${pane}-mid`);
    if (!m) continue;
    delete m.divider;
    for (const c of m.children ?? []) {
      if (c.id.endsWith("-s1") || c.id.endsWith("-s2")) {
        c.size = { px: LINE };
        c.content = { mod: "orbit-edge", props: { pane, side: true } };
      }
    }
  }
  const right = find(root, "right");
  if (right) {
    right.children = rightChildren(right.children ?? []);
    const want = space && sidesState().shown?.[space.id];
    if (want && right.children.some((c) => c.id === want)) right.active = want;
  }
  const body = find(root, "panel-body");
  if (body) {
    const views = panelViews(s);
    body.children = [...body.children.filter((c) => !c.id.startsWith("panel-v")),
      ...views.map((v) => ({ id: viewId(v), type: "block", title: v.title, content: { mod: v.mod, ...(v.props ? { props: v.props } : {}) } }))];
    if (!body.children.some((c) => c.id === body.active)) body.active = views.length ? viewId(views[0]) : "panel-pick";
  }
  return root;
}

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

let known = null;

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

export async function renamePanelView(id, title) {
  const name = (title ?? "").trim();
  if (!name) return;
  await apply({ views: panelViews().map((v) => (viewId(v) === id ? { ...v, title: name } : v)) });
}

export async function movePanelView(id, before) {
  const views = panelViews();
  const from = views.findIndex((v) => viewId(v) === id);
  if (from < 0 || id === before) return;
  const [view] = views.splice(from, 1);
  const at = views.findIndex((v) => viewId(v) === before);
  views.splice(at < 0 ? views.length : at, 0, view);
  await apply({ views });
}

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

export function lookOf(s = settings()) {
  const d = DENSITIES[s.density] ?? DENSITIES.comfortable;
  const radius = s.rounding ?? d.radius;
  const background = s.background ? { image: s.background, blur: null } : GENERATED;
  const opacity = typeof s.opacity === "number" ? Math.min(1, Math.max(0, s.opacity)) : 0;
  return { ...d, radius, gap: s.gap ?? d.gap, small: Math.min(4, radius), top: s.tabs === "top", background, opacity,
    density: s.density, rounding: s.rounding, gapSet: s.gap, tabs: s.tabs, picked: s.background, notify: s.notify, updates: s.updates !== false };
}

const PLACED = ["left-tabs", "right-tabs", "panel-tabs"];

const zoom = () => appSettings()?.zoom || 1;
const viewport = () => { const v = globalThis.window?.viewport_size?.(); return v?.width ? v : null; };

export function share() {
  const put = (key, value) => { if (JSON.stringify(shared(key)) !== JSON.stringify(value)) setShared(key, value); };
  put("orbit.look", lookOf());
  const L = layout();
  put("orbit.places", Object.fromEntries(PLACED.map((id) => [id, blockPlace(L, id)]).filter(([, at]) => at)));
}

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
