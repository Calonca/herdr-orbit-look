import { View, div } from "gpui-kit";
import { props, shared, setShared } from "herdr";
import { Menu } from "./menu.js";
import { Confirm } from "./confirm.js";
import { NewTab } from "./new-tab.js";
import { Switcher } from "./switcher.js";
import { Settings } from "./settings.js";
import { Stat } from "./stat.js";
import { Update } from "./update.js";

const DIALOGS = { menu: Menu, confirm: Confirm, "new-tab": NewTab, switcher: Switcher, settings: Settings, stat: Stat, update: Update };

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
