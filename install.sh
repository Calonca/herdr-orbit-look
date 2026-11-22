#!/usr/bin/env bash
#   ./install.sh                   install or update
#   ./install.sh --updates off     the same, and update notices off (or on)
#   ./install.sh --remove          remove what this script installed (backups stay)
set -euo pipefail

updates=
if [[ ${1:-} == --updates ]]; then
  case ${2:-} in
    on | off) updates=$2 ;;
    *) echo "--updates takes on or off" >&2; exit 2 ;;
  esac
  shift 2
fi

repo=$(cd "$(dirname "$0")" && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
manifest=$home/.herdr-orbit-manifest
backup=$home/backup-herdr-orbit-$(date +%Y%m%d-%H%M%S)
mkdir -p "$home"
touch "$manifest"

items() {
  local f
  for f in "$repo"/themes/*.json "$repo"/mods/*/ "$repo"/layouts/*.json "$repo"/layouts/*.svg; do
    if [[ -e $f ]]; then f=${f%/}; printf '%s\n' "${f#"$repo"/}"; fi
  done
}

ours() { grep -qxF "$1" "$manifest"; }

keys() {
  [[ -f $home/keys.json ]] || { echo "no $home/keys.json yet: start herdr-app once, then run this again for the keys"; return 0; }
  python3 - "$home/keys.json" "$repo/keys.json" "$backup" "${1:-}" <<'EOF'
import json, os, shutil, sys
path, src, backup, mode = sys.argv[1:5]
old = open(path).read()
keys = json.loads(old)
for section, binds in json.load(open(src)).items():
    if mode == "--remove":
        keys.pop(section, None)
    else:
        keys[section] = binds
new = json.dumps(keys, indent=2, ensure_ascii=False) + "\n"
if json.loads(new) != json.loads(old):
    os.makedirs(backup, exist_ok=True)
    shutil.copy2(path, os.path.join(backup, "keys.json"))
    open(path + ".herdr-orbit-tmp", "w").write(new)
    os.replace(path + ".herdr-orbit-tmp", path)
    print(f"updated {path} (the old one is in {backup})")
EOF
}

if [[ ${1:-} == --remove ]]; then
  while read -r rel; do
    if [[ -n $rel ]] && [[ -e $home/$rel ]]; then
      rm -rf "${home:?}/$rel"
      echo "removed $home/$rel"
    fi
  done <"$manifest"
  rm -f "$manifest"
  keys --remove
  exit 0
fi

repick=$(python3 - "$home" <<'PY'
import glob, json, os, sys
home = sys.argv[1]
OLD = {"orbit": "tokyo-night", **{f"orbit-{t}": t for t in
       ["catppuccin-mocha", "everforest", "gruvbox-dark", "kanagawa", "nord", "rose-pine"]}}
for path in glob.glob(f"{home}/layouts/.state/*.json"):
    try:
        state = json.load(open(path))
    except Exception:
        continue
    picks = state.get("theme") if isinstance(state.get("theme"), dict) else {}
    saved = state.get("file") if isinstance(state.get("file"), dict) else {}
    if not any(v in OLD for v in picks.values()) and saved.get("theme") not in OLD:
        continue
    if picks:
        state["theme"] = {k: OLD.get(v, v) for k, v in picks.items()}
    if saved.get("theme") in OLD:
        saved["theme"] = OLD[saved["theme"]]
    open(path + ".herdr-orbit-tmp", "w").write(json.dumps(state, indent=2) + "\n")
    os.replace(path + ".herdr-orbit-tmp", path)
    name = os.path.basename(path)[:-5]
    print(f"theme names in {path}: {picks} -> {state.get('theme')}", file=sys.stderr)
    for kind in ["light", "dark"]:
        if state.get("theme", {}).get(kind):
            print(f"{name}\t{state['theme'][kind]}")
PY
)

items | while read -r rel; do
  src=$repo/$rel dst=$home/$rel
  mkdir -p "$(dirname "$dst")"
  if [[ -e $dst ]] && ! ours "$rel"; then
    mkdir -p "$backup/$(dirname "$rel")"
    mv "$dst" "$backup/$rel"
    echo "backed up $dst to $backup/$rel"
  fi
  ours "$rel" || echo "$rel" >>"$manifest"
  if [[ -e $dst ]] && diff -rq -x jsconfig.json -x "*.d.ts" -x VERSION -x __pycache__ "$src" "$dst" >/dev/null 2>&1; then continue; fi
  if [[ -d $src ]]; then
    tmp=$(mktemp -d "$home/.herdr-orbit-tmp.XXXXXX")
    cp -r "$src" "$tmp/new"
    rm -rf "$dst"
    mv "$tmp/new" "$dst"
    rmdir "$tmp"
  else
    cp "$src" "$dst.herdr-orbit-tmp"
    mv "$dst.herdr-orbit-tmp" "$dst"
  fi
  echo "installed $dst"
done

if [[ -n $repick ]] && shown=$(HERDR_APP_HOME=$home DO_NOT_TRACK=1 HERDR_TELEMETRY=0 herdr-app status 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("layout") or "")'); then
  sleep 2
  while IFS=$'\t' read -r name pick; do
    if [[ $name == "$shown" ]]; then
      HERDR_APP_HOME=$home DO_NOT_TRACK=1 HERDR_TELEMETRY=0 herdr-app do app.theme "{\"name\":\"$pick\"}" >/dev/null
      echo "theme $pick picked again for the $name layout"
    fi
  done <<<"$repick"
fi

gone=()
while read -r rel; do
  [[ -n $rel && ! -e $repo/$rel ]] && gone+=("$rel")
done <"$manifest"
for rel in "${gone[@]}"; do
  rm -rf "${home:?}/$rel"
  grep -vxF "$rel" "$manifest" >"$manifest.tmp" || true
  mv "$manifest.tmp" "$manifest"
  echo "removed $home/$rel (no longer in the repo)"
done

keys

python3 "$repo/mods/orbit/update.py" stamp "$repo" --version "$(head -n1 "$repo/mods/orbit/VERSION")" --out "$home/mods/orbit/VERSION"

if [[ -n $updates ]]; then
  mkdir -p "$home/data/orbit-updates"
  printf '%s\n' "$updates" >"$home/data/orbit-updates/ask"
  echo "update notices: $updates"
fi

if [[ ! -e $home/orbit-windows.json ]]; then
  cp "$repo/defaults/orbit-windows.json" "$home/orbit-windows.json"
  echo "created $home/orbit-windows.json (the picker's list: edit it, or use its \"configure windows…\" row)"
fi
echo "done: switch to the orbit layout in herdr-app's settings (or ctrl-shift-l)"
