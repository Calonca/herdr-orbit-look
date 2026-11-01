// The orbit layout's dialogs and popups, opened with openOverlay and
// props { dialog, ... }:
//   "menu"      the sidebar's menu and a tab's right-click menu (menu.js)
//   "confirm"   "close <name>?" before a terminal closes (confirm.js)
//   "new-tab"   make tab N, when ctrl+N finds none (new-tab.js)
//   "switcher"  the recent spaces, to pick from (switcher.js)

import { View, div } from "gpui-kit";
import { props } from "herdr";
import { Menu } from "./menu.js";
import { Confirm } from "./confirm.js";
import { NewTab } from "./new-tab.js";
import { Switcher } from "./switcher.js";

const DIALOGS = { menu: Menu, confirm: Confirm, "new-tab": NewTab, switcher: Switcher };

export default class OrbitDialogs extends View {
  init(p, cx) {
    const Dialog = DIALOGS[props()?.dialog];
    this.dialog = Dialog ? new Dialog() : null;
    this.dialog?.init?.(p, cx);
  }

  render(cx) {
    return this.dialog ? this.dialog.render(cx) : div();
  }
}
