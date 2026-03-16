import { type FSWatcher, watch } from "node:fs";
import { enterAlternateScreen, leaveAlternateScreen } from "./alternate-screen";
import { isTTY } from "./tty";

export interface WatchEntry {
  /** Directory to watch recursively. */
  path: string;
  /** Optional filter — return true to ignore this event (skip debounce). */
  shouldIgnore?: (filename: string) => boolean;
}

export interface WatchLoopCallbacks {
  /** Called to render the screen content. Return value is written to the alternate screen. */
  render: () => Promise<string>;
  /** Called when the user presses 'f'. Should perform a fetch and re-render. */
  onFetch?: () => Promise<void>;
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
  const { render, onFetch, watchers, debounceMs = 300 } = options;

  if (!isTTY() || !process.stdin.isTTY) {
    throw new Error("Watch mode requires a terminal (TTY).");
  }

  const fsWatchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let rendering = false;
  let dirty = false;
  let fetching = false;
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
    if (stopped) return;
    rendering = true;
    dirty = false;
    try {
      const content = await render();
      if (!stopped) writeScreen(content);
    } finally {
      rendering = false;
      // Mute events for the debounce window after render completes, so filesystem
      // activity from our own git operations doesn't trigger an immediate re-render.
      muteUntil = Date.now() + debounceMs;
    }
    // If real events arrived during render, schedule a re-render after the mute window.
    if (dirty && !stopped) {
      dirty = false;
      setTimeout(() => {
        if (!stopped) doRender();
      }, debounceMs);
    }
  };

  const scheduleRender = (): void => {
    if (stopped) return;
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

  // --- Keypress handling ---

  const stdin = process.stdin;
  let stdinCleaned = false;

  const cleanupStdin = (): void => {
    if (stdinCleaned) return;
    stdinCleaned = true;
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

  const onData = (data: Buffer): void => {
    // Ctrl-C
    if (data.length === 1 && data[0] === 0x03) {
      stop();
      cleanupStdin();
      process.kill(process.pid, "SIGINT");
      return;
    }

    // q or Escape
    if (data.length === 1 && (data[0] === 0x71 || data[0] === 0x1b)) {
      stop();
      return;
    }

    // f — trigger fetch
    if (data.length === 1 && data[0] === 0x66 && onFetch && !fetching) {
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
  };

  // --- SIGWINCH (terminal resize) ---

  const onResize = (): void => {
    if (!stopped && !rendering) {
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

  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", onData);
  stdin.unref();

  process.on("SIGWINCH", onResize);

  // Start filesystem watchers
  for (const entry of watchers) {
    try {
      const watcher = watch(entry.path, { recursive: true }, (_event, filename) => {
        if (stopped) return;
        if (filename && entry.shouldIgnore?.(filename)) return;
        scheduleRender();
      });
      watcher.on("error", () => {}); // Ignore watcher errors (directory deleted, etc.)
      fsWatchers.push(watcher);
    } catch {
      // Directory may not exist — skip silently
    }
  }

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
  cleanupStdin();
  process.removeListener("SIGWINCH", onResize);
  process.removeListener("exit", onExit);
  for (const w of fsWatchers) {
    try {
      w.close();
    } catch {}
  }
  leaveAlternateScreen();
}
