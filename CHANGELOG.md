# Changelog

The top entry's bullets are the release notes: `tools/release.sh` publishes
them, and the look's update card shows them.

## 0.5.3

- **Terminals closer to their border.** Less padding between a terminal and its pane's outline: at the sides 2px at compact, 4px at default, 8px at comfortable (was 8, 14 and 18).
- **Still by density.** The padding steps up from compact to comfortable, as before.

## 0.5.2

- **The update button downloads again.** In 0.5.0 and 0.5.1 GitHub refused its download ("HTTP Error 415"). Those copies can't update themselves: run `./install.sh` from a fresh clone once, or give an agent the update prompt from the README.
- **All the release notes.** The update card shows every note, wrapped; long ones scroll inside the card.
- **Readable errors.** An error on the card wraps over up to three lines, and a failed update offers "copy update prompt" too.

## 0.5.1

- **Font and size from Herdr's Settings.** The layout no longer names a terminal font or size, so the ones you set there apply.
- **Terminal background.** A new "terminal" row in the Orbit look settings: clear, tinted or solid.
- **Settings, not the layout file.** Everything you'd change is in the look's settings or Herdr's, so the update button keeps working.

## 0.5.0

- **Update card.** A newer release shows a small card at the bottom right; its "update" button replaces the look's files, if you haven't changed them.
- **Undo.** The copy you had is kept, and the card's "undo" puts it back.
- **No update pill.** The status bar leaves Herdr's own update to Herdr's notice.
