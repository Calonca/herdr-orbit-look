// "close <name>?": asked before a pane tab running a terminal closes. Enter or "close" closes it, Esc or "keep" keeps it; the same
// close again (middle-click, Ctrl+Shift+W) also confirms (the orbit mod's
// actions.js, which opens this and does the close).
// Props: { dialog: "confirm", label, space, side, id }.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme } from "herdr";
import { look, ask } from "./look.js";

const cancelAsk = () => ask("cancel-ask");

export class Confirm {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(200, () => this.handle.focus());
  }

  yes() {
    const p = props();
    ask("close-asked", { space: p.space, side: p.side, id: p.id });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const button = (id, text, danger, f) => div().id(id).px(16).py(6).rounded(4).text_size(13)
      .bg(danger ? t.ansi1 : t.chrome).text_color(danger ? t.background : t.foreground)
      .hover((s) => s.opacity(0.85)).on_click((_e, cx) => f(cx)).child(text);
    return v_flex().id("orbit-confirm").track_focus(this.handle).size_full().p(18).gap(8)
      .bg(t.surface.slice(0, 7) + "f2").border(2).border_color(t.border).rounded(look().radius).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key === "enter") this.yes();
        else if (e.key === "escape") cancelAsk();
        else return;
        cx.stop_propagation();
      })
      .child(div().text_size(15).font_bold().truncate().child(`close ${p.label || "this terminal"}?`))
      .child(div().text_size(12).text_color(t.muted).child("what runs there ends · Enter or the same close again closes"))
      .child(h_flex().pt(8).gap(10).child(button("orbit-confirm-yes", "close", true, () => this.yes()))
        .child(button("orbit-confirm-no", "keep", false, () => cancelAsk())));
  }
}
