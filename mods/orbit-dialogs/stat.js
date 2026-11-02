// What the status bar's cpu, ram and disk widgets open (props { dialog:
// "stat", stat: "cpu" | "ram" | "disk" }): a popup above the widget, or,
// opened from its "open in pane ⇥" (pin.js), a pane of its own. It samples
// the machine itself (system.js), live.
//   cpu   the total, the load, each core as a bar
//   ram   used, available, swap
//   disk  the home folder's filesystem: used, free, how full
// props.height: in a popup it is that tall.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, closeOverlay } from "herdr";
import { System, bytes, pct, level } from "./system.js";
import { pinButton } from "./pin.js";

export const TITLES = { cpu: "cpu", ram: "memory", disk: "disk" };

export class Stat {
  init(_props, cx) {
    this.sys = new System();
    this.sys.start(cx);
    this.handle = cx.focus_handle();
    if (props()?.overlay) this.handle.focus();
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const s = this.sys;
    const bar = (v, w) => div().w(w).h(6).flex_none().rounded(3).bg(t.muted.slice(0, 7) + "40")
      .child(div().h_full().rounded(3).w(Math.max(1, Math.round((v ?? 0) * w))).bg(level(t, v ?? 0)));
    const row = (label, value, v = null) => h_flex().gap(10).items_center().text_size(12.5)
      .child(div().w(80).flex_none().text_color(t.muted).child(label))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(value))
      .when(v !== null, (el) => el.child(bar(v, 90)));
    const body = [];
    if (p.stat === "cpu") {
      if (s.cpu !== null) body.push(row("total", pct(s.cpu), s.cpu));
      if (s.load) body.push(row("load", s.load.map((x) => x.toFixed(2)).join("  ")));
      if (s.cores.length) {
        body.push(div().pt(4).text_size(12.5).text_color(t.muted).child("cores"));
        // Each core a small bar, in columns of eight.
        const cols = [];
        for (let n = 0; n < s.cores.length; n += 8) {
          cols.push(v_flex().gap(4).children(s.cores.slice(n, n + 8).map((c, i) =>
            h_flex().gap(6).items_center().text_size(11).text_color(t.muted)
              .child(div().w(18).flex_none().child(String(n + i)))
              .child(bar(c, 44)))));
        }
        body.push(h_flex().gap(14).children(cols));
      }
    } else if (p.stat === "ram" && s.mem) {
      const m = s.mem;
      body.push(row("used", `${bytes(m.used)} of ${bytes(m.total)}`, m.used / m.total));
      body.push(row("available", bytes(m.available)));
      if (m.swapTotal > 0) body.push(row("swap", `${bytes(m.swapUsed)} of ${bytes(m.swapTotal)}`, m.swapUsed / m.swapTotal));
    } else if (p.stat === "disk" && s.disk) {
      const d = s.disk;
      body.push(row("filesystem", d.path));
      body.push(row("used", `${bytes(d.used)} of ${bytes(d.total)}`, s.full()));
      body.push(row("free", bytes(d.free)));
      body.push(row("full", s.full() === null ? "" : pct(s.full())));
    }
    if (!body.length) body.push(div().text_size(12.5).text_color(t.muted).child("measuring…"));
    const popup = Boolean(p.overlay);
    return v_flex().id("orbit-stat").track_focus(this.handle).w_full()
      .when(popup && p.height, (el) => el.h(p.height)).when(!popup, (el) => el.size_full())
      .p(12).gap(8).when(popup, (el) => el.bg(t.popover)).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && p.overlay) { closeOverlay(p.overlay); cx.stop_propagation(); }
      })
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().text_size(13.5).font_bold().child(TITLES[p.stat] ?? p.stat ?? ""))
        .children([pinButton(t)].filter(Boolean)))
      .children(body);
  }
}
