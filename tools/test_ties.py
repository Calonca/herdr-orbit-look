#!/usr/bin/env python3
"""Ties between files that must agree but can't import each other (the mods
are JavaScript, each importing only from its own folder; the updater is
Python; the installer is bash). Each test fails with what has to stay in
step with what, and what to do. tools/release.sh runs them.

  python3 tools/test_ties.py
"""
import ast, collections, hashlib, importlib.util, json, os, re, subprocess, sys, tempfile, unittest

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jsread as J  # noqa: E402

REPO = J.REPO
spec = importlib.util.spec_from_file_location("orbit_update", os.path.join(REPO, "mods/orbit/update.py"))
U = importlib.util.module_from_spec(spec)
spec.loader.exec_module(U)


def read(rel):
    return open(os.path.join(REPO, rel), encoding="utf-8").read()


# ---------------------------------------------------------------- shared copies

# Files under the same name in several mods/orbit* folders that are each
# mod's own, not copies of one file.
NOT_COPIES = {
    "main.js": "each mod's own entry point",
    "mod.json": "each mod's own manifest (place, title, size)",
}


class SharedCopies(unittest.TestCase):
    def groups(self):
        by_name = collections.defaultdict(list)
        mods = sorted(d for d in os.listdir(os.path.join(REPO, "mods")) if d.startswith("orbit"))
        for mod in mods:
            top = os.path.join(REPO, "mods", mod)
            for d, dirs, files in os.walk(top):
                dirs[:] = sorted(x for x in dirs if not U.skipped(x))
                for f in files:
                    if U.skipped(f):
                        continue
                    by_name[os.path.relpath(os.path.join(d, f), top)].append(f"mods/{mod}/{os.path.relpath(os.path.join(d, f), top)}")
        return {name: paths for name, paths in by_name.items() if len(paths) > 1}

    def test_found(self):
        # The walk sees the copies at all (look.js is in every mod but the toast).
        self.assertGreaterEqual(len(self.groups().get("look.js", [])), 8)

    def test_identical(self):
        for name, paths in sorted(self.groups().items()):
            if name in NOT_COPIES:
                continue
            with self.subTest(name):
                by_hash = collections.defaultdict(list)
                for p in paths:
                    by_hash[hashlib.sha256(open(os.path.join(REPO, p), "rb").read()).hexdigest()].append(p)
                if len(by_hash) == 1:
                    continue
                groups = sorted(by_hash.values(), key=len, reverse=True)
                self.fail(
                    f"{name} differs between the mods that have a copy of it:\n"
                    + "".join(f"  {', '.join(g)}\n" for g in groups)
                    + f"Each mod imports only from its own folder, so {name} is one file kept as identical copies. "
                    f"Make the change in one copy and copy it over the others (e.g. for p in {' '.join(paths[1:])}; "
                    f"do cp {paths[0]} $p; done). If these are meant to differ, give them different names, or add "
                    f"{name!r} to NOT_COPIES in tools/test_ties.py with the reason.")


if __name__ == "__main__":
    unittest.main(verbosity=1)
