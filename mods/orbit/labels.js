import { panes } from "herdr";

export const WIDGET = "mods/orbit-tabs/widget.svg";

export function main(tab) {
  const mine = panes().filter((p) => p.tab === tab.id);
  return mine.find((p) => p.program?.agent) ?? mine[0];
}

export function label(tab) {
  if (tab.named) return tab.name;
  return programLabel(main(tab)) ?? tab.name;
}

export function mark(p) {
  if (!p) return null;
  if (p.mod) return { icon: WIDGET, tint: true };
  return p.program?.icon ? { icon: p.program.icon, tint: p.program.tint } : null;
}

const PROMPT = /^[^\s@]+@[^\s:]+:/;
const SHELLS = new Set(["bash", "zsh", "fish", "sh", "dash", "nu", "toolbox", "distrobox", "podman", "toolbx"]);

export function programLabel(p) {
  if (!p) return null;
  if (p.mod) return p.title || p.mod;
  if (p.program?.shell || SHELLS.has(p.program?.name)) return "shell";
  if (p.program?.key && p.program.key !== "program") return p.program.key;
  const title = (p.title ?? "").trim();
  if (PROMPT.test(title)) return "shell";
  if (!title) return p.program?.name || "shell";
  return title;
}
