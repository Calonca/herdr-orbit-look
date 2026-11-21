// "Orbit 0.6.0 is out": the look's own update notice, a card at the bottom
// right (the orbit mod's updates.js opens it, places it clear of Herdr's own
// notices, moves it, and does what its buttons ask). A dot, the title, a ×,
// up to three lines from the release notes, and its buttons:
//
//   due      "update" (its tooltip says what it does) · "stop notifications"
//   working  "updating…"
//   updated  "Updated to Orbit 0.6.0" · "undo" (the previous copy back)
//   error    one line; for a copy someone changed (code "changed"), "copy
//            update prompt" (a line for an agent); else "update" again
//
// Nothing is replaced before the click on "update", and only by the orbit
// mod's update.py, which leaves a changed copy alone.
//
// Its heights are fixed: updates.js sizes the window from them (height()).
// Props: { dialog: "update", mode, tag, version, from, notes: [line], code, error, prompt }.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, closeOverlay } from "herdr";
import { ask } from "./look.js";

export class Update {
  init() {
    this.copied = false;
  }

  // At once here (the orbit mod takes its asks a moment later), and remembered there.
  close(what = "update-close") {
    const p = props() ?? {};
    if (p.overlay) closeOverlay(p.overlay);
    ask(what, { tag: p.tag });
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const version = p.version ?? p.tag;
    const mode = p.mode ?? "due";
    const lines = mode === "due" || mode === "working" ? (p.notes ?? []).slice(0, 3) : [];

    const primary = (id, text, tip, click) => div().id(id).h(28).px(14).flex().items_center().flex_none().rounded(6)
      .bg(t.accent).text_color(t.accent_foreground).text_size(13).font_semibold().cursor_pointer()
      .hover((st) => st.opacity(0.9)).tooltip(tip)
      .on_click((_e, cx) => click(cx))
      .child(text);
    const quiet = (id, text, tip, click) => div().id(id).h(28).px(10).flex().items_center().flex_none().rounded(6)
      .text_size(13).text_color(t.muted).cursor_pointer().tooltip(tip)
      .hover((st) => st.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => click(cx))
      .child(text);
    const said = (text) => div().h(28).flex().items_center().min_w(0).text_size(13).text_color(t.muted).truncate().child(text);

    let title = `Orbit ${version} is out`;
    let buttons = [];
    if (mode === "due") {
      buttons = [
        primary("orbit-update-go", "update",
          `Download Orbit ${version} and replace the look's mods, layout and themes with it. Your settings and your own files stay, and the copy you have now is kept, so you can undo it.`,
          () => ask("update-apply", { tag: p.tag })),
        quiet("orbit-update-stop", "stop notifications", "No more update checks or cards. Turn them on again in Orbit look settings.",
          () => this.close("update-stop")),
      ];
    } else if (mode === "working") {
      buttons = [said("updating…")];
    } else if (mode === "updated") {
      title = `Updated to Orbit ${version}`;
      buttons = [quiet("orbit-update-undo", "undo", `Put Orbit ${p.from ?? "as it was"} back.`, () => { if (p.overlay) closeOverlay(p.overlay); ask("update-undo"); })];
    } else if (p.code === "changed") {
      buttons = [this.copied ? said("prompt copied: paste it to an agent")
        : primary("orbit-update-copy", "copy update prompt", "A one-line prompt for an agent, to update the look and keep your changes.", (cx) => {
          cx.write_to_clipboard(p.prompt ?? "");
          this.copied = true;
          cx.notify();
        })];
    } else {
      buttons = [primary("orbit-update-go", "update", "Try again.", () => ask("update-apply", { tag: p.tag }))];
    }
    const error = mode === "error"
      ? (p.code === "changed" ? "Not replaced: your copy was changed." : `Not updated: ${p.error ?? "it failed"}.`)
      : null;

    return v_flex().id("orbit-update").size_full().px(16).py(13).bg(t.popover).border(1).border_color(t.border).rounded(12)
      .text_color(t.foreground)
      // A press here isn't a drag of the window.
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(h_flex().h(20).gap(8).items_center()
        .child(div().size(8).rounded(4).flex_none().bg(mode === "error" ? t.ansi1 : t.accent))
        .child(div().flex_1().min_w(0).truncate().text_size(14).font_semibold().child(title))
        .child(div().id("orbit-update-close").size(20).flex().items_center().justify_center().flex_none().rounded(4)
          .text_size(14).text_color(t.muted).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
          .on_click(() => this.close())
          .child("×")))
      .when(lines.length > 0, (el) => el.child(v_flex().pt(4).pl(16)
        .children(lines.map((line) => div().h(18).truncate().text_size(13).text_color(t.muted).child(line)))))
      .when(Boolean(error), (el) => el.child(v_flex().pt(4).pl(16)
        .child(div().id("orbit-update-error").h(18).truncate().text_size(13).text_color(t.ansi1).tooltip(error ?? "").child(error ?? ""))))
      .child(h_flex().mt(12).pl(16).h(28).gap(6).items_center().children(buttons));
  }
}
