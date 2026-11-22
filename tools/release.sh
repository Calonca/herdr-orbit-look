#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=${1:?usage: tools/release.sh <version, e.g. 0.5.0>}
version=${version#v}
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "a version is three numbers: 0.5.0" >&2; exit 2; }
[[ $(git rev-parse --abbrev-ref HEAD) == main ]] || { echo "release from main" >&2; exit 2; }
[[ -z $(git status --porcelain) ]] || { echo "commit or stash your changes first" >&2; exit 2; }
git rev-parse -q --verify "refs/tags/v$version" >/dev/null && { echo "v$version is tagged already" >&2; exit 2; }

notes=$(python3 - "$version" <<'PY'
import re, sys
text = open("CHANGELOG.md").read()
m = re.search(rf"^## v?{re.escape(sys.argv[1])}\s*\n(.*?)(?=^## |\Z)", text, re.S | re.M)
if not m or not m.group(1).strip():
    sys.exit(f"CHANGELOG.md has no entry for {sys.argv[1]}")
print(m.group(1).strip())
PY
)

python3 tools/test_update.py
python3 tools/test_ties.py
python3 mods/orbit/update.py stamp . --version "$version"
if [[ -n $(git status --porcelain mods/orbit/VERSION) ]]; then
  git add mods/orbit/VERSION
  git commit -m "Version $version"
fi
python3 mods/orbit/update.py stamp . --check
git tag -a "v$version" -m "Orbit $version"
git push origin main "v$version"
gh release create "v$version" --title "Orbit $version" --notes "$notes"
echo "released v$version"
