import { isTTY } from "./tty";

export interface StdinSuppression {
  restore: () => void;
}

/**
 * Suppress stdin echo by enabling raw mode and discarding input.
 * Prevents stray keypresses from corrupting multi-phase terminal output.
 *
 * No-op when stdin is not a TTY or when raw mode is already active.
 */
export function suppressStdin(): StdinSuppression {
  if (!process.stdin.isTTY || !isTTY()) {
    return { restore: () => {} };
  }

  const stdin = process.stdin;

  if (stdin.isRaw) {
    return { restore: () => {} };
  }

  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    stdin.setRawMode(false);
    stdin.removeListener("data", onData);
    stdin.unref();
    process.removeListener("exit", onExit);
  };

  const onData = (data: Buffer) => {
    if (data.length === 1 && data[0] === 0x03) {
      restore();
      process.kill(process.pid, "SIGINT");
      return;
    }
  };

  const onExit = () => {
    restore();
  };

  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", onData);
  stdin.unref();
  process.on("exit", onExit);

  return { restore };
}
