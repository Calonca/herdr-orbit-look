import { readTextFile, exec, home, shared } from "herdr";

export function bytes(n) {
  const units = ["B", "K", "M", "G", "T", "P"];
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return n < 10 && u > 0 ? `${n.toFixed(1)}${units[u]}` : `${Math.round(n)}${units[u]}`;
}

export const pct = (v) => `${Math.round(v * 100)}%`;

export function level(t, v) {
  return v >= 0.9 ? t.ansi1 : v >= 0.7 ? t.ansi3 : t.ansi4;
}

const AWAY = ["cat /proc/stat", "cat /proc/loadavg", "cat /proc/meminfo", "df -B1 --output=used,avail,size,target ~"].join("; echo @@; ");

export class System {
  constructor(on = null) {
    this.on = on;
    this.clear();
  }

  clear() {
    this.cpu = null;
    this.cores = [];
    this.load = null;
    this.mem = null;
    this.disk = null;
    this.prev = null;
    this.asked = 0;
    this.run = null;
  }

  start(cx) {
    this.sample(cx);
    this.sampleDisk(cx);
    cx.timer.after(250, (cx) => this.sample(cx));
    cx.timer.every(1000, (cx) => this.sample(cx));
    cx.timer.every(30000, (cx) => this.sampleDisk(cx));
  }

  sample(cx) {
    cx.spawn(async (cx) => {
      try {
        this.takeUse(await readTextFile("/proc/stat"), await readTextFile("/proc/loadavg"), await readTextFile("/proc/meminfo"));
      } catch (_) { }
      cx.notify();
    });
  }

  sampleDisk(cx) {
    cx.spawn(async (cx) => {
      try {
        this.takeDisk((await exec("df", ["-B1", "--output=used,avail,size,target", home()])).stdout);
      } catch (_) { this.disk = null; }
      cx.notify();
    });
  }

  sampleAway(cx) {
    if (this.run || Date.now() - this.asked < (this.prev && this.cpu === null ? 1000 : 5000)) return;
    const run = (this.run = {});
    this.asked = Date.now();
    cx.spawn(async (cx) => {
      try {
        const [stat, load, mem, disk] = (await exec("sh", ["-c", AWAY], { on: this.on, timeout: 10000 })).stdout.split("@@\n");
        if (this.run === run) {
          this.takeUse(stat, load, mem);
          this.takeDisk(disk);
        }
      } catch (_) { }
      if (this.run === run) this.run = null;
      cx.notify();
    });
  }

  takeUse(stat, loadavg, meminfo) {
    const now = (stat ?? "").split("\n").filter((l) => /^cpu\d*\s/.test(l)).map((l) => {
      const f = l.trim().split(/\s+/).slice(1).map(Number);
      return { idle: f[3] + (f[4] ?? 0), total: f.reduce((a, b) => a + b, 0) };
    });
    const use = (n, p) => (p && n.total > p.total ? 1 - (n.idle - p.idle) / (n.total - p.total) : null);
    if (this.prev && now.length) {
      const all = use(now[0], this.prev[0]);
      if (all !== null) this.cpu = all;
      this.cores = now.slice(1).map((c, i) => use(c, this.prev[i + 1]) ?? 0);
      const fake = shared("orbit.probe") === true ? shared("orbit.probe.cores") : null;
      if (Number.isInteger(fake) && fake > this.cores.length) this.cores = [...this.cores, ...Array(fake - this.cores.length).fill(0)];
    }
    if (now.length) this.prev = now;
    const load = (loadavg ?? "").trim().split(/\s+/).slice(0, 3).map(Number);
    if (load.length === 3 && load.every((x) => !Number.isNaN(x))) this.load = load;
    const info = {};
    for (const line of (meminfo ?? "").split("\n")) {
      const m = line.match(/^(\w+):\s+(\d+)/);
      if (m) info[m[1]] = Number(m[2]) * 1024;
    }
    if (info.MemTotal) {
      this.mem = { used: info.MemTotal - info.MemAvailable, total: info.MemTotal, available: info.MemAvailable,
        swapUsed: info.SwapTotal - info.SwapFree, swapTotal: info.SwapTotal };
    }
  }

  takeDisk(df) {
    const [used, free, total, path] = (df ?? "").trim().split("\n").pop().trim().split(/\s+/);
    this.disk = path ? { used: Number(used), free: Number(free), total: Number(total), path } : null;
  }

  full() {
    const d = this.disk, room = d ? d.used + d.free : 0;
    return room ? d.used / room : null;
  }
}
