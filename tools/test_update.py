#!/usr/bin/env python3
"""Tests of mods/orbit/update.py: the hash (what's in, what's out, match and
mismatch) and the replace step, which can destroy a person's files.

  python3 tools/test_update.py
"""
import copy, hashlib, importlib.util, io, json, os, shutil, sys, tarfile, tempfile, unittest
from unittest import mock

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("orbit_update", os.path.join(REPO, "mods/orbit/update.py"))
U = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(U)


def snapshot(root):
    """Every file under root (but data/orbit-updates) with its bytes' hash."""
    out = {}
    for d, dirs, files in os.walk(root):
        if os.path.relpath(d, root).startswith(os.path.join("data", "orbit-updates")):
            continue
        for f in files:
            p = os.path.join(d, f)
            out[os.path.relpath(p, root)] = hashlib.sha256(open(p, "rb").read()).hexdigest()
    return out


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write(text)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="orbit-update-test-")
        self.home = os.path.join(self.tmp, "home")
        self.release = os.path.join(self.tmp, "release")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def tree(self, root, version, change=""):
        """A copy of this repo's look at `root`, stamped `version`; `change`
        added to orbit-status' main.js (a different release)."""
        for sub in ("themes", "mods", "layouts"):
            shutil.copytree(os.path.join(REPO, sub), os.path.join(root, sub),
                            ignore=shutil.ignore_patterns("jsconfig.json", "*.d.ts", "__pycache__"))
        shutil.copy(os.path.join(REPO, "keys.json"), os.path.join(root, "keys.json"))
        if change:
            with open(os.path.join(root, "mods/orbit-status/main.js"), "a") as f:
                f.write(change)
        U.atomic_write(os.path.join(root, U.VERSION), U.version_text(version, U.tree_items(root), root))

    def install(self):
        """The home as install.sh leaves it, with the person's own things."""
        self.tree(self.home, "0.5.0")
        write(f"{self.home}/keys.json", json.dumps({"global": {"ctrl-q": "app.quit"}, "layout:orbit": {"old": "x"}}))
        write(f"{self.home}/shared.json", '{"orbit.settings": {"density": "compact"}}')
        write(f"{self.home}/orbit-windows.json", '{"windows": []}')
        write(f"{self.home}/layouts/.state/orbit.json", '{"clicks": 1}')
        write(f"{self.home}/data/orbit-settings/picked", "x")
        write(f"{self.home}/backgrounds/me.png", "png")
        write(f"{self.home}/mods/orbit-mine/main.js", "// the person's own mod")
        write(f"{self.home}/mods/files/main.js", "// another mod")
        write(f"{self.home}/themes/mine.json", "{}")
        write(f"{self.home}/layouts/mine.json", "{}")
        write(f"{self.home}/.herdr-orbit-manifest", "".join(f"{i}\n" for i in U.tree_items(self.home)))
        # What Herdr writes into mod folders.
        write(f"{self.home}/mods/orbit/jsconfig.json", "{}")
        write(f"{self.home}/mods/orbit/herdr.d.ts", "// types")

    def own(self, snap):
        """The person's files in a snapshot: everything but the look's own."""
        items = set(U.tree_items(REPO)) | set(U.tree_items(self.release) if os.path.isdir(self.release) else [])
        return {k: v for k, v in snap.items() if k not in ("keys.json", ".herdr-orbit-manifest") and not any(k == i or k.startswith(i + "/") for i in items)}

    def archive(self, tree, name="v0.6.0.tar.gz", top="Calonca-herdr-orbit-look-abc123"):
        path = os.path.join(self.tmp, name)
        with tarfile.open(path, "w:gz") as tar:
            tar.add(tree, arcname=top)
        return "file://" + path


class Hash(Base):
    def setUp(self):
        super().setUp()
        self.install()
        self.recorded = U.read_version(self.home)[1]

    def now(self):
        return U.digest(self.home, U.read_version(self.home)[2])

    def test_installed_matches(self):
        self.assertEqual(self.now(), self.recorded)
        self.assertEqual(U.installed(self.home)[0], "0.5.0")

    def test_left_out(self):
        for rel in ["mods/orbit-status/jsconfig.json", "mods/orbit-tabs/gpui-kit.d.ts", "mods/orbit/.hidden",
                    "mods/orbit-add/.cache/x", "mods/orbit/__pycache__/update.cpython-314.pyc",
                    # the person's own: not on the list
                    "mods/orbit-mine/more.js", "themes/other.json", "layouts/other.json", "shared.json",
                    "layouts/.state/orbit.json", "data/orbit-updates/state.json"]:
            write(f"{self.home}/{rel}", "x")
        with open(f"{self.home}/{U.VERSION}", "a") as f:
            f.write("\n")  # VERSION itself (a blank line read past)
        self.assertEqual(self.now(), self.recorded)

    def test_counted(self):
        cases = {
            "a mod's file changed": lambda: open(f"{self.home}/mods/orbit-status/main.js", "a").write("//"),
            "a file added to a mod": lambda: write(f"{self.home}/mods/orbit/extra.js", ""),
            "a file removed": lambda: os.remove(f"{self.home}/mods/orbit-tabs/main.js"),
            "a mod folder removed": lambda: shutil.rmtree(f"{self.home}/mods/orbit-edge"),
            "a theme changed": lambda: open(f"{self.home}/themes/nord.json", "a").write(" "),
            "the layout's preview changed": lambda: open(f"{self.home}/layouts/orbit.svg", "a").write(" "),
            "a picture changed": lambda: open(f"{self.home}/mods/orbit/backgrounds/space.png", "ab").write(b"\0"),
        }
        for what, change in cases.items():
            with self.subTest(what):
                self.tearDown(); self.setUp()
                change()
                self.assertNotEqual(self.now(), self.recorded)
                with self.assertRaises(U.Refused) as e:
                    U.installed(self.home)
                self.assertEqual(e.exception.code, "changed")

    def layout(self, change):
        path = f"{self.home}/layouts/orbit.json"
        root = json.load(open(path))
        change(root, lambda id: next(n for n in walk(root) if n.get("id") == id))
        open(path, "w").write(json.dumps(root, indent=2))

    def test_layout_what_the_mod_writes(self):
        def mod_writes(root, find):
            # layout.js shape(): settings, glass, outlines, right pane, panel views, tabs on top.
            root["background"] = {"image": "backgrounds/me.png", "fit": "cover"}
            root["terminal_padding"] = [8, 6]
            root.pop("padding", None)
            find("body")["gap"] = 4
            find("work").pop("gap", None)
            find("orbit")["size"] = {"px": 6}
            find("status")["size"] = {"px": 28}
            find("sidebar-footer")["size"] = {"px": 67}
            find("sidebar")["background"] = "#1616229e"
            find("sidebar")["radius"] = 4
            find("panel")["min"] = 99
            for f in ("left-frame", "right-frame", "panel"):
                kids = find(f)["children"]
                for c in kids:
                    if c["id"].endswith(("-cap", "-tabs")):
                        c["size"] = {"px": 77}
                kids.reverse()
            find("left-mid")["divider"] = {"width": 2, "color": "#bb9af7"}
            find("left")["background"] = "#123"
            find("left")["active"] = "left-tab"
            find("right")["children"].append({"id": "t-t7", "type": "block", "content": {"terminal": "t7"}})
            find("right")["active"] = "t-t7"
            find("panel-body")["children"].append({"id": "panel-vabc", "type": "block", "content": {"mod": "files"}})
            find("panel-body")["active"] = "panel-vabc"
        self.layout(mod_writes)
        self.assertEqual(self.now(), self.recorded)

    def test_layout_hand_edits(self):
        edits = {
            "the sidebar's width": lambda root, find: find("sidebar").__setitem__("size", {"px": 300}),
            "a block's mod": lambda root, find: find("spaces").__setitem__("content", {"mod": "spaces"}),
            "the theme": lambda root, find: root.__setitem__("theme", "nord"),
            "a block added to a frame": lambda root, find: find("left-frame")["children"].append({"id": "x", "type": "block"}),
            "a block added to the panel": lambda root, find: find("panel-body")["children"].append({"id": "mine", "type": "block"}),
        }
        for what, edit in edits.items():
            with self.subTest(what):
                self.tearDown(); self.setUp()
                self.layout(edit)
                self.assertNotEqual(self.now(), self.recorded)
        self.tearDown(); self.setUp()
        open(f"{self.home}/layouts/orbit.json", "w").write("not json")
        self.assertNotEqual(self.now(), self.recorded)

    def test_no_version_file(self):
        os.remove(f"{self.home}/{U.VERSION}")
        with self.assertRaises(U.Refused) as e:
            U.installed(self.home)
        self.assertEqual(e.exception.code, "missing")

    def test_stamp_check(self):
        self.tree(self.release, "0.6.0")
        self.assertEqual(U.main(["u", "stamp", self.release, "--check"]), 0)
        open(f"{self.release}/mods/orbit/main.js", "a").write("//")
        self.assertEqual(U.main(["u", "stamp", self.release, "--check"]), 1)


def walk(n):
    yield n
    for c in n.get("children") or []:
        yield from walk(c)


class Replace(Base):
    def setUp(self):
        super().setUp()
        self.install()
        self.tree(self.release, "0.6.0", change="\n// 0.6.0\n")
        # The release drops orbit-edge and adds orbit-new; its keys differ.
        shutil.rmtree(f"{self.release}/mods/orbit-edge")
        write(f"{self.release}/mods/orbit-new/main.js", "// new")
        write(f"{self.release}/keys.json", json.dumps({"layout:orbit": {"new": "y"}}))
        U.atomic_write(f"{self.release}/{U.VERSION}", U.version_text("0.6.0", U.tree_items(self.release), self.release))
        self.url = self.archive(self.release)
        self.before = snapshot(self.home)

    def apply(self, url=None, tag="v0.6.0"):
        return U.run(self.home, "apply", lambda: U.apply(self.home, url or self.url, tag), tag)

    def unchanged(self):
        self.assertEqual(snapshot(self.home), self.before)
        left = os.listdir(f"{self.home}/data/orbit-updates")
        self.assertFalse({"staging", "download.tar.gz", "download.tar.gz.part", "previous.new"} & set(left), left)

    def test_update(self):
        out = self.apply()
        self.assertEqual((out.get("ok"), out.get("from"), out.get("to")), (True, "0.5.0", "0.6.0"), out)
        self.assertEqual(json.load(open(f"{self.home}/data/orbit-updates/result.json"))["to"], "0.6.0")
        after = snapshot(self.home)
        # The new release is installed, and checks out as it.
        self.assertEqual(U.installed(self.home)[0], "0.6.0")
        self.assertIn("// 0.6.0", open(f"{self.home}/mods/orbit-status/main.js").read())
        self.assertTrue(os.path.isfile(f"{self.home}/mods/orbit-new/main.js"))
        self.assertFalse(os.path.exists(f"{self.home}/mods/orbit-edge"))
        # The person's files are as they were.
        self.assertEqual(self.own(after), self.own(self.before))
        keys = json.load(open(f"{self.home}/keys.json"))
        self.assertEqual(keys, {"global": {"ctrl-q": "app.quit"}, "layout:orbit": {"new": "y"}})
        manifest = open(f"{self.home}/.herdr-orbit-manifest").read().split()
        self.assertIn("mods/orbit-new", manifest)
        self.assertNotIn("mods/orbit-edge", manifest)
        # The previous copy is kept whole.
        prev = f"{self.home}/data/orbit-updates/previous"
        self.assertEqual(U.read_version(prev)[0], "0.5.0")
        self.assertTrue(os.path.isfile(f"{prev}/mods/orbit-edge/main.js"))
        self.assertEqual(json.load(open(f"{prev}/keys.json")), {"layout:orbit": {"old": "x"}})
        self.assertFalse(os.path.exists(f"{self.home}/data/orbit-updates/staging"))

    def test_undo_and_redo(self):
        self.apply()
        # keys.json is written again (the same keys, its own spacing).
        files = lambda: {k: v for k, v in snapshot(self.home).items() if k != "keys.json"}
        keys = lambda: json.load(open(f"{self.home}/keys.json"))
        updated, updated_keys = files(), keys()
        before_keys = {"global": {"ctrl-q": "app.quit"}, "layout:orbit": {"old": "x"}}
        out = U.run(self.home, "undo", lambda: U.undo(self.home))
        self.assertEqual((out.get("ok"), out.get("to")), (True, "0.5.0"), out)
        self.assertEqual(files(), {k: v for k, v in self.before.items() if k != "keys.json"})
        self.assertEqual(keys(), before_keys)
        out = U.run(self.home, "undo", lambda: U.undo(self.home))
        self.assertEqual((out.get("ok"), out.get("to")), (True, "0.6.0"), out)
        self.assertEqual((files(), keys()), (updated, updated_keys))
        # A copy changed after the update isn't undone over.
        open(f"{self.home}/mods/orbit/main.js", "a").write("//")
        out = U.run(self.home, "undo", lambda: U.undo(self.home))
        self.assertEqual(out.get("error"), "changed", out)

    def test_changed_copy_is_left_alone(self):
        open(f"{self.home}/mods/orbit-tabs/main.js", "a").write("// mine")
        self.before = snapshot(self.home)
        with mock.patch.object(U, "download", side_effect=AssertionError("downloaded")):
            out = self.apply()
        self.assertEqual(out.get("error"), "changed", out)
        self.assertEqual(out.get("tag"), "v0.6.0")
        self.unchanged()
        self.assertFalse(os.path.exists(f"{self.home}/data/orbit-updates/previous"))

    def test_bad_downloads_change_nothing(self):
        def tampered():
            open(f"{self.release}/mods/orbit/main.js", "a").write("// not as stamped")
            return self.archive(self.release, "tampered.tar.gz")

        def truncated():
            path = self.url[len("file://"):]
            data = open(path, "rb").read()
            open(path + ".cut", "wb").write(data[: len(data) // 2])
            return self.url + ".cut"

        def escaping():
            path = os.path.join(self.tmp, "escape.tar.gz")
            with tarfile.open(path, "w:gz") as tar:
                info = tarfile.TarInfo("top/../../evil")
                info.size = 1
                tar.addfile(info, io.BytesIO(b"x"))
            return "file://" + path

        def link():
            path = os.path.join(self.tmp, "link.tar.gz")
            with tarfile.open(path, "w:gz") as tar:
                tar.add(self.release, arcname="top")
                info = tarfile.TarInfo("top/mods/orbit/evil")
                info.type, info.linkname = tarfile.SYMTYPE, "/etc/passwd"
                tar.addfile(info)
            return "file://" + path

        cases = {
            "missing": (lambda: "file:///nonexistent/x.tar.gz", "download", "v0.6.0"),
            "not an archive": (lambda: (write(f"{self.tmp}/junk", "<html>"), "file://" + f"{self.tmp}/junk")[1], "check", "v0.6.0"),
            "truncated": (truncated, "check", "v0.6.0"),
            "another version": (lambda: self.url, "check", "v0.7.0"),
            "files not as stamped": (tampered, "check", "v0.6.0"),
            "a path outside": (escaping, "check", "v0.6.0"),
            "a link": (link, "check", "v0.6.0"),
        }
        for what, (url, code, tag) in cases.items():
            with self.subTest(what):
                out = self.apply(url(), tag)
                self.assertEqual(out.get("error"), code, out)
                self.unchanged()
                self.assertFalse(os.path.exists(os.path.join(self.tmp, "evil")))

    def test_failure_half_way_puts_everything_back(self):
        real = os.rename
        for n in (1, 2, 5, 12, 25):
            with self.subTest(f"rename {n} fails"):
                calls = {"n": 0}

                def flaky(a, b):
                    if "orbit-updates/previous.new" in str(b) or "orbit-updates/staging" in str(a):
                        calls["n"] += 1
                        if calls["n"] == n:
                            raise OSError("disk full")
                    return real(a, b)
                with mock.patch.object(U.os, "rename", flaky):
                    out = self.apply()
                self.assertEqual(out.get("error"), "failed", out)
                self.unchanged()
                self.assertEqual(json.load(open(f"{self.home}/keys.json"))["layout:orbit"], {"old": "x"})

    def test_failure_on_keys_puts_everything_back(self):
        with mock.patch.object(U, "set_manifest", side_effect=OSError("read-only")):
            out = self.apply()
        self.assertEqual(out.get("error"), "failed", out)
        self.unchanged()

    def test_busy(self):
        import fcntl
        os.makedirs(f"{self.home}/data/orbit-updates", exist_ok=True)
        held = open(f"{self.home}/data/orbit-updates/lock", "w")
        fcntl.flock(held, fcntl.LOCK_EX)
        out = self.apply()
        self.assertEqual(out.get("error"), "busy", out)
        self.unchanged()

    def test_a_file_where_a_new_item_goes_is_kept(self):
        write(f"{self.home}/mods/orbit-new/main.js", "// the person's own orbit-new")
        out = self.apply()
        self.assertTrue(out.get("ok"), out)
        self.assertEqual(open(f"{self.home}/data/orbit-updates/previous/mods/orbit-new/main.js").read(), "// the person's own orbit-new")


if __name__ == "__main__":
    unittest.main(verbosity=1)
