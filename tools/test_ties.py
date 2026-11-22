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


# ---------------------------------------------------------------- what shape() writes

LAYOUT_JS = "mods/orbit/layout.js"

# Functions shape() may call: none of them writes into the layout it is
# given. A new one fails the test until it's read and added here.
SHAPE_CALLS = {
    "lookOf": "the look from the settings",
    "glass": "a colour",
    "find": "a block of the layout by id (reads)",
    "spaces": "herdr's spaces",
    "sidesState": "shared orbit.sides",
    "rightChildren": "a new list for the right pane (from orbit.sides)",
    "panelViews": "the side panel's views (settings)",
    "viewId": "a view's block id",
    "put": "sets or deletes one key (the helper below)",
}
# shape()'s helper that writes: put(node, key, value). Its body as tokens.
PUT = "const put = ( node , key , value ) => { if ( ! node ) return ; if ( value ) node [ key ] = value ; else delete node [ key ] ; } ;"
MUTATORS = {"push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "assign", "defineProperty"}


def shape_writes():
    """{(where, key)} that layout.js shape(root, ...) writes or deletes, where
    is "root", a block id, or "<id>/*<suffix>" (that block's children whose
    id ends so). Raises Unreadable on any statement it can't place."""
    toks = J.lex_file(LAYOUT_JS)
    body = J.function_body(toks, "shape", LAYOUT_JS)
    texts = [t.text for t in body]
    where = lambda i: f"{LAYOUT_JS}:{body[i].line}"
    scope = []  # (depth, name, value): value ("nodes", [where...]) | ("values", [str...]) | ("children", [where...]) | None
    writes = set()
    depth = 0

    def lookup(name, i):
        for d, n, v in reversed(scope):
            if n == name:
                return v
        raise J.Unreadable(f"{where(i)}: shape() uses {name}, which the check doesn't know")

    def nodes(name, i):
        if name == "root":
            return ["root"]
        v = lookup(name, i)
        if not v or v[0] != "nodes":
            raise J.Unreadable(f"{where(i)}: shape() writes into {name}, which the check can't place in the layout")
        return v[1]

    def arg(i):
        """The block ids find(root, <arg>) can name; the arg is at body[i]."""
        t = body[i]
        if t.kind == "str":
            return [J.eval_string(t.text)], i + 1
        if t.kind == "ident":
            v = lookup(t.text, i)
            if v and v[0] == "values":
                return v[1], i + 1
        if t.kind == "tmpl":
            m = re.fullmatch(r"`\$\{(\w+)\}([\w-]*)`", t.text)
            if m:
                v = lookup(m.group(1), i)
                if v and v[0] == "values":
                    return [x + m.group(2) for x in v[1]], i + 1
        raise J.Unreadable(f"{where(i)}: find(root, {t.text}): the check can't tell which block that is")

    def find_call(i):
        """find ( root , ARG ) at body[i]: (ids, index after)."""
        if texts[i:i + 4] != ["find", "(", "root", ","]:
            return None, i
        ids, j = arg(i + 4)
        if texts[j] != ")":
            raise J.Unreadable(f"{where(i)}: find(root, ...) with more than one argument")
        return ids, j + 1

    i = 0
    while i < len(body):
        t, s = body[i], texts[i]
        if t.kind == "punct" and s in ("{", "}"):
            depth += 1 if s == "{" else -1
            scope[:] = [b for b in scope if b[0] <= depth]
            i += 1
            continue
        # The put helper: exactly as known.
        if texts[i:i + 3] == ["const", "put", "="]:
            end = i + len(PUT.split())
            if " ".join(texts[i:end]) != PUT:
                raise J.Unreadable(f"{where(i)}: shape()'s put helper changed: read it and update PUT in tools/test_ties.py")
            scope.append((depth, "put", None))
            i = end
            continue
        # for (const X of [literal]) {  /  for (const [A, B] of [literal]) {  /  for (const c of M.children ?? []) {
        if texts[i:i + 3] == ["for", "(", "const"]:
            close = J.match(body, i + 1, ")")
            inner = texts[i + 3:close]
            of = inner.index("of") if "of" in inner else -1
            names = [x for x in inner[:of] if re.fullmatch(r"\w+", x)]
            src = i + 3 + of + 1
            if body[src].text == "[":
                values, j = J.literal(body, src, where(i))
                if j != close:
                    raise J.Unreadable(f"{where(i)}: a for loop over more than a literal list")
                cols = [values] if len(names) == 1 else [[row[k] for row in values] for k in range(len(names))]
                for n, col in zip(names, cols):
                    scope.append((depth + 1, n, ("values", [str(x) for x in col])))
            elif len(names) == 1 and texts[src + 1:close] == [".", "children", "??", "[", "]"]:
                parent = nodes(texts[src], src)
                # Which children: the if right after the loop's brace.
                k = close + 2
                if texts[k:k + 2] != ["if", "("]:
                    raise J.Unreadable(f"{where(k)}: a loop over children without an `if (c.id.endsWith(...))` first")
                cond = texts[k + 2:J.match(body, k + 1, ")")]
                suffixes = re.findall(r'\b' + names[0] + r' \. id \. endsWith \( ("[^"]*") \)', " ".join(cond))
                rest = re.sub(r'\b' + names[0] + r' \. id \. endsWith \( "[^"]*" \)', "", " ".join(cond)).replace("||", "").strip()
                if not suffixes or rest:
                    raise J.Unreadable(f"{where(k)}: the loop's if isn't only c.id.endsWith(...) || ...")
                scope.append((depth + 1, names[0], ("nodes", [f"{p}/*{J.eval_string(x)}" for p in parent for x in suffixes])))
            else:
                raise J.Unreadable(f"{where(i)}: a for loop the check doesn't know")
            i = close + 1
            continue
        # const declarations (a list: const a = ..., b = ...;)
        if s in ("const", "let"):
            j = i + 1
            if texts[j] == "{":  # const { a, b } = L;
                close = J.match(body, j, "}")
                for n in texts[j + 1:close]:
                    if re.fullmatch(r"\w+", n):
                        scope.append((depth, n, None))
                i = close + 1
                continue
            while True:
                name = texts[j]
                if texts[j + 1] != "=":
                    raise J.Unreadable(f"{where(j)}: a declaration the check doesn't know")
                k = j + 2
                ids, _ = find_call(k)
                value = None
                if ids is not None:
                    value = ("nodes", ids)
                elif re.fullmatch(r"\w+", texts[k]) and texts[k + 1:k + 6] == ["?.", "children", "??", "[", "]"]:
                    value = ("children", nodes(texts[k], k))
                elif re.fullmatch(r"\w+", texts[k]) and texts[k + 1:k + 5] == [".", "find", "(", "("]:
                    m = re.match(r'\( \( c \) => c \. id \. endsWith \( ("[^"]*") \) \)', " ".join(texts[k + 3:k + 20]))
                    parent = lookup(texts[k], k)
                    if m and parent and parent[0] == "children":
                        value = ("nodes", [f"{p}/*{J.eval_string(m.group(1))}" for p in parent[1]])
                scope.append((depth, name, value))
                # On to the next declarator: a , or ; at this nesting.
                level = 0
                while not (level == 0 and texts[k] in (",", ";")):
                    level += texts[k] in ("(", "[", "{")
                    level -= texts[k] in (")", "]", "}")
                    k += 1
                if texts[k] == ";":
                    break
                j = k + 1
            # The right-hand sides are scanned below like any other code.
            i += 1
            continue
        # Calls: known functions only; no mutating methods.
        if t.kind == "ident" and i + 1 < len(body) and texts[i + 1] == "(":
            prev = texts[i - 1] if i else ""
            if prev in (".", "?."):
                if s in MUTATORS:
                    raise J.Unreadable(f"{where(i)}: shape() calls .{s}(): the check can't tell what that changes; write the key instead")
            elif s not in ("if", "for", "while", "switch", "catch", "return", "typeof") and s not in SHAPE_CALLS and s not in ("Math", "Array", "Number", "String", "Object", "JSON", "Boolean"):
                raise J.Unreadable(f"{where(i)}: shape() calls {s}(), which the check hasn't read: if it writes nothing into the layout, add it to SHAPE_CALLS in tools/test_ties.py")
            if s == "put":
                ids, j = find_call(i + 2)
                if ids is None:
                    ids, j = nodes(texts[i + 2], i + 2), i + 3
                if texts[j] != "," or body[j + 1].kind != "str":
                    raise J.Unreadable(f"{where(i)}: put(...) without a string key")
                writes |= {(n, J.eval_string(body[j + 1].text)) for n in ids}
        if s == "Object" and texts[i + 1:i + 2] == ["."] and texts[i + 2] in MUTATORS:
            raise J.Unreadable(f"{where(i)}: shape() calls Object.{texts[i + 2]}: write the keys one by one instead")
        if s == "delete":
            if not (re.fullmatch(r"\w+", texts[i + 1]) and texts[i + 2] == "." and texts[i + 4] in (";", "}")):
                raise J.Unreadable(f"{where(i)}: a delete the check doesn't know")
            writes |= {(n, texts[i + 3]) for n in nodes(texts[i + 1], i + 1)}
        if t.kind == "punct" and s in ("++", "--"):
            raise J.Unreadable(f"{where(i)}: {s} in shape(): the check can't place it")
        if t.kind == "punct" and (s == "=" or (s.endswith("=") and s not in ("==", "===", "!=", "!==", "<=", ">=", "=>"))):
            # a write: OBJ.key = ...  (a plain name = ... is a variable)
            lhs = texts[max(0, i - 4):i]
            if texts[i - 1] == "]":
                raise J.Unreadable(f"{where(i)}: shape() writes a computed key (x[k] = ...): the check can't place it")
            if i >= 2 and texts[i - 2] in (".", "?."):
                if texts[i - 4] in (".", "?.", "]"):
                    raise J.Unreadable(f"{where(i)}: shape() writes {' '.join(lhs)} =: only <name>.<key> = is read")
                writes |= {(n, texts[i - 1]) for n in nodes(texts[i - 3], i - 3)}
        i += 1
    return writes


def digest_leaves_out():
    """What update.py layout_digest leaves out, in shape_writes()'s terms."""
    out = {("root", k) for k in U.LAYOUT_ROOT_WRITES}
    out |= {(n, k) for n, ks in U.LAYOUT_NODE_WRITES.items() for k in ks}
    out |= {(f, "children") for f in U.LAYOUT_FRAMES}
    out |= {(f"{f}/*{s}", "size") for f in U.LAYOUT_FRAMES for s in U.LAYOUT_FRAME_SIZED}
    out.add((U.LAYOUT_VIEWS_STACK, "children"))
    return out


# What shape() writes that stays in the hash: written as the layout ships
# them, so a copy the mod wrote matches (tools/test_update.py
# test_layout_side_blocks_as_shipped checks the shipped layout has them so).
AS_SHIPPED = {(f"{p}-mid/*-{s}", k) for p in ("left", "right", "panel") for s in ("s1", "s2") for k in ("size", "content")}


# What update.py leaves out of the hash that shape() doesn't write.
NOT_SHAPE = {
    ("left", "active"): "the orbit mod picks the left stack's child with layout.select (main.js, actions.js), not in shape(); "
                        "left out in case Herdr saves the pick in the file (AGENTS.md says picks go to layouts/.state/)",
}


class LayoutWrites(unittest.TestCase):
    def test_reader_sees_writes(self):
        # The reader finds shape()'s writes at all.
        self.assertIn(("root", "background"), shape_writes())

    def test_written_is_left_out(self):
        extra = shape_writes() - digest_leaves_out() - AS_SHIPPED
        if extra:
            self.fail(
                "layout.js shape() writes " + ", ".join(f"{w}.{k}" for w, k in sorted(extra)) + " into layouts/orbit.json, "
                "and update.py layout_digest doesn't leave that out of the look's hash. Every installed copy the orbit "
                "mod rewrote would count as changed, and its update button would refuse. Add it to the LAYOUT_* lists "
                "in mods/orbit/update.py (and to mod_writes in tools/test_update.py test_layout_what_the_mod_writes); "
                "or, if it's written exactly as the layout ships it, to AS_SHIPPED in tools/test_ties.py.")

    def test_left_out_is_written(self):
        stale = digest_leaves_out() - shape_writes() - set(NOT_SHAPE)
        if stale:
            self.fail(
                "update.py layout_digest leaves " + ", ".join(f"{w}.{k}" for w, k in sorted(stale)) + " out of the look's "
                "hash, but layout.js shape() no longer writes it, so a hand edit there goes unnoticed by the update "
                "button. Take it out of the LAYOUT_* lists in mods/orbit/update.py; if something else still writes it "
                "(an older orbit mod, Herdr), list it in NOT_SHAPE in tools/test_ties.py with who.")

    def test_exceptions_still_apply(self):
        self.assertLessEqual(set(NOT_SHAPE), digest_leaves_out() - shape_writes(),
                             "NOT_SHAPE in tools/test_ties.py names something shape() now writes or update.py no longer leaves out: take it out")

    def test_as_shipped_is_written(self):
        self.assertLessEqual(AS_SHIPPED, shape_writes(),
                             "AS_SHIPPED in tools/test_ties.py names writes shape() no longer makes: take them out")


# ---------------------------------------------------------------- repeated values


class RepeatedValues(unittest.TestCase):
    def test_archives_allowed(self):
        archives = J.const(J.lex_file("mods/orbit/updates.js"), "ARCHIVES", "mods/orbit/updates.js")
        allowed = [f"https://{host}{path}" for host, path in U.ALLOWED.items()]
        self.assertEqual(sorted(archives), sorted(allowed),
                         "Where a release archive may come from is said twice: ARCHIVES in mods/orbit/updates.js (the "
                         "card offers an update only from there) and ALLOWED in mods/orbit/update.py (the download "
                         "and every redirect are checked against it). Change both the same way.")

    def install_items(self):
        """install.sh's items(), run in bash on a test tree, and that tree."""
        text = read("install.sh")
        m = re.search(r"^items\(\) \{\n(.*?)^\}\n", text, re.S | re.M)
        self.assertTrue(m, "install.sh has no items() { ... } function: tools/test_ties.py reads it")
        tree = tempfile.mkdtemp(prefix="orbit-ties-")
        self.addCleanup(lambda: subprocess.run(["rm", "-rf", tree]))
        for rel in ["themes/b.json", "themes/a.json", "themes/notes.txt", "mods/orbit-z/main.js", "mods/orbit/main.js",
                    "mods/stray.js", "layouts/orbit.json", "layouts/orbit.svg", "layouts/a.svg", "layouts/x.png"]:
            os.makedirs(os.path.dirname(os.path.join(tree, rel)), exist_ok=True)
            open(os.path.join(tree, rel), "w").close()
        out = subprocess.run(["bash", "-c", f"set -euo pipefail\n{m.group(0)}\nitems", "items"],
                             env={"repo": tree, "PATH": os.environ.get("PATH", ""), "LC_ALL": "C"},
                             capture_output=True, text=True, check=True).stdout.split()
        return out, tree

    def test_install_order(self):
        items, tree = self.install_items()
        msg = ("install.sh items() and update.py (tree_items, ORDER) list the look's files the same way: what install.sh "
               "copies is what the update replaces and hashes, themes first (a mod or layout naming one finds it). "
               "Change both the same way.")
        self.assertEqual(sorted(items), sorted(U.tree_items(tree)), msg)
        top = lambda i: next(n for n, p in enumerate(U.ORDER) if i.startswith(p))
        self.assertEqual(items, sorted(items, key=top), msg)
        self.assertEqual([p for n, p in enumerate(U.ORDER)], [p for p in dict.fromkeys(i.split("/")[0] + "/" for i in items)], msg)

    def test_install_diff_skips(self):
        lines = [l for l in read("install.sh").splitlines() if re.search(r"\bdiff -rq\b", l)]
        self.assertEqual(len(lines), 1, "install.sh should have one `diff -rq` (its unchanged-copy check): tools/test_ties.py reads it")
        excludes = {x.strip('"') for x in re.findall(r"-x (\"[^\"]+\"|\S+)", lines[0])}
        # Hidden files: the hash skips them; install's diff doesn't need to
        # (the repo has none, so at worst a folder is copied again).
        hashed_out = set(U.SKIP_NAMES) | {"*.d.ts", os.path.basename(U.VERSION)}
        self.assertEqual(excludes, hashed_out,
                         "What install.sh's diff ignores when it compares an installed folder (-x ...) and what update.py "
                         "leaves out of the hash (SKIP_NAMES, *.d.ts, VERSION) are the files Herdr or the look write "
                         "into mod folders. Change both the same way.")
        for x in excludes - {"VERSION"}:
            self.assertTrue(U.skipped(x.replace("*", "x")), f"update.py skipped() doesn't skip {x}")

    def test_regress_padding(self):
        tree = ast.parse(read("tools/regress.py"))
        found = [n.value for n in tree.body if isinstance(n, ast.Assign) and any(getattr(t, "id", None) == "PADDING" for t in n.targets)]
        self.assertEqual(len(found), 1, "tools/regress.py should have one PADDING = {...}: tools/test_ties.py reads it")
        padding = {k: list(v) for k, v in ast.literal_eval(found[0]).items()}
        densities = J.const(J.lex_file(LAYOUT_JS), "DENSITIES", LAYOUT_JS)
        self.assertEqual(padding, {k: d["padding"] for k, d in densities.items()},
                         "PADDING in tools/regress.py (the padding its screenshot check expects) is a copy of each "
                         "density's padding in DENSITIES in mods/orbit/layout.js. Change it with them.")

    def test_start_is_comfortable(self):
        start = J.const(J.lex_file("mods/orbit/look.js"), "START", "mods/orbit/look.js")
        densities = J.const(J.lex_file(LAYOUT_JS), "DENSITIES", LAYOUT_JS)
        comfortable = densities["comfortable"]
        same = {k: start[k] for k in comfortable if k in start}
        self.assertEqual(same, {k: comfortable[k] for k in same},
                         "START in look.js (the look every mod draws with until the orbit mod shares its own) is the "
                         "comfortable density of DENSITIES in mods/orbit/layout.js, the default. Change them together "
                         "(look.js in every mod: it's a shared copy).")
        self.assertEqual(start.get("small"), min(4, comfortable["radius"]), "START.small is min(4, radius) (layout.js lookOf)")


if __name__ == "__main__":
    unittest.main(verbosity=1)
