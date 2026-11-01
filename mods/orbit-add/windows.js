// The "new window" picker's own list (orbit-add): what else it offers besides
// a terminal, the agents and herdr's own views, read from one file of the
// person's, orbit-windows.json in the app's folder, so any mod can be listed
// without changing code.
//
//   { "windows": [
//       { "title": "Notes", "about": "this project's notes", "icon": "mods/my-notes/icon.svg",
//         "mod": "my-notes", "props": { "folder": "$folder" } },
//       { "title": "Keybinds", "command": "app.help" }
//   ] }
//
// Each entry: "title"; optionally "about" (a short line) and "icon" (an .svg
// under the app's folder); then what it opens: "mod" (a folder in mods/) with
// optional "props", opened in the pane the picker is in, or "command" (any
// herdr-app command) with optional "args". "$folder" anywhere in props or args
// becomes the folder of that pane (its space's). A missing file is an empty
// list; a broken one is reported in the picker, and the rest of it still works.

import { appHome, readTextFile } from "herdr";

export const WINDOWS_FILE = "orbit-windows.json";
export const windowsPath = () => `${appHome()}/${WINDOWS_FILE}`;

// { windows: [entry], error: string | null }
export async function readWindows() {
  let text = null;
  try { text = await readTextFile(windowsPath()); } catch (e) { return { windows: [], error: `can't read ${WINDOWS_FILE}: ${e?.message ?? e}` }; }
  if (text === null || !text.trim()) return { windows: [], error: null };
  let doc;
  try { doc = JSON.parse(text); } catch (e) { return { windows: [], error: `${WINDOWS_FILE} isn't valid JSON: ${e?.message ?? e}` }; }
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.windows) ? doc.windows : null;
  if (!list) return { windows: [], error: `${WINDOWS_FILE}: no "windows" list` };
  const bad = [];
  const windows = list.filter((w, i) => {
    const ok = w && typeof w.title === "string" && w.title.trim()
      && (typeof w.mod === "string" && w.mod.trim() || typeof w.command === "string" && w.command.trim());
    if (!ok) bad.push(i + 1);
    return ok;
  });
  return { windows, error: bad.length ? `${WINDOWS_FILE}: entr${bad.length > 1 ? "ies" : "y"} ${bad.join(", ")} skipped (each needs "title" and "mod" or "command")` : null };
}

// "$folder" in every string of props or args.
export function fill(value, vars) {
  if (typeof value === "string") return value.replace(/\$folder\b/g, vars.folder ?? "");
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, vars)]));
  return value;
}

// What the picker's "configure windows…" row copies: a prompt for the
// person's own agent.
export function configurePrompt() {
  const home = appHome();
  return [
    `Add windows to the "new window" picker of my herdr-app (the orbit layout).`,
    ``,
    `The picker lists the entries of ${windowsPath()} (JSON). Keep what's there and add to "windows", for example:`,
    ``,
    `{ "windows": [`,
    `  { "title": "Notes", "about": "this project's notes", "mod": "my-notes", "props": { "folder": "$folder" } }`,
    `] }`,
    ``,
    `Each entry has "title"; optionally "about" (a short line) and "icon" (an .svg path under ${home});`,
    `then either "mod" (a mod's folder name) with optional "props", opened in the pane the picker is in,`,
    `or "command" (a herdr-app command; \`herdr-app commands\` lists them) with optional "args".`,
    `"$folder" in props or args becomes the folder of that pane.`,
    ``,
    `The installed mods are the folders in ${home}/mods/ (the name is the folder). To learn the props a mod`,
    `takes, read its README or main.js (what it reads from props()).`,
    ``,
    `Save the file; the picker's list updates the next time it shows.`,
  ].join("\n");
}
