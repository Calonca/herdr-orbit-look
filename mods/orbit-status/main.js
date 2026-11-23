import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, theme, layout, spaces, machines, shared, setShared, openOverlay, closeOverlay } from "herdr";
import { look, glass, spaceLook, spaceSymbol, accentBand, probeColor } from "./look.js";
import { backdrop, orbitPlace, orbitRadius, zoom, viewport } from "./glass.js";
import { System, bytes, pct, level } from "./system.js";
import { order, drop, landing } from "./taskbar.js";

const ICONS = "mods/orbit-status/icons";
const PINNED = "orbit.pinned";
const METER = 22;
const METERS = [6, 5, 4];

const POPUPS = {
  cpu: { title: "cpu", width: 300, height: 260 },
  ram: { title: "memory", width: 300, height: 150 },
  disk: { title: "disk", width: 300, height: 180 },
};

const CORE_COLUMNS = 3, CORE_ROW = 22;
function cpuHeight(n) {
  return 150 + Math.ceil(Math.max(1, n) / CORE_COLUMNS) * CORE_ROW;
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class OrbitStatus extends View {
  init(_props, cx) {
    this.sys = new System();
    this.sys.start(cx);
    this.away = new Map();
    this.watchMachines(cx);
    cx.timer.every(1000, (cx) => this.watchMachines(cx));
    this.popup = null;
    this.drag = null;
    this.acx = cx;
  }

  watchMachines(cx) {
    const others = machines().filter((m) => m.name !== null);
    for (const name of [...this.away.keys()]) if (!others.some((m) => m.name === name)) this.away.delete(name);
    for (const m of others) {
      if (!this.away.has(m.name)) this.away.set(m.name, new System(m.name));
      const sys = this.away.get(m.name);
      if (m.layout === "ready") sys.sampleAway(cx);
      else if (m.layout === "unavailable") sys.clear();
    }
  }

  above(bounds, w, h) {
    const z = zoom(), view = viewport();
    if (!bounds) return { at: "pointer", h };
    const room = (bounds.y - 6 - 8) / z;
    h = Math.max(40, Math.min(h, room));
    const x = Math.max(8, Math.min(bounds.x, view ? view.width - w * z - 8 : bounds.x));
    return { at: { x, y: Math.max(8, bounds.y - h * z - 6) }, h };
  }

  openPopup(widget, bounds, w, h, props, cx) {
    if (this.popup) closeOverlay(this.popup.id);
    const place = this.above(bounds, w, h);
    const id = openOverlay({ mod: "orbit-dialogs", kind: "popup", width: w, height: place.h, at: place.at,
      props: { ...props(place.h), bar: true } });
    this.popup = { widget, id, at: Date.now() };
    cx.notify();
  }

  toggle(widget, press, spec, cx) {
    if (press?.wasOpen) {
      if (this.popup?.widget === widget) closeOverlay(this.popup.id);
      this.popup = null;
      cx.notify();
      return;
    }
    const inPane = { mod: "orbit-dialogs", title: spec.title, props: spec.props };
    this.openPopup(widget, press?.bounds ?? null, spec.width, spec.height, (h) => ({
      ...spec.props, height: h, pin: spec.title,
      pinCommand: `orbit.new-mod ${JSON.stringify({ side: "right", ...inPane })}`,
    }), cx);
  }

  popupGone() {
    const p = this.popup;
    return p && Date.now() - p.at > 1500 && shared("orbit.popup") !== p.id;
  }

  probe(key, b) {
    if (!b || shared("orbit.probe") !== true) return;
    const all = shared("orbit.probe.status") ?? {};
    const was = all[key];
    if (was && was.x === b.x && was.y === b.y && was.width === b.width) return;
    setShared("orbit.probe.status", { ...all, [key]: { x: b.x, y: b.y, width: b.width, height: b.height } });
  }

  render() {
    if (this.popupGone()) this.popup = null;
    const t = theme();
    const sys = this.sys;
    const hover = t.foreground.slice(0, 7) + "24";
    const text = (s, color) => div().whitespace_nowrap().text_color(color ?? t.foreground).child(s);
    const icon = (name, color) => svg(`${ICONS}/${name}.svg`).w(name.startsWith("sidebar") ? 18 : 14).h(14).flex_none().text_color(color ?? t.ansi7);
    const ghost = (id, children, action, tip) => {
      const open = this.popup?.widget === id;
      return h_flex().id(id).h(28).px(6).gap(6).items_center().rounded(4).flex_none()
        .hover((s) => s.bg(hover)).when(open, (el) => el.bg(hover))
        .on_mouse_down("left", (e, cx) => {
          cx.stop_propagation();
          this.pressed = { id, bounds: e?.bounds ?? null, wasOpen: this.popup?.widget === id };
        })
        .when(Boolean(action), (el) => el.on_click((_e, cx) => action(this.pressed?.id === id ? this.pressed : null, cx)))
        .when(Boolean(tip) && !open, (el) => el.tooltip(tip))
        .on_mouse_move((e) => this.probe(id, e?.bounds))
        .children(children);
    };
    const every = [this.sys, ...[...this.away.values()].sort((a, b) => (a.on < b.on ? -1 : 1))];
    const tall = METERS[every.length - 1] ?? 3;
    const meter = (v) => div().w(METER).h(tall).flex_none().rounded(tall / 2).bg(t.muted.slice(0, 7) + "40")
      .when(v !== null, (el) => el.child(div().h_full().rounded(tall / 2).w(Math.max(1, Math.round(v * METER))).bg(level(t, v))));
    const tipOf = (f) => every.length === 1 ? f(sys)
      : every.map((s) => `${s.on ?? "local"}: ${f(s) ?? (machines().find((m) => m.name === s.on)?.layout === "unavailable" ? "offline" : "unknown")}`).join("\n");
    const popupOf = (name) => (press, cx) => this.toggle(name, press, { ...POPUPS[name],
      ...(name === "cpu" ? { height: cpuHeight(sys.cores.length) } : {}), props: { dialog: "stat", stat: name } }, cx);
    const usage = (name, use, tip) => {
      const uses = every.map(use);
      if (uses.every((v) => v === null)) return [];
      const bars = v_flex().flex_none().gap(every.length > 3 ? 1 : 2).children(uses.map(meter));
      return [ghost(name, [icon(name), bars], popupOf(name), tipOf(tip)).px(4).gap(4)];
    };
    const L = layout();
    const sidebarOpen = find(L, "sidebar")?.hidden !== true;

    const left = [ghost("sidebar", [icon(sidebarOpen ? "sidebar-open" : "sidebar")], () => run("layout.toggle", { id: "sidebar" }), "sidebar  ctrl+shift+b")];
    const after = [];
    if (machines().find((m) => m.name === null)?.layout === "unavailable") after.push(text("herdr offline", t.ansi1));
    const settled = spaces().reduce((n, s) => n + s.tabs.filter((tb) => tb.settled).length, 0);
    if (settled) after.push(text(`${settled} folded`, t.muted));
    const right = [];
    const stats = [
      ...usage("cpu", (s) => s.cpu, (s) => s.cpu === null ? null
        : `total ${pct(s.cpu)}${s.load ? `, load ${s.load.map((x) => x.toFixed(2)).join(" ")}` : ""}`),
      ...usage("ram", (s) => s.mem && s.mem.used / s.mem.total, (s) => s.mem
        && `used ${bytes(s.mem.used)} of ${bytes(s.mem.total)} (${pct(s.mem.used / s.mem.total)})`),
      ...usage("disk", (s) => s.full(), (s) => s.full() === null ? null
        : `${bytes(s.disk.free)} free on ${s.disk.path} (${pct(s.full())} full)`),
    ];
    if (stats.length) right.push(h_flex().flex_none().items_center().children(stats));
    const now = new Date();
    right.push(div().pl(6).child(text(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`)));

    const Lk = look();
    const sizes = (this.sizes ??= {});
    const sized = (key) => (size, cx) => {
      const was = sizes[key];
      if (size.width !== was?.width || size.height !== was?.height) { sizes[key] = size; cx.notify(); }
    };
    const bar = orbitPlace(Lk, "status", sizes.bar);
    const box = (el, key, dx) => el.id(`status-${key}`).relative().h_full().items_center()
      .on_size_change(sized(key))
      .child(backdrop({ x: bar && dx(sizes[key]) !== null ? bar.x + dx(sizes[key]) : undefined, y: bar?.y,
        w: sizes[key]?.width, h: sizes[key]?.height, radius: orbitRadius(Lk), corners: "tl tr bl br", fill: glass(t) }));
    const leftAt = () => 0;
    return h_flex().id("orbit-status").size_full().gap(Lk.gap || 6).text_size(13)
      .on_size_change(sized("bar"))
      .child(box(h_flex(), "left", leftAt).flex_1().min_w(0).px(14).gap(10)
        .child(h_flex().gap(4).flex_none().items_center().children(left))
        .child(div().w(1).h(18).flex_none().bg(t.border))
        .child(this.taskbar(t))
        .child(h_flex().gap(4).flex_none().items_center().children(after))
        .child(div().flex_1())
        .child(h_flex().gap(10).flex_none().items_center().children(right)));
  }

  taskbar(t) {
    const pinned = shared(PINNED) ?? [];
    const list = order(spaces(), pinned);
    const ids = list.map((s) => s.id);
    const g = this.drag;
    const mark = g && g.over !== g.from ? landing(ids, pinned, g.from, g.over) : null;
    const set = (v, cx) => { this.drag = v; cx.notify(); };
    const cards = list.map((s, i) => {
      const symbol = spaceSymbol(s, 14, s.active ? spaceLook(s).color : t.muted, "taskbar");
      const line = (side) => div().absolute().top(4).bottom(4).w(2).rounded(1).bg(t.accent)
        .when(side === "before", (m) => m.left(0)).when(side === "after", (m) => m.right(0));
      if (s.active) { probeColor("taskbar-band", accentBand(spaceLook(s).color)); probeColor("taskbar-text", t.foreground); }
      return h_flex().id(`task-${s.id}`).relative().h(26).px(8).gap(6).flex_none().items_center().rounded(5)
        .text_size(12.5).text_color(s.active ? t.foreground : t.ansi7)
        .when(s.active, (el) => el.bg(accentBand(spaceLook(s).color)))
        .hover((st) => st.bg(t.foreground.slice(0, 7) + "24"))
        .when(!g && this.popup?.widget !== `task-${s.id}`, (el) => el.tooltip(`${s.name}${pinned.includes(s.id) ? " · pinned" : ""}\nright-click: ${pinned.includes(s.id) ? "unpin" : "pin"} · drag to move`))
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.drag = { from: i, over: i }; })
        .on_mouse_move((e, cx) => {
          this.probe(`task:${s.name}`, e?.bounds);
          const d = this.drag;
          if (d && d.over !== i) set({ ...d, over: i }, cx);
        })
        .on_mouse_up("left", (_e, cx) => {
          const d = this.drag;
          if (!d) return;
          set(null, cx);
          if (d.from !== i) setShared(PINNED, drop(ids, pinned, d.from, i));
        })
        .on_click(() => { if (!s.active) run("space.select", { id: s.id }); })
        .on_mouse_down("right", (e, cx) => {
          cx.stop_propagation();
          this.openPopup(`task-${s.id}`, e?.bounds ?? null, 160, 41,
            () => ({ dialog: "menu", tab: "taskbar", target: { id: s.id } }), cx);
        })
        .child(symbol)
        .child(div().max_w(150).truncate().child(s.name))
        .when(pinned.includes(s.id), (el) => el.child(div().id(`pin-${s.id}`).flex_none()
          .on_mouse_move((e) => this.probe(`pin:${s.name}`, e?.bounds))
          .child(svg(`${ICONS}/pin.svg`).size(11).text_color(t.muted))))
        .when(mark?.before === s.id, (el) => el.child(line("before")))
        .when(mark?.after === s.id, (el) => el.child(line("after")));
    });
    return h_flex().id("taskbar").flex_shrink_1().min_w(0).h_full().gap(4).items_center().overflow_hidden()
      .on_hover((h, cx) => { if (!h && this.drag) set(null, cx); })
      .on_mouse_up("left", (_e, cx) => { if (this.drag) set(null, cx); })
      .children(cards);
  }
}
