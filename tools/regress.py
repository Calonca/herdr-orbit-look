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
  pin     right-click → Pin puts a card first ("orbit.pinned"); Unpin takes it
          out again
  drag    a card dragged onto another lands in its place, pinned
"""
import argparse, json, os, subprocess, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = os.environ.get("HERDR_APP_SANDBOX", "regress")
ROOT = f"/var/tmp/herdr-app-{NAME}"
HOME = f"{ROOT}/home"
OUT = os.environ.get("REGRESS_OUT", "/tmp/herdr-regress")
W, H = 1280, 820
ENV = {**os.environ, "HERDR_APP_SANDBOX": NAME, "SANDBOX_X11": "1", "SANDBOX_WIDTH": str(W),
       "SANDBOX_HEIGHT": str(H), "DO_NOT_TRACK": "1", "HERDR_TELEMETRY": "0"}

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
    return sb("x", *[str(a) for a in args])


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
    return H - 34


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
    json.dump({"frame.welcomed": "skipped", "layout": "orbit", "orbit.probe": True}, open(f"{HOME}/shared.json", "w"))
    sb("up", check=True)
    time.sleep(2)
    # A fresh home shows "Updated to …" over the bar's right end: its ×, now,
    # before an agent's toast could be there instead (a click on that one
    # shows its space).
    do("space.new", {"name": "first", "folder": "/tmp"})
    time.sleep(2)
    click(W - 37, H - 34)
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
    cx, cy = centre(p["cpu"])
    click(cx, cy)
    check("popup", "cpu opens", wait(lambda: overlays() == ["orbit-dialogs"]), str(overlays()))
    shot("popup-cpu")
    click(cx, cy)
    check("popup", "second click closes", wait(lambda: overlays() == []), str(overlays()))
    click(cx, cy)
    wait(lambda: overlays() == ["orbit-dialogs"])
    click(700, 300)
    check("popup", "a click beside closes", wait(lambda: overlays() == []), str(overlays()))
    time.sleep(0.5)  # the bar notices (it polls) before the next click
    for w in ["ram", "disk"]:
        click(*centre(p[w]))
        check("popup", f"{w} opens", wait(lambda: overlays() == ["orbit-dialogs"]), str(overlays()))
        click(*centre(p[w]))
        check("popup", f"{w} closes again", wait(lambda: overlays() == []), str(overlays()))
    # "open in pane ⇥": top right of the popup (300 wide, 250 tall, above cpu).
    time.sleep(0.5)
    click(cx, cy)
    wait(lambda: overlays() == ["orbit-dialogs"])
    time.sleep(0.4)
    left = min(p["cpu"]["x"], W - 300 - 8)
    top = p["cpu"]["y"] - 250 - 6
    click(left + 300 - 60, top + 23)
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


def menu_click(card, item=0):
    b = card
    click(*centre(b), button=3)
    wait(lambda: overlays() == ["orbit-dialogs"])
    time.sleep(0.3)
    # The menu: above the card, 41 tall, its first item 5 below its top.
    click(b["x"] + 40, b["y"] - 41 - 6 + 5 + 15 + 31 * item)
    wait(lambda: overlays() == [])


def pin(ids):
    names, p = cards()
    menu_click(p["task:working"])
    check("pin", "Pin stores it", wait(lambda: shared().get("orbit.pinned") == [ids["working"][0]]), str(shared().get("orbit.pinned")))
    names, p = cards()
    check("pin", "a pinned card leads", names[:1] == ["working"], str(names))
    menu_click(p["task:working"])
    check("pin", "Unpin takes it out", wait(lambda: shared().get("orbit.pinned") == []), str(shared().get("orbit.pinned")))
    names, _ = cards()
    check("pin", "unpinned, its group's place again", names[-1:] == ["working"], str(names))


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


SCENARIOS = [("popup", popup), ("order", order), ("pin", pin), ("drag", drag)]


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
