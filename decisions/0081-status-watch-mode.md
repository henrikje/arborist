# Status Watch Mode

Date: 2026-03-16

## Context

Users working with AI agents across multi-repo workspaces want a live dashboard showing workspace state in a split terminal. The current `arb status` is one-shot: gather, render, exit. Re-running it manually is tedious during fast-moving agent sessions where files change and commits happen frequently.

The existing codebase has all the building blocks: `gatherWorkspaceSummary()` + `buildStatusView()` + `render()` form a composable pipeline, `clearLines()`/`countLines()` handle ANSI redraw, and `listenForAbortKeypress()` demonstrates raw-mode stdin handling. The question is how to structure the continuous refresh.

## Options

### `setInterval` polling
Re-run the status pipeline on a fixed interval (e.g. 2 seconds).
- **Pros:** Dead simple, no watcher setup, no debounce logic.
- **Cons:** Spawns git processes every N seconds even when nothing changed. Either too slow or too CPU-hungry.

### Filesystem watching with `fs.watch`
Use Bun's `node:fs` `watch()` with `recursive: true` to detect changes, debounce events, and re-render.
- **Pros:** Event-driven — only re-renders when something changes. Near-instant response. Zero wasted work when idle.
- **Cons:** Must watch two locations per repo (worktree dir + canonical `.git/` dir). Needs debouncing. Must handle gitignore to filter noise from `node_modules` etc.

### Separate `arb watch` command
A new top-level command wrapping the status pipeline.
- **Pros:** Clean separation.
- **Cons:** Duplicates the pipeline or tightly couples to status internals. Doesn't meet the "substantial coordination value" threshold for a new command. GUIDELINES say variants belong as flags.

## Decision

Filesystem watching via `--watch` flag on `arb status`, using Bun's `fs.watch` with `recursive: true`, rendered on an alternate screen buffer with debounced re-rendering.

## Reasoning

GUIDELINES: "If the mechanism is fundamentally the same as an existing command applied differently, it is a variant and belongs as a flag." Watch mode runs the exact same pipeline triggered by filesystem events — clearly a variant. A separate command would violate "do one thing and do it well" by creating a meta-command.

Filesystem watching over polling because the use case demands responsiveness (seeing changes as they happen) without burning CPU. `fs.watch` with `recursive: true` uses FSEvents on macOS, which is efficient and reliable for this scale. The complexity of watching two directories per repo (worktree + canonical `.git/`) is well-contained in setup code.

The alternate screen buffer (like `top`, `less`, `vim`) was chosen over `clearLines()` because it provides clean entry/exit — original terminal content is restored when watch mode ends, with no scrollback pollution.

Interactive `f` key for on-demand fetch was added because automatic fetching would hammer remote servers, while never fetching would limit the feature's usefulness. The interactive approach lets the user control when to incur network I/O.

## Consequences

- `arb status` gains a long-running mode, which is new for arb commands. The process stays alive until the user quits.
- The alternate screen buffer pattern (`alternate-screen.ts`) and watch loop primitive (`watch-loop.ts`) are available for reuse if other commands want similar behavior.
- No remote fetch happens automatically in watch mode — users must explicitly press `f`. This is deliberate but could surprise users who expect fresh remote data.
- Gitignore filtering uses `git ls-files --others --ignored --exclude-standard --directory` at setup time. If `.gitignore` changes during a session, the filter is stale. This is acceptable for the expected session duration.
