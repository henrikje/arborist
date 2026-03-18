import { isTTY } from "./tty";

export interface AbortSignalHandle {
  signal: AbortSignal;
  cleanup: () => void;
}

/**
 * Listen for SIGINT (Ctrl+C) to abort a background operation.
 * Returns an AbortSignal that fires on the first Ctrl+C, plus a cleanup function.
 *
 * Temporarily replaces the process SIGINT handlers so the first Ctrl+C aborts
 * without killing the process. Original handlers are restored immediately after
 * the abort fires (so a second Ctrl+C uses the normal kill-and-exit path).
 *
 * No-op when stdin is not a TTY — returns a never-aborted signal.
 */
export function listenForAbortSignal(): AbortSignalHandle {
  const controller = new AbortController();

  if (!process.stdin.isTTY || !isTTY()) {
    return { signal: controller.signal, cleanup: () => {} };
  }

  let cleaned = false;

  // Save existing SIGINT handlers so we can restore them
  const existingListeners = process.rawListeners("SIGINT").slice();
  process.removeAllListeners("SIGINT");

  const restoreListeners = () => {
    if (cleaned) return;
    cleaned = true;
    process.removeAllListeners("SIGINT");
    for (const listener of existingListeners) {
      process.on("SIGINT", listener as NodeJS.SignalsListener);
    }
  };

  const onSigint = () => {
    controller.abort();
    restoreListeners();
  };

  process.on("SIGINT", onSigint);

  return { signal: controller.signal, cleanup: restoreListeners };
}
