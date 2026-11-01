// The top of a pane's outline (the layout frames each pane: this, then its
// content between the two side lines, then its tab row; with the tab rows on
// top, the bottom): the line with its two rounded corners, filled with the
// pane's glass inside. In the shown
// space's colour while the keys are in the pane, else the border's.
// Props: { pane: "left" | "right" | "panel" }.
// With no props it draws nothing: each pane's middle is a row of that, the
// pane's content and that again, zero wide, and the row's divider draws the
// outline's two sides.

import { View, div } from "gpui-kit";
import { props, theme, spaces } from "herdr";
import { look, LINE, keysIn, glass, spaceLook } from "./look.js";

export default class OrbitEdge extends View {
  render() {
    const t = theme();
    const L = look();
    const pane = props()?.pane;
    if (!pane) return div();
    const active = spaces().find((s) => s.active);
    const line = keysIn() === pane && active ? spaceLook(active).color : t.border;
    const el = div().id(`orbit-edge-${pane}`).size_full().bg(glass(t)).border_color(line).border_l(LINE).border_r(LINE);
    return L.top ? el.border_b(LINE).rounded_b(L.radius) : el.border_t(LINE).rounded_t(L.radius);
  }
}
