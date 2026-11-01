// The recent spaces, most recent first: identity symbol, name, machine, agent state. The one before this space
// is picked at first. ↑/↓ or Tab/Shift+Tab move, 1-9 or Enter go, Esc closes.
// Props: { dialog: "switcher" }.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, shared, run, theme, props, closeOverlay } from "herdr";
import { look } from "./look.js";
import { identity, glyph, glyphPath, spaceKey, statusColor } from "./identity.js";

export class Switcher {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(100, () => this.handle.focus());
    this.at = null;
  }

  rows() {
    const all = spaces();
    const order = (shared("orbit.recent") ?? []).filter((id) => all.some((s) => s.id === id));
    const rest = all.filter((s) => !order.includes(s.id)).map((s) => s.id);
    return [...order, ...rest].map((id) => all.find((s) => s.id === id));
  }

  go(space) {
    closeOverlay(props().overlay);
    if (space) run("space.select", { id: space.id });
  }

  render() {
    const t = theme();
    const rows = this.rows();
    if (this.at === null) this.at = rows.length > 1 ? 1 : 0;
    this.at = Math.min(this.at, rows.length - 1);
    const row = (s, i) => {
      const on = i === this.at;
      const key = spaceKey(s);
      const fill = statusColor(s.status);
      return h_flex().id(`sw-${s.id}`).h(42).px(18).gap(14).items_center().flex_none()
        .when(on, (el) => el.bg(t.selected))
        .hover((el) => el.bg(t.hover))
        .on_click(() => this.go(s))
        .child(div().size(16).flex_none().relative()
          .when(Boolean(fill), (el) => el.child(svg(glyphPath(glyph(key), true)).absolute().size(16).text_color(fill)))
          .child(svg(glyphPath(glyph(key), false)).absolute().size(16).text_color(identity(key))))
        .child(div().max_w(260).truncate().text_size(16).text_color(t.foreground).when(on, (el) => el.font_semibold()).child(s.name))
        .child(div().flex_1().truncate().text_size(14).text_color(t.muted).child(s.machine ?? "local"))
        .when(Boolean(s.status) && s.status !== "idle", (el) => el.child(div().text_size(13).text_color(t.muted).child(s.status)));
    };
    return v_flex().id("orbit-switcher").track_focus(this.handle).w_full().py(14)
      .bg(t.surface.slice(0, 7) + "f2").border(2).border_color(t.border).rounded(look().radius).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.go(null);
        if (k === "enter") return this.go(rows[this.at]);
        if (/^[1-9]$/.test(k)) return this.go(rows[Number(k) - 1]);
        if (k === "down" || (k === "tab" && !e.modifiers.shift)) this.at = (this.at + 1) % rows.length;
        else if (k === "up" || k === "tab") this.at = (this.at + rows.length - 1) % rows.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().px(18).pb(6).text_size(14).text_color(t.muted).child(`projects · ${rows.length}`))
      .child(v_flex().h(Math.min(rows.length, 10) * 42).overflow_y_scrollbar().children(rows.map(row)));
  }
}
