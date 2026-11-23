import { View, div } from "gpui-kit";
import { props } from "herdr";
import { PaneRow } from "./pane.js";
import { PanelRow } from "./panel.js";
import { DragLayer } from "./drag.js";

export default class OrbitTabs extends View {
  init(p, cx) {
    const stack = props()?.stack;
    this.row = props()?.drag ? new DragLayer() : stack === "left" || stack === "right" ? new PaneRow() : stack ? new PanelRow() : null;
    this.row?.init(p, cx);
  }

  async close() {
    await this.row?.close?.();
  }

  render(cx) {
    return this.row ? this.row.render(cx) : div();
  }
}
