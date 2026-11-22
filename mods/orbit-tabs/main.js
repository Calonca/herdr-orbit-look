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
