// A space's identity key (mods/orbit/repokey.js), without a window:
//   node tools/identity-test.mjs
import assert from "node:assert/strict";
import { normalizeOrigin, repoName, identityKey } from "../mods/orbit/repokey.js";

assert.equal(normalizeOrigin("git@github.com:Me/App.git"), "github.com/me/app");
assert.equal(normalizeOrigin("https://me@github.com/Me/App/"), "github.com/me/app");
assert.equal(normalizeOrigin("ssh://git@gitlab.com/group/sub/app.git"), "gitlab.com/group/sub/app");
assert.equal(normalizeOrigin("ssh://git@example.org:2222/me/app.git"), "example.org/me/app");
assert.equal(normalizeOrigin(""), null);

const here = { repo: "/home/me/src/app/.git", linked: false, origin: "git@github.com:me/app.git" };
const there = { repo: "/srv/code/app-clone/.git", linked: false, origin: "https://github.com/me/app" };
const tree = { repo: "/home/me/src/app/.git", linked: true, origin: "git@github.com:me/app.git" };
const local = { repo: "/home/me/src/notes/.git", linked: false, origin: null };
const localTree = { repo: "/home/me/src/notes/.git", linked: true, origin: null };
const other = { repo: "/home/me/src/other/.git", linked: false, origin: "git@github.com:me/other.git" };

// Same repo on two machines (other paths, the origin's two spellings): one key.
assert.equal(identityKey({ name: "app here" }, here), identityKey({ name: "on kino" }, there));
// A worktree and its main checkout: one key, with or without an origin.
assert.equal(identityKey({ name: "fix" }, tree), identityKey({ name: "app" }, here));
assert.equal(identityKey({ name: "wt" }, localTree), identityKey({ name: "notes" }, local));
assert.equal(repoName(local), "notes");
// Another repo: its own.
assert.notEqual(identityKey({ name: "x" }, other), identityKey({ name: "x" }, here));
// Outside a repo (or not looked up yet): the space's name.
assert.equal(identityKey({ name: "scratch" }, null), "scratch");
assert.equal(identityKey({ name: "scratch" }, undefined), "scratch");
console.log("identity: ok");
