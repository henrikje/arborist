export function isTTY(): boolean {
  if (process.stderr.isTTY !== true) return false;
  try {
    return Bun.stdout.writer().toString() !== "[object Blob]";
  } catch {
    return false;
  }
}

export function shouldColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === "dumb") return false;
  return isTTY();
}
