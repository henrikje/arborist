import { renameSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * Write a file atomically using a per-process temp file and rename.
 *
 * Writes to `${filePath}.tmp.${process.pid}`, then renames into place.
 * The per-process suffix prevents concurrent arb invocations from
 * clobbering each other's temp files.
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {}
    throw err;
  }
}
