// The orbit layout's own block: it draws nothing and keeps the layout file in
// step with what the window shows.
// - The glass follows the shown theme (a layout can't give a theme colour an
//   alpha, so the colours are written into layouts/orbit.json as hex).
// - The pane with the keys is outlined in the shown space's colour (look.js):
//   it's written again when another space shows or the keys move.
// - A terminal taking herdr's focus gives the keys back to the left pane; a
//   hidden side panel can't keep them.
// Put it in the layout as a small block:
//   { "id": "orbit", "type": "block", "size": { "px": 4 }, "content": { "mod": "orbit" } }

import { View, div } from "gpui-kit";
import { spaces, theme, layout, focused, watchFolder, appHome } from "herdr";
import { apply, keysIn, setKeysIn, find } from "./look.js";
import { identity, spaceKey } from "./identity.js";

export default class Orbit extends View {
  init(_props, cx) {
    this.focus = null; // the outline colour last written
    // The layout is written at start and again whenever its file is replaced
    // (a fresh copy); apply() writes only what differs. The loop uses cx each
    // time round: herdr ends it at its next cx use once this block is gone.
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(1);
        try { await apply(this.focus, true); } catch (e) { console.log(`orbit: ${e}`); }
        await watchFolder(`${appHome()}/layouts`);
      }
    });
    cx.timer.every(250, (cx) => this.sync(cx));
  }

  sync(cx) {
    const f = focused();
    const fk = `${f?.pane}|${f?.terminal}`;
    if (fk !== this.fk) {
      this.fk = fk;
      if (f?.pane || f?.terminal) setKeysIn("left");
    }
    if (keysIn() === "panel" && find(layout(), "panel")?.hidden) setKeysIn("left");
    if (keysIn() !== this.drawnSide) this.redraw(cx);
  }

  // One write at a time: one begun before the keys moved would otherwise land
  // last with the old colours. Again while anything changed during a write.
  redraw(cx) {
    if (this.drawing) { this.again = true; return; }
    this.drawing = true;
    cx.spawn(async () => {
      try {
        do {
          this.again = false;
          this.drawnSide = keysIn();
          const colour = this.focus;
          await apply(colour);
          if (keysIn() !== this.drawnSide || colour !== this.focus) this.again = true;
        } while (this.again);
      } catch (e) {
        console.log(`orbit: ${e}`);
      } finally {
        this.drawing = false;
      }
    });
  }

  render(cx) {
    const surface = theme().surface;
    const active = spaces().find((s) => s.active);
    const focus = active ? identity(spaceKey(active)) : this.focus;
    if ((this.surface !== undefined && this.surface !== surface) || focus !== this.focus) {
      this.focus = focus;
      this.redraw(cx);
    }
    this.surface = surface;
    return div();
  }
}
