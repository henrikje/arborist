# Watch: handle terminal disconnect and process signals

Date: 2026-03-25

## Context

`arb watch` runs a long-lived interactive dashboard powered by `runWatchLoop()` in `watch-loop.ts`. The loop uses `fs.watch()` for filesystem monitoring and raw-mode stdin for keypresses. A `done` Promise gates cleanup — calling `stop()` resolves it, which tears down stdin, closes watchers, and restores the alternate screen.

The loop handled Ctrl-C (byte 0x03), `q`, and Escape as exit triggers, but had no handling for OS signals (SIGHUP, SIGTERM) or stdin EOF. When a terminal window is closed or an SSH session drops, the OS sends SIGHUP and stdin reaches EOF, but the loop ignored both. The active `fs.watch()` instances kept the event loop alive, leaving the process running as a ghost.

## Options

### Handle signals in watch-loop.ts (local)

Register SIGHUP, SIGTERM, and stdin `end` handlers inside `runWatchLoop()` that call the existing `stop()` function. Remove them during cleanup.

- **Pros:** Self-contained, uses the existing stop/cleanup flow, handles all disconnect scenarios, matches the loop's existing pattern of managing its own lifecycle (SIGWINCH, stdin, exit handlers).
- **Cons:** Only covers the watch loop, not other long-running commands. (No other command currently needs this.)

### Handle signals globally in index.ts

Add SIGHUP/SIGTERM handlers alongside the existing SIGINT handler, calling `process.exit()`.

- **Pros:** Covers all commands.
- **Cons:** Too broad — non-watch commands already terminate on SIGHUP via the default OS behavior. The global handler can't perform watch-specific cleanup (close watchers, restore stdin). The `process.on("exit")` safety net only restores the alternate screen.

## Decision

Handle signals locally in `watch-loop.ts`.

## Reasoning

The watch loop manages its own lifecycle: it registers SIGWINCH, stdin data, and exit handlers, and cleans them all up when stopping. Adding SIGHUP, SIGTERM, and stdin `end` to this set is the natural extension. The existing `stop()` → cleanup → return flow handles everything without needing `process.exit()` in the signal handler — the normal exit path in `index.ts` calls `process.exit(0)` after `parseAsync()` resolves.

Global handlers would violate the principle that the watch loop owns its state. They'd also be redundant for non-watch commands, where the default OS signal behavior already terminates the process.

## Consequences

`arb watch` now exits cleanly when the terminal closes (SIGHUP), when killed (SIGTERM), or when stdin reaches EOF. Cleanup (watchers closed, stdin restored, alternate screen left) runs through the normal path. Terminal-related cleanup steps are wrapped in try-catch because the terminal may already be gone when SIGHUP fires — resource cleanup (closing fs watchers, removing listeners) always runs regardless.
