# Orbit layout for Herdr

A layout for the Herdr app (herdr-app): a space picture behind everything,
glass panels over it, and each space with a colour and a symbol of its own.

This is an unofficial layout. It is not affiliated with or endorsed by Herdr.
It uses only what herdr-app offers to everyone (a layout, mods and a theme)
and doesn't change the app. Made for herdr-app 0.1.11.

**Version 1** (stage 1: the look). See [Updating](#updating).

## Add it

Copy the three folders into herdr-app's home (`~/.config/herdr-app`, or
`$HERDR_APP_HOME`):

```sh
cp -r layouts/. ~/.config/herdr-app/layouts/
cp -r mods/. ~/.config/herdr-app/mods/
cp -r themes/. ~/.config/herdr-app/themes/
```

Then pick the **orbit** layout in herdr-app's settings (or `ctrl-shift-l`).
`ctrl-shift-l` switches back to your own layout; deleting the files removes it.
Check a name isn't taken first: the layout is `orbit`, the mods are `orbit` and
`orbit-*`, the theme is `orbit`.

`./install.sh` does the same copy, keeps a list of what it copied, moves aside
anything of yours under the same name, and `./install.sh --remove` takes it
away again. It is a convenience: nothing needs it.

## Updating

Installed copies don't update by themselves. To see which version you have:
`"orbit.version"` in `shared.json` in herdr-app's home (the `orbit` mod writes
it), or `VERSION` at the top of `mods/orbit/main.js`.

Herdr's add flow never overwrites: adding this repo again would make a second
copy (`orbit-2`, ...). To update, either:

- tell your agent: "replace my orbit layout, the orbit-* mods and
  themes/orbit.json with the latest from github.com/Calonca/herdr-orbit-look"
  (it removes `layouts/orbit.json`, `layouts/orbit.svg`, `mods/orbit` and
  `mods/orbit-*` and `themes/orbit.json` first, then copies the new ones;
  your other files stay as they are); or
- run `./install.sh` from a fresh clone: it replaces what it installed before
  and moves anything else under the same names to a backup folder.

Your clicks (sizes, what's shown) stay in `layouts/.state/`.

## What you see

- **Background**: a generated space picture (`mods/orbit/backgrounds/`), with
  the sidebar, the pane, its tab row and the status bar as glass over it: the
  theme's surface, a little see-through, over a blurred copy of the picture.
- **Space colours**: every space gets one of six colours and one of 8 symbols
  from a hash of its name; a git worktree and the main checkout it belongs to
  share their repo's. The pane's outline, its tab row and the space's row in
  the sidebar use that colour.
- **Sidebar** (`orbit-spaces`, a restyled clone of herdr-app's `spaces`, and
  `orbit-sidebar-footer`): a header per machine; each space with its symbol
  (filled by its agents' state), its name, and its branch and ahead/behind;
  worktrees hang from their repo with tree lines and a fold toggle. Click
  switches, right-click opens herdr's space menu, drag reorders. At the foot,
  "▸ agents" folds herdr's agents list in, and "open folder" makes a space.
- **The pane** (`orbit-tabs`, `orbit-edge`): an outline around the shown tab,
  in the space's colour, and the tab row as the bottom of that outline: the
  space's symbol and name, then its tabs, the shown one a folder tab open into
  the content. Each tab has its program's icon and its agent's state (working
  yellow, blocked red, done green). Click shows a tab; right-click opens
  herdr's tab menu.
- **Side panel** (`orbit-panel-tabs`): herdr's files and changes, framed as
  the pane is, with a tab each. The status bar's right-most button opens and
  closes it. Clicking in the panel moves the coloured outline there.
- **Status bar** (`orbit-status`): the sidebar toggle, "herdr offline" while
  the core can't be reached, folded tabs and an update pill on the left; on
  the right cpu (with a 20 s sparkline), ram and disk use (yellow from 70%,
  red from 90%, details on hover), `?` for the shortcuts, what needs you /
  runs / is done, the clock and the side panel toggle.
- **Theme** `orbit` (Tokyo Night colours), JetBrains Mono in terminals.

herdr-app's own keys work as usual (`ctrl-shift-t` a new tab, `ctrl-shift-w`
close it, `ctrl-shift-b` the sidebar).

## What the mods run and read

- `orbit-spaces` runs `git status` and `git rev-parse` in each space's folder
  (on that space's machine), runs `hc machine ls`, and watches local repos'
  git folders for changes.
- `orbit-tabs` runs `git rev-parse` in each space's folder, so a worktree gets
  its repo's colour.
- `orbit-status` reads `/proc/stat`, `/proc/loadavg` and `/proc/meminfo`, and
  runs `df` on your home folder every 30 s.
- `orbit` reads and writes `layouts/orbit.json` in herdr-app's home: it puts
  the shown theme's glass colours and the space's outline colour there.
- None of them uses the network.

## Files

- `layouts/orbit.json`, `layouts/orbit.svg` (its preview in settings)
- `mods/orbit/`: the layout's own block (keeps the layout's colours in step),
  with the background pictures
- `mods/orbit-*/`: the sidebar, the status bar, the tab rows and the pane
  outline. Shared code is copied into each mod that uses it (`look.js`,
  `glass.js`, `identity.js`, ...): the copies are the same file.
- `themes/orbit.json`
- `scripts/space.py` and `scripts/blur.py` make the background and its blurred
  copy; `scripts/glyphs.py` the symbols. Only needed to change them.

## Credits

- The `orbit` theme's colours are the Tokyo Night palette by Enkia
  ([tokyo-night-vscode-theme](https://github.com/tokyo-night/tokyo-night-vscode-theme),
  MIT).
- The space background is generated by `scripts/space.py` (procedural:
  gradients, seeded stars, a planet), not a photo or a third-party image;
  `scripts/blur.py` makes its blurred copy. Both scripts reproduce the files
  in `mods/orbit/backgrounds/` exactly.

## License

Apache-2.0 (see `LICENSE`), the same as Herdr.

Two parts are derived from herdr-app's own files (Apache-2.0) and changed:

- `mods/orbit-spaces/` from herdr-app's `spaces` mod: restyled rows, identity
  symbols and colours, worktrees under their repo, the glass background (its
  `main.js` says so too, and its `mod.json` records `cloned_from`);
- `layouts/orbit.json` from herdr-app's `main` layout: rebuilt into the
  sidebar, one framed pane with its tab row, the side panel and the status
  bar, with its own theme, fonts and background.
