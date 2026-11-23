import { View, div } from "gpui-kit";
import { props, theme, spaces, shared, setShared, settings } from "herdr";
import { look, LINE, keysIn, glass, spaceLook } from "./look.js";

// A pane's outline but for its tab row, and its glass, under the content.
// herdr clips a block to its box and lays no two over each other, so what is
// under the content's box is drawn by `corners`: 0px tall, its padding
// (layouts/orbit.json: REACH) makes it taller than the pane, and the content
// comes after it.
const REACH = 2000;

export default class OrbitEdge extends View {
  render() {
    const t = theme();
    const L = look();
    const p = props() ?? {};
    const pane = p.pane;
    if (!pane) return div();
    const z = settings()?.zoom || 1;
    const active = spaces().find((s) => s.active);
    const line = keysIn() === pane && active ? spaceLook(active).color : t.border;
    const r = L.radius;
    // herdr rounds no box by more than half its side: the corners' curves.
    const curve = Math.min(r, (r + LINE) / 2);
    // The sides start past the curve, over the corners' own straight ends.
    const past = Math.min(r, r / 2 + 1);
    const key = `orbit.mid.${pane}`;
    if (p.side) {
      return div().id(`orbit-edge-${pane}-side`).size_full().relative()
        .on_size_change((size) => { if (shared(key) !== size.height) setShared(key, size.height); })
        .child(div().absolute().left(0).right(0).top(L.top ? 0 : past).bottom(L.top ? past : 0).bg(line));
    }
    // The outline's end: its line in the cap, the rest of its corners in the content's box.
    const end = () => {
      const el = div().absolute().left(0).w_full().h(r + LINE).border_color(line).border_l(LINE).border_r(LINE);
      return L.top ? el.border_b(LINE).rounded_b(r) : el.border_t(LINE).rounded_t(r);
    };
    const box = div().id(`orbit-edge-${pane}`).size_full().relative();
    // Square corners: a box only as tall as its border is drawn half as thick.
    if (!p.corners && !r) return box.bg(line);
    if (!p.corners) return box.overflow_hidden().child(L.top ? end().bottom(0) : end().top(0));
    const mid = (shared(key) ?? 0) / z;
    if (!(mid > 0)) return box;
    const under = div().absolute().left(0).w_full().top(-REACH + (L.top ? 0 : -LINE)).h(mid + LINE).bg(glass(t));
    if (!r) return box.child(under);
    return box.child(L.top ? under.rounded_b(curve) : under.rounded_t(curve))
      .child(end().top(-REACH + (L.top ? mid - r : -LINE)));
  }
}
