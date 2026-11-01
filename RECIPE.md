# Orbit

A dark, glassy workspace over a generated space picture. Each space gets a
colour and a symbol of its own, and the pane you're in is outlined in it, with
its tabs as the bottom of that outline. A sidebar lists your spaces with their
branches; a status bar shows cpu, ram, disk and what your agents are doing.

![Orbit](preview.png)

This file is the brief: enough to build Orbit from an empty folder. The files
next to it are one build of it, for herdr-app 0.1.11.

## What you see

Left to right, then the status bar along the bottom (the system draws the
title bar: `"titlebar": "system"`). Theme `orbit` (Tokyo Night colours:
background `#161622`, surface `#161622`, border `#414868`, foreground
`#c0caf5`, muted `#9aa5ce`, accent `#7aa2f7`). Terminals in JetBrains Mono
14px, padding `[18, 16]`, fully see-through (`terminal_opacity: 0`).

- **Background**: `mods/orbit/backgrounds/space.png` (2560×1600) behind the
  whole window, `fit: "cover"`: a night sky with a pale Milky-Way band across
  it, blue, teal and violet glows, small stars, and the curve of a planet
  rising bottom right.
- **Glass**: the sidebar, the pane, its tab row and the status bar are the
  theme's surface at 62% (`#1616229e`) over a blurred copy of the background
  (`space-blur.png`, Gaussian radius 1.2% of its width), placed exactly where
  the sharp picture is, so the panels look frosted. The terminal area shows the
  sharp picture.
- **Space identity**: each space has one of six colours (`#bb9af7` purple,
  `#7dcfff` cyan, `#9ece6a` green, `#e0af68` yellow, `#ff9e64` orange,
  `#f7768e` red) and one of 8 symbols (hexagon, triangle, square, circle, star,
  plus, cross, diamond, 16px SVGs, outlined and filled).
- **Sidebar**, 400px wide (44–560), glass, square corners:
  - A header per machine, "Local" first: 27px, 16px semibold, a `▾`/`▸` fold
    (15px, muted). A machine that can't be reached shows "! attention" in red
    and why under it.
  - Each space: its symbol (14px box, centre 14px from the left) outlined in
    muted, in `idle` (`#a9b1d6`) when shown, filled with its agents' state
    colour; its name at 16px (`#a9b1d6`); under it its branch at 14px (muted
    at 62%) with `↑N` green and `↓N` red. A two-line row is 41px, a one-line
    row 27px.
  - The shown space: a band in its identity colour at 16% behind the row
    (radius 4), its name bold in that colour, its branch in `#bb9af7`.
  - Worktrees: one 24px line each (15px name, 12px symbol), hung under their
    repo's row with 1px tree lines (muted at 45%) and an `└─` elbow; the repo's
    row has a 20px `▾`/`▸` fold in accent at its right.
  - At the foot, an 86px block: "▸ agents" (27px row, 16px) and under it
    "open folder" (16px, `#a9b1d6`).
- **The pane**, the rest of the width, in an outline 2px wide with corners of
  radius 4: in the shown space's colour while it has the keys, else the border
  colour. Its top is a 6px cap with the rounded corners; its sides run down to
  the tab row.
- **The tab row**, 52px, the bottom of the pane's outline:
  - A 6px glass band whose bottom edge is the tab line (2px, outline colour),
    then the row, then the row's edge (2px) with rounded bottom corners, in a
    muted colour: on the pane with the keys, the space colour 30% of the way
    from the border, then 60% of the way to its own grey (`#676579` for
    purple); else the border colour. The outline's sides go on past the tab
    line to that edge (a T).
  - First the space: its symbol (13px, identity colour) and name (14px bold,
    foreground, at most 220px), 18px in.
  - Then the space's tabs, 26px tall, 12px text, 10px padding: a 6px dot in
    the agent's state colour (an agent with no state: a 6px muted ring), the
    program's 12px icon, the name. Others are `#a9b1d6`, lighter on hover.
  - The shown tab is a folder tab: no tab line above it, its sides (2px, the
    outline colour) curving out of the tab line with radius 4 and down to its
    own bottom edge, which lies on the row's edge; its label in the identity
    colour (foreground when the pane hasn't the keys).
- **Side panel**, hidden at first, 368px (280–900), on the right: herdr's
  files and changes, framed like the pane, with a tab each in a row like the
  pane's (an 11px ⠿ before each name).
- **Status bar**, 40px, glass, 13px text, 14px in from each side:
  - Left: the sidebar toggle (an 18px panel icon), "herdr offline" in red
    while the core can't be reached, "N folded" (muted) for settled tabs, and
    an accent "update ready · restart" pill.
  - Right: cpu % with a sparkline (20 bars 2px wide, 14px tall, one a second),
    ram %, disk % (each with a 14px icon; plain, yellow `#e0af68` from 70%,
    red `#f7768e` from 90%), `?` in accent, three counts with a dot (to handle:
    red, or muted at 0; in progress: yellow; done: green), the clock (HH:MM),
    and the side panel toggle (the sidebar icon mirrored).
- Under the status bar, a 4px block (the `orbit` mod, which draws nothing).

## How it behaves

- **Agent states**: blocked `#f7768e`, working `#e0af68`, done `#9ece6a`; idle
  has no colour. They fill the space's symbol in the sidebar and colour a tab's
  dot. The status bar counts blocked and done agents as "to handle", working
  as "in progress", idle as "done"; clicking a non-zero count focuses its
  first agent.
- **Identity**: FNV-1a (32-bit) of the space's name as UTF-8 bytes; colour =
  hash % 6, symbol = (hash >>> 9) % 8. A git worktree and the main checkout it
  belongs to use their repo's common git dir instead of the name, so they
  match. With another theme than `orbit`, the colours are its ANSI 5, 6, 2, 3,
  11 and 1.
- **The pane with the keys**: clicking into the side panel moves the coloured
  outline (and the bright lines of its tab row) there; clicking a terminal, a
  tab or a press anywhere in the pane's column brings it back. Hiding the
  panel gives it back to the pane. Switching spaces recolours the outline.
- **Sidebar**: click a space to show it; right-click opens herdr's space menu
  (rename, worktrees, close); drag a row onto another to move the space there.
  Fold toggles fold a machine or a repo's worktrees (remembered). Branches
  refresh when a command or an agent's turn ends, when the repo's git folder
  changes, and once a minute while the window is in front.
- **Tab row**: click a tab to show it; right-click opens herdr's tab menu
  (Rename, New tab, Close). Tabs too many for the width narrow, then scroll
  sideways; the shown tab and the space's name stay.
- **Side panel**: the status bar's right-most button opens and closes it;
  click its tabs to switch between files and changes.
- **Status bar**: the left button toggles the sidebar; hovering cpu, ram or
  disk shows details (load and each core; used, available and swap; the
  filesystem's sizes); `?` opens herdr's shortcuts.
- Keys: herdr-app's own (`ctrl-shift-t` new tab, `ctrl-shift-w` close,
  `ctrl-shift-b` sidebar, `ctrl-shift-l` switch layout).

## Built from

- **Layout** `layouts/orbit.json`, a root column (`theme: "orbit"`,
  `font: "JetBrains Mono"`, `font_size: 14`, the background, `terminal_padding`,
  `terminal_opacity: 0`, `preview: "layouts/orbit.svg"`):
  - `body`, a row:
    - `sidebar`, a column (400px, 44–560, `resizable: false`): `spaces`
      (`orbit-spaces`), `agents` (herdr's `agents`, hidden), `sidebar-footer`
      (86px, `orbit-sidebar-footer`).
    - `work`, a row of two frames. Each frame is a column: `<x>-cap` (6px,
      `orbit-edge` with `props.pane`), `<x>-mid` (a row, `resizable: false`,
      `divider` 2px in the outline colour, holding a zero-wide `orbit-nothing`
      block, the content, another zero-wide block: the divider draws the
      outline's sides), `<x>-tabs` (52px, the tab row mod).
      - `left-frame`: content the stack `left` with the block `left-tab`
        (`{ "tab": "active" }`, pane frame gap 0, radius 0, transparent, no
        border); tab row `orbit-tabs` with `props.stack: "left"`.
      - `panel` (hidden, 368px, 280–900): content the stack `panel-body` with
        `panel-files` (herdr's `files`) and `panel-changes` (herdr's
        `changes`), each with a `title`; tab row `orbit-panel-tabs` with
        `props.stack: "panel-body"`.
  - `status` (40px, `orbit-status`), `orbit` (4px, the `orbit` mod).
- **Mods** (all `place: "none"`):
  - `orbit`: keeps the layout file in step. On start, when `layouts/` changes,
    when the theme or the shown space changes and when the keys move, it
    writes into `layouts/orbit.json` the glass colour (`surface` + `9e`) on
    `sidebar`, `left` and `panel-body`, and the `left-mid` / `panel-mid`
    divider colours (the space's identity on the pane with the keys, the
    border on the other). It holds `backgrounds/`.
  - `orbit-spaces`: a restyled clone of herdr-app's `spaces` mod.
  - `orbit-sidebar-footer`, `orbit-status`, `orbit-tabs`, `orbit-panel-tabs`,
    `orbit-edge` (the 6px cap), `orbit-nothing` (draws nothing).
  - Shared files, the same in each mod that imports them: `look.js` (sizes,
    glass, which pane has the keys: shared `"orbit.sides".focus`, the layout
    writer), `glass.js` (the blurred backdrop), `rowframe.js` (the tab row's
    segments and folder tab), `identity.js` (colours, symbols, the repo
    lookup: shared `"orbit.git"`), `labels.js` (tab names and icons).
- **herdr API**: `spaces`, `panes`, `agents`, `machines`, `updates`,
  `layout`, `focused`, `theme`, `settings`, `shared`, `setShared`, `exec`,
  `hc`, `readTextFile`, `writeTextFile`, `watchFolder`, `appHome`, `home`,
  `pickFolder`, `openOverlay`, `run`, `window`. Commands: `space.select`,
  `space.move`, `space.new`, `tab.select`, `layout.toggle`, `layout.select`,
  `agent.focus`, `app.help`, `app.update`. Shipped mods: `agents`, `files`,
  `changes`, `menu` (popups with `tab: "space"` and `tab: "tab"`).
- **Programs**: `git status --porcelain=v2 --branch` and `git rev-parse` in
  each space's folder (on its machine), `hc machine ls --json`,
  `df -B1 --output=used,avail,size,target <home>`; files read: `/proc/stat`,
  `/proc/loadavg`, `/proc/meminfo`, `layouts/orbit.json`.
- **Art**: `scripts/space.py` renders the background (procedural, seeded),
  `scripts/blur.py` its blurred copy, `scripts/glyphs.py` the 8 symbols in
  `mods/orbit-tabs/glyphs/`. The status bar's icons, the fillets and the ⠿
  mark are small SVGs in their mods. `layouts/orbit.svg` is the settings
  preview.

## Watch out

- **Copy `themes/` too.** The layout names the theme `orbit`; without
  `themes/orbit.json` herdr-app doesn't apply the layout at all ("theme
  "orbit" is not one of graphite, ink, moss, paper").
- The `orbit` mod rewrites `layouts/orbit.json` (glass and outline colours):
  edit those there and they come back. It must be in the layout for the
  outline to follow the space.
- Paths across mods: the layout and every `glass.js` use
  `mods/orbit/backgrounds/`; `identity.js` uses `mods/orbit-tabs/glyphs/` and
  `labels.js` `mods/orbit-tabs/widget.svg`. Renaming a mod on a name clash
  means changing those paths in every copy.
- herdr-app clips a pane's content inside its frame and has one focus colour
  per layout, so the outline isn't a pane frame: it's the cap block, the
  middle row's divider around zero-wide blocks, and the tab row. The tab
  block's own pane frame stays invisible.
- herdr has no backdrop blur: each glass block draws the blurred picture as
  its bottom layer, placed with the root's cover maths from the window size
  (`viewport_size`) and its own place, divided by the zoom (herdr scales
  lengths a mod writes, but reports sizes unzoomed). gpui clips to rectangles,
  so rounded glass corners are 1px rows of the picture.
- `focused()` says nothing when a press lands in a mod block (the panel's
  files), so the tab rows watch every press (`on_mouse_down_out`) and take
  the ones in their own column.
- herdr's `files` and `changes` draw their own card inside the panel.
- Linux only for cpu, ram and disk (`/proc`, `df`); elsewhere they're hidden.
- The background picture's size (2560×1600) is written in `look.js`; another
  picture needs its size there and a blurred copy.
- Corners are radius 4 and the gap 0 in this build; there are no settings.
- **Updating**: copies don't update themselves, and the add flow never
  overwrites (it would make `orbit-2`). To update, remove `layouts/orbit.json`,
  `layouts/orbit.svg`, `mods/orbit`, every `mods/orbit-*` and
  `themes/orbit.json`, then copy the new ones in; leave the person's other
  files alone. This build is version 1 (`VERSION` in `mods/orbit/main.js`,
  shared `"orbit.version"`).

## Done when

- `herdr-app check` passes for each of the 8 mods, and after
  `layout.switch {"name": "orbit"}` `herdr-app status` lists no errors.
- The background shows behind a see-through terminal, and the sidebar, tab
  row and status bar show the same picture blurred, lined up with it.
- The pane's outline and the shown space's sidebar band are the space's
  identity colour; another space shows another colour; a worktree space and
  its repo share one.
- The tab row's line is open under the shown tab, whose sides curve out of
  it; the row's edge below is muted, with rounded corners.
- An agent reporting working, blocked or done fills its space's symbol and
  its tab's dot yellow, red or green, and the status bar's counts change.
- The status bar's right button opens the side panel with files and changes;
  clicking in it moves the coloured outline there, clicking the terminal moves
  it back.
- cpu, ram and disk update every second (disk every 30 s) and turn yellow and
  red at 70% and 90%.
