import assert from "node:assert/strict";
import { order, drop, landing } from "../mods/orbit-status/taskbar.js";

const sp = (id, status, at, active = false) => ({ id, status, active, tabs: [{ changed_at: at }] });
const all = [sp("idle", "idle", 1), sp("work1", "working", 5), sp("done", "done", 3), sp("blocked", "blocked", 7),
  sp("shown", null, 0, true), sp("work2", "working", 9)];
const ids = (list) => list.map((s) => s.id);

assert.deepEqual(ids(order(all, [])), ["shown", "blocked", "done", "work2", "work1"]);
assert.deepEqual(ids(order(all, ["idle", "work1"])), ["idle", "work1", "shown", "blocked", "done", "work2"]);
assert.deepEqual(ids(order(all, ["gone", "shown"])), ["shown", "blocked", "done", "work2", "work1"]);

const row = ["idle", "shown", "blocked", "done", "work2", "work1"];
assert.deepEqual(drop(row, ["idle"], 4, 0), ["work2", "idle"]);
assert.deepEqual(landing(row, ["idle"], 4, 0), { before: "idle" });
assert.deepEqual(drop(row, ["idle"], 0, 3), ["idle"]);
assert.deepEqual(landing(row, ["idle"], 0, 3), { before: "shown" });
assert.deepEqual(drop(row, ["idle"], 5, 2), ["idle", "work1"]);
assert.deepEqual(drop(row, ["gone"], 3, 0), ["done", "gone"]);
assert.deepEqual(drop(row, ["idle"], 2, 2), ["idle"]);
console.log("taskbar: ok");
