import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, shared, setShared } from "herdr";

const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };

const hidden = (p) => shared("orbit.settings")?.notify === "errors" && p?.level !== "error";

const TOASTS = "orbit.toasts";
function listed(id, on) {
  if (!id) return;
  const all = { ...(shared(TOASTS) ?? {}) };
  if (on === Boolean(all[id])) return;
  if (on) all[id] = Date.now();
  else delete all[id];
  setShared(TOASTS, all);
}

export default class Toast extends View {
  init(initProps, cx) {
    const p = initProps ?? props() ?? {};
    if (hidden(p) && p.overlay) return closeOverlay(p.overlay);
    this.overlay = p.overlay;
    listed(this.overlay, true);
    cx.spawn(async () => {
      const q = props() ?? {};
      if (hidden(q) && q.overlay) { listed(q.overlay, false); closeOverlay(q.overlay); }
    });
  }

  close() {
    listed(this.overlay, false);
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    if (hidden(p)) return div();
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    return h_flex()
      .id("toast")
      .size_full()
      .px(18)
      .gap(12)
      .items_center()
      .bg(t.popover)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        if (p.action?.name) run(p.action.name, p.action.args ?? {});
        closeOverlay(p.overlay);
      })
      .child(p.icon ? image(p.icon).w(18).h(18).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[p.level] ?? "accent"]))
      .child(
        v_flex()
          .flex_1()
          .overflow_hidden()
          .child(div().truncate().font_semibold().text_size(13).text_color(t.foreground).child(login ? `${login[1]} needs a login: run` : p.title ?? ""))
          .when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(p.body ?? "")))
          .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(12).text_color(t.muted).child(command))
            .child(div().id("toast-login-copy").flex_none().px(6).py(3).rounded(4).bg(t.raised)
              .text_size(12).text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover))
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "Copied" : "Copy")))),
      );
  }
}
