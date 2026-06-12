import { rmdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export async function removeFileIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Temp screenshot cleanup is best-effort.
  }
  try {
    await rmdir(dirname(path));
  } catch {
    // Leave non-empty directories alone.
  }
}
