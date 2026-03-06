export function isTTY(): boolean {
  if (process.stderr.isTTY !== true) return false;
  try {
    return Bun.stdout.writer().toString() !== "[object Blob]";
  } catch {
    return false;
  }
}
