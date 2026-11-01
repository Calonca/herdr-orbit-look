// Make tab N, asked for when ctrl+N finds no such tab: a name and, optionally,
// the command it runs (empty: a shell). Enter makes it, Esc cancels.
// Props: { dialog: "new-tab", space, index }.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";
import { look } from "./look.js";

// "claude --resume" -> ["claude", "--resume"]; quotes keep spaces together.
function argv(command) {
  const out = [];
  for (const m of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export class NewTab {
  init(_props, cx) {
    this.name = InputState.new({ placeholder: "name" });
    this.command = InputState.new({ placeholder: "command (empty: a shell)" });
    this.name.on("submit", () => this.submit());
    this.command.on("submit", () => this.submit());
    this.name.focus();
    cx.timer.after(300, () => this.name.focus());
    this.handle = cx.focus_handle();
  }

  submit() {
    const p = props();
    const name = this.name.value().trim(), command = this.command.value().trim();
    closeOverlay(p.overlay);
    run("tab.new", { space: p.space, ...(name ? { name } : {}), ...(command ? { argv: argv(command) } : {}) });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const field = (state) => Input.new(state).h(36).px(12).rounded(4).border(1).border_color(t.input).bg(t.background)
      .text_size(14).text_color(t.foreground);
    const label = (text) => div().pt(14).pb(6).text_size(13).text_color(t.muted).child(text);
    return v_flex().id("orbit-new-tab").track_focus(this.handle).size_full().p(18)
      .bg(t.surface.slice(0, 7) + "f2").border(2).border_color(t.border).rounded(look().radius).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().child(`no tab ${p.index} yet: make one`))
        .child(div().text_size(12).text_color(t.muted).child("esc")))
      .child(label("name")).child(field(this.name))
      .child(label("command")).child(field(this.command))
      .child(div().pt(12).text_size(12).text_color(t.muted).child("⏎ make it"));
  }
}
