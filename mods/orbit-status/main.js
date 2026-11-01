// The status bar: on the left, the sidebar toggle, "herdr offline" while the
// core can't be reached, how many tabs are folded away (settled) and an
// update pill; on the right, cpu (with a sparkline of the last 20 s), ram and
// disk use, each with a tooltip (load and each core; available and swap; the
// sizes), "?" (the shortcuts), what needs you / what runs / what's done, the
// clock, and the side panel toggle.
//
// System figures come from /proc every second and `df` every 30 s (Linux;
// elsewhere those widgets stay hidden).

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, theme, layout, spaces, agents, machines, updates, readTextFile, exec, home } from "herdr";
import { look, glass } from "./look.js";
import { backdrop, orbitPlace } from "./glass.js";

const ICONS = "mods/orbit-status/icons";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Samples kept for cpu's sparkline, one a second.
const HISTORY = 20;

// `17G`, `7.1G`, `512M`: binary units, one decimal under 10.
function bytes(n) {
  const units = ["B", "K", "M", "G", "T", "P"];
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return n < 10 && u > 0 ? `${n.toFixed(1)}${units[u]}` : `${Math.round(n)}${units[u]}`;
}

export default class OrbitStatus extends View {
  init(_props, cx) {
    this.cpu = null; // 0..1
    this.cores = []; // 0..1 each
    this.load = null; // [1, 5, 15 min]
    this.history = []; // the last HISTORY cpu samples
    this.mem = null; // { used, total, swapUsed, swapTotal }
    this.disk = null; // { used, free, total, path }
    this.prev = null; // last /proc/stat totals: [{ idle, total }], all cpus then each core
    this.sample(cx);
    this.sampleDisk(cx);
    cx.timer.every(1000, (cx) => this.sample(cx));
    cx.timer.every(30000, (cx) => this.sampleDisk(cx));
  }

  sample(cx) {
    cx.spawn(async (cx) => {
      try {
        const stat = (await readTextFile("/proc/stat")) ?? "";
        const now = stat.split("\n").filter((l) => /^cpu\d*\s/.test(l)).map((l) => {
          const f = l.trim().split(/\s+/).slice(1).map(Number);
          return { idle: f[3] + (f[4] ?? 0), total: f.reduce((a, b) => a + b, 0) };
        });
        const use = (n, p) => (p && n.total > p.total ? 1 - (n.idle - p.idle) / (n.total - p.total) : null);
        if (this.prev && now.length) {
          const all = use(now[0], this.prev[0]);
          if (all !== null) {
            this.cpu = all;
            this.history = [...this.history, all].slice(-HISTORY);
          }
          this.cores = now.slice(1).map((c, i) => use(c, this.prev[i + 1]) ?? 0);
        }
        this.prev = now;
        const load = ((await readTextFile("/proc/loadavg")) ?? "").trim().split(/\s+/).slice(0, 3).map(Number);
        if (load.length === 3 && load.every((x) => !Number.isNaN(x))) this.load = load;
        const info = {};
        for (const line of ((await readTextFile("/proc/meminfo")) ?? "").split("\n")) {
          const m = line.match(/^(\w+):\s+(\d+)/);
          if (m) info[m[1]] = Number(m[2]) * 1024;
        }
        if (info.MemTotal) {
          this.mem = { used: info.MemTotal - info.MemAvailable, total: info.MemTotal, available: info.MemAvailable,
            swapUsed: info.SwapTotal - info.SwapFree, swapTotal: info.SwapTotal };
        }
      } catch (_) { /* not Linux: those widgets stay hidden */ }
      cx.notify();
    });
  }

  sampleDisk(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("df", ["-B1", "--output=used,avail,size,target", home()]);
        const [used, free, total, path] = r.stdout.trim().split("\n").pop().trim().split(/\s+/);
        this.disk = { used: Number(used), free: Number(free), total: Number(total), path };
      } catch (_) { this.disk = null; }
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const text = (s, color) => div().whitespace_nowrap().text_color(color ?? t.foreground).child(s);
    const icon = (name, color) => svg(`${ICONS}/${name}.svg`).w(name.startsWith("sidebar") || name.startsWith("panel") ? 18 : 14).h(14).flex_none().text_color(color ?? t.ansi7);
    const ghost = (id, children, action, tip) => h_flex().id(id).h(28).px(6).gap(6).items_center().rounded(4).flex_none()
      .hover((s) => s.bg(t.foreground.slice(0, 7) + "24")).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .when(Boolean(action), (el) => el.on_click(action))
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .children(children);
    // Plain, yellow from 70%, red from 90%.
    const level = (v) => (v >= 0.9 ? t.ansi1 : v >= 0.7 ? t.ansi3 : t.foreground);
    const usage = (id, name, v, tip, extra = []) => ghost(id, [icon(name), text(`${Math.round(v * 100)}%`, level(v)), ...extra], null, tip);
    // cpu's sparkline: a bar a second for the last 20 s, newest at the right.
    const spark = (values, color) => h_flex().h(14).gap(1).items_end().flex_none().children(
      Array.from({ length: HISTORY }, (_, i) => {
        const v = values[values.length - HISTORY + i];
        return div().w(2).h(v === undefined ? 1 : Math.max(1, Math.round(v * 14))).rounded(1)
          .bg(v === undefined ? t.muted.slice(0, 7) + "40" : color);
      }));

    const L = layout();
    const sidebarOpen = find(L, "sidebar")?.hidden !== true;

    const left = [ghost("sidebar", [icon(sidebarOpen ? "sidebar-open" : "sidebar")], () => run("layout.toggle", { id: "sidebar" }), "sidebar  ctrl+shift+b")];
    if (machines().find((m) => m.name === null)?.layout === "unavailable") left.push(text("herdr offline", t.ansi1));
    const settled = spaces().reduce((n, s) => n + s.tabs.filter((tb) => tb.settled).length, 0);
    if (settled) left.push(text(`${settled} folded`, t.muted));
    const up = updates();
    if (up.app.ready) {
      left.push(h_flex().id("update").h(24).px(10).items_center().rounded(12).bg(t.accent).text_color(t.accent_foreground)
        .on_click(() => run("app.update")).child(`update ready · restart`));
    }
    const right = [];
    // The tooltips: a label column, then the figures.
    const pct = (v) => `${Math.round(v * 100)}%`;
    if (this.cpu !== null) {
      const tip = [`total ${pct(this.cpu)}`];
      if (this.load) tip.push(`load  ${this.load.map((x) => x.toFixed(2)).join(" ")}`);
      for (let n = 0; n < this.cores.length; n += 8) {
        tip.push(`${n ? "     " : "cores"}${this.cores.slice(n, n + 8).map((c) => String(Math.round(c * 100)).padStart(4)).join("")}`);
      }
      right.push(usage("cpu", "cpu", this.cpu, tip.join("\n"), [spark(this.history, level(this.cpu))]));
    }
    if (this.mem) {
      const m = this.mem;
      const tip = [`used      ${bytes(m.used)} of ${bytes(m.total)} (${pct(m.used / m.total)})`, `available ${bytes(m.available)}`];
      if (m.swapTotal > 0) tip.push(`swap      ${bytes(m.swapUsed)} of ${bytes(m.swapTotal)}`);
      right.push(usage("ram", "ram", m.used / m.total, tip.join("\n")));
    }
    if (this.disk) {
      const d = this.disk, room = d.used + d.free;
      if (room) {
        right.push(usage("disk", "disk", d.used / room, [`filesystem of ${d.path}`, `used ${bytes(d.used)} of ${bytes(d.total)}`,
          `free ${bytes(d.free)}`, `full ${pct(d.used / room)}`].join("\n")));
      }
    }
    right.push(ghost("hints", [text("?", t.accent)], () => run("app.help"), "shortcuts  ctrl+shift+?"));
    // To handle (blocked, or done while you weren't looking), in progress, done.
    const a = agents();
    const buckets = [
      ["to handle", a.filter((x) => x.status === "blocked" || x.status === "done"), (n) => (n ? t.ansi1 : t.muted)],
      ["in progress", a.filter((x) => x.status === "working"), () => t.ansi3],
      ["done", a.filter((x) => x.status === "idle"), () => t.ansi2],
    ];
    right.push(h_flex().gap(0).flex_none().children(buckets.map(([what, list, color]) =>
      ghost(`count-${what}`, [div().text_size(9).text_color(color(list.length)).child("●"), text(String(list.length), color(list.length))],
        list.length ? () => run("agent.focus", { terminal: list[0].address }) : null, `${list.length} ${what}`).gap(4))));
    const now = new Date();
    right.push(div().pl(6).child(text(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`)));
    const panelOpen = find(L, "panel")?.hidden === false;
    right.push(ghost("panel", [icon(panelOpen ? "panel-open" : "panel")], () => run("orbit.side-panel"), "the side panel"));

    const Lk = look();
    // The glass, with the blurred background under its fill (glass.js): the
    // bar's place in the window, then the box's in the bar.
    const sizes = (this.sizes ??= {});
    const sized = (key) => (size, cx) => {
      const was = sizes[key];
      if (size.width !== was?.width || size.height !== was?.height) { sizes[key] = size; cx.notify(); }
    };
    const bar = orbitPlace(Lk, "status", sizes.bar);
    const box = (el, key, dx) => el.id(`status-${key}`).relative().h_full().items_center()
      .on_size_change(sized(key))
      .child(backdrop({ x: bar && dx(sizes[key]) !== null ? bar.x + dx(sizes[key]) : undefined, y: bar?.y,
        w: sizes[key]?.width, h: sizes[key]?.height, radius: 0, fill: glass(t) }));
    const leftAt = () => 0;
    return h_flex().id("orbit-status").size_full().gap(Lk.gap || 6).text_size(13)
      .on_size_change(sized("bar"))
      .child(box(h_flex(), "left", leftAt).flex_1().min_w(0).px(14).gap(10)
        .child(h_flex().gap(4).items_center().children(left))
        .child(div().flex_1())
        .child(h_flex().gap(10).items_center().children(right)));
  }
}
