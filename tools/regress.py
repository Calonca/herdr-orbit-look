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
  settings  orbit.settings (ctrl-,) opens Orbit look settings in the right
          pane, not an overlay; again, it shows that one (no second copy)
"""
import argparse, json, os, subprocess, sys, time

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
    json.dump({"frame.welcomed": "skipped", "layout": "orbit", "orbit.probe": True, "orbit.probe.cores": CORES},
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
    top = int(110 * SCALE)  # below a terminal's blinking cursor
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


SCENARIOS = [("popup", popup), ("order", order), ("pin", pin), ("drag", drag), ("settings", settings)]


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
