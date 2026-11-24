import fs from "node:fs";
import path from "node:path";

// The space of the directory an agent runs in: the nearest folder upwards with
// a .bowman, not beyond the repository root (a repo without a space has none,
// even when a folder above it has one).
export function spaceOfDirectory(directory: string): string | undefined {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".bowman"))) return current;
    if (fs.existsSync(path.join(current, ".git")) || path.dirname(current) === current) return undefined;
  }
}
