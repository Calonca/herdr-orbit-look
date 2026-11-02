// What the machine is using: cpu (all and each core, the load), ram (and
// swap), the disk of the home folder. This file is the same in every orbit
// mod that uses it (the status bar's widgets, orbit-dialogs' "stat" popup).
//
//   const sys = new System(); sys.start(cx);   then sys.cpu, sys.cores, ...
//
// /proc every second and `df` every 30 s (Linux; elsewhere they stay null).

import { readTextFile, exec, home, shared } from "herdr";

// Samples kept for cpu's sparkline, one a second.
export const HISTORY = 20;

// `17G`, `7.1G`, `512M`: binary units, one decimal under 10.
export function bytes(n) {
  const units = ["B", "K", "M", "G", "T", "P"];
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return n < 10 && u > 0 ? `${n.toFixed(1)}${units[u]}` : `${Math.round(n)}${units[u]}`;
}

export const pct = (v) => `${Math.round(v * 100)}%`;

// A use's colour: blue, yellow from 70%, red from 90%.
export function level(t, v) {
  return v >= 0.9 ? t.ansi1 : v >= 0.7 ? t.ansi3 : t.ansi4;
}

export class System {
  constructor() {
    this.cpu = null; // 0..1
    this.cores = []; // 0..1 each
    this.load = null; // [1, 5, 15 min]
    this.history = []; // the last HISTORY cpu samples
    this.mem = null; // { used, total, available, swapUsed, swapTotal }
    this.disk = null; // { used, free, total, path }
    this.prev = null; // last /proc/stat totals: [{ idle, total }], all cpus then each core
  }

  start(cx) {
    this.sample(cx);
    this.sampleDisk(cx);
    // cpu use needs two samples: the second soon, so a popup has it at once.
    cx.timer.after(250, (cx) => this.sample(cx));
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
          // tools/regress.py: a machine with this many cores (the rest idle).
          const fake = shared("orbit.probe") === true ? shared("orbit.probe.cores") : null;
          if (Number.isInteger(fake) && fake > this.cores.length) this.cores = [...this.cores, ...Array(fake - this.cores.length).fill(0)];
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

  // How full each is, 0..1, or null while unknown.
  ram() { return this.mem ? this.mem.used / this.mem.total : null; }
  full() {
    const d = this.disk, room = d ? d.used + d.free : 0;
    return room ? d.used / room : null;
  }
}
