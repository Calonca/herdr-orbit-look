// "open in pane ⇥": the button a popup shows when it was opened with
// props.pin (its title). It runs props.pinCommand, which opens the same mod
// in a pane (the status bar passes the orbit mod's new-mod ask, a whole
// command: "orbit.new-mod <args as JSON>"), then closes the popup. In a pane
// (no props.pin) it isn't there.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { props, run, closeOverlay } from "herdr";

export function pinButton(t) {
  const p = props() ?? {};
  if (!p.pin || !p.pinCommand) return null;
  return h_flex().id("orbit-pin").h(22).px(8).gap(5).flex_none().items_center().rounded(5)
    .text_size(11.5).text_color(t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground))
    .tooltip(`open ${p.pin} in a pane`)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(() => {
      run(p.pinCommand);
      if (p.overlay) closeOverlay(p.overlay);
    })
    .child(div().child("open in pane"))
    .child(div().text_size(13).child("⇥"));
}
