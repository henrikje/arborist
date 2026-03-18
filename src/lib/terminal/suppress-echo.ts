import { isTTY } from "./tty";

export interface EchoSuppression {
  restore: () => void;
}

/**
 * Suppress terminal echo without entering raw mode.
 * Uses `stty -echo noflsh` so typed characters stay in the kernel input buffer
 * (preserved for the shell after this process exits) and are not flushed on signals.
 *
 * No-op when stdin is not a TTY.
 */
export function suppressEcho(): EchoSuppression {
  if (!process.stdin.isTTY || !isTTY()) {
    return { restore: () => {} };
  }

  // Save current terminal state for exact restoration
  const saveResult = Bun.spawnSync(["stty", "-g"]);
  if (saveResult.exitCode !== 0) {
    return { restore: () => {} };
  }
  const savedState = saveResult.stdout.toString().trim();

  const applyResult = Bun.spawnSync(["stty", "-echo", "noflsh"]);
  if (applyResult.exitCode !== 0) {
    return { restore: () => {} };
  }

  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    Bun.spawnSync(["stty", savedState]);
    process.removeListener("exit", onExit);
  };

  const onExit = () => {
    restore();
  };

  process.on("exit", onExit);

  return { restore };
}
