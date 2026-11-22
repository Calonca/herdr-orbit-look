import { View, div } from "gpui-kit";
import { props, theme, spaces } from "herdr";
import { look, LINE, keysIn, glass, spaceLook } from "./look.js";

export default class OrbitEdge extends View {
  render() {
    const t = theme();
    const L = look();
    const pane = props()?.pane;
    if (!pane) return div();
    const side = props()?.side === true;
    const active = spaces().find((s) => s.active);
    const line = keysIn() === pane && active ? spaceLook(active).color : t.border;
    if (side) return div().id(`orbit-edge-${pane}-side`).size_full().bg(line);
    const el = div().id(`orbit-edge-${pane}`).size_full().bg(glass(t)).border_color(line).border_l(LINE).border_r(LINE);
    return L.top ? el.border_b(LINE).rounded_b(L.radius) : el.border_t(LINE).rounded_t(L.radius);
  }
}
