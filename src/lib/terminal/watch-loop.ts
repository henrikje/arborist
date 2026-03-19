import { type FSWatcher, watch } from "node:fs";
import { ArbAbort, ArbError } from "../core/errors";
import { enterAlternateScreen, leaveAlternateScreen } from "./alternate-screen";
import { dim } from "./output";
import { isTTY } from "./tty";

export interface WatchEntry {
  /** Directory to watch recursively. */
  path: string;
  /** Optional filter — return true to ignore this event (skip debounce). */
  shouldIgnore?: (filename: string) => boolean;
}

export interface WatchCommand {
  /** Label shown in the footer hint bar (e.g. "rebase"). */
  label: string;
  /** Runs the command. May throw ArbAbort/ArbError/ExitPromptError. */
  run: () => Promise<void>;
}

export interface WatchLoopCallbacks {
  /** Called to render the screen content. Return value is written to the alternate screen. */
  render: () => Promise<string>;
  /** Called when the user presses 'f'. Should perform a fetch and re-render. */
  onFetch?: () => Promise<void>;
  /** Handles a keypress inline (no suspension). Return true if handled — triggers a re-render. */
  onKey?: (key: string) => boolean;
  /** Additional key-triggered commands. Key is the single character (e.g. "r"). */
  commands?: Map<string, WatchCommand>;
  /** Content to show at the top of the screen during suspended commands. Receives the command label. */
  suspendHeader?: (commandLabel: string) => string;
  /** Called after a suspended command completes, before re-rendering. */
  onPostCommand?: () => void;
}

export interface WatchLoopOptions extends WatchLoopCallbacks {
  /** Directories to watch for changes. */
  watchers: WatchEntry[];
  /** Debounce interval in milliseconds (default: 300). */
  debounceMs?: number;
}

/**
 * Run a watch loop that renders content on an alternate screen buffer,
 * re-rendering when filesystem changes are detected.
 *
 * Exits when the user presses q, Escape, or Ctrl-C.
 * Returns a Promise that resolves when the loop ends.
 */
export async function runWatchLoop(options: WatchLoopOptions): Promise<void> {
  const { render, onFetch, onKey, commands, suspendHeader, onPostCommand, watchers, debounceMs = 300 } = options;

  if (!isTTY() || !process.stdin.isTTY) {
    throw new Error("Watch mode requires a terminal (TTY).");
  }

  let fsWatchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let rendering = false;
  let dirty = false;
  let fetching = false;
  let suspended = false;
  let stopped = false;
  // Mute events briefly after each render to ignore filesystem activity caused by
  // our own git operations (e.g. git status touches .git/index, refs, etc.)
  let muteUntil = 0;

  const resolvers: { resolve: () => void } = { resolve: () => {} };
  const done = new Promise<void>((resolve) => {
    resolvers.resolve = resolve;
  });

  // --- Screen management ---

  const writeScreen = (content: string): void => {
    process.stderr.write(`\x1b[H\x1b[J${content}`);
  };

  const doRender = async (): Promise<void> => {
    if (stopped || suspended) return;
    rendering = true;
    dirty = false;
    try {
      const content = await render();
      if (!stopped && !suspended) writeScreen(content);
    } finally {
      rendering = false;
      // Mute events for the debounce window after render completes, so filesystem
      // activity from our own git operations doesn't trigger an immediate re-render.
      muteUntil = Date.now() + debounceMs;
    }
    // If real events arrived during render, schedule a re-render after the mute window.
    if (dirty && !stopped && !suspended) {
      dirty = false;
      setTimeout(() => {
        if (!stopped && !suspended) doRender();
      }, debounceMs);
    }
  };

  const scheduleRender = (): void => {
    if (stopped || suspended) return;
    if (rendering) {
      dirty = true;
      return;
    }
    if (Date.now() < muteUntil) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      doRender();
    }, debounceMs);
  };

  // --- Filesystem watcher management ---

  const startFsWatchers = (): void => {
    for (const entry of watchers) {
      try {
        const watcher = watch(entry.path, { recursive: true }, (_event, filename) => {
          if (stopped || suspended) return;
          if (filename && entry.shouldIgnore?.(filename)) return;
          scheduleRender();
        });
        watcher.on("error", () => {}); // Ignore watcher errors (directory deleted, etc.)
        fsWatchers.push(watcher);
      } catch {
        // Directory may not exist — skip silently
      }
    }
  };

  const stopFsWatchers = (): void => {
    for (const w of fsWatchers) {
      try {
        w.close();
      } catch {}
    }
    fsWatchers = [];
  };

  // --- Keypress handling ---

  const stdin = process.stdin;

  const setupStdin = (): void => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    stdin.unref();
  };

  const teardownStdin = (): void => {
    stdin.setRawMode(false);
    stdin.removeListener("data", onData);
    stdin.unref();
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    resolvers.resolve();
  };

  // --- Suspended command execution ---

  /** Wait indefinitely for any keypress. */
  const waitForKeypress = (options?: { skipLeadingNewline?: boolean }): Promise<void> => {
    return new Promise<void>((resolve) => {
      const prefix = options?.skipLeadingNewline ? "" : "\n";
      process.stderr.write(`${prefix}${dim("Press any key to return to watch mode...")}\n`);
      stdin.setRawMode(true);
      stdin.resume();
      const handler = (): void => {
        stdin.removeListener("data", handler);
        stdin.setRawMode(false);
        resolve();
      };
      stdin.on("data", handler);
    });
  };

  /** Auto-return after `ms` with countdown. Any keypress returns immediately. Escape cancels and waits indefinitely. */
  const waitWithAutoReturn = (ms: number): Promise<void> => {
    return new Promise<void>((resolve) => {
      let remaining = Math.ceil(ms / 1000);
      const writeCountdown = (): void => {
        // Move to start of line, erase it, write updated countdown
        process.stderr.write(`\x1b[2K\r${dim(`Returning in ${remaining}s (Enter to return, Esc to stay)`)}`);
      };

      process.stderr.write("\n"); // blank line before countdown
      writeCountdown();

      stdin.setRawMode(true);
      stdin.resume();

      const cleanup = (): void => {
        clearInterval(interval);
        clearTimeout(timer);
        stdin.removeListener("data", handler);
        stdin.setRawMode(false);
      };

      const interval = setInterval(() => {
        remaining--;
        if (remaining > 0) writeCountdown();
      }, 1000);

      const timer = setTimeout(() => {
        cleanup();
        process.stderr.write("\n");
        resolve();
      }, ms);

      const handler = (data: Buffer): void => {
        // Escape (0x1b) — cancel auto-return, switch to wait-for-keypress
        if (data.length === 1 && data[0] === 0x1b) {
          cleanup();
          // Overwrite the countdown line with persistent prompt
          process.stderr.write("\x1b[2K\r");
          waitForKeypress({ skipLeadingNewline: true }).then(resolve);
          return;
        }
        // Any other key — return immediately
        cleanup();
        process.stderr.write("\n");
        resolve();
      };
      stdin.on("data", handler);
    });
  };

  const AUTO_RETURN_MS = 3000;

  const runSuspended = async (fn: () => Promise<void>, commandLabel: string): Promise<void> => {
    suspended = true;

    // Tear down watch state — stay on alternate screen
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    stopFsWatchers();
    // Erase screen below the header so the command output starts clean,
    // but write header + erase in a single call to avoid a visible blank frame.
    const header = suspendHeader?.(commandLabel) ?? "";
    process.stderr.write(`\x1b[H\x1b[2K${header}\x1b[J`);
    teardownStdin();

    // Run the command
    let waitMode: "auto" | "manual" | "immediate" = "auto";
    try {
      await fn();
    } catch (err) {
      if (err instanceof ArbAbort || (err instanceof Error && err.name === "ExitPromptError")) {
        // User cancelled — return immediately, nothing to read
        waitMode = "immediate";
      } else if (err instanceof ArbError) {
        // Command failed — wait for keypress so user can read the error
        waitMode = "manual";
      } else {
        // Unexpected error — resume watch mode but rethrow after cleanup
        await waitForKeypress();
        setupStdin();
        startFsWatchers();
        onPostCommand?.();
        suspended = false;
        doRender();
        throw err;
      }
    }

    // Let the user read command output before returning
    if (waitMode === "manual") {
      await waitForKeypress();
    } else if (waitMode === "auto") {
      await waitWithAutoReturn(AUTO_RETURN_MS);
    }

    // Resume watch state
    setupStdin();
    startFsWatchers();
    onPostCommand?.();
    suspended = false;
    doRender();
  };

  const onData = (data: Buffer): void => {
    if (data.length !== 1) return;
    const byte = data[0] as number;

    // Ctrl-C — always responsive
    if (byte === 0x03) {
      stop();
      teardownStdin();
      process.kill(process.pid, "SIGINT");
      return;
    }

    // q or Escape — always responsive
    if (byte === 0x71 || byte === 0x1b) {
      stop();
      return;
    }

    // All other keys gated behind busy state
    if (fetching || suspended) return;

    // f — trigger inline fetch
    if (byte === 0x66 && onFetch) {
      fetching = true;
      onFetch()
        .then(() => {
          fetching = false;
          if (!stopped) doRender();
        })
        .catch(() => {
          fetching = false;
        });
      // Re-render immediately to show "Fetching..." state
      doRender();
      return;
    }

    // Inline key handler (toggles, etc.)
    const key = String.fromCharCode(byte);
    if (onKey?.(key)) {
      doRender();
      return;
    }

    // Command dispatch
    if (commands) {
      const cmd = commands.get(key);
      if (cmd) {
        runSuspended(cmd.run, cmd.label);
        return;
      }
    }
  };

  // --- SIGWINCH (terminal resize) ---

  const onResize = (): void => {
    if (!stopped && !suspended && !rendering) {
      doRender();
    } else {
      dirty = true;
    }
  };

  // --- Setup ---

  enterAlternateScreen();

  // Safety net: always leave alternate screen on process exit
  const onExit = (): void => {
    leaveAlternateScreen();
  };
  process.on("exit", onExit);

  setupStdin();
  process.on("SIGWINCH", onResize);

  // Start filesystem watchers
  startFsWatchers();

  // Initial render
  try {
    await doRender();
  } catch {
    // If initial render fails, stop
    stop();
  }

  // Wait for user to exit
  await done;

  // --- Cleanup ---
  teardownStdin();
  process.removeListener("SIGWINCH", onResize);
  process.removeListener("exit", onExit);
  stopFsWatchers();
  leaveAlternateScreen();
}
