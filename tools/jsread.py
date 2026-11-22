"""Reads values and code out of the look's JavaScript without node: a small
lexer (strings, template literals, regex literals and comments told apart),
a strict reader of literal values, and a finder of function bodies. Anything
it doesn't recognise is an error that names the file, never a silent miss.
"""
import os, re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Unreadable(AssertionError):
    """The source changed shape: the reader needs a look, not a pass."""


class Tok:
    __slots__ = ("kind", "text", "line")

    def __init__(self, kind, text, line):
        self.kind, self.text, self.line = kind, text, line

    def __repr__(self):
        return f"{self.kind}:{self.text!r}@{self.line}"


PUNCT = sorted("""=== !== ... >>>= **= <<= >>= >>> ?. ?? ??= &&= ||= => == != <= >= && || ++ -- += -= *= /= %= &= |= ^= ** << >>
{ } ( ) [ ] ; , < > + - * / % & | ^ ! ~ ? : = . @ #""".split(), key=len, reverse=True)
REGEX_AFTER = set("( , = : [ ! & | ? { } ; + - * % < > ~ ^ => == === != !== && || ?? += -= return typeof case do else in of new delete void throw yield await".split())


def lex(src, name="<js>"):
    """The tokens of `src`, comments dropped. Kinds: ident, num, str, tmpl, regex, punct."""
    out, i, line, n = [], 0, 1, len(src)

    def fail(msg):
        raise Unreadable(f"{name}:{line}: {msg}")

    def skip_string(i, q):
        i += 1
        while i < n and src[i] != q:
            if src[i] == "\\":
                i += 1
            elif src[i] == "\n":
                fail("a line break in a string")
            i += 1
        if i >= n:
            fail("a string that never ends")
        return i + 1

    def skip_template(i):
        i += 1
        while i < n and src[i] != "`":
            if src[i] == "\\":
                i += 2
                continue
            if src.startswith("${", i):
                i = skip_code(i + 2, "}")
                continue
            i += 1
        if i >= n:
            fail("a template literal that never ends")
        return i + 1

    def skip_code(i, close):
        # Inside ${ }: braces, strings and templates nest.
        depth = 0
        while i < n:
            c = src[i]
            if c in "'\"":
                i = skip_string(i, c)
            elif c == "`":
                i = skip_template(i)
            elif c == "{":
                depth += 1; i += 1
            elif c == "}":
                if depth == 0:
                    return i + 1
                depth -= 1; i += 1
            else:
                i += 1
        fail("a ${ } that never ends")

    def skip_regex(i):
        i += 1
        cls = False
        while i < n:
            c = src[i]
            if c == "\\":
                i += 2
                continue
            if c == "\n":
                fail("a line break in a regex literal")
            if c == "[":
                cls = True
            elif c == "]":
                cls = False
            elif c == "/" and not cls:
                i += 1
                while i < n and (src[i].isalnum() or src[i] == "_"):
                    i += 1
                return i
            i += 1
        fail("a regex literal that never ends")

    while i < n:
        c = src[i]
        if c == "\n":
            line += 1; i += 1
        elif c.isspace():
            i += 1
        elif src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
        elif src.startswith("/*", i):
            end = src.find("*/", i + 2)
            if end < 0:
                fail("a comment that never ends")
            line += src.count("\n", i, end)
            i = end + 2
        elif c in "'\"":
            j = skip_string(i, c)
            out.append(Tok("str", src[i:j], line)); i = j
        elif c == "`":
            j = skip_template(i)
            out.append(Tok("tmpl", src[i:j], line)); line += src.count("\n", i, j); i = j
        elif c == "/" and (not out or out[-1].text in REGEX_AFTER and out[-1].kind in ("punct", "ident")):
            j = skip_regex(i)
            out.append(Tok("regex", src[i:j], line)); i = j
        elif c.isdigit() or (c == "." and i + 1 < n and src[i + 1].isdigit()):
            m = re.compile(r"0[xX][0-9a-fA-F_]+n?|\d[\d_]*(\.\d*)?([eE][+-]?\d+)?n?|\.\d+([eE][+-]?\d+)?").match(src, i)
            out.append(Tok("num", m.group(), line)); i = m.end()
        elif c.isalpha() or c in "_$":
            m = re.compile(r"[\w$]+").match(src, i)
            out.append(Tok("ident", m.group(), line)); i = m.end()
        else:
            p = next((p for p in PUNCT if src.startswith(p, i)), None)
            if not p:
                fail(f"a character the reader doesn't know: {c!r}")
            out.append(Tok("punct", p, line)); i += len(p)
    return out


def lex_file(rel):
    return lex(open(os.path.join(REPO, rel), encoding="utf-8").read(), rel)


def match(toks, i, close):
    """The index of the bracket closing the one at toks[i]."""
    opening = toks[i].text
    depth = 0
    for j in range(i, len(toks)):
        t = toks[j]
        if t.kind == "punct" and t.text == opening:
            depth += 1
        elif t.kind == "punct" and t.text == close:
            depth -= 1
            if depth == 0:
                return j
    raise Unreadable(f"line {toks[i].line}: an unclosed {opening}")


def function_body(toks, name, where):
    """The tokens between the braces of the one definition of `name` (a
    function or a method), braces left out."""
    found = []
    for i, t in enumerate(toks):
        if t.kind == "ident" and t.text == name and i + 1 < len(toks) and toks[i + 1].text == "(":
            prev = toks[i - 1].text if i else ""
            if prev == ".":
                continue
            close = match(toks, i + 1, ")")
            if close + 1 < len(toks) and toks[close + 1].text == "{":
                found.append(close + 1)
    if len(found) != 1:
        raise Unreadable(f"{where}: expected one definition of {name}(), found {len(found)}")
    start = found[0]
    return toks[start + 1:match(toks, start, "}")]


class Ident(str):
    """A name in a literal (a constant from elsewhere): kept as its name."""


def literal(toks, i, where):
    """(value, next index) of the literal at toks[i]: objects, arrays,
    strings, numbers (with * and /), true/false/null, and bare names (Ident)."""
    def fail(msg):
        raise Unreadable(f"{where}:{toks[min(i, len(toks) - 1)].line}: {msg}")

    def value(i):
        v, i = atom(i)
        while i < len(toks) and toks[i].text in ("*", "/") and toks[i].kind == "punct":
            op = toks[i].text
            w, i = atom(i + 1)
            if not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in (v, w)):
                fail(f"{op} between things that aren't numbers")
            v = v * w if op == "*" else v / w
        return v, i

    def atom(i):
        if i >= len(toks):
            fail("the literal ends early")
        t = toks[i]
        if t.kind == "str":
            return eval_string(t.text), i + 1
        if t.kind == "num":
            text = t.text.replace("_", "")
            return (int(text, 0) if re.fullmatch(r"0[xX][0-9a-fA-F]+|\d+", text) else float(text)), i + 1
        if t.text == "-" and t.kind == "punct":
            v, j = atom(i + 1)
            if not isinstance(v, (int, float)):
                fail("- before something that isn't a number")
            return -v, j
        if t.kind == "ident":
            if t.text in ("true", "false", "null"):
                return {"true": True, "false": False, "null": None}[t.text], i + 1
            if i + 1 < len(toks) and toks[i + 1].text in ("(", ".", "?.", "["):
                fail(f"code where a literal value was expected ({t.text}{toks[i + 1].text})")
            return Ident(t.text), i + 1
        if t.text == "[":
            out, i = [], i + 1
            while toks[i].text != "]":
                v, i = value(i)
                out.append(v)
                if toks[i].text == ",":
                    i += 1
                elif toks[i].text != "]":
                    fail(f"expected , or ] in an array, found {toks[i].text!r}")
            return out, i + 1
        if t.text == "{":
            out, i = {}, i + 1
            while toks[i].text != "}":
                k = toks[i]
                if k.kind == "ident":
                    key = k.text
                elif k.kind == "str":
                    key = eval_string(k.text)
                else:
                    fail(f"an object key the reader doesn't know: {k.text!r}")
                if toks[i + 1].text != ":":
                    fail(f"expected : after {key!r} (shorthand and spreads aren't read)")
                v, i = value(i + 2)
                out[key] = v
                if toks[i].text == ",":
                    i += 1
                elif toks[i].text != "}":
                    fail(f"expected , or }} in an object, found {toks[i].text!r}")
            return out, i + 1
        fail(f"a literal the reader doesn't know: {t.text!r}")

    return value(i)


def eval_string(text):
    import ast
    return ast.literal_eval(text)


def const(toks, name, where):
    """The literal value of `const <name> = ...;` (exported or not); exactly one."""
    hits = [i for i, t in enumerate(toks) if t.kind == "ident" and t.text == name and i
            and toks[i - 1].text in ("const", "let") and i + 1 < len(toks) and toks[i + 1].text == "="]
    if len(hits) != 1:
        raise Unreadable(f"{where}: expected one `const {name} = ...`, found {len(hits)}")
    v, j = literal(toks, hits[0] + 2, where)
    if j >= len(toks) or toks[j].text != ";":
        raise Unreadable(f"{where}:{toks[hits[0]].line}: `const {name}` is more than a literal value (read up to {toks[min(j, len(toks) - 1)].text!r})")
    return v
