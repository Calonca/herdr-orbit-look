#!/usr/bin/env python3
"""Regression suite for the orbit look's status bar: real clicks on an X11
sandbox (scripts/sandbox with SANDBOX_X11=1: a private Xvfb display, its own
app home and herdr core; never the person's display or app), then state checks.

    tools/regress.py            a fresh sandbox (HERDR_APP_SANDBOX, default
                                "regress"), every scenario, a PASS/FAIL table;
                                the sandbox stays up
    tools/regress.py --down     the same, then the sandbox goes
    tools/regress.py -k drag    only scenarios whose name has "drag"

Shots go to $REGRESS_OUT (default /tmp/herdr-regress). Exit 1 if anything fails.

Clicks find their target with the status bar's probe (orbit-status main.js
probe()): shared "orbit.probe" is set in the sandbox's shared.json before it
starts, the pointer sweeps the bar, and each widget and taskbar card records
where it is. Agent states come from OSC 7501 reports printed in the sandbox's
terminals.

Scenarios:
  popup   a click on cpu opens its popup, a second click closes it; a click
          beside it closes it; ram and disk open theirs; "open in pane ⇥"
          opens the same view in the right pane and closes the popup
  order   the taskbar: pinned in pin order, the shown space, those waiting
          (blocked, done), those at work; an idle unpinned space isn't there
  pin     right-click → Pin puts a card first ("orbit.pinned") and shows a pin
          icon in it (the card one line, as tall as before); Unpin takes it out
          again, and the icon
  drag    a card dragged onto another lands in its place, pinned
  symbols each card's symbol is the sidebar's for that space: filled in the
          state's colour for working, blocked, done; empty with no agent and
          once a finished agent was seen (idle)
  tabs    the shown space's accent (the band behind its sidebar row and its
          taskbar card) is its colour, and the text stays white there and in
          the panes' shown tabs, for two spaces, back and forth
  identity  a space's colour and symbol come from its repository: the same
          repo at another path (as on another machine), a worktree and its
          main checkout, with or without an origin, look the same; another
          repo has its own
  keep    a mod in the right pane keeps running across space switches (its
          init runs once): A -> B -> A, and to a pinned space and back
  split   each space keeps its own split: the divider dragged in A and in B,
          A -> B -> A gives each its own; a space never resized keeps the one
          it had
  settings  orbit.settings (ctrl-,) opens Orbit look settings in the right
          pane, not an overlay; again, it shows that one (no second copy)
  terminal  the layout names no font: settings.json's font and size apply
          (JetBrains Mono 14 there looks as the default); the look settings'
          terminal background is written into the layout,
          show, and the copy still hashes as installed
  toast   a notify() of each level (info, success, warning, error): with
          notifications "all" each shows (orbit-toast, the layout's "toast");
          with "errors only" (asked of the orbit mod as the settings dialog
          does) only the error shows, the others close at once
  update  the look's own update card, against a local fake of GitHub's
          latest-release answer and of its archive (never GitHub): the
          installed copy still hashes as installed after the other scenarios
          (the layout the orbit mod rewrites included); no card for the same
          or an older release, the card for a newer one (its notes the first
          bullets), above the status bar and clear of Herdr's update pill and
          of a toast; × remembers the release; "update" replaces the look
          (settings kept) and the card says "Updated to"; "undo" puts the old
          copy back; a changed copy is left alone, the card says so in one
          line and "copy update prompt" copies the prompt; "stop
          notifications" turns the setting off: no card, no request; the
          status bar's update pill is gone
"""
import argparse, json, os, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = os.environ.get("HERDR_APP_SANDBOX", "regress")
ROOT = f"/var/tmp/herdr-app-{NAME}"
HOME = f"{ROOT}/home"
OUT = os.environ.get("REGRESS_OUT", "/tmp/herdr-regress")
# The person's conditions by default: a HiDPI screen (scale 2), a window of
# 1280×706 (logical), herdr-app's zoom 1.2. Positions below are logical
# window pixels, as the probes report them; x() scales them for xdotool.
W, H = (int(v) for v in os.environ.get("REGRESS_SIZE", "1280x706").split("x"))
SCALE = float(os.environ.get("REGRESS_SCALE", "2"))
ZOOM = float(os.environ.get("REGRESS_ZOOM", "1.2"))
CORES = 32  # the cpu popup is tested with this many cores (a fake count)
ENV = {**os.environ, "HERDR_APP_SANDBOX": NAME, "SANDBOX_X11": "1", "SANDBOX_WIDTH": str(int(W * SCALE)),
       "SANDBOX_HEIGHT": str(int(H * SCALE)), "GPUI_X11_SCALE_FACTOR": str(SCALE),
       "DO_NOT_TRACK": "1", "HERDR_TELEMETRY": "0"}

results = []  # (scenario, case, ok, detail)


def sb(*args, check=False):
    r = subprocess.run([f"{REPO}/scripts/sandbox", *args], env=ENV, capture_output=True, text=True)
    if check and r.returncode:
        raise RuntimeError(f"sandbox {' '.join(args)}: {r.stderr or r.stdout}")
    return r.stdout


def do(action, args=None):
    out = sb("do", action, json.dumps(args or {}))
    try:
        return json.loads(out)
    except Exception:
        return {}


_win = None
def win():
    global _win
    if _win is None:
        _win = sb("x", "search", "--onlyvisible", "--name", ".").split()[0]
    return _win


def x(*args):
    """xdotool on the sandbox's display: the two numbers after each
    `--window <id>` are logical window pixels, scaled to the screen's."""
    out, i = [], 0
    while i < len(args):
        out.append(args[i])
        if args[i] == "--window" and i + 3 < len(args):
            out += [args[i + 1], round(float(args[i + 2]) * SCALE), round(float(args[i + 3]) * SCALE)]
            i += 4
            continue
        i += 1
    return sb("x", *[str(a) for a in out])


def away():
    x("mousemove", "--window", win(), 700, 300)


def click(px, py, button=1):
    x("mousemove", "--window", win(), int(px), int(py), "click", button)


def shared():
    try:
        return json.load(open(f"{HOME}/shared.json"))
    except Exception:
        return {}


def overlays():
    try:
        return json.loads(sb("status")).get("overlays", [])
    except Exception:
        return None


def wait(pred, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        v = pred()
        if v:
            return v
        time.sleep(0.15)
    return pred()


def check(scenario, case, ok, detail=""):
    results.append((scenario, case, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {scenario:6} {case}{'  — ' + detail if detail and not ok else ''}", flush=True)


def shot(name):
    os.makedirs(OUT, exist_ok=True)
    sb("shot", f"{OUT}/{name}.png")


# The bar's row, swept so every widget and card reports where it is.
def bar_y():
    p = shared().get("orbit.probe.status", {})
    if "sidebar" in p:
        return p["sidebar"]["y"] + p["sidebar"]["height"] / 2
    return H - 34 * ZOOM


def sweep():
    y = int(bar_y())
    for px in range(10, W - 10, 12):
        x("mousemove", "--window", win(), px, y)
    away()
    time.sleep(0.3)
    return shared().get("orbit.probe.status", {})


def cards():
    """The taskbar's space names, left to right (after a sweep)."""
    p = sweep()
    y = bar_y()
    on = [(v["x"], k[5:]) for k, v in p.items() if k.startswith("task:")]
    # Only cards on the bar now: a sweep refreshes every card it passes.
    return [n for _, n in sorted(on)], p


def centre(b):
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


# ---------------------------------------------------------------- setup

def setup():
    sb("down")
    os.makedirs(HOME, exist_ok=True)
    json.dump({"frame.welcomed": "skipped", "layout": "orbit", "orbit.probe": True, "orbit.probe.cores": CORES,
               "orbit.update.api": FAKE.url},
              open(f"{HOME}/shared.json", "w"))
    json.dump({"zoom": ZOOM, "telemetry": False}, open(f"{HOME}/settings.json", "w"))
    sb("up", check=True)
    time.sleep(2)
    # A fresh home shows "Updated to …" over the bar's right end: its ×, now,
    # before an agent's toast could be there instead (a click on that one
    # shows its space).
    do("space.new", {"name": "first", "folder": "/tmp"})
    time.sleep(2)
    click(W - 37 * ZOOM, H - 34 * ZOOM)
    away()
    do("space.close", {})
    time.sleep(1)
    ids = {}
    for n in ["idle", "working", "blocked", "done", "shown"]:
        r = do("space.new", {"name": n, "folder": "/tmp"})
        ids[n] = (r.get("space"), r.get("terminal"))
    time.sleep(1.5)
    report = {"working": "working", "blocked": "blocked", "done": "working"}
    for n, st in report.items():
        sb("hc", "send", ids[n][1], f"printf '\\033]7501;state={st}\\007'")
    time.sleep(1)
    # "done": it worked, then finished while another space was shown.
    sb("hc", "send", ids["done"][1], "printf '\\033]7501;state=idle\\007'")
    do("space.select", {"id": ids["shown"][0]})
    time.sleep(1.5)
    return ids


# ---------------------------------------------------------------- scenarios

def grab(name):
    from PIL import Image
    shot(name)
    return Image.open(f"{OUT}/{name}.png").convert("RGB")


def opened_rect(before, after, anchor=None):
    """Where something new appeared between two shots, above the bar (the
    bar's own figures change every second), in logical window pixels. With
    `anchor`: only the run of changed columns that holds the anchor's left
    edge (a toast elsewhere doesn't count)."""
    from PIL import ImageChops
    # From the window's top: a terminal's blinking cursor changes too, but
    # only the columns around the anchor count.
    top = int(8 * SCALE)
    bottom = int((bar_y() - 22 * ZOOM) * SCALE)
    box = (0, top, before.width, bottom)
    diff = ImageChops.difference(before.crop(box), after.crop(box)).convert("L").point(lambda v: 255 if v > 24 else 0)
    if anchor:
        cols = [diff.crop((c, 0, c + 1, diff.height)).getbbox() is not None for c in range(diff.width)]
        # the run of changed columns nearest the anchor's left edge
        a = min(max(0, int(anchor["x"] * SCALE)), diff.width - 1)
        on = [c for c, v in enumerate(cols) if v]
        if not on:
            return None
        c0 = min(on, key=lambda c: abs(c - a))
        lo = hi = c0
        while lo > 0 and cols[lo - 1]:
            lo -= 1
        while hi < diff.width - 1 and cols[hi + 1]:
            hi += 1
        diff = diff.crop((lo, 0, hi + 1, diff.height))
        bb = diff.getbbox()
        bb = bb and (bb[0] + lo, bb[1], bb[2] + lo, bb[3])
    else:
        bb = diff.getbbox()
    if not bb:
        return None
    return {"x": bb[0] / SCALE, "y": (bb[1] + top) / SCALE, "width": (bb[2] - bb[0]) / SCALE, "height": (bb[3] - bb[1]) / SCALE}


def placed_above(scenario, what, rect, anchor, width):
    """The popup's rect sits just above `anchor`: its bottom 6 above it, its
    left edge at the anchor's (or kept inside the window)."""
    if not rect:
        check(scenario, f"{what}: it shows", False, "nothing appeared above the bar")
        return
    want_x = max(8, min(anchor["x"], W - width * ZOOM - 8))
    bottom = rect["y"] + rect["height"]
    check(scenario, f"{what}: just above it", anchor["y"] - 14 <= bottom <= anchor["y"], f"bottom {bottom}, anchor top {anchor['y']}")
    check(scenario, f"{what}: at its left edge, in the window", abs(rect["x"] - want_x) <= 4 and rect["x"] + rect["width"] <= W,
          f"rect {rect}, want x {want_x}")


def popup(ids):
    for _ in range(6):
        _, p = cards()
        if all(w in p for w in ["cpu", "ram", "disk"]):
            break
        time.sleep(2)
    for w in ["cpu", "ram", "disk"]:
        if w not in p:
            check("popup", f"{w} widget found", False, "not probed")
            return
    rects = {}
    for w in ["cpu", "ram", "disk"]:
        before = grab(f"popup-{w}-0")
        click(*centre(p[w]))
        check("popup", f"{w} opens", wait(lambda: overlays() == ["orbit-dialogs"]), str(overlays()))
        away()
        time.sleep(1.5)  # cpu: two samples
        rects[w] = opened_rect(before, grab(f"popup-{w}"), p[w])
        placed_above("popup", w, rects[w], p[w], 300)
        click(*centre(p[w]))
        check("popup", f"{w}: a second click closes it", wait(lambda: overlays() == []), str(overlays()))
        time.sleep(0.4)
    # Every core's row in full inside the cpu popup (CORES of them): the
    # pointer passes over the popup and each row says where it is.
    cx, cy = centre(p["cpu"])
    click(cx, cy)
    wait(lambda: overlays() == ["orbit-dialogs"])
    time.sleep(1.5)
    r = rects["cpu"]
    if r:
        moves = []
        for yy in range(int(r["y"]) + 4, int(r["y"] + r["height"]) - 2, 6):
            for xx in range(int(r["x"]) + 6, int(r["x"] + r["width"]) - 6, 14):
                moves += ["mousemove", "--window", win(), xx, yy]
        for i in range(0, len(moves), 400):
            x(*moves[i:i + 400])
        time.sleep(0.5)
        st = shared().get("orbit.probe.stat", {})
        rows = [st.get(f"core:{n}") for n in range(CORES)]
        missing = [n for n, b in enumerate(rows) if not b]
        cut = [n for n, b in enumerate(rows) if b and not (r["y"] - 1 <= b["y"] and b["y"] + b["height"] <= r["y"] + r["height"] + 1)]
        check("popup", f"cpu: all {CORES} cores' rows, none cut", not missing and not cut, f"missing {missing}, cut {cut}")
    click(cx, cy)
    wait(lambda: overlays() == [])
    time.sleep(0.4)
    # A press beside an open popup closes it; the next click opens it again.
    click(cx, cy)
    wait(lambda: overlays() == ["orbit-dialogs"])
    click(W / 2, 200)
    check("popup", "a click beside closes", wait(lambda: overlays() == []), str(overlays()))
    time.sleep(1.8)
    click(cx, cy)
    check("popup", "then one click opens it again", wait(lambda: overlays() == ["orbit-dialogs"]), str(overlays()))
    # "open in pane ⇥": top right of the popup.
    time.sleep(0.6)
    if r:
        click(r["x"] + r["width"] - 50 * ZOOM, r["y"] + 24 * ZOOM)
    mods = lambda: [m for m in shared().get("orbit.sides", {}).get("mods", []) if (m.get("props") or {}).get("stat") == "cpu"]
    check("popup", "open in pane: the view in a pane", wait(mods), json.dumps(shared().get("orbit.sides", {}).get("mods")))
    check("popup", "open in pane: the popup closes", wait(lambda: overlays() == []), str(overlays()))
    shot("popup-pinned")


def order(ids):
    names, _ = cards()
    want = ["shown", "blocked", "done", "working"]
    # blocked and done wait for you, most recent first: done changed last.
    want_alt = ["shown", "done", "blocked", "working"]
    check("order", "shown, waiting, at work; idle left out", names in (want, want_alt), f"{names}")
    check("order", "waiting: most recent first", names == want_alt, f"{names}")
    shot("order")


def menu_click(card, item=0, scenario=None):
    """Right-clicks a card and picks the menu's item; with `scenario`, also
    checks the menu opened just above that card."""
    away()
    time.sleep(0.3)
    before = grab("menu-0")
    click(*centre(card), button=3)
    wait(lambda: overlays() == ["orbit-dialogs"])
    away()
    time.sleep(0.5)
    r = opened_rect(before, grab("menu"), card)
    if scenario:
        placed_above(scenario, "its menu", r, card, 160)
    if r:
        click(r["x"] + 40, r["y"] + (5 + 15 + 31 * item) * ZOOM)
    wait(lambda: overlays() == [])
    time.sleep(0.3)


def pin(ids):
    names, p = cards()
    plain = p["task:working"]
    menu_click(p["task:working"], scenario="pin")
    check("pin", "Pin stores it", wait(lambda: shared().get("orbit.pinned") == [ids["working"][0]]), str(shared().get("orbit.pinned")))
    names, p = cards()
    check("pin", "a pinned card leads", names[:1] == ["working"], str(names))
    card, icon = p["task:working"], p.get("pin:working")
    inside = icon and card["x"] < icon["x"] and icon["x"] + icon["width"] <= card["x"] + card["width"] \
        and card["y"] <= icon["y"] and icon["y"] + icon["height"] <= card["y"] + card["height"]
    check("pin", "a pinned card has the pin icon, inside it", inside, f"card {card} icon {icon}")
    check("pin", "the pin makes it wider, not taller", card["width"] > plain["width"] + 10 and card["height"] == plain["height"],
          f"before {plain} after {card}")
    others = [k for k in p if k.startswith("task:") and k != "task:working"]
    check("pin", "unpinned cards: their usual size", all(p[k]["height"] == plain["height"] for k in others), str(others))
    shot("pinned")
    menu_click(p["task:working"], scenario="pin")
    check("pin", "Unpin takes it out", wait(lambda: shared().get("orbit.pinned") == []), str(shared().get("orbit.pinned")))
    names, p = cards()
    check("pin", "unpinned, its group's place again", names[-1:] == ["working"], str(names))
    check("pin", "unpinned: no pin icon (its old size again)", abs(p["task:working"]["width"] - plain["width"]) < 1, f"{p['task:working']} vs {plain}")


def drag(ids):
    names, p = cards()
    a, b = p[f"task:{names[-1]}"], p[f"task:{names[0]}"]
    (ax, ay), (bx, by) = centre(a), centre(b)
    x("mousemove", "--window", win(), int(ax), int(ay), "mousedown", 1, "sleep", 0.2,
      "mousemove", "--window", win(), int((ax + bx) / 2), int(ay), "sleep", 0.2,
      "mousemove", "--window", win(), int(bx), int(by), "sleep", 0.4)
    shot("drag-over")
    x("mouseup", 1)
    moved = names[-1]
    check("drag", "the moved card is pinned", wait(lambda: shared().get("orbit.pinned") == [ids[moved][0]]), str(shared().get("orbit.pinned")))
    after, _ = cards()
    check("drag", "it lands where dropped", after[:1] == [moved], str(after))
    # A second card onto the first pinned one: in front of it, both pinned.
    names, p = cards()
    a, b = p[f"task:{names[-1]}"], p[f"task:{names[0]}"]
    (ax, ay), (bx, by) = centre(a), centre(b)
    x("mousemove", "--window", win(), int(ax), int(ay), "mousedown", 1, "sleep", 0.2,
      "mousemove", "--window", win(), int(bx), int(by), "sleep", 0.3, "mouseup", 1)
    second = names[-1]
    check("drag", "dropped in front of a pinned card: both pinned, in that order",
          wait(lambda: shared().get("orbit.pinned") == [ids[second][0], ids[moved][0]]), str(shared().get("orbit.pinned")))
    shot("drag-done")


def settings(ids):
    mine = lambda: [m for m in shared().get("orbit.sides", {}).get("mods", [])
                    if (m.get("props") or {}).get("dialog") == "settings" and m.get("space") == ids["shown"][0]]
    do("space.select", {"id": ids["shown"][0]})
    time.sleep(0.8)
    do("orbit.settings")
    check("settings", "opens in the right pane", wait(mine), json.dumps(shared().get("orbit.sides", {}).get("mods")))
    check("settings", "titled Orbit look settings", [m.get("title") for m in mine()] == ["Orbit look settings"], str(mine()))
    check("settings", "not an overlay", overlays() == [], str(overlays()))
    shot("settings")
    do("orbit.settings")
    time.sleep(1.5)
    check("settings", "again: still one", len(mine()) == 1, str(mine()))


COUNTER = """import { View, div } from "gpui-kit";
import { shared, setShared, props } from "herdr";
// tools/regress.py: counts how often a copy starts (init), by its props.tag.
export default class Counter extends View {
  init() {
    const tag = props()?.tag ?? "?";
    const all = shared("regress.inits") ?? {};
    setShared("regress.inits", { ...all, [tag]: (all[tag] ?? 0) + 1 });
  }
  render() { return div().size_full().child(`counter ${props()?.tag}`); }
}
"""


NOTIFIER = """import { View, div } from "gpui-kit";
import { props, notify, run } from "herdr";
// tools/regress.py: sets the notifications setting as the settings dialog
// does (props.set), or posts a notify() of props.level.
export default class Notifier extends View {
  init() {
    const p = props() ?? {};
    if (p.set) run(`orbit.settings ${JSON.stringify({ notify: p.set })}`);
    if (p.level) notify({ title: `${p.level} toast`, body: `a ${p.level} notification from the regression suite`, level: p.level, timeout: 5000 });
  }
  render() { return div().size_full().child("notifier"); }
}
"""

LEVELS = ["info", "success", "warning", "error"]


SETTER = """import { View, div } from "gpui-kit";
import { props, run } from "herdr";
// tools/regress.py: changes the look settings as the settings dialog does.
export default class Setter extends View {
  init() { run(`orbit.settings ${JSON.stringify(props()?.change ?? {})}`); }
  render() { return div().size_full().child("setter"); }
}
"""


def terminal(ids):
    """The terminals' font and size come from settings.json (the layout names
    none); their background from the look settings, written into
    the layout and left out of the update hash."""
    os.makedirs(f"{HOME}/mods/regress-set", exist_ok=True)
    open(f"{HOME}/mods/regress-set/main.js", "w").write(SETTER)
    open(f"{HOME}/mods/regress-set/mod.json", "w").write('{ "place": "none" }')
    do("space.select", {"id": ids["shown"][0]})
    time.sleep(0.8)
    root = lambda: json.load(open(f"{HOME}/layouts/orbit.json"))
    check("terminal", "the layout names no font or size", not {"font", "font_size"} & set(root()), str(sorted(root())))

    def change(c):
        r = do("tab.new", {"mod": "regress-set", "props": {"change": c}})
        time.sleep(0.5)
        if r.get("tab"):
            do("tab.close", {"id": r["tab"], "confirmed": True})
        time.sleep(0.8)

    def terms(name):
        time.sleep(1.2)
        return grab(name).crop((int(420 * ZOOM * SCALE), 0, int(W * SCALE), int((H - 60 * ZOOM) * SCALE)))

    def same(a, b):
        from PIL import ImageChops
        return ImageChops.difference(a, b).getbbox() is None

    for i in range(4):
        sb("hc", "send", ids["shown"][1], f"echo line {i} of the regression suite's terminal text")
    default = terms("terminal-default")
    for op in [1, 0]:
        c = {"opacity": op}
        change(c)
        got = lambda: root().get("terminal_opacity")
        check("terminal", f"{json.dumps(c)}: written", wait(lambda: got() == op), str(got()))
        ok, v = installed_ok()
        check("terminal", f"{json.dumps(c)}: still hashes as installed", ok and v == INSTALLED, str(v))
        img = terms(f"terminal-opacity-{op}")
        check("terminal", f"{json.dumps(c)}: {'as before' if op == 0 else 'shows'}", same(img, default) == (op == 0))

    base = json.load(open(f"{HOME}/settings.json"))
    def fonts(extra, name):
        json.dump({**base, **extra}, open(f"{HOME}/settings.json", "w"))
        return terms(name)
    check("terminal", "settings.json JetBrains Mono 14: as the default (0.5.0's)",
          same(fonts({"font": "JetBrains Mono", "font_size": 14}, "terminal-font-14"), default))
    check("terminal", "settings.json Geist Mono 20: applies",
          not same(fonts({"font": "Geist Mono", "font_size": 20}, "terminal-font-20"), default))
    json.dump(base, open(f"{HOME}/settings.json", "w"))


def toast(ids):
    os.makedirs(f"{HOME}/mods/regress-notify", exist_ok=True)
    open(f"{HOME}/mods/regress-notify/main.js", "w").write(NOTIFIER)
    open(f"{HOME}/mods/regress-notify/mod.json", "w").write('{ "place": "none" }')
    check("toast", "the layout names orbit-toast", json.load(open(f"{HOME}/layouts/orbit.json")).get("toast") == "orbit-toast")
    do("space.select", {"id": ids["shown"][0]})
    time.sleep(0.8)

    # Its tab is closed after the shot (closed before, the shot lost the
    # toast).
    def run_mod(props, then=lambda: None):
        r = do("tab.new", {"mod": "regress-notify", "props": props})
        time.sleep(0.5)
        then()
        if r.get("tab"):
            do("tab.close", {"id": r["tab"], "confirmed": True})

    # Overlays are listed by mod name; a toast closes after its timeout.
    toasts = lambda: [o for o in overlays() or [] if o == "orbit-toast"]
    for setting in ["all", "errors"]:
        run_mod({"set": setting})
        check("toast", f"{setting}: saved", wait(lambda: shared().get("orbit.settings", {}).get("notify") == setting),
              json.dumps(shared().get("orbit.settings")))
        for level in LEVELS:
            wait(lambda: not toasts(), 8)
            def look():
                shown = bool(wait(toasts, 1.0))
                want = setting == "all" or level == "error"
                check("toast", f"{setting}: {level} {'shows' if want else 'closes at once'}", shown == want, str(overlays()))
                time.sleep(1.5)  # the shot is the window's last frame: a moment late
                shot(f"toast-{setting}-{level}")
            run_mod({"level": level}, look)
    wait(lambda: not toasts(), 8)
    run_mod({"set": "all"})
    wait(lambda: shared().get("orbit.settings", {}).get("notify") == "all")


def keep(ids):
    os.makedirs(f"{HOME}/mods/regress-counter", exist_ok=True)
    open(f"{HOME}/mods/regress-counter/main.js", "w").write(COUNTER)
    open(f"{HOME}/mods/regress-counter/mod.json", "w").write('{ "place": "none" }\n')
    time.sleep(1.5)
    a, b = ids["shown"][0], ids["working"][0]
    do("space.select", {"id": a})
    time.sleep(1)
    run_name = "orbit.new-mod " + json.dumps({"space": a, "side": "right", "title": "counter", "mod": "regress-counter", "props": {"tag": "A"}})
    sb("do", run_name)
    inits = lambda: shared().get("regress.inits", {}).get("A", 0)
    check("keep", "the mod starts in the right pane", wait(lambda: inits() >= 1, 5), str(shared().get("regress.inits")))
    time.sleep(2)
    start = inits()
    for target in [b, a, b, a]:
        do("space.select", {"id": target})
        time.sleep(1.5)
    check("keep", "A -> B -> A twice: it never starts again", inits() == start, f"inits {start} -> {inits()}")
    # A pinned space, another outline colour.
    pinned_ids = [ids["blocked"][0]]
    # (pinning goes through the menu elsewhere; here the shared value is only read)
    do("space.select", {"id": ids["blocked"][0]})
    time.sleep(1.5)
    do("space.select", {"id": a})
    time.sleep(1.5)
    check("keep", "to another space and back: still the same copy", inits() == start, f"inits {start} -> {inits()}")
    shot("keep")


def split(ids):
    """Each space keeps its own split: the divider between the panes dragged
    in A (left wider) and B (left narrower), 60 px each, inside the panes'
    minimums (a drag past one lands a moment later at it), then A -> B -> A. Where the panes
    are is read from the tab rows' places (shared "orbit.places")."""
    os.makedirs(f"{HOME}/mods/regress-counter", exist_ok=True)
    open(f"{HOME}/mods/regress-counter/main.js", "w").write(COUNTER)
    open(f"{HOME}/mods/regress-counter/mod.json", "w").write('{ "place": "none" }\n')
    time.sleep(1.5)
    a, b, other = ids["shown"][0], ids["working"][0], ids["blocked"][0]
    left = lambda: (shared().get("orbit.places", {}).get("left-tabs") or {}).get("width", 0)
    def still():
        """The left pane's width once it holds still (a drag settles)."""
        last = None
        for _ in range(10):
            now = left()
            if now == last:
                return now
            last = now
            time.sleep(1)
        return last
    def drag_by(dx):
        pl = shared().get("orbit.places", {})
        l, r = pl.get("left-tabs"), pl.get("right-tabs")
        if not l or not r:
            return False
        gx = (l["x"] + l["width"] + r["x"]) / 2
        y = l["y"] - 120
        to = gx + dx
        x("mousemove", "--window", win(), int(gx), int(y), "mousedown", 1)
        for i in range(1, 9):
            x("mousemove", "--window", win(), int(gx + (to - gx) * i / 8), int(y))
            time.sleep(0.05)
        x("mouseup", 1)
        away()
        return True
    for sp, tag in [(a, "A"), (b, "B"), (other, "C")]:
        do("space.select", {"id": sp})
        time.sleep(1)
        sb("do", "orbit.new-mod " + json.dumps({"space": sp, "side": "right", "title": "split", "mod": "regress-counter", "props": {"tag": "split" + tag}}))
        time.sleep(1.5)
    do("space.select", {"id": a})
    time.sleep(1.5)
    base = left()
    check("split", "both panes shown", wait(lambda: drag_by(60), 3), str(shared().get("orbit.places")))
    wait(lambda: left() > base + 40, 6)
    wide = still()
    near = lambda want: wait(lambda: abs(left() - want) <= 2, 6)
    do("space.select", {"id": b})
    check("split", "a space never resized has the split it had", near(base), f"{left()} vs {base}")
    time.sleep(1)  # the switch settled before the drag
    drag_by(-60)
    wait(lambda: left() < base - 40, 6)
    narrow = still()
    nodes = lambda: json.load(open(f"{HOME}/layouts/.state/orbit.json")).get("nodes", {})
    kept = lambda sp: (shared().get("orbit.splits") or {}).get("spaces", {}).get(sp)
    at_b = (nodes().get("left-frame"), nodes().get("right-frame"), kept(b))
    check("split", "the drags took (A wide, B narrow)", wide > base + 40 and narrow < base - 40, f"base {base} A {wide} B {narrow}")
    # The sandbox's software-drawn window is slow: each switch is waited for.
    seen = []
    for sp, want in [(a, wide), (b, narrow), (a, wide)]:
        do("space.select", {"id": sp})
        seen.append((bool(near(want)), left(), want, nodes().get("left-frame"), kept(sp)))
    check("split", "A -> B -> A: each keeps its own", all(v[0] for v in seen), f"{seen} B after its drag: {at_b}")
    do("space.select", {"id": other})
    check("split", "another space, never resized: the split it had", near(base), f"{left()} vs {base}")
    do("space.select", {"id": a})
    time.sleep(1.5)
    shot("split")


def symbols(ids):
    """Each card's symbol against the sidebar's, per state. The idle case: an
    agent that reports idle, as a finished one is once seen (the sandbox's
    window never has the focus herdr counts a look by), in the shown space so
    it has a card."""
    ansi = json.load(open(f"{HOME}/themes/tokyo-night.json"))["ansi"]
    cases = [("working", "working", ansi[3]), ("blocked", "blocked", ansi[1]), ("done", "done (finished, not seen)", ansi[2]),
             ("shown", "no agent", None), ("idle", "idle (finished and seen)", None)]
    sb("hc", "send", ids["idle"][1], "printf '\\033]7501;state=idle\\007'")
    time.sleep(1)
    for name, what, fill in cases:
        if name == "idle":
            do("space.select", {"id": ids["idle"][0]})
            time.sleep(2)
        sid = ids[name][0]
        syms = shared().get("orbit.probe.symbols", {})
        bar, side = syms.get(f"taskbar:{sid}"), syms.get(f"sidebar:{sid}")
        check("symbols", f"{what}: the card's symbol is the sidebar's", bar is not None and bar == side, f"taskbar {bar} sidebar {side}")
        got = (bar or {}).get("fill")
        ok = got is None if fill is None else (got or "").lower()[:7] == fill.lower()[:7]
        check("symbols", f"{what}: {'empty' if fill is None else 'filled ' + fill}", bar is not None and ok, f"{bar}")
    shot("symbols")
    do("space.select", {"id": ids["shown"][0]})
    time.sleep(1)


def tabs(ids):
    """The shown space's accent (a band of its colour behind the sidebar's row
    and the taskbar's card) and white text (those two and the panes' shown
    tabs), for two spaces of different colours, back and forth."""
    colors = lambda: shared().get("orbit.probe.colors", {})
    fg = json.load(open(f"{HOME}/themes/tokyo-night.json"))["foreground"].lower()[:7]
    seen = {}
    for name in ["shown", "blocked"]:
        sid = ids[name][0]
        do("space.select", {"id": sid})
        time.sleep(1)
        sb("do", "orbit.new-mod " + json.dumps({"space": sid, "side": "right", "title": "memory", "mod": "orbit-dialogs",
                                                 "props": {"dialog": "stat", "stat": "ram"}}))
        time.sleep(1.5)
    for name in ["shown", "blocked", "shown", "blocked"]:
        do("space.select", {"id": ids[name][0]})
        time.sleep(1.5)
        c = {k: (v or "").lower() for k, v in colors().items()}
        band = c.get("space", "")[:7] + "29"
        check("tabs", f"{name}: the sidebar's and the taskbar's accent is the space's colour",
              c.get("space") and c.get("sidebar-band") == band and c.get("taskbar-band") == band, str(c))
        texts = {k: c.get(k, "")[:7] for k in ["sidebar-text", "taskbar-text", "left-text", "right-text"]}
        check("tabs", f"{name}: the text stays white", all(v == fg for v in texts.values()), f"{texts} want {fg}")
        seen[name] = c.get("space")
    check("tabs", "the two spaces' colours differ (the test means something)", seen["shown"] != seen["blocked"], str(seen))
    shot("tabs")
    do("space.select", {"id": ids["shown"][0]})
    time.sleep(1)


def identity(ids):
    base = f"{ROOT}/repos"
    subprocess.run(["rm", "-rf", base])
    os.makedirs(base)
    g = lambda *a, cwd=None: subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True)
    def repo(path, origin=None):
        os.makedirs(path)
        g("init", "-q", "-b", "main", cwd=path)
        g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start", cwd=path)
        if origin:
            g("remote", "add", "origin", origin, cwd=path)
    repo(f"{base}/app", "git@github.com:me/app.git")
    repo(f"{base}/elsewhere/app-clone", "https://github.com/me/app")  # the same repo, another place
    g("worktree", "add", "-q", "-b", "fix", f"{base}/app-fix", cwd=f"{base}/app")
    repo(f"{base}/notes")  # no origin
    g("worktree", "add", "-q", "-b", "draft", f"{base}/notes-draft", cwd=f"{base}/notes")
    repo(f"{base}/other", "git@github.com:me/other.git")
    made = {}
    for name, folder in [("app here", "app"), ("app there", "elsewhere/app-clone"), ("app fix", "app-fix"),
                         ("notes", "notes"), ("notes draft", "notes-draft"), ("other", "other")]:
        made[name] = do("space.new", {"name": name, "folder": f"{base}/{folder}"}).get("space")
    look = lambda: shared().get("orbit.identity", {})
    have = lambda: all("origin" in (shared().get("orbit.git", {}).get(sid) or {}) for sid in made.values())
    check("identity", "every new space's repo looked up", wait(have, 15), json.dumps({k: shared().get("orbit.git", {}).get(v) for k, v in made.items()}))
    time.sleep(1)
    idt = {k: look().get(v) for k, v in made.items()}
    same = lambda a, b: idt[a] is not None and idt[a] == idt[b]
    check("identity", "same repo, another place (another machine): same colour and symbol", same("app here", "app there"), str(idt))
    check("identity", "a worktree and its main checkout: same", same("app here", "app fix"), str(idt))
    check("identity", "without an origin, a worktree and its main checkout: same", same("notes", "notes draft"), str(idt))
    check("identity", "another repo: its own", idt["other"] is not None and idt["other"] != idt["app here"], str(idt))
    for sid in made.values():
        do("space.close", {"id": sid})
    time.sleep(1)


# ---------------------------------------------------------------- update

class FakeGitHub:
    """GitHub's latest-release answer, served locally: `release` is what it
    answers (None: 404, as before the first release); `hits` the requests'
    headers."""
    def __init__(self):
        fake = self
        self.release, self.hits, self.downloads, self.tarballs = None, [], [], []
        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path.startswith("/repos/Calonca/herdr-orbit-look/tarball/"):
                    # As GitHub's API: 415 to an Accept it refuses, else a
                    # redirect to the archive (codeload there).
                    accept = self.headers.get("Accept", "")
                    fake.tarballs.append(accept)
                    if accept and not any(a.split(";")[0].strip() in ("*/*", "application/vnd.github+json", "application/json")
                                          for a in accept.split(",")):
                        self.send_response(415)
                        self.end_headers()
                        return
                    self.send_response(302)
                    self.send_header("Location", f"/archive/{self.path.rsplit('/', 1)[1]}.tar.gz")
                    self.end_headers()
                    return
                if self.path.startswith("/archive/"):
                    # This repo's look as release <tag>: stamped, and a mark in orbit-status.
                    data = release_archive(self.path[len("/archive/"):-len(".tar.gz")])
                    fake.downloads.append(self.path)
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                fake.hits.append({k.lower(): v for k, v in self.headers.items()})
                body = json.dumps(fake.release or {"message": "Not Found"}).encode()
                self.send_response(200 if fake.release else 404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *a):
                pass
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/repos/Calonca/herdr-orbit-look/releases/latest"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def answer(self, tag, bullets=("one", "two", "three", "four")):
        base = self.url.split("/repos/")[0]
        self.release = {"tag_name": tag, "draft": False, "prerelease": False, "html_url": "https://example.invalid",
                        "tarball_url": f"{base}/repos/Calonca/herdr-orbit-look/tarball/{tag}",
                        "body": f"## {tag}\n\n" + "\n".join(f"- **{b}.** detail {b}" for b in bullets)}


def release_archive(tag):
    """A release archive as GitHub's (one top folder): this repo's look,
    marked "// release <tag>" in orbit-status, stamped <tag>."""
    import io, shutil, tarfile, tempfile
    with tempfile.TemporaryDirectory() as tmp:
        tree = f"{tmp}/Calonca-herdr-orbit-look-0000000"
        for sub in ("themes", "mods", "layouts"):
            shutil.copytree(f"{REPO}/{sub}", f"{tree}/{sub}", ignore=shutil.ignore_patterns("jsconfig.json", "*.d.ts", "__pycache__"))
        shutil.copy(f"{REPO}/keys.json", tree)
        with open(f"{tree}/mods/orbit-status/main.js", "a") as f:
            f.write(f"\n// release {tag}\n")
        subprocess.run([sys.executable, f"{REPO}/mods/orbit/update.py", "stamp", tree, "--version", tag.lstrip("v")], check=True)
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            tar.add(tree, arcname=os.path.basename(tree))
        return buf.getvalue()


def installed_ok():
    """The sandbox's look hashes as its VERSION records: (ok, version)."""
    r = subprocess.run([sys.executable, "-c", "import importlib.util,sys; s=importlib.util.spec_from_file_location('u', sys.argv[1]); "
                        "u=importlib.util.module_from_spec(s); s.loader.exec_module(u); print(u.installed(sys.argv[2])[0])",
                        f"{HOME}/mods/orbit/update.py", HOME], capture_output=True, text=True,
                       env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    return r.returncode == 0, (r.stdout.strip() or r.stderr.strip().splitlines()[-1:])


FAKE = FakeGitHub()
# update.py downloads only this repo's archives on GitHub; the fake's address
# is allowed by its test switch (the sandbox's herdr-app passes it on).
ENV["HERDR_ORBIT_UPDATE_TEST_ARCHIVE"] = FAKE.url.split("/repos/")[0] + "/"
INSTALLED = open(f"{REPO}/mods/orbit/VERSION").read().split("\n")[0].strip()
MAJOR, MINOR, PATCH = (int(v) for v in INSTALLED.split("."))


def card():
    return shared().get("orbit.probe.update")


def update_state():
    try:
        return json.load(open(f"{HOME}/data/orbit-updates/state.json"))
    except Exception:
        return {}


def check_now(tag=None):
    """The fake answers `tag`; the orbit mod looks now (orbit.update-check)."""
    n = len(FAKE.hits)
    if tag:
        FAKE.answer(tag)
    sb("do", "orbit.update-check {}")
    wait(lambda: len(FAKE.hits) > n, 5)
    # Then the answer is saved (data/orbit-updates/state.json) and the card placed.
    want = FAKE.release and FAKE.release["tag_name"]
    wait(lambda: len(FAKE.hits) > n and (update_state().get("latest") or {}).get("tag") == want, 5)
    time.sleep(1)
    return len(FAKE.hits) > n


def card_point(r, what):
    """Where on the card (orbit-dialogs update.js' lengths) to click: "close",
    the first button ("first": update, undo, copy update prompt) or the
    second ("second": stop notifications)."""
    z = ZOOM
    if what == "close":
        return r["x"] + (280 - 1 - 16 - 10) * z, r["y"] + (14 + 10) * z
    if what == "second":
        return r["x"] + (1 + 16 + 16 + 74 + 6 + 40) * z, r["y"] + (r["h"] - 14 - 14) * z
    return r["x"] + (1 + 16 + 16 + 20) * z, r["y"] + (r["h"] - 14 - 14) * z


def clipboard():
    num = 100 + int(subprocess.run(["cksum"], input=NAME, capture_output=True, text=True).stdout.split()[0]) % 400
    r = subprocess.run(["xsel", "-o", "-b"], env={**os.environ, "DISPLAY": f":{num}"}, capture_output=True, text=True, timeout=5)
    return r.stdout


def set_updates(on):
    sb("do", "orbit.settings " + json.dumps({"updates": on}))
    return wait(lambda: shared().get("orbit.settings", {}).get("updates") is on)


def herdr_pill():
    """Herdr's update pill (its frame: 16 px from the right and the bottom,
    34 px tall), in logical window pixels: its top."""
    return H - (16 + 34) * ZOOM


def update(ids):
    newer = lambda d: f"v{MAJOR}.{MINOR + d}.0"
    ok, v = installed_ok()
    check("update", "after the other scenarios the look hashes as installed (the layout the orbit mod rewrote too)", ok and v == INSTALLED, f"{ok} {v}")
    src = open(f"{REPO}/mods/orbit-status/main.js").read()
    check("update", "the status bar has no update pill", "update ready" not in src and "updates()" not in src)
    do("space.select", {"id": ids["shown"][0]})
    time.sleep(0.8)

    hit = check_now(f"v{INSTALLED}")
    check("update", "it asks the (fake) API", hit, f"{len(FAKE.hits)} requests")
    h = FAKE.hits[-1] if FAKE.hits else {}
    check("update", "a generic User-Agent, nothing else of the person's", h.get("user-agent") == "herdr-orbit-look"
          and not any(k in h for k in ("authorization", "cookie", "x-github-api-version")), json.dumps(h))
    check("update", f"the same release (v{INSTALLED}): no card", not card(), str(card()))
    check_now(f"v{MAJOR}.{max(0, MINOR - 1)}.0")
    check("update", "an older release: no card", not card(), str(card()))

    check_now(newer(1))
    r = wait(lambda: (card() or {}).get("tag") == newer(1) and card(), 5)
    check("update", f"a newer release ({newer(1)}): the card shows", r and r.get("tag") == newer(1) and "orbit-dialogs" in (overlays() or []),
          f"{r} {overlays()}")
    time.sleep(1)
    shot("update-card")
    st = update_state()
    check("update", "its notes: the first three bullets, plain", (st.get("latest") or {}).get("notes") == ["one. detail one", "two. detail two", "three. detail three"], json.dumps(st))
    if r:
        bottom = r["y"] + r["h"] * ZOOM
        bar_top = bar_y() - 20 * ZOOM
        check("update", "above the status bar, at the right edge", bottom <= bar_top + 1 and r["x"] + 280 * ZOOM <= W, f"{r} bar top {bar_top}")
        check("update", "clear of Herdr's update pill", bottom <= herdr_pill() - 4, f"bottom {bottom} pill top {herdr_pill()}")

    # A toast: the card moves up, clear of it.
    os.makedirs(f"{HOME}/mods/regress-notify", exist_ok=True)
    open(f"{HOME}/mods/regress-notify/main.js", "w").write(NOTIFIER)
    open(f"{HOME}/mods/regress-notify/mod.json", "w").write('{ "place": "none" }')
    time.sleep(0.5)
    t = do("tab.new", {"mod": "regress-notify", "props": {"level": "info"}})
    moved = wait(lambda: card() and r and card()["y"] < r["y"] - 70 * ZOOM, 3)
    top_toast = H - (16 + 34 + 8 + 72) * ZOOM
    check("update", "a toast: the card moves up, clear of it", moved and card()["y"] + card()["h"] * ZOOM <= top_toast - 4,
          f"{card()} toast top {top_toast}")
    time.sleep(1)
    shot("update-card-toast")
    if t.get("tab"):
        do("tab.close", {"id": t["tab"], "confirmed": True})
    back = wait(lambda: card() and r and abs(card()["y"] - r["y"]) < 2, 12)
    check("update", "the toast gone: the card back in its place", back, f"{card()} was {r}")

    # Herdr's own pill showing ("Updated to …" after a start on a new version), compact.
    sb("do", "orbit.settings " + json.dumps({"density": "compact"}))
    time.sleep(1.5)
    shot("update-card-compact")
    c = card()
    check("update", "compact: still clear of Herdr's pill", c and c["y"] + c["h"] * ZOOM <= herdr_pill() - 4, f"{c} pill top {herdr_pill()}")
    sb("do", "orbit.settings " + json.dumps({"density": "comfortable"}))
    # (Clicked once it's back in its place.)
    c = wait(lambda: card() and r and abs(card()["y"] - r["y"]) < 2 and card(), 5)
    time.sleep(0.5)

    # ×: gone, and not again for that release.
    if c:
        click(*card_point(c, "close"))
    check("update", "× closes it", wait(lambda: "orbit-dialogs" not in (overlays() or []), 3), str(overlays()))
    check("update", "× remembers the release", wait(lambda: update_state().get("closed") == newer(1) and not card(), 6), json.dumps(update_state()))
    check_now()
    check("update", "the same release again: no card", not card(), str(card()))

    # "update": the look replaced by the release, the settings kept.
    settings_before = json.dumps(shared().get("orbit.settings"), sort_keys=True)
    check_now(newer(2))
    c = wait(lambda: (card() or {}).get("tag") == newer(2) and card(), 5)
    check("update", f"{newer(2)}: the card", c and c.get("tag") == newer(2), str(c))
    n = len(FAKE.downloads)
    if c:
        click(*card_point(c, "first"))
    done = wait(lambda: (card() or {}).get("mode") == "updated", 20)
    check("update", "\"update\" downloads the release once", len(FAKE.downloads) == n + 1, str(FAKE.downloads))
    time.sleep(2)
    shot("update-updated")
    ok, v = installed_ok()
    check("update", "\"update\" replaces the look: the new version, as recorded", ok and v == newer(2).lstrip("v")
          and f"// release {newer(2)}" in open(f"{HOME}/mods/orbit-status/main.js").read(), f"{ok} {v}")
    check("update", "then the card says \"Updated to\"", done, str(card()))
    check("update", "one card only (the one from before the reload is gone)", wait(lambda: (overlays() or []).count("orbit-dialogs") == 1, 5), str(overlays()))
    check("update", "the settings stay", json.dumps(shared().get("orbit.settings"), sort_keys=True) == settings_before,
          f"{shared().get('orbit.settings')} was {settings_before}")
    check("update", "the previous copy is kept", os.path.isfile(f"{HOME}/data/orbit-updates/previous/mods/orbit/VERSION"))
    check("update", "the status bar runs the new copy", wait(lambda: bar_y() is not None, 5), "")

    # "undo": the copy from before back, and no card for that release.
    c = card()
    if c:
        click(*card_point(c, "first"))
    back = wait(lambda: installed_ok() == (True, INSTALLED), 20)
    check("update", "\"undo\" puts the old copy back", back and "// release" not in open(f"{HOME}/mods/orbit-status/main.js").read(), str(installed_ok()))
    time.sleep(3)
    check("update", "after undo: no card for that release", wait(lambda: not card(), 5), str(card()))
    shot("update-undone")

    # A changed copy: left alone, one line, "copy update prompt".
    path = f"{HOME}/mods/orbit-tabs/main.js"
    original = open(path).read()
    open(path, "a").write("\n// my own change\n")
    check_now(newer(3))
    c = wait(lambda: (card() or {}).get("tag") == newer(3) and card(), 5)
    n = len(FAKE.downloads)
    if c:
        click(*card_point(c, "first"))
    err = wait(lambda: (card() or {}).get("mode") == "error" and card(), 10)
    check("update", "a changed copy: the card says so, nothing replaced, nothing downloaded",
          err and installed_ok()[1] != newer(3).lstrip("v") and "// my own change" in open(path).read() and len(FAKE.downloads) == n,
          f"{card()} {installed_ok()} {FAKE.downloads}")
    time.sleep(1)
    shot("update-changed")
    if err:
        click(*card_point(err, "first"))
    got = wait(lambda: newer(3) in clipboard() and clipboard(), 5) or clipboard()
    check("update", "\"copy update prompt\" copies the prompt", newer(3) in got and got.startswith("Read ~/.config/herdr-app/AGENTS.md")
          and "keep those changes" in got, repr(got))
    time.sleep(0.5)
    shot("update-copied")
    open(path, "w").write(original)
    c = card()
    if c:
        click(*card_point(c, "close"))
    check("update", "× closes the error card", wait(lambda: not card(), 3), str(card()))

    # "stop notifications": the setting off, no card, no request; on again: back.
    check_now(newer(4))
    c = wait(lambda: (card() or {}).get("tag") == newer(4) and card(), 5)
    check("update", f"{newer(4)}: the card", c, str(card()))
    if c:
        click(*card_point(c, "second"))
    check("update", "\"stop notifications\": the card goes, the setting is off",
          wait(lambda: not card() and shared().get("orbit.settings", {}).get("updates") is False, 4),
          f"{card()} {shared().get('orbit.settings')}")
    check("update", "off: no request", not check_now(newer(5)), f"{len(FAKE.hits)} requests")
    check("update", "off: still no card", not card(), str(card()))
    set_updates(True)
    check("update", "on again (the settings row): it asks, and the card is back", check_now() and wait(card, 3), str(card()))
    # The settings row.
    sb("do", "orbit.settings")
    time.sleep(1.5)
    shot("update-settings")
    c = card()
    if c:
        click(*card_point(c, "close"))
    wait(lambda: not card(), 3)
    ok, v = installed_ok()
    check("update", "at the end: the look hashes as installed", ok and v == INSTALLED, f"{ok} {v}")


def update_pill(ids):
    """Herdr's own pill shows ("Updated to …", after a start on a new
    version): the card is above it. A restart of the window, so it's last."""
    nxt = f"v{MAJOR}.{MINOR + 9}.0"
    json.dump({"last_run": "0.0.1", "presented": []}, open(f"{HOME}/update-notes.json", "w"))
    sb("restart", check=True)
    time.sleep(4)
    # The orbit mod takes commands once it has started again.
    for _ in range(4):
        if check_now(nxt):
            break
    c = wait(lambda: (card() or {}).get("tag") == nxt and card(), 8)
    time.sleep(1.5)
    shot("update-pill")
    check("update", "Herdr's pill showing: the card above it", c and c["y"] + c["h"] * ZOOM <= herdr_pill() - 4, f"{c} pill top {herdr_pill()}")


SCENARIOS = [("popup", popup), ("order", order), ("pin", pin), ("drag", drag), ("symbols", symbols), ("tabs", tabs), ("identity", identity), ("settings", settings), ("terminal", terminal), ("toast", toast), ("keep", keep), ("split", split), ("update", update), ("update-pill", update_pill)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-k", default="")
    ap.add_argument("--down", action="store_true")
    a = ap.parse_args()
    ids = setup()
    try:
        for name, f in SCENARIOS:
            if a.k in name:
                try:
                    f(ids)
                except Exception as e:
                    check(name, "ran", False, repr(e))
    finally:
        if a.down:
            sb("down")
    failed = [r for r in results if not r[2]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
