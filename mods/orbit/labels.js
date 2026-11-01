// What a tab is called, and the mark before its name, for the tab rows. This
// file is the same in every orbit mod that uses it.

import { panes } from "herdr";

export const WIDGET = "mods/orbit-tabs/widget.svg";

// The pane a tab is known by: its agent's, else its first.
export function main(tab) {
  const mine = panes().filter((p) => p.tab === tab.id);
  return mine.find((p) => p.program?.agent) ?? mine[0];
}

// A tab's label: its name when someone named it, else what it runs.
export function label(tab) {
  if (tab.named) return tab.name;
  return programLabel(main(tab)) ?? tab.name;
}

// What a tab shows before its label: a mod's, the widget mark (⠿); a
// terminal's, its program's icon from herdr-app's table (a brand logo, or a
// glyph for a shell or an unknown program).
export function mark(p) {
  if (!p) return null;
  if (p.mod) return { icon: WIDGET, tint: true };
  return p.program?.icon ? { icon: p.program.icon, tint: p.program.tint } : null;
}

// A shell's own title (user@host:folder, as a prompt sets it), or a process
// that only wraps a shell (a toolbox, a container).
const PROMPT = /^[^\s@]+@[^\s:]+:/;
const SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "nu", "toolbox", "distrobox", "podman", "toolbx"]);

export function programLabel(p) {
  if (!p) return null;
  if (p.mod) return p.title || p.mod;
  // A shell, or a process that only wraps one, on any machine: "shell",
  // whatever title it set (a command line, a folder).
  if (p.program?.shell || SHELLS.has(p.program?.name)) return "shell";
  if (p.program?.key && p.program.key !== "program") return p.program.key;
  const title = (p.title ?? "").trim();
  if (PROMPT.test(title)) return "shell";
  if (!title) return p.program?.name || "shell";
  return title;
}
