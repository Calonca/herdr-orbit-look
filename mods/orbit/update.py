#!/usr/bin/env python3
"""The Orbit look's own update: hash, replace, undo. The orbit mod
(updates.js) runs it when the person clicks "update" on its card; install.sh
and tools/release.sh use it to write mods/orbit/VERSION.

mods/orbit/VERSION: the version on its first line, then "sha256:<hash>" of
the look's files, then those files and folders, one per line, relative to
herdr-app's home (or the repo): the themes, the mods/orbit*/ folders and the
layout files. The hash is what that version's files hash to, so a copy whose
files hash differently was changed by someone, and an update leaves it alone.

What the hash leaves out: VERSION itself; in the folders, hidden files,
__pycache__, and what Herdr writes into mod folders (jsconfig.json, *.d.ts),
as install.sh does when it compares; in layouts/orbit.json, what the orbit mod
writes there (layout.js shape(): the look settings, the glass, the outline
colours, the right pane's children, the side panel's views). The person's
settings live elsewhere (shared.json, orbit-windows.json, layouts/.state,
data/, backgrounds/) and are never read or written here.

  update.py hash <root>                    the hash of the look at <root> (its VERSION's list)
  update.py stamp <tree> [--version V] [--out FILE] [--check]
                                           write <tree>'s VERSION (list and hash of <tree>)
  update.py apply <home> <archive-url> <tag> [--detach]
                                           update the installed look to <tag>
  update.py undo <home> [--detach]         put the previous copy back (again: redo)

apply and undo print and write <home>/data/orbit-updates/result.json:
{"ok": true, "action", "from", "to"} or {"error": "changed" | "download" |
"check" | "busy" | "failed" | "missing", "message", "action", "tag"}.
--detach: return at once and do the work in a process of its own, so that
Herdr reloading the orbit mod (whose files this replaces) can't stop it half
way; the mod reads result.json.

apply: the installed hash must equal the recorded one, else nothing happens
("changed"). Then the release archive is downloaded and unpacked under
data/orbit-updates/ (same disk as the home), and checked: its VERSION names
<tag>, lists exactly its files, and its files hash to the recorded hash. Only
then is anything replaced: each item is moved into data/orbit-updates/previous
and the new one moved into its place (renames, each atomic); a failure on the
way moves everything back. keys.json's sections from the release
("layout:orbit") are set in the home's keys.json as install.sh does, the old
ones kept with the previous copy. install.sh's manifest, when there is one,
gets the new list.
"""
import hashlib, json, os, shutil, signal, sys, tarfile, time, urllib.request

try:
    import fcntl
except ImportError:  # not on Windows: no lock there
    fcntl = None

ORDER = ("themes/", "mods/", "layouts/")  # themes first: a mod or layout that names one finds it
SKIP_NAMES = {"jsconfig.json", "__pycache__"}
VERSION = "mods/orbit/VERSION"
LAYOUT = "layouts/orbit.json"
MAX_DOWNLOAD = 64 * 1024 * 1024
UA = "herdr-orbit-look"

# ---------------------------------------------------------------- hash


def layout_digest(data):
    """layouts/orbit.json with what the orbit mod writes taken out (layout.js
    shape(); keep the two in step)."""
    root = json.loads(data)
    for k in ("background", "terminal_padding", "padding"):
        root.pop(k, None)
    strip = {
        "body": ("gap", "padding"), "work": ("gap",), "orbit": ("size",), "status": ("size",),
        "sidebar-footer": ("size",), "sidebar": ("background", "radius"), "panel": ("min",),
        "left": ("background", "active"), "right": ("background", "active", "children"),
        "panel-body": ("background", "active"),
        "left-mid": ("divider",), "right-mid": ("divider",), "panel-mid": ("divider",),
    }

    def walk(node):
        nid = node.get("id")
        for k in strip.get(nid, ()):
            node.pop(k, None)
        if nid in ("left-frame", "right-frame", "panel") and isinstance(node.get("children"), list):
            for c in node["children"]:
                if str(c.get("id", "")).endswith(("-cap", "-tabs")):
                    c.pop("size", None)
            node["children"].sort(key=lambda c: str(c.get("id")))  # the tabs on top: upside down
        if nid == "panel-body" and isinstance(node.get("children"), list):
            node["children"] = [c for c in node["children"] if not str(c.get("id", "")).startswith("panel-v")]
        for c in node.get("children") or []:
            if isinstance(c, dict):
                walk(c)

    walk(root)
    return hashlib.sha256(json.dumps(root, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def file_digest(rel, path):
    data = open(path, "rb").read()
    if rel == LAYOUT:
        try:
            return layout_digest(data)
        except Exception:
            pass  # not JSON any more: its bytes, which won't match
    return hashlib.sha256(data).hexdigest()


def skipped(name):
    return name.startswith(".") or name in SKIP_NAMES or name.endswith(".d.ts")


def entries(root, items):
    """[(path, digest)] of every file of `items` under `root`."""
    out = []
    for item in items:
        path = os.path.join(root, item)
        if os.path.isfile(path):
            out.append((item, file_digest(item, path)))
        elif os.path.isdir(path):
            for d, dirs, files in os.walk(path):
                dirs[:] = sorted(x for x in dirs if not skipped(x))
                for f in sorted(files):
                    if skipped(f):
                        continue
                    rel = os.path.relpath(os.path.join(d, f), root).replace(os.sep, "/")
                    if rel == VERSION:
                        continue
                    out.append((rel, file_digest(rel, os.path.join(d, f))))
        else:
            out.append((item, "missing"))
    return sorted(out)


def digest(root, items):
    h = hashlib.sha256()
    for rel, d in entries(root, items):
        h.update(f"{rel}\0{d}\n".encode())
    return "sha256:" + h.hexdigest()


def tree_items(tree):
    """The look's files in a repo or release tree, as install.sh copies them."""
    out = []
    for sub, ok in (("themes", lambda n, p: n.endswith(".json") and os.path.isfile(p)),
                    ("mods", lambda n, p: os.path.isdir(p)),
                    ("layouts", lambda n, p: n.endswith((".json", ".svg")) and os.path.isfile(p))):
        d = os.path.join(tree, sub)
        if os.path.isdir(d):
            out += [f"{sub}/{n}" for n in sorted(os.listdir(d)) if not n.startswith(".") and ok(n, os.path.join(d, n))]
    return ordered(out)


def ordered(items):
    return sorted(set(items), key=lambda i: (next((n for n, p in enumerate(ORDER) if i.startswith(p)), 9), i))


def read_version(root):
    """(version, hash, items) of <root>/mods/orbit/VERSION, or None."""
    try:
        lines = [l.strip() for l in open(os.path.join(root, VERSION)).read().splitlines()]
    except OSError:
        return None
    lines = [l for l in lines if l]
    if len(lines) < 3 or not lines[1].startswith("sha256:"):
        return None
    items = lines[2:]
    if any(i.startswith("/") or ".." in i.split("/") or not i.startswith(ORDER) for i in items):
        return None
    return lines[0], lines[1], items


def version_text(version, items, tree):
    return f"{version}\n{digest(tree, items)}\n" + "".join(f"{i}\n" for i in items)


# ---------------------------------------------------------------- files


def atomic_write(path, text):
    tmp = f"{path}.orbit-tmp"
    with open(tmp, "w") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def rmtree(path):
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    elif os.path.lexists(path):
        os.remove(path)


def move(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    os.rename(src, dst)


def set_keys(home, sections):
    """Sets keys.json's `sections` ({name: binds | None}); returns what they
    were. No keys.json yet: nothing (install.sh says the same)."""
    path = os.path.join(home, "keys.json")
    if not os.path.isfile(path):
        return {}
    old_text = open(path).read()
    keys = json.loads(old_text)
    before = {name: keys.get(name) for name in sections}
    for name, binds in sections.items():
        if binds is None:
            keys.pop(name, None)
        else:
            keys[name] = binds
    if keys != json.loads(old_text):
        atomic_write(path, json.dumps(keys, indent=2, ensure_ascii=False) + "\n")
    return before


def set_manifest(home, remove, add):
    path = os.path.join(home, ".herdr-orbit-manifest")
    if not os.path.isfile(path):
        return
    old = [l for l in open(path).read().splitlines() if l]
    new = ordered([l for l in old if l not in remove] + list(add))
    if new != old:
        atomic_write(path, "".join(f"{l}\n" for l in new))


def swap(home, src, old_items, new_items, keys, prev):
    """Moves `old_items` (and whatever sits where a new item goes) from `home`
    into `prev`, then `new_items` from `src` into `home`, and sets `keys`.
    Any failure moves everything back and raises. `prev` gets the list of what
    it holds (items) and the keys it replaced (keys.json)."""
    os.makedirs(prev)
    done = []  # ("out", item) moved home -> prev; ("in", item) moved src -> home
    try:
        for item in ordered(old_items + new_items):
            if os.path.lexists(os.path.join(home, item)):
                move(os.path.join(home, item), os.path.join(prev, item))
                done.append(("out", item))
            if item in new_items:
                move(os.path.join(src, item), os.path.join(home, item))
                done.append(("in", item))
        kept = [i for k, i in done if k == "out"]
        atomic_write(os.path.join(prev, "items"), "".join(f"{i}\n" for i in kept))
        keys_path = os.path.join(home, "keys.json")
        keys_text = open(keys_path).read() if os.path.isfile(keys_path) else None
        before = set_keys(home, keys)
        done.append(("keys", keys_text))
        atomic_write(os.path.join(prev, "keys.json"), json.dumps(before, indent=2) + "\n")
        set_manifest(home, set(old_items) - set(new_items), new_items)
    except BaseException:
        for kind, what in reversed(done):
            try:
                if kind == "in":
                    move(os.path.join(home, what), os.path.join(src, what))
                elif kind == "out":
                    move(os.path.join(prev, what), os.path.join(home, what))
                elif what is not None:
                    atomic_write(os.path.join(home, "keys.json"), what)
            except Exception as e:  # keep going: put back all that can be
                print(f"couldn't put back {what}: {e}", file=sys.stderr)
        raise


# ---------------------------------------------------------------- download


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/octet-stream"})
    tmp = dest + ".part"
    got = 0
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            got += len(chunk)
            if got > MAX_DOWNLOAD:
                raise ValueError("the archive is too big")
            f.write(chunk)
    os.replace(tmp, dest)


def unpack(archive, dest):
    """Unpacks a release archive (GitHub's: one top folder) into `dest`: only
    plain files and folders, nothing outside it."""
    with tarfile.open(archive, "r:*") as tar:
        members = [m for m in tar.getmembers() if m.type not in (tarfile.XGLTYPE, tarfile.XHDTYPE)]
        tops = {m.name.split("/")[0] for m in members if m.name not in ("", ".")}
        strip = len(tops) == 1 and not any(m.name == "mods" for m in members)
        os.makedirs(dest)
        for m in members:
            parts = [p for p in m.name.split("/") if p not in ("", ".")]
            if strip:
                parts = parts[1:]
            if not parts:
                continue
            if m.name.startswith("/") or ".." in parts:
                raise ValueError(f"a path outside the archive: {m.name}")
            out = os.path.join(dest, *parts)
            if m.isdir():
                os.makedirs(out, exist_ok=True)
            elif m.isfile():
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with tar.extractfile(m) as src, open(out, "wb") as f:
                    shutil.copyfileobj(src, f)
                if m.mode & 0o111:
                    os.chmod(out, 0o755)
            elif m.issym() or m.islnk():
                raise ValueError(f"a link in the archive: {m.name}")
            # pax headers and the like: nothing to unpack


def check_release(tree, tag):
    v = read_version(tree)
    if not v:
        raise ValueError("it has no version file")
    version, recorded, items = v
    if version.lstrip("v") != tag.lstrip("v"):
        raise ValueError(f"it is {version}, not {tag}")
    if items != tree_items(tree):
        raise ValueError("its version file doesn't list its files")
    if digest(tree, items) != recorded:
        raise ValueError("its files don't match its version file")
    return version, items


# ---------------------------------------------------------------- apply, undo


class Refused(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def work_dir(home):
    return os.path.join(home, "data", "orbit-updates")


def installed(home):
    """(version, items) of the installed copy, if its files are as recorded."""
    v = read_version(home)
    if not v:
        raise Refused("missing", "the installed look has no version file")
    version, recorded, items = v
    if digest(home, items) != recorded:
        raise Refused("changed", "the installed look was changed, so it wasn't replaced")
    return version, items


def apply(home, url, tag):
    work = work_dir(home)
    version, old_items = installed(home)
    archive, staging = os.path.join(work, "download.tar.gz"), os.path.join(work, "staging")
    rmtree(staging)
    try:
        try:
            download(url, archive)
        except Exception as e:
            raise Refused("download", f"the download failed: {e}")
        try:
            unpack(archive, staging)
            new_version, new_items = check_release(staging, tag)
        except Exception as e:
            raise Refused("check", f"the download didn't check out: {e}")
        installed(home)  # still as recorded, after the download
        keys = {}
        if os.path.isfile(os.path.join(staging, "keys.json")):
            keys = json.load(open(os.path.join(staging, "keys.json")))
        replace(home, staging, old_items, new_items, keys)
        return {"ok": True, "action": "apply", "from": version, "to": new_version}
    finally:
        rmtree(staging)
        rmtree(archive)
        rmtree(archive + ".part")


def replace(home, src, old_items, new_items, keys):
    work = work_dir(home)
    prev, nxt = os.path.join(work, "previous"), os.path.join(work, "previous.new")
    rmtree(nxt)
    try:
        swap(home, src, old_items, new_items, keys, nxt)
    except Exception as e:
        rmtree(nxt)
        raise Refused("failed", f"couldn't replace the files, nothing was changed: {e}")
    rmtree(prev)
    os.rename(nxt, prev)


def undo(home):
    """The previous copy back; the one replaced becomes the previous copy."""
    work = work_dir(home)
    prev = os.path.join(work, "previous")
    try:
        items = [l for l in open(os.path.join(prev, "items")).read().splitlines() if l]
        keys = json.load(open(os.path.join(prev, "keys.json")))
    except OSError:
        raise Refused("missing", "there is no previous copy")
    if any(i.startswith("/") or ".." in i.split("/") or not i.startswith(ORDER) for i in items):
        raise Refused("missing", "the previous copy's list is broken")
    version, current = installed(home)
    back = read_version(prev)
    # The previous copy moves out of the way first, then the swap fills a new one.
    held = os.path.join(work, "previous.old")
    rmtree(held)
    os.rename(prev, held)
    try:
        replace(home, held, current, items, keys)
    except Exception:
        os.rename(held, prev)
        raise
    rmtree(held)
    return {"ok": True, "action": "undo", "from": version, "to": back[0] if back else None}


def run(home, action, fn, tag=None):
    work = work_dir(home)
    os.makedirs(work, exist_ok=True)
    lock = open(os.path.join(work, "lock"), "w")
    try:
        if fcntl:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return {"error": "busy", "message": "an update is running already", "action": action, "tag": tag}
    try:
        out = fn()
    except Refused as e:
        out = {"error": e.code, "message": str(e), "action": action}
    except Exception as e:
        out = {"error": "failed", "message": f"{type(e).__name__}: {e}", "action": action}
    out["at"] = int(time.time() * 1000)
    if tag:
        out["tag"] = tag
    atomic_write(os.path.join(work, "result.json"), json.dumps(out, indent=2) + "\n")
    return out


def detach():
    """Goes on in a process of its own (the caller gets its answer now)."""
    if not hasattr(os, "fork"):
        return  # (Windows) the work is done before the answer
    if os.fork():
        print(json.dumps({"started": True}))
        sys.stdout.flush()
        os._exit(0)
    os.setsid()
    if os.fork():
        os._exit(0)
    for s in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
        signal.signal(s, signal.SIG_IGN)
    null = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(null, fd)


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    cmd, args, flags, rest = argv[1], [], {}, list(argv[2:])
    while rest:
        a = rest.pop(0)
        if a in ("--version", "--out") and rest:
            flags[a] = rest.pop(0)
        elif a.startswith("--"):
            flags[a] = True
        else:
            args.append(a)
    if cmd == "hash" and len(args) == 1:
        v = read_version(args[0])
        print(digest(args[0], v[2] if v else tree_items(args[0])))
        return 0
    if cmd == "stamp" and len(args) == 1:
        tree = args[0]
        old = read_version(tree)
        version = flags.get("--version") or (old[0] if old else None)
        if not version:
            print("no version: pass --version", file=sys.stderr)
            return 2
        text = version_text(version, tree_items(tree), tree)
        out = flags.get("--out") or os.path.join(tree, "mods/orbit/VERSION")
        if flags.get("--check"):
            ok = os.path.isfile(out) and open(out).read() == text
            print("VERSION is up to date" if ok else f"VERSION is out of date: run {argv[0]} stamp {tree}", file=sys.stderr)
            return 0 if ok else 1
        atomic_write(out, text)
        return 0
    if cmd in ("apply", "undo") and len(args) == (3 if cmd == "apply" else 1):
        home = args[0]
        if flags.get("--detach"):
            detach()
        fn = (lambda: apply(home, args[1], args[2])) if cmd == "apply" else (lambda: undo(home))
        out = run(home, cmd, fn, args[2] if cmd == "apply" else None)
        print(json.dumps(out))
        return 0 if out.get("ok") else 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
