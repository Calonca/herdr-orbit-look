// The orbit layout's dialogs and popups, opened with openOverlay and
// props { dialog, ... }:
//   "menu"      the sidebar's menu and a tab's right-click menu (menu.js)
//   "confirm"   "close <name>?" before a terminal closes (confirm.js)
//   "new-tab"   make tab N, when ctrl+N finds none (new-tab.js)
//   "switcher"  the recent spaces, to pick from (switcher.js)
//   "settings"  the look: density, corners, gap, tab rows, background (settings.js)
//   "stat"      the status bar's cpu, ram or disk in detail (stat.js); also in a pane

import { View, div } from "gpui-kit";
import { props, shared, setShared } from "herdr";
import { Menu } from "./menu.js";
import { Confirm } from "./confirm.js";
import { NewTab } from "./new-tab.js";
import { Switcher } from "./switcher.js";
import { Settings } from "./settings.js";
import { Stat } from "./stat.js";

const DIALOGS = { menu: Menu, confirm: Confirm, "new-tab": NewTab, switcher: Switcher, settings: Settings, stat: Stat };

// A popup the status bar opened (props.bar) says it's open in shared
// "orbit.popup" (its overlay id) and takes that back when it closes, so the
// bar knows which of its widgets has one.
export default class OrbitDialogs extends View {
  init(p, cx) {
    const own = props();
    if (own?.bar && own.overlay) setShared("orbit.popup", own.overlay);
    const Dialog = DIALOGS[props()?.dialog];
    this.dialog = Dialog ? new Dialog() : null;
    this.dialog?.init?.(p, cx);
  }

  async close() {
    const own = props();
    if (own?.bar && own.overlay && shared("orbit.popup") === own.overlay) setShared("orbit.popup", null);
  }

  render(cx) {
    return this.dialog ? this.dialog.render(cx) : div();
  }
}
