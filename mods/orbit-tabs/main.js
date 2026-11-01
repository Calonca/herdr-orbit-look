// The orbit layout's tab rows, each the bottom of its pane's outline:
//   props { stack: "left" | "right" }   a pane's row (pane.js)
//   props { stack: "panel-body" }       the side panel's row (panel.js)
// A change (show, close, rename, move, a new tab) is asked of the orbit mod
// (look.js ask), which makes it.

import { View, div } from "gpui-kit";
import { props } from "herdr";
import { PaneRow } from "./pane.js";
import { PanelRow } from "./panel.js";

export default class OrbitTabs extends View {
  init(p, cx) {
    const stack = props()?.stack;
    this.row = stack === "left" || stack === "right" ? new PaneRow() : stack ? new PanelRow() : null;
    this.row?.init(p, cx);
  }

  render(cx) {
    return this.row ? this.row.render(cx) : div();
  }
}
