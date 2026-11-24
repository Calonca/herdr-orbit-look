#!/usr/bin/env python3
"""Regression suite for the orbit look's status bar: real clicks in a sandbox
(scripts/sandbox: a headless Wayland display of its own, on the GPU, its own
app home and herdr core; never the person's display or app), then state checks.

    tools/regress.py            a fresh sandbox (HERDR_APP_SANDBOX, default
                                "regress"), every scenario, a PASS/FAIL table;
                                the sandbox stays up
    tools/regress.py --down     the same, then the sandbox goes
    tools/regress.py -k drag    only scenarios whose name has "drag"
    tools/regress.py --reuse -k drag   on the sandbox the last run left up (same
                                size, scale and zoom): the mods are installed
                                again and reload live, its spaces are kept, no
                                new start; a fresh one (3 s) if there is none
                                or its agents are not as they were at the start

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
  row     the tab row: the first tab's outline is the pane's own left edge, no
          gap before it; showing another tab moves only the outline (every
          icon and label on the same pixels with each tab shown); the outline
          is one line, each of the shown tab's top corners a quarter circle
          as thick as the lines it joins, at zoom 1, 1.2 and 1.4
  tabdrag dragging a tab: a pale grey ghost in its place, a copy at the
          pointer, the bar where it would land, nothing else changed; moved
          in its row and to the other pane's row and back, at the bar's
          place, its terminal the same process; Escape, a drop on the sidebar
          or outside the window: nothing changed, the keys where they were
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
  padding a terminal's cells near its pane's outline at each density: the
          line and the padding on the left (compact [2, 0] < default [4, 0]
          < comfortable [8, 0], all below the old [8, 6] [14, 12] [18, 16]),
          less than a cell more on the right, half a row at the bottom
  spacing nothing between the pane's outline and its content, above or below:
          Files, Changes and a plain mod touch it at the top and the bottom;
          a terminal (in either pane) has half of what whole
          rows leave over above it and half below; at zoom 1, 1.2 and 1.4, in
          each density, tabs at the bottom and on top
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
import argparse, hashlib, json, os, subprocess, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = os.environ.get("HERDR_APP_SANDBOX", "regress")
ROOT = f"/var/tmp/herdr-app-{NAME}"
HOME = f"{ROOT}/home"
OUT = os.environ.get("REGRESS_OUT", "/tmp/herdr-regress")
W, H = (int(v) for v in os.environ.get("REGRESS_SIZE", "1280x706").split("x"))
SCALE = float(os.environ.get("REGRESS_SCALE", "2"))
ZOOM = float(os.environ.get("REGRESS_ZOOM", "1.2"))
CORES = 32
ENV = {**os.environ, "HERDR_APP_SANDBOX": NAME, "SANDBOX_WIDTH": str(int(W * SCALE)),
       "SANDBOX_HEIGHT": str(int(H * SCALE)), "SANDBOX_SCALE": str(SCALE),
       "DO_NOT_TRACK": "1", "HERDR_TELEMETRY": "0"}

results = []


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


def win():
    """The window, for x()'s `--window`: the sandbox has the one."""
    return "herdr"


def x(*args):
    """The sandbox's mouse and keyboard (scripts/sandbox input), in logical
    window pixels: the window is at the display's top left, so the
    `--window <id>` of a mousemove needs nothing done."""
    out, args = [], list(args)
    while args:
        a = args.pop(0)
        if a == "--window":
            args.pop(0)
        else:
            out.append(str(a))
    return sb("input", *out, check=True)


def away():
    x("mousemove", "--window", win(), 700, 300)


def click(px, py, button=1):
    x("mousemove", "--window", win(), int(px), int(py), "click", button)


def shared():
    try:
        return json.load(open(f"{HOME}/shared.json"))
    except Exception:
        return {}


def status():
    try:
        return json.loads(sb("status"))
    except Exception:
        return {}


def overlays():
    return status().get("overlays")


def wait(pred, timeout=3.0):
    end = time.time() + timeout
    while time.time() < end:
        v = pred()
        if v:
            return v
        time.sleep(0.04)
    return pred()


def quiet(hold=0.2, timeout=4.0):
    """Until what the mods share (shared.json, written as they react) has held
    still for `hold` seconds: after an action, they have taken it in."""
    def stamp():
        try:
            st = os.stat(f"{HOME}/shared.json")
            return st.st_mtime_ns, st.st_size
        except OSError:
            return None
    end = time.time() + timeout
    last, since = stamp(), time.time()
    while time.time() < end and time.time() - since < hold:
        time.sleep(0.03)
        now = stamp()
        if now != last:
            last, since = now, time.time()


def select(sid):
    """Shows a space, and waits until it and its panes are the shown ones."""
    do("space.select", {"id": sid})
    wait(lambda: status().get("space") == sid)
    quiet()


def check(scenario, case, ok, detail=""):
    results.append((scenario, case, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {scenario:6} {case}{'  — ' + detail if detail and not ok else ''}", flush=True)


def shot(name):
    os.makedirs(OUT, exist_ok=True)
    sb("shot", f"{OUT}/{name}.png")


def bar_y():
    p = shared().get("orbit.probe.status", {})
    if "sidebar" in p:
        return p["sidebar"]["y"] + p["sidebar"]["height"] / 2
    return H - 34 * ZOOM


def sweep():
    y = int(bar_y())
    moves = []
    for px in range(10, W - 10, 12):
        moves += ["mousemove", "--window", win(), px, y, "sleep", 0.003]
    x(*moves)
    away()
    quiet(0.2)
    return shared().get("orbit.probe.status", {})


def cards():
    """The taskbar's space names, left to right (after a sweep)."""
    p = sweep()
    y = bar_y()
    on = [(v["x"], k[5:]) for k, v in p.items() if k.startswith("task:")]
    return [n for _, n in sorted(on)], p


def centre(b):
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2



KEPT = f"{ROOT}/regress.json"
KIND = [W, H, SCALE, ZOOM]


def kept():
    """What a run left in its sandbox for the next: {kind, ids, port, look}."""
    try:
        return json.load(open(KEPT))
    except Exception:
        return {}


RESET = """import { View, div } from "gpui-kit";
import { setShared } from "herdr";
// tools/regress.py --reuse: nothing pinned.
export default class Reset extends View {
  init() { setShared("orbit.pinned", []); }
  render() { return div(); }
}
"""


def look():
    """A hash of what install.sh installs from this repo."""
    h = hashlib.sha256(open(f"{REPO}/keys.json", "rb").read())
    for sub in ("themes", "mods", "layouts"):
        for at, dirs, files in sorted(os.walk(f"{REPO}/{sub}")):
            for f in sorted(files):
                if "__pycache__" not in at:
                    h.update(f"{at}/{f}".encode() + open(f"{at}/{f}", "rb").read())
    return h.hexdigest()


def keep_for_reuse(ids):
    json.dump({"kind": KIND, "ids": ids, "port": FAKE.port, "look": look()}, open(KEPT, "w"))


def reuse():
    """The spaces of the sandbox that is up, as they are but for what is quick
    to put back: this repo's mods (which reload live), no overlay, nothing
    pinned, no other spaces. None when there is none up (or of another size,
    without those spaces or with their agents in other states)."""
    if kept().get("kind") != KIND or kept().get("port") != FAKE.port:
        return None
    ids = {k: tuple(v) for k, v in kept()["ids"].items()}
    there = {s["id"]: s for s in json.loads(sb("ls") or "{}").get("spaces", [])}
    states = {t["terminal"]: t["status"] for s in there.values() for b in s["tabs"] for t in b["terminals"]}
    if not {v[0] for v in ids.values()} <= set(there) or \
            [states.get(ids[n][1]) for n in ("working", "blocked", "done")] != ["working", "blocked", "done"]:
        return None
    if kept().get("look") != look():
        subprocess.run([f"{REPO}/install.sh"], env={**os.environ, "HERDR_APP_HOME": HOME}, check=True, stdout=subprocess.DEVNULL)
        quiet(1)
        keep_for_reuse(ids)
    x("mouseup", 1)
    for sid in set(there) - {v[0] for v in ids.values()}:
        do("space.close", {"id": sid, "confirmed": True})
    do("space.select", {"id": ids["shown"][0]})
    for _ in range(4):
        if not overlays():
            break
        x("key", "Escape")
        wait(lambda: not overlays(), 0.5)
    if shared().get("orbit.pinned"):
        tab = do("tab.new", {"mod": "regress-reset"}).get("tab")
        wait(lambda: not shared().get("orbit.pinned"))
        do("tab.close", {"id": tab, "confirmed": True})
    quiet()
    return ids


def setup():
    sb("down")
    os.makedirs(HOME, exist_ok=True)
    json.dump({"frame.welcomed": "skipped", "layout": "orbit", "orbit.probe": True, "orbit.probe.cores": CORES,
               "orbit.update.api": FAKE.url},
              open(f"{HOME}/shared.json", "w"))
    json.dump({"zoom": ZOOM, "telemetry": False}, open(f"{HOME}/settings.json", "w"))
    # Herdr's "What's new" already seen: it would cover the window.
    version = subprocess.run([os.environ.get("HERDR_APP_BIN", "herdr-app"), "--version"], capture_output=True, text=True).stdout.split()[-1:]
    if version:
        json.dump({"last_run": version[0], "presented": version}, open(f"{HOME}/update-notes.json", "w"))
    os.makedirs(f"{HOME}/mods/regress-reset", exist_ok=True)
    open(f"{HOME}/mods/regress-reset/main.js", "w").write(RESET)
    open(f"{HOME}/mods/regress-reset/mod.json", "w").write('{ "place": "none" }')
    sb("up", check=True)
    quiet(0.5)
    return spaces()


def report(term, state):
    """The pretend agent (tools/report-state.sh) in that terminal reports it."""
    sb("hc", "keys", term, *state, "enter")
    wait(lambda: f'"state":"{state}"' in sb("hc", "get", term))


def notifications(which):
    do("orbit.settings " + json.dumps({"notify": which}))
    wait(lambda: shared().get("orbit.settings", {}).get("notify") == which)


def spaces():
    """The five spaces, three with an agent: at work, blocked, and one that
    finished unseen. Only "shown" is looked at."""
    ids = {}
    for n in ["idle", "working", "blocked", "done", "shown"]:
        argv = {} if n == "shown" else {"argv": [f"{REPO}/tools/report-state.sh"]}
        r = do("space.new", {"name": n, "folder": "/tmp", **argv})
        ids[n] = (r.get("space"), r.get("terminal"))
    notifications("errors")  # no toast for the one that finishes
    select(ids["shown"][0])
    report(ids["blocked"][1], "blocked")
    if wait(overlays, 2):  # its toast: a click closes it (and goes there)
        click(W - 60 * ZOOM, H - 50 * ZOOM)
        wait(lambda: not overlays())
        away()
    select(ids["shown"][0])
    report(ids["working"][1], "working")
    report(ids["done"][1], "working")
    report(ids["done"][1], "idle")
    quiet()
    notifications("all")
    keep_for_reuse(ids)
    return ids



def grab(name):
    from PIL import Image
    shot(name)
    return Image.open(f"{OUT}/{name}.png").convert("RGB")


def still(name, box=None, timeout=3.0):
    """A shot once two in a row are the same there (logical `box`; the whole
    window above the bar without one: the bar's figures never hold still)."""
    box = [int(v * SCALE) for v in box or (0, 8, W, bar_y() - 22 * ZOOM)]
    end, last = time.time() + timeout, None
    while True:
        img = grab(name)
        part = img.crop(box).tobytes()
        if part == last or time.time() > end:
            return img
        last = part
        time.sleep(0.1)


def opened_rect(before, after, anchor=None):
    """Where something new appeared between two shots, above the bar (the
    bar's own figures change every second), in logical window pixels. With
    `anchor`: only the run of changed columns that holds the anchor's left
    edge (a toast elsewhere doesn't count)."""
    from PIL import ImageChops
    top = int(8 * SCALE)
    bottom = int((bar_y() - 22 * ZOOM) * SCALE)
    box = (0, top, before.width, bottom)
    diff = ImageChops.difference(before.crop(box), after.crop(box)).convert("L").point(lambda v: 255 if v > 24 else 0)
    if anchor:
        cols = [diff.crop((c, 0, c + 1, diff.height)).getbbox() is not None for c in range(diff.width)]
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
    for _ in range(10):
        _, p = cards()
        if all(w in p for w in ["cpu", "ram", "disk"]):
            break
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
        quiet()
        rects[w] = opened_rect(before, still(f"popup-{w}"), p[w])
        placed_above("popup", w, rects[w], p[w], 300)
        click(*centre(p[w]))
        check("popup", f"{w}: a second click closes it", wait(lambda: overlays() == []), str(overlays()))
        quiet()
    cx, cy = centre(p["cpu"])
    edge = lambda img: img.getpixel((int((p["cpu"]["x"] + 3) * SCALE), int(cy * SCALE)))
    away()
    quiet()
    plain = edge(grab("popup-plain"))
    click(cx, cy)
    wait(lambda: overlays() == ["orbit-dialogs"])
    quiet()
    r = rects["cpu"]
    if r:
        moves = []
        for yy in range(int(r["y"]) + 4, int(r["y"] + r["height"]) - 2, 6):
            for xx in range(int(r["x"]) + 6, int(r["x"] + r["width"]) - 6, 40):
                moves += ["mousemove", "--window", win(), xx, yy]
        for i in range(0, len(moves), 400):
            x(*moves[i:i + 400])
        quiet()
        st = shared().get("orbit.probe.stat", {})
        rows = [st.get(f"core:{n}") for n in range(CORES)]
        missing = [n for n, b in enumerate(rows) if not b]
        cut = [n for n, b in enumerate(rows) if b and not (r["y"] - 1 <= b["y"] and b["y"] + b["height"] <= r["y"] + r["height"] + 1)]
        check("popup", f"cpu: all {CORES} cores' rows, none cut", not missing and not cut, f"missing {missing}, cut {cut}")
    click(cx, cy)
    wait(lambda: overlays() == [])
    quiet()
    click(cx, cy)
    wait(lambda: overlays() == ["orbit-dialogs"])
    click(W / 2, 200)
    away()
    check("popup", "a click beside closes", wait(lambda: overlays() == []), str(overlays()))
    # (orbit-status sees that at its next sample, 1.5 s after the opening at
    # the earliest: the widget's own background goes.)
    wait(lambda: edge(grab("popup-closed")) == plain, 6)
    click(cx, cy)
    check("popup", "then one click opens it again", wait(lambda: overlays() == ["orbit-dialogs"]), str(overlays()))
    quiet()
    if r:
        click(r["x"] + r["width"] - 50 * ZOOM, r["y"] + 24 * ZOOM)
    mods = lambda: [m for m in shared().get("orbit.sides", {}).get("mods", []) if (m.get("props") or {}).get("stat") == "cpu"]
    check("popup", "open in pane: the view in a pane", wait(mods), json.dumps(shared().get("orbit.sides", {}).get("mods")))
    check("popup", "open in pane: the popup closes", wait(lambda: overlays() == []), str(overlays()))
    shot("popup-pinned")


def order(ids):
    names, _ = cards()
    want = ["shown", "blocked", "done", "working"]
    want_alt = ["shown", "done", "blocked", "working"]
    check("order", "shown, waiting, at work; idle left out", names in (want, want_alt), f"{names}")
    check("order", "waiting: most recent first", names == want_alt, f"{names}")
    shot("order")


def menu_click(card, item=0, scenario=None):
    """Right-clicks a card and picks the menu's item; with `scenario`, also
    checks the menu opened just above that card."""
    away()
    quiet()
    before = still("menu-0")
    click(*centre(card), button=3)
    wait(lambda: overlays() == ["orbit-dialogs"])
    away()
    r = opened_rect(before, still("menu"), card)
    if scenario:
        placed_above(scenario, "its menu", r, card, 160)
    if r:
        click(r["x"] + 40, r["y"] + (5 + 15 + 31 * item) * ZOOM)
    wait(lambda: overlays() == [])
    quiet()


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
    select(ids["shown"][0])
    do("orbit.settings")
    check("settings", "opens in the right pane", wait(mine), json.dumps(shared().get("orbit.sides", {}).get("mods")))
    check("settings", "titled Orbit look settings", [m.get("title") for m in mine()] == ["Orbit look settings"], str(mine()))
    check("settings", "not an overlay", overlays() == [], str(overlays()))
    shot("settings")
    do("orbit.settings")
    quiet(0.6)
    check("settings", "again: still one", len(mine()) == 1, str(mine()))


PADDING = {"compact": (2, 0), "default": (4, 0), "comfortable": (8, 0)}
OLD_PADDING = {"compact": (8, 6), "default": (14, 12), "comfortable": (18, 16)}


def cell_gaps(name):
    """A shot's green terminal (tools/fill-cells.sh) against its pane's outline,
    found from the left tab row's place (shared "orbit.places": the outline's
    left and right edges and its tab line): {left, right, bottom} in logical
    pixels, or None while the green doesn't fill its pane yet (its program
    redraws on a resize)."""
    img = grab(name)
    px = img.load()
    green = lambda p: p[1] > 200 and p[0] < 60 and p[2] < 60
    xs = [x for x in range(img.width) if green(px[x, img.height // 2])]
    tabs = shared().get("orbit.places", {}).get("left-tabs")
    if len(xs) < 100 or not tabs:
        return None
    ys = [y for y in range(img.height) if green(px[(xs[0] + xs[-1]) // 2, y])]
    return {"left": xs[0] / SCALE - tabs["x"], "right": tabs["x"] + tabs["width"] - (xs[-1] + 1) / SCALE,
            "bottom": tabs["y"] - (ys[-1] + 1) / SCALE}


def padding(ids):
    """A terminal's cells sit close to its pane's outline, a little further at
    each step from compact to comfortable, and closer than before the padding
    was reduced. Left: the outline's line and the padding (herdr puts the
    columns' leftover on the right, the rows' half above and half below), so
    it grows with the padding; right and bottom add less than a cell and less
    than half a row."""
    r = do("space.new", {"name": "padding", "folder": "/tmp", "argv": [f"{REPO}/tools/fill-cells.sh"]})
    sid = r.get("space")
    line = 2 * ZOOM
    cell_w, cell_h = 0.65 * 14 * ZOOM, 1.15 * 1.3 * 14 * ZOOM
    gaps = {}
    try:
        for d in ["compact", "default", "comfortable"]:
            do(f'orbit.settings {json.dumps({"density": d})}')
            wait(lambda: shared().get("orbit.look", {}).get("padding") == list(PADDING[d]), 5)
            quiet()
            pad_x = PADDING[d][0] * ZOOM
            settled = lambda g: g if g and min(g.values()) >= 0 and g["right"] <= line + pad_x + cell_w + 1 else None
            # (Twice the same: the window has drawn the new padding.)
            twice = lambda: (lambda a: a if a and a == settled(cell_gaps(f"padding-{d}")) else None)(settled(cell_gaps(f"padding-{d}")))
            fresh = lambda: (lambda g: g if g and g not in gaps.values() else None)(twice())
            g = wait(fresh, 8) or cell_gaps(f"padding-{d}")
            gaps[d] = g
    finally:
        do(f'orbit.settings {json.dumps({"density": "comfortable"})}')
        if sid:
            do("space.close", {"id": sid, "confirmed": True})
        quiet()
    said = json.dumps({d: g and {k: round(v, 1) for k, v in g.items()} for d, g in gaps.items()}) + f" (zoom {ZOOM})"
    check("padding", "the filled terminal shows at every density", all(gaps.values()), said)
    if not all(gaps.values()):
        return
    for d, g in gaps.items():
        (pad_x, pad_y), (old_x, _) = (v * ZOOM for v in PADDING[d]), OLD_PADDING[d]
        check("padding", f"{d}: left is the line and the padding", abs(g["left"] - (line + pad_x)) <= 1.5, said)
        check("padding", f"{d}: closer than before ({old_x} at zoom 1)", g["left"] < line + old_x * ZOOM - 1, said)
        check("padding", f"{d}: right under a cell more", 0 <= g["right"] <= line + pad_x + cell_w + 1, said)
        check("padding", f"{d}: bottom under half a row more", 0 <= g["bottom"] <= pad_y + cell_h / 2 + 1, said)
    left = [gaps[d]["left"] for d in ["compact", "default", "comfortable"]]
    check("padding", "it grows from compact to default to comfortable", left[0] < left[1] < left[2], said)
    print(f"      gaps: {said}", flush=True)


def set_zoom(z):
    path = f"{HOME}/settings.json"
    st = json.load(open(path))
    json.dump({**st, "zoom": z}, open(path, "w"))
    wait(lambda: abs(status().get("zoom", 0) - z) < 0.01, 5)
    quiet()


FILLER = """import { View, div } from "gpui-kit";
// tools/regress.py: fills its pane with one colour.
export default class Filler extends View { render() { return div().size_full().bg("#ff00ff"); } }
"""


def edge_gaps(img, sid, side, top):
    """Where a shown pane's outline is, in screen pixels: `first` and `last`,
    the rows just inside it above and below, read down one column of the shot
    (`col`, beside the right corner: the shown tab has no tab line); `left`, the
    line's width at its left edge, `x0` (shared "orbit.places" is within a
    pixel or two of it). The pane has the keys, so its line is the space's
    colour. None when there is no such outline."""
    import math
    place = shared().get("orbit.places", {}).get(f"{side}-tabs")
    if not place:
        return None
    px = img.load()
    near = lambda a, b, d=12: math.dist(a, b) <= d
    z = current_zoom()
    x0, x1 = round(place["x"] * SCALE), min(img.width, round((place["x"] + place["width"]) * SCALE))
    row_y, row_h = round(place["y"] * SCALE), round(place["height"] * SCALE)
    mid = (img.height * 2) // 5
    hex_ = shared().get("orbit.identity", {}).get(sid, {}).get("color", "#000000")
    line = tuple(int(hex_[i:i + 2], 16) for i in (1, 3, 5))
    x0 = next((x for x in range(max(0, x0 - 8), x0 + 9) if near(px[x, mid], line)), None)
    if x0 is None:
        return None
    x = x0
    while near(px[x, mid], line) and x < x1:
        x += 1
    col = x1 - round(30 * z * SCALE)
    y0, y1 = (row_y, img.height - 1) if top else (0, row_y + row_h)
    ys = [y for y in range(y0, y1) if near(px[col, y], line)]
    up = [y for y in ys if y < mid]
    down = [y for y in ys if y > mid]
    if not up or not down:
        return None
    return {"line": line, "left": x - x0, "x0": x0, "x1": x1, "col": col, "first": up[-1] + 1, "last": down[0] - 1, "px": px, "near": near, "mid": mid}


def current_zoom():
    return json.load(open(f"{HOME}/settings.json")).get("zoom", 1)


def spacing(ids):
    os.makedirs(f"{HOME}/mods/regress-filler", exist_ok=True)
    open(f"{HOME}/mods/regress-filler/main.js", "w").write(FILLER)
    open(f"{HOME}/mods/regress-filler/mod.json", "w").write('{ "place": "none" }\n')
    time.sleep(1.5)
    cells = {"argv": [f"{REPO}/tools/fill-cells.sh"]}
    r = do("space.new", {"name": "spacing", "folder": REPO, **cells})
    sid, tab = r.get("space"), r.get("tab")
    time.sleep(2)
    sides = lambda: shared().get("orbit.sides", {})
    mine = lambda: [m["id"] for m in sides().get("mods", []) if m["space"] == sid]
    right = lambda i: lambda: sb("do", "orbit.show " + json.dumps({"space": sid, "side": "right", "id": i}))
    left = lambda i: lambda: do("tab.select", {"id": i})
    shows = [("left", "terminal", left(tab))]
    try:
        for mod in ("files", "changes", "regress-filler"):
            had = mine()
            sb("do", "orbit.new-mod " + json.dumps({"space": sid, "side": "right", "title": mod[0], "mod": mod}))
            new = wait(lambda: [m for m in mine() if m not in had], 5)
            shows.append(("right", mod, right(new[0] if new else None)))
        had = set(sides().get("right", {}).values())
        sb("do", "orbit.new-terminal " + json.dumps({"space": sid, "side": "right", "extra": cells}))
        new = wait(lambda: set(sides().get("right", {}).values()) - had, 8)
        shows.append(("right", "terminal", right(f"rt-{next(iter(new), None)}")))
        own = do("tab.new", {"space": sid, "mod": "regress-filler"}).get("tab")
        shows.append(("left", "regress-filler", left(own)))
        time.sleep(1)
        spacing_cases(sid, shows)
    finally:
        do("orbit.settings " + json.dumps({"density": "comfortable", "tabs": "bottom"}))
        set_zoom(ZOOM)
        if sid:
            do("space.close", {"id": sid, "confirmed": True})
        do("space.select", {"id": ids["shown"][0]})
        time.sleep(1)


def spacing_cases(sid, shows):
    green = lambda p: p[1] > 200 and p[0] < 60 and p[2] < 60
    said = []

    def gaps(g, what):
        """The rows between the outline and the pane's content: a terminal's
        green cells, or a view's own edge (its colour as at the left)."""
        px, near = g["px"], g["near"]
        if what == "terminal":
            ys = [y for y in range(g["first"], g["last"] + 1) if green(px[(g["x0"] + g["x1"]) // 2, y])]
        else:
            edge = px[g["x0"] + g["left"], g["mid"]]
            ys = [y for y in range(g["first"], g["last"] + 1) if near(px[g["col"], y], edge)]
        return (ys[0] - g["first"], g["last"] - ys[-1]) if ys else None

    for z in (1, 1.2, 1.4):
        set_zoom(z)
        cell = 1.15 * 1.3 * 14 * z * SCALE
        for tabs in ("bottom", "top"):
            for d in PADDING:
                do("orbit.settings " + json.dumps({"density": d, "tabs": tabs}))
                wait(lambda: (lambda L: L.get("density") == d and L.get("top") == (tabs == "top"))(shared().get("orbit.look", {})), 5)
                time.sleep(1)
                row = {}
                for side, what, show in shows:
                    show()
                    sb("do", "orbit.focus " + json.dumps({"side": side}))
                    ok = (lambda r: bool(r) and abs(r[0] - r[1]) <= 2 * SCALE and sum(r) < cell) if what == "terminal" else (lambda r: r == (0, 0))
                    got = None
                    # A resize, and the pane's program's redraw, take a moment.
                    for _ in range(8):
                        time.sleep(0.5)
                        g = edge_gaps(grab(f"spacing-{z}-{tabs}-{d}-{side}-{what}"), sid, side, tabs == "top")
                        got = g and gaps(g, what)
                        if ok(got):
                            break
                    row[f"{side} {what}"] = got
                    if g:
                        # The left side, between the rounded end's curve and the tab line.
                        curve = round((shared()["orbit.look"]["radius"] + 2) * z * SCALE / 2) + 1
                        rows = range(g["first"], g["last"] + 1 - curve) if tabs == "top" else range(g["first"] + curve, g["last"] + 1)
                        off = [y for y in rows if not g["near"](g["px"][g["x0"] + 1, y], g["line"], 30)]
                        if off:
                            check("spacing", f"zoom {z}, tabs {tabs}, {d}: the {side} pane's side is unbroken", False, f"rows {off[:5]}")
                    said_so = "has only what whole rows leave over" if what == "terminal" else "touches the outline above and below"
                    check("spacing", f"zoom {z}, tabs {tabs}, {d}: {side} {what} {said_so}", ok(got), f"rows of pixels {got}")
                said.append(f"zoom {z}, tabs {tabs}, {d}: {row}")
    print("      rows of pixels above and below:\n" + "\n".join("      " + s for s in said), flush=True)


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
    if (p.level) notify({ title: `${p.level} toast`, body: `a ${p.level} notification from the regression suite`, level: p.level, timeout: 1500 });
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
    select(ids["shown"][0])
    root = lambda: json.load(open(f"{HOME}/layouts/orbit.json"))
    check("terminal", "the layout names no font or size", not {"font", "font_size"} & set(root()), str(sorted(root())))

    def change(c):
        r = do("tab.new", {"mod": "regress-set", "props": {"change": c}})
        quiet()
        if r.get("tab"):
            do("tab.close", {"id": r["tab"], "confirmed": True})
        quiet()

    def terms(name, other=None):
        """The panes, still; with `other`, once they are not as in it (or
        that takes too long)."""
        box = (420 * ZOOM, 0, W, H - 60 * ZOOM)
        crop = lambda: still(name, box).crop([int(v * SCALE) for v in box])
        img = crop()
        end = time.time() + 2
        while other and same(img, other) and time.time() < end:
            img = crop()
        return img

    def same(a, b):
        from PIL import ImageChops
        return ImageChops.difference(a, b).getbbox() is None

    # (Its cursor hidden: it blinks, the window has the keyboard.)
    sb("hc", "send", ids["shown"][1], "printf '\\033[?25l'")
    for i in range(4):
        sb("hc", "send", ids["shown"][1], f"echo line {i} of the regression suite's terminal text")
    wait(lambda: "line 3" in sb("hc", "read", ids["shown"][1]))
    default = terms("terminal-default")
    shown = default
    for op in [1, 0]:
        c = {"opacity": op}
        change(c)
        got = lambda: root().get("terminal_opacity")
        check("terminal", f"{json.dumps(c)}: written", wait(lambda: got() == op), str(got()))
        ok, v = installed_ok()
        check("terminal", f"{json.dumps(c)}: still hashes as installed", ok and v == INSTALLED, str(v))
        img = terms(f"terminal-opacity-{op}", shown)
        shown = img
        check("terminal", f"{json.dumps(c)}: {'as before' if op == 0 else 'shows'}", same(img, default) == (op == 0))

    base = json.load(open(f"{HOME}/settings.json"))
    def fonts(extra, name, other=None):
        json.dump({**base, **extra}, open(f"{HOME}/settings.json", "w"))
        time.sleep(0.5)  # nothing says the app has read it when it changes nothing
        return terms(name, other)
    check("terminal", "settings.json JetBrains Mono 14: as the default (0.5.0's)",
          same(fonts({"font": "JetBrains Mono", "font_size": 14}, "terminal-font-14"), default))
    check("terminal", "settings.json Geist Mono 20: applies",
          not same(fonts({"font": "Geist Mono", "font_size": 20}, "terminal-font-20", default), default))
    json.dump(base, open(f"{HOME}/settings.json", "w"))
    sb("hc", "send", ids["shown"][1], "printf '\\033[?25h'")


def toast(ids):
    os.makedirs(f"{HOME}/mods/regress-notify", exist_ok=True)
    open(f"{HOME}/mods/regress-notify/main.js", "w").write(NOTIFIER)
    open(f"{HOME}/mods/regress-notify/mod.json", "w").write('{ "place": "none" }')
    check("toast", "the layout names orbit-toast", json.load(open(f"{HOME}/layouts/orbit.json")).get("toast") == "orbit-toast")
    select(ids["shown"][0])

    def run_mod(props, then=lambda: None):
        r = do("tab.new", {"mod": "regress-notify", "props": props})
        quiet(0.2)
        then()
        if r.get("tab"):
            do("tab.close", {"id": r["tab"], "confirmed": True})

    toasts = lambda: [o for o in overlays() or [] if o == "orbit-toast"]
    for setting in ["all", "errors"]:
        run_mod({"set": setting})
        check("toast", f"{setting}: saved", wait(lambda: shared().get("orbit.settings", {}).get("notify") == setting),
              json.dumps(shared().get("orbit.settings")))
        for level in LEVELS:
            wait(lambda: not toasts(), 8)
            def look():
                shown = bool(wait(toasts, 0.7))
                want = setting == "all" or level == "error"
                check("toast", f"{setting}: {level} {'shows' if want else 'closes at once'}", shown == want, str(overlays()))
                still(f"toast-{setting}-{level}")
            run_mod({"level": level}, look)
    wait(lambda: not toasts(), 8)
    run_mod({"set": "all"})
    wait(lambda: shared().get("orbit.settings", {}).get("notify") == "all")


def keep(ids):
    os.makedirs(f"{HOME}/mods/regress-counter", exist_ok=True)
    open(f"{HOME}/mods/regress-counter/main.js", "w").write(COUNTER)
    open(f"{HOME}/mods/regress-counter/mod.json", "w").write('{ "place": "none" }\n')
    time.sleep(0.5)  # the app finds it
    a, b = ids["shown"][0], ids["working"][0]
    select(a)
    run_name = "orbit.new-mod " + json.dumps({"space": a, "side": "right", "title": "counter", "mod": "regress-counter", "props": {"tag": "A"}})
    inits = lambda: shared().get("regress.inits", {}).get("A", 0)
    before = inits()
    sb("do", run_name)
    check("keep", "the mod starts in the right pane", wait(lambda: inits() > before, 5), str(shared().get("regress.inits")))
    quiet(1)
    start = inits()
    for target in [b, a, b, a]:
        select(target)
    check("keep", "A -> B -> A twice: it never starts again", inits() == start, f"inits {start} -> {inits()}")
    select(ids["blocked"][0])
    select(a)
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
    time.sleep(0.5)  # the app finds it
    a, b, other = ids["shown"][0], ids["working"][0], ids["blocked"][0]
    left = lambda: (shared().get("orbit.places", {}).get("left-tabs") or {}).get("width", 0)
    def still():
        """The left pane's width once it holds still (a drag settles)."""
        quiet(0.5, 10)
        return left()
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
        select(sp)
        sb("do", "orbit.new-mod " + json.dumps({"space": sp, "side": "right", "title": "split", "mod": "regress-counter", "props": {"tag": "split" + tag}}))
        quiet(0.5)
    select(a)
    base = left()
    check("split", "both panes shown", wait(lambda: drag_by(60), 3), str(shared().get("orbit.places")))
    wait(lambda: left() > base + 40, 6)
    wide = still()
    near = lambda want: wait(lambda: abs(left() - want) <= 2, 6)
    do("space.select", {"id": b})
    check("split", "a space never resized has the split it had", near(base), f"{left()} vs {base}")
    quiet()
    drag_by(-60)
    wait(lambda: left() < base - 40, 6)
    narrow = still()
    nodes = lambda: json.load(open(f"{HOME}/layouts/.state/orbit.json")).get("nodes", {})
    kept = lambda sp: (shared().get("orbit.splits") or {}).get("spaces", {}).get(sp)
    at_b = (nodes().get("left-frame"), nodes().get("right-frame"), kept(b))
    check("split", "the drags took (A wide, B narrow)", wide > base + 40 and narrow < base - 40, f"base {base} A {wide} B {narrow}")
    seen = []
    for sp, want in [(a, wide), (b, narrow), (a, wide)]:
        do("space.select", {"id": sp})
        seen.append((bool(near(want)), left(), want, nodes().get("left-frame"), kept(sp)))
    check("split", "A -> B -> A: each keeps its own", all(v[0] for v in seen), f"{seen} B after its drag: {at_b}")
    do("space.select", {"id": other})
    check("split", "another space, never resized: the split it had", near(base), f"{left()} vs {base}")
    select(a)
    shot("split")


def symbols(ids):
    """Each card's symbol against the sidebar's, per state. The idle case: an
    agent that reports idle, as a finished one is once seen, in the shown
    space so it has a card."""
    ansi = json.load(open(f"{HOME}/themes/tokyo-night.json"))["ansi"]
    cases = [("working", "working", ansi[3]), ("blocked", "blocked", ansi[1]), ("done", "done (finished, not seen)", ansi[2]),
             ("shown", "no agent", None), ("idle", "idle (finished and seen)", None)]
    report(ids["idle"][1], "idle")
    quiet()
    for name, what, fill in cases:
        if name == "idle":
            select(ids["idle"][0])
        sid = ids[name][0]
        syms = shared().get("orbit.probe.symbols", {})
        bar, side = syms.get(f"taskbar:{sid}"), syms.get(f"sidebar:{sid}")
        check("symbols", f"{what}: the card's symbol is the sidebar's", bar is not None and bar == side, f"taskbar {bar} sidebar {side}")
        got = (bar or {}).get("fill")
        ok = got is None if fill is None else (got or "").lower()[:7] == fill.lower()[:7]
        check("symbols", f"{what}: {'empty' if fill is None else 'filled ' + fill}", bar is not None and ok, f"{bar}")
    shot("symbols")
    select(ids["shown"][0])


def tabs(ids):
    """The shown space's accent (a band of its colour behind the sidebar's row
    and the taskbar's card) and white text (those two and the panes' shown
    tabs), for two spaces of different colours, back and forth."""
    colors = lambda: shared().get("orbit.probe.colors", {})
    fg = json.load(open(f"{HOME}/themes/tokyo-night.json"))["foreground"].lower()[:7]
    seen = {}
    for name in ["shown", "blocked"]:
        sid = ids[name][0]
        select(sid)
        sb("do", "orbit.new-mod " + json.dumps({"space": sid, "side": "right", "title": "memory", "mod": "orbit-dialogs",
                                                 "props": {"dialog": "stat", "stat": "ram"}}))
        quiet(0.5)
    for name in ["shown", "blocked", "shown", "blocked"]:
        select(ids[name][0])
        c = {k: (v or "").lower() for k, v in colors().items()}
        band = c.get("space", "")[:7] + "29"
        check("tabs", f"{name}: the sidebar's and the taskbar's accent is the space's colour",
              c.get("space") and c.get("sidebar-band") == band and c.get("taskbar-band") == band, str(c))
        texts = {k: c.get(k, "")[:7] for k in ["sidebar-text", "taskbar-text", "left-text", "right-text"]}
        check("tabs", f"{name}: the text stays white", all(v == fg for v in texts.values()), f"{texts} want {fg}")
        seen[name] = c.get("space")
    check("tabs", "the two spaces' colours differ (the test means something)", seen["shown"] != seen["blocked"], str(seen))
    shot("tabs")
    select(ids["shown"][0])


def rows():
    return {k: shared().get(f"orbit.row.{k}") for k in ("left", "right")}


def labels(side):
    return [t["label"] for t in (rows()[side] or {}).get("tabs", [])]


def keys_of(side):
    return [t["key"] for t in (rows()[side] or {}).get("tabs", [])]


def at_tab(r, t):
    """The middle of a tab's label area, in window pixels."""
    return r["x"] + t["x"] + t["w"] / 2, r["y"] + r["low"] + (r["h"] - r["band"] - r["line"]) / 2


def row_space(name, left=3, right=0):
    """A space with that many terminals in its left and right panes."""
    sid = do("space.new", {"name": name, "folder": "/tmp"}).get("space")
    time.sleep(1)
    for _ in range(left - 1):
        do("tab.new", {"space": sid})
        time.sleep(0.5)
    do("space.select", {"id": sid})
    time.sleep(1)
    for _ in range(right):
        sb("do", "orbit.new-terminal " + json.dumps({"space": sid, "side": "right"}))
        time.sleep(2)
    time.sleep(1.5)
    wait(lambda: len(labels("left")) == left and (not right or len(labels("right")) == right), 8)
    return sid


def set_zoom(z):
    path = f"{HOME}/settings.json"
    st = json.load(open(path))
    json.dump({**st, "zoom": z}, open(path, "w"))
    time.sleep(2.5)


def stroke(img, color, cx, cy, dx, dy, reach):
    """How thick (in screen pixels) a line of `color` is where a ray from
    (cx, cy) along the unit (dx, dy) crosses it, and how far out its middle
    is: how much of the colour each step shows, summed along the ray."""
    import math
    px = img.load()
    def at(x, y):
        x, y = min(max(x, 0), img.width - 1.001), min(max(y, 0), img.height - 1.001)
        x0, y0 = int(x), int(y)
        fx, fy = x - x0, y - y0
        out = [0, 0, 0]
        for ix, iy, w in ((x0, y0, (1 - fx) * (1 - fy)), (x0 + 1, y0, fx * (1 - fy)), (x0, y0 + 1, (1 - fx) * fy), (x0 + 1, y0 + 1, fx * fy)):
            for c in range(3):
                out[c] += px[ix, iy][c] * w
        return out
    step, lo, hi = 0.1, reach[0], reach[1]
    ends = [at(cx + dx * d - 0.5, cy + dy * d - 0.5) for d in (lo, hi)]
    back = [(a + b) / 2 for a, b in zip(*ends)]
    span = math.dist(back, color)
    if span < 1:
        return 0, 0
    total = weighted = 0
    for k in range(int((hi - lo) / step)):
        d = lo + (k + 0.5) * step
        v = at(cx + dx * d - 0.5, cy + dy * d - 0.5)
        share = min(1, max(0, 1 - math.dist(v, color) / span))
        share = 0 if share < 0.12 else share
        total += share * step
        weighted += share * step * d
    return total, (weighted / total if total else 0)


def moved(a, b):
    """By how many pixels b's profile (its ink per column or row) is a's,
    moved: the shift they match best at, whatever each one's brightness."""
    import math
    if not any(a) or not any(b):
        return None
    norm = lambda v: math.sqrt(sum(q * q for q in v)) or 1
    na, nb = norm(a), norm(b)
    fit = lambda s: sum(a[i] * b[i + s] for i in range(len(a)) if 0 <= i + s < len(b)) / (na * nb)
    return max(range(-4, 5), key=lambda s: (fit(s), -abs(s)))


def row(ids):
    import math
    sid = row_space("row")
    try:
        for z in (1, 1.2, 1.4):
            set_zoom(z)
            r = wait(lambda: (lambda v: v if v and len(v["tabs"]) == 3 and abs(v["line"] - round(2 * z * SCALE) / SCALE) < 0.01 and abs(v["w"] - shared()["orbit.places"]["left-tabs"]["width"]) <= 1.5 else None)(rows()["left"]), 12)
            if not r:
                check("row", f"zoom {z}: three tabs", False, str(rows()["left"]))
                continue
            # A press tells the row where it is, to the pixel.
            click(*at_tab(r, r["tabs"][0]))
            time.sleep(0.5)
            away()
            time.sleep(1)
            r, place = rows()["left"], shared()["orbit.places"]["left-tabs"]
            check("row", f"zoom {z}: the first tab starts at the pane's left edge", r["tabs"][0]["x"] == 0 and abs(r["x"] - place["x"]) <= 2, f"{r} {place}")
            box = lambda: tuple(int(v * SCALE) for v in (r["x"], r["y"] - 40, r["x"] + r["w"], r["y"] + r["h"]))
            S, line = SCALE, r["line"] * SCALE
            ink, geom = [], []
            for i, t in enumerate(r["tabs"]):
                click(*at_tab(r, t))
                away()
                wait(lambda: shared().get("orbit.sides", {}).get("last", {}).get(sid) == t["key"], 6)
                time.sleep(1.5)
                img = grab(f"row-{z}-{i}").crop(box())
                now = rows()["left"]
                geom.append([(q["x"], q["w"]) for q in now["tabs"]])
                top = 40 * S + r["band"] * S
                got = []
                for q in now["tabs"]:
                    x0, x1 = int((q["x"] + 5 * z) * S), int((q["x"] + q["w"] - 5 * z) * S)
                    y0, y1 = int(top + 8 * z * S), int(img.height - 8 * z * S)
                    g = img.crop((x0, y0, x1, y1)).convert("L")
                    bg = sorted(g.tobytes())[len(g.tobytes()) // 2]
                    d = [[max(0, g.getpixel((xx, yy)) - bg - 12) for yy in range(g.height)] for xx in range(g.width)]
                    got.append(([sum(col) for col in d], [sum(d[xx][yy] for xx in range(g.width)) for yy in range(g.height)]))
                ink.append(got)
                if i == 1:
                    color = img.getpixel((int(S), int(4 * S)))
                    h = line / 2
                    xa, xb = t["x"] * S + h, (t["x"] + t["w"]) * S - h
                    y = 40 * S + r["band"] * S - h
                    c = round(6 * z * S) - h
                    reach = (c - 3 * line if c > 3 * line else 0, c + 3 * line)
                    straight = [stroke(img, color, xa - c - 4 * S, y - 3 * line, 0, 1, (0, 6 * line))[0],
                                stroke(img, color, xa - 3 * line, y + c + 6 * S, 1, 0, (0, 6 * line))[0],
                                stroke(img, color, xb - 3 * line, y + c + 6 * S, 1, 0, (0, 6 * line))[0],
                                stroke(img, color, xb + c + 4 * S, y - 3 * line, 0, 1, (0, 6 * line))[0]]
                    check("row", f"zoom {z}: the lines are {r['line']} thick", all(abs(v - line) <= 0.35 * S for v in straight), f"{straight} want {line}")
                    for name, cx, sign in (("left", xa - c, 1), ("right", xb + c, -1)):
                        arc = [stroke(img, color, cx, y + c, sign * math.sin(math.radians(a)), -math.cos(math.radians(a)), reach) for a in range(0, 91, 5)]
                        off = [(round(w, 1), round(d, 1)) for w, d in arc if abs(w - line) > 0.4 * S or abs(d - c) > 0.4 * S]
                        check("row", f"zoom {z}: the {name} top corner is a quarter circle of that thickness", not off, f"want ({line}, {c}), off: {off}")
                if i == 0:
                    color = img.getpixel((int(S), int(4 * S)))
                    edge = [img.getpixel((int(S), yy)) for yy in range(0, img.height - int(20 * z * S))]
                    check("row", f"zoom {z}: the first tab's side is the pane's left edge, unbroken", all(math.dist(p, color) < 30 for p in edge),
                          f"{sum(math.dist(p, color) >= 30 for p in edge)} pixels off")
            check("row", f"zoom {z}: with any tab shown, the tabs are where they were", geom[0] == geom[1] == geom[2], str(geom))
            off = [(i, k, axis, moved(ink[0][k][axis], ink[i][k][axis])) for i in (1, 2) for k in range(3) for axis in (0, 1)]
            check("row", f"zoom {z}: every icon and label on the same pixels", all(v[3] == 0 for v in off), f"(shown, tab, x/y, moved by): {off}")
    finally:
        set_zoom(ZOOM)
        if sid:
            do("space.close", {"id": sid, "confirmed": True})
        do("space.select", {"id": ids["shown"][0]})
        time.sleep(1)


def pid_of(term):
    """The shell's own process id, as it prints it."""
    sb("hc", "send", term, "echo pid=$$.")
    time.sleep(0.8)
    import re
    found = re.findall(r"pid=(\d+)\.", sb("hc", "read", term))
    return found[-1] if found else None


def hold(start, *points):
    """Presses at `start`, drags over the points, and holds."""
    x("mousemove", "--window", win(), *start, "sleep", 0.3, "mousedown", 1, "sleep", 0.2, "mousemove", "--window", win(), start[0] + 9, start[1])
    wait(lambda: overlays() == ["orbit-tabs"], 6)
    time.sleep(0.8)
    for pt in points:
        x("mousemove", "--window", win(), *pt)
        time.sleep(0.6)
    time.sleep(1)


def release():
    x("mouseup", 1)


def press_key(name):
    x("key", name)


def type_line(text):
    x("type", text)
    press_key("Return")


def resize_window(*size):
    """The sandbox's window, in logical pixels; with none, the whole display."""
    sb("size", *([str(int(v)) for v in size] or ["full"]), check=True)
    quiet()
    away()
    time.sleep(1)


def drop():
    release()
    wait(lambda: not shared().get("orbit.drag") and overlays() == [], 6)
    time.sleep(2)
    away()
    time.sleep(0.4)


def tabdrag(ids):
    from PIL import ImageChops
    dragging = lambda: shared().get("orbit.drag")
    sid = row_space("tabdrag", 3, 2)
    terms = {}
    try:
        do("space.select", {"id": sid})
        time.sleep(1)
        L, R = rows()["left"], rows()["right"]
        check("tabdrag", "both rows there", L and R and len(L["tabs"]) == 3 and len(R["tabs"]) == 2, f"{L} {R}")
        tabs = {t["id"]: t for s in json.loads(sb("ls") or "{}").get("spaces", []) for t in s.get("tabs", [])}
        alive = lambda: {t["address"]: t["state"] for t in json.loads(sb("hc", "ls")).get("terminals", [])}
        before_alive = alive()
        away()
        time.sleep(0.5)
        clean = grab("tabdrag-0")
        t = L["tabs"][2]
        sx, sy = at_tab(L, t)
        hold((sx, sy), (sx + 60, sy - 200), (R["x"] + 60, R["y"] - 150))
        d = dragging()
        check("tabdrag", "over the other pane: it would land in its row", d and (d.get("over") or {}).get("row") == "right", str(d))
        held = grab("tabdrag-held")
        s = SCALE
        rect = lambda x0, y0, x1, y1: tuple(int(v * s) for v in (x0, y0, x1, y1))
        gx0, gx1 = L["x"] + t["x"], L["x"] + t["x"] + t["w"]
        ghost = rect(gx0 + 4, L["y"] + L["band"], gx1 - 4, L["y"] + L["h"] - 4)
        sat = lambda im: max(max(p) - min(p) for p in (im.getpixel((i, j)) for i in range(im.width) for j in range(im.height)))
        def contrast(im):
            g = sorted(im.convert("L").tobytes())
            return g[-1] - g[len(g) // 2]
        a, b = clean.crop(ghost), held.crop(ghost)
        check("tabdrag", "the ghost: paler and greyer than the tab", b.tobytes() != a.tobytes() and contrast(b) < 0.5 * contrast(a) and sat(b) < sat(a),
              f"contrast {contrast(a)} -> {contrast(b)}, saturation {sat(a)} -> {sat(b)}")
        fx0, fy0 = R["x"] + 60 - d["grab"]["x"], R["y"] - 150 - d["grab"]["y"]
        follow = (fx0, fy0, fx0 + d["w"], fy0 + 26 * ZOOM)
        check("tabdrag", "a copy of the tab at the pointer", ImageChops.difference(clean.crop(rect(*follow)), held.crop(rect(*follow))).getbbox() is not None)
        index = d["over"]["index"]
        edge = R["tabs"][index - 1]["x"] + R["tabs"][index - 1]["w"] if index else 0
        bar = (R["x"] + edge - 4, R["y"] + R["band"], R["x"] + edge + 12, R["y"] + R["h"] - 4)
        check("tabdrag", "the bar, between that row's tabs", ImageChops.difference(clean.crop(rect(*bar)), held.crop(rect(*bar))).getbbox() is not None, str(bar))
        diff = ImageChops.difference(clean, held).convert("L").point(lambda v: 255 if v > 12 else 0)
        # (A row's y is right to half a pixel: the ghost's edge can end a screen pixel lower.)
        for box in [(gx0 - 8, L["y"], gx1 + 8, L["y"] + L["h"] + 1), (follow[0] - 2, follow[1] - 2, follow[2] + 2, follow[3] + 2), bar]:
            diff.paste(0, rect(*box))
        # The terminals' cursors go hollow while the layer has the keys (the
        # panes' first lines); the bar's figures and clock change by themselves.
        rest = diff.crop(rect(0, 110, W, R["y"] + R["h"])).getbbox()
        check("tabdrag", "nothing else changes while dragging", rest is None, f"{rest} (from y 110)")
        check("tabdrag", "no tab shifted, no pane resized", [(q["x"], q["w"]) for q in rows()["left"]["tabs"] + rows()["right"]["tabs"]] ==
              [(q["x"], q["w"]) for q in L["tabs"] + R["tabs"]] and rows()["right"]["w"] == R["w"], str(rows()))
        press_key("Escape")
        wait(lambda: dragging() is None and overlays() == [], 6)
        check("tabdrag", "Escape ends it", dragging() is None and overlays() == [], f"{dragging()} {overlays()}")
        release()
        time.sleep(1)
        same = lambda: keys_of("left") == [q["key"] for q in L["tabs"]] and keys_of("right") == [q["key"] for q in R["tabs"]]
        check("tabdrag", "Escape: nothing changed", same(), str(rows()))
        hold((sx, sy), (100, 300))
        check("tabdrag", "over the sidebar: no landing place", dragging() and dragging().get("over") is None, str(dragging()))
        drop()
        check("tabdrag", "dropped on the sidebar: nothing changed", same() and dragging() is None and overlays() == [], str(rows()))
        # The window fills the screen: smaller, so the pointer can leave it.
        resize_window(W - 120, H)
        small = rows()["left"]
        hold(at_tab(small, small["tabs"][2]), (W - 150, 300), (W - 40, 300))
        wait(lambda: dragging() is None and overlays() == [], 6)
        check("tabdrag", "outside the window: it goes back", dragging() is None and overlays() == [], f"{dragging()} {overlays()}")
        drop()
        check("tabdrag", "outside the window: nothing changed", same(), str(rows()))
        resize_window()
        L, R = rows()["left"], rows()["right"]
        t = L["tabs"][2]
        sx, sy = at_tab(L, t)

        term = lambda key: key[3:] if key.startswith("rt-") else None
        hold((sx, sy), at_tab(L, L["tabs"][0]))
        hold_over = (dragging() or {}).get("over")
        drop()
        want = [L["tabs"][i]["key"] for i in (0, 2, 1)]
        first = [L["tabs"][i]["key"] for i in (2, 0, 1)]
        got = wait(lambda: keys_of("left") in (want, first) and keys_of("left"), 3)
        check("tabdrag", "moved in the left row, where the bar was", got and got.index(t["key"]) == hold_over["index"], f"{hold_over} {keys_of('left')}")

        R = rows()["right"]
        L = rows()["left"]
        mine = next(q for q in L["tabs"] if q["key"] == t["key"])
        rt = R["tabs"][1]
        hold(at_tab(L, mine), (R["x"] + rt["x"] + 8, at_tab(R, rt)[1]))
        over = (dragging() or {}).get("over") or {}
        check("tabdrag", "over the other row: the bar before its second tab", over.get("row") == "right" and over.get("index") == 1, str(over))
        drop()
        got = wait(lambda: len(keys_of("right")) == 3 and keys_of("right"), 5) or []
        check("tabdrag", "moved to the right row, at the bar's place", len(got) == 3 and [got[0], got[2]] == [q["key"] for q in R["tabs"]] and len(keys_of("left")) == 2, f"{got} {keys_of('left')}")
        moved = got[1] if len(got) == 3 else None
        tid = term(moved) if moved else None
        check("tabdrag", "every terminal still runs", alive() == before_alive, f"{before_alive} -> {alive()}")
        pid = pid_of(tid) if tid else None
        sb("hc", "send", tid, "sleep 987654 &")
        R, L = rows()["right"], rows()["left"]
        mine = next(q for q in R["tabs"] if q["key"] == moved)
        hold(at_tab(R, mine), (L["x"] + 12, L["y"] - 100))
        over = (dragging() or {}).get("over") or {}
        check("tabdrag", "back over the left pane: before its first tab", over.get("row") == "left" and over.get("index") == 0, str(over))
        drop()
        got = wait(lambda: len(keys_of("left")) == 3 and keys_of("left"), 5) or []
        check("tabdrag", "moved to the left row, at the bar's place", got[:1] == [t["key"]] and len(keys_of("right")) == 2, f"{got} {keys_of('right')}")
        again = pid_of(tid) if tid else None
        jobs = sb("hc", "read", tid)
        check("tabdrag", "its terminal is the same process, its job still there", pid and pid == again, f"{pid} {again}")
        sb("hc", "send", tid, "kill %1")
        check("tabdrag", "every terminal still runs", alive() == before_alive, f"{before_alive} -> {alive()}")

        time.sleep(1)
        R, L = rows()["right"], rows()["left"]
        a, b = R["tabs"]
        hold(at_tab(R, b), (R["x"] + 6, at_tab(R, a)[1]))
        drop()
        check("tabdrag", "moved in the right row", wait(lambda: keys_of("right") == [b["key"], a["key"]], 3), str(keys_of("right")))
        click(*at_tab(L, L["tabs"][1]))
        away()
        shown = lambda: shared().get("orbit.sides", {}).get("last", {}).get(sid)
        check("tabdrag", "a click still shows a tab", wait(lambda: shown() == L["tabs"][1]["key"], 3), f"{shown()}")
        kept = sb("status")
        hold(at_tab(L, L["tabs"][0]), (100, 300))
        drop()
        one = json.loads(kept).get("focused_pane")
        two = json.loads(sb("status")).get("focused_pane")
        check("tabdrag", "the keys are where they were", one and one == two, f"{one} {two}")
        type_line("echo typed-here")
        time.sleep(1)
        seen = [q for q in alive() if "typed-here" in sb("hc", "read", q)]
        check("tabdrag", "and typing goes there", len(seen) == 1, str(seen))
    finally:
        release()
        if sid:
            do("space.close", {"id": sid, "confirmed": True})
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
    repo(f"{base}/elsewhere/app-clone", "https://github.com/me/app")
    g("worktree", "add", "-q", "-b", "fix", f"{base}/app-fix", cwd=f"{base}/app")
    repo(f"{base}/notes")
    g("worktree", "add", "-q", "-b", "draft", f"{base}/notes-draft", cwd=f"{base}/notes")
    repo(f"{base}/other", "git@github.com:me/other.git")
    made = {}
    for name, folder in [("app here", "app"), ("app there", "elsewhere/app-clone"), ("app fix", "app-fix"),
                         ("notes", "notes"), ("notes draft", "notes-draft"), ("other", "other")]:
        # (One at a time: a lookup that ends drops those of spaces made since it
        # began, mods/orbit/identity.js.)
        sid = made[name] = do("space.new", {"name": name, "folder": f"{base}/{folder}"}).get("space")
        wait(lambda: sid in shared().get("orbit.git", {}), 5)
    look = lambda: shared().get("orbit.identity", {})
    have = lambda: all("origin" in (shared().get("orbit.git", {}).get(sid) or {}) for sid in made.values())
    check("identity", "every new space's repo looked up", wait(have, 15), json.dumps({k: shared().get("orbit.git", {}).get(v) for k, v in made.items()}))
    quiet(0.5)
    idt = {k: look().get(v) for k, v in made.items()}
    same = lambda a, b: idt[a] is not None and idt[a] == idt[b]
    check("identity", "same repo, another place (another machine): same colour and symbol", same("app here", "app there"), str(idt))
    check("identity", "a worktree and its main checkout: same", same("app here", "app fix"), str(idt))
    check("identity", "without an origin, a worktree and its main checkout: same", same("notes", "notes draft"), str(idt))
    check("identity", "another repo: its own", idt["other"] is not None and idt["other"] != idt["app here"], str(idt))
    for sid in made.values():
        do("space.close", {"id": sid, "confirmed": True})
    quiet()



class FakeGitHub:
    """GitHub's latest-release answer, served locally: `release` is what it
    answers (None: 404, as before the first release); `hits` the requests'
    headers."""
    def __init__(self):
        fake = self
        self.release, self.hits, self.downloads, self.tarballs = None, [], [], []
        self.refuse = False
        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path.startswith("/repos/Calonca/herdr-orbit-look/tarball/"):
                    # As GitHub's API: 415 to an Accept it refuses, else a
                    # redirect to the archive (codeload there).
                    accept = self.headers.get("Accept", "")
                    fake.tarballs.append(accept)
                    if fake.refuse or accept and not any(a.split(";")[0].strip() in ("*/*", "application/vnd.github+json", "application/json")
                                          for a in accept.split(",")):
                        self.send_response(415)
                        self.end_headers()
                        return
                    self.send_response(302)
                    self.send_header("Location", f"/archive/{self.path.rsplit('/', 1)[1]}.tar.gz")
                    self.end_headers()
                    return
                if self.path.startswith("/archive/"):
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
        # The port the running sandbox asks (--reuse), else any.
        try:
            self.server = ThreadingHTTPServer(("127.0.0.1", kept().get("port", 0)), H)
        except OSError:
            self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.server.server_address[1]
        self.url = f"http://127.0.0.1:{self.port}/repos/Calonca/herdr-orbit-look/releases/latest"
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


def check_now(tag=None, timeout=5):
    """The fake answers `tag`; the orbit mod looks now (orbit.update-check):
    whether it asked."""
    n = len(FAKE.hits)
    if tag:
        FAKE.answer(tag)
    sb("do", "orbit.update-check {}")
    if not wait(lambda: len(FAKE.hits) > n, timeout):
        return False
    want = FAKE.release and FAKE.release["tag_name"]
    wait(lambda: (update_state().get("latest") or {}).get("tag") == want, 5)
    quiet(0.3)
    return True


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
    return sb("clipboard")


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
    select(ids["shown"][0])

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
    still("update-card")
    st = update_state()
    check("update", "its notes: all the bullets, plain", (st.get("latest") or {}).get("notes") == ["one. detail one", "two. detail two", "three. detail three", "four. detail four"], json.dumps(st))
    if r:
        bottom = r["y"] + r["h"] * ZOOM
        bar_top = bar_y() - 20 * ZOOM
        check("update", "above the status bar, at the right edge", bottom <= bar_top + 1 and r["x"] + 280 * ZOOM <= W, f"{r} bar top {bar_top}")
        check("update", "clear of Herdr's update pill", bottom <= herdr_pill() - 4, f"bottom {bottom} pill top {herdr_pill()}")

    os.makedirs(f"{HOME}/mods/regress-notify", exist_ok=True)
    open(f"{HOME}/mods/regress-notify/main.js", "w").write(NOTIFIER)
    open(f"{HOME}/mods/regress-notify/mod.json", "w").write('{ "place": "none" }')
    quiet(0.5)
    t = do("tab.new", {"mod": "regress-notify", "props": {"level": "info"}})
    moved = wait(lambda: card() and r and card()["y"] < r["y"] - 70 * ZOOM, 3)
    top_toast = H - (16 + 34 + 8 + 72) * ZOOM
    check("update", "a toast: the card moves up, clear of it", moved and card()["y"] + card()["h"] * ZOOM <= top_toast - 4,
          f"{card()} toast top {top_toast}")
    still("update-card-toast")
    if t.get("tab"):
        do("tab.close", {"id": t["tab"], "confirmed": True})
    back = wait(lambda: card() and r and abs(card()["y"] - r["y"]) < 2, 12)
    check("update", "the toast gone: the card back in its place", back, f"{card()} was {r}")

    sb("do", "orbit.settings " + json.dumps({"density": "compact"}))
    wait(lambda: card() and r and abs(card()["y"] - r["y"]) > 1, 2)
    quiet()
    still("update-card-compact")
    c = card()
    check("update", "compact: still clear of Herdr's pill", c and c["y"] + c["h"] * ZOOM <= herdr_pill() - 4, f"{c} pill top {herdr_pill()}")
    sb("do", "orbit.settings " + json.dumps({"density": "comfortable"}))
    c = wait(lambda: card() and r and abs(card()["y"] - r["y"]) < 2 and card(), 5)
    quiet()

    if c:
        click(*card_point(c, "close"))
    check("update", "× closes it", wait(lambda: "orbit-dialogs" not in (overlays() or []), 3), str(overlays()))
    check("update", "× remembers the release", wait(lambda: update_state().get("closed") == newer(1) and not card(), 6), json.dumps(update_state()))
    check_now()
    check("update", "the same release again: no card", not card(), str(card()))

    settings_before = json.dumps(shared().get("orbit.settings"), sort_keys=True)
    check_now(newer(2))
    c = wait(lambda: (card() or {}).get("tag") == newer(2) and card(), 5)
    check("update", f"{newer(2)}: the card", c and c.get("tag") == newer(2), str(c))
    n = len(FAKE.downloads)
    if c:
        click(*card_point(c, "first"))
    done = wait(lambda: (card() or {}).get("mode") == "updated", 20)
    check("update", "\"update\" downloads the release once", len(FAKE.downloads) == n + 1, str(FAKE.downloads))
    quiet(0.5)
    still("update-updated")
    ok, v = installed_ok()
    check("update", "\"update\" replaces the look: the new version, as recorded", ok and v == newer(2).lstrip("v")
          and f"// release {newer(2)}" in open(f"{HOME}/mods/orbit-status/main.js").read(), f"{ok} {v}")
    check("update", "then the card says \"Updated to\"", done, str(card()))
    check("update", "one card only (the one from before the reload is gone)", wait(lambda: (overlays() or []).count("orbit-dialogs") == 1, 5), str(overlays()))
    check("update", "the settings stay", json.dumps(shared().get("orbit.settings"), sort_keys=True) == settings_before,
          f"{shared().get('orbit.settings')} was {settings_before}")
    check("update", "the previous copy is kept", os.path.isfile(f"{HOME}/data/orbit-updates/previous/mods/orbit/VERSION"))
    check("update", "the status bar runs the new copy", wait(lambda: bar_y() is not None, 5), "")

    c = card()
    if c:
        click(*card_point(c, "first"))
    back = wait(lambda: installed_ok() == (True, INSTALLED), 20)
    check("update", "\"undo\" puts the old copy back", back and "// release" not in open(f"{HOME}/mods/orbit-status/main.js").read(), str(installed_ok()))
    quiet(1)
    check("update", "after undo: no card for that release", wait(lambda: not card(), 5), str(card()))
    shot("update-undone")

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
    still("update-changed")
    if err:
        click(*card_point(err, "first"))
    got = wait(lambda: newer(3) in clipboard() and clipboard(), 5) or clipboard()
    check("update", "\"copy update prompt\" copies the prompt", newer(3) in got and got.startswith("Read ~/.config/herdr-app/AGENTS.md")
          and "keep those changes" in got, repr(got))
    still("update-copied")
    open(path, "w").write(original)
    c = card()
    if c:
        click(*card_point(c, "close"))
    check("update", "× closes the error card", wait(lambda: not card(), 3), str(card()))

    check_now(newer(4))
    c = wait(lambda: (card() or {}).get("tag") == newer(4) and card(), 5)
    check("update", f"{newer(4)}: the card", c, str(card()))
    if c:
        click(*card_point(c, "second"))
    check("update", "\"stop notifications\": the card goes, the setting is off",
          wait(lambda: not card() and shared().get("orbit.settings", {}).get("updates") is False, 4),
          f"{card()} {shared().get('orbit.settings')}")
    check("update", "off: no request", not check_now(newer(5), 2), f"{len(FAKE.hits)} requests")
    check("update", "off: still no card", not card(), str(card()))
    set_updates(True)
    check("update", "on again (the settings row): it asks, and the card is back", check_now() and wait(card, 3), str(card()))
    sb("do", "orbit.settings")
    quiet(0.5)
    still("update-settings")
    c = card()
    if c:
        click(*card_point(c, "close"))
    wait(lambda: not card(), 3)

    long = [f"{w} " + "a longer line of release notes that wraps over more than one row" for w in ("first", "second", "third", "fourth", "fifth")]
    FAKE.answer(newer(6), long)
    check_now()
    c = wait(lambda: (card() or {}).get("tag") == newer(6) and card(), 5)
    check("update", "long notes: all kept", (update_state().get("latest") or {}).get("notes") == [f"{l}. detail {l}" for l in long], json.dumps(update_state()))
    check("update", "long notes: six rows on the card, a taller card", c and c.get("lines") == 6 and c["h"] == 14 + 20 + 4 + 18 * 6 + 12 + 28 + 14, str(c))
    check("update", "long notes: still clear of Herdr's pill", c and c["y"] + c["h"] * ZOOM <= herdr_pill() - 4, f"{c} pill top {herdr_pill()}")
    still("update-long-notes")
    if c:
        for _ in range(6):
            click(c["x"] + 140 * ZOOM, c["y"] + (14 + 20 + 4 + 50) * ZOOM, 5)
        still("update-long-notes-scrolled")

    FAKE.refuse = True
    n = len(FAKE.downloads)
    if c:
        click(*card_point(c, "first"))
    err = wait(lambda: (card() or {}).get("mode") == "error" and card(), 15)
    FAKE.refuse = False
    check("update", "a refused download: an error card, nothing downloaded or replaced",
          err and len(FAKE.downloads) == n and installed_ok() == (True, INSTALLED), f"{card()} {FAKE.downloads} {installed_ok()}")
    check("update", "the error wraps over more than one row", err and err.get("lines", 0) >= 2, str(err))
    still("update-download-error")
    if err:
        click(*card_point(err, "second"))
    got = wait(lambda: newer(6) in clipboard() and clipboard(), 5) or clipboard()
    check("update", "a download error: \"copy update prompt\" copies the prompt", newer(6) in got and "failed" in got and "keep those changes" not in got, repr(got))
    still("update-download-copied")
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
    quiet(1)
    for _ in range(4):
        if check_now(nxt):
            break
    c = wait(lambda: (card() or {}).get("tag") == nxt and card(), 8)
    quiet()
    still("update-pill")
    check("update", "Herdr's pill showing: the card above it", c and c["y"] + c["h"] * ZOOM <= herdr_pill() - 4, f"{c} pill top {herdr_pill()}")


SCENARIOS = [("popup", popup), ("order", order), ("pin", pin), ("drag", drag), ("symbols", symbols), ("tabs", tabs), ("row", row), ("tabdrag", tabdrag), ("identity", identity), ("settings", settings), ("terminal", terminal), ("padding", padding), ("spacing", spacing), ("toast", toast), ("keep", keep), ("split", split), ("update", update), ("update-pill", update_pill)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-k", default="")
    ap.add_argument("--down", action="store_true")
    ap.add_argument("--reuse", action="store_true")
    a = ap.parse_args()
    ids = (a.reuse and reuse()) or setup()
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
