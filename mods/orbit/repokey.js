export function normalizeOrigin(url) {
  let u = String(url ?? "").trim();
  if (!u) return null;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u);
  u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  u = u.replace(/^[^@/]+@/, "");
  if (scheme) u = u.replace(/^([^/:]+):\d+\//, "$1/");
  else u = u.replace(/^([^/:]+):/, "$1/");
  u = u.replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return u.toLowerCase() || null;
}

export function repoName(git) {
  if (!git?.repo) return null;
  const origin = normalizeOrigin(git.origin);
  if (origin) return origin.split("/").pop() || null;
  const dir = git.repo.replace(/\/+$/, "");
  const main = /\/\.git$/.test(dir) ? dir.slice(0, -5) : dir.replace(/\.git$/i, "");
  return main.split("/").pop() || null;
}

export function identityKey(space, git) {
  return repoName(git) ?? space?.name ?? "";
}
