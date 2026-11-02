// What a space's colour and symbol are worked out from (identity.js): its
// repository, the same on every machine and for every worktree of it, else
// the space's name. Plain functions (no herdr), so tools/ can test them.
//
// git: what identity.js looked up for the space (shared "orbit.git"):
//   { repo: the common git dir (absolute, on its machine), linked, origin: remote.origin.url or null }

// "git@github.com:Me/App.git", "https://me@github.com/Me/App/" -> "github.com/me/app"
export function normalizeOrigin(url) {
  let u = String(url ?? "").trim();
  if (!u) return null;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u);
  u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // scheme
  u = u.replace(/^[^@/]+@/, ""); // user@
  if (scheme) u = u.replace(/^([^/:]+):\d+\//, "$1/"); // host:port/
  else u = u.replace(/^([^/:]+):/, "$1/"); // scp-like host:path
  u = u.replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return u.toLowerCase() || null;
}

// The repository's name: the origin's last part, else the main checkout's
// folder (the common git dir's parent; a bare repo's own name).
export function repoName(git) {
  if (!git?.repo) return null;
  const origin = normalizeOrigin(git.origin);
  if (origin) return origin.split("/").pop() || null;
  const dir = git.repo.replace(/\/+$/, "");
  const main = /\/\.git$/.test(dir) ? dir.slice(0, -5) : dir.replace(/\.git$/i, "");
  return main.split("/").pop() || null;
}

// The key a space's identity is hashed from.
export function identityKey(space, git) {
  return repoName(git) ?? space?.name ?? "";
}
