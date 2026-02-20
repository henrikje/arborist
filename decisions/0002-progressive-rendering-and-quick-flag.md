# Progressive Rendering and --quick Flag for List

Date: 2026-02-16

## Context

The `arb list` command was slow for larger projects because it gathered comprehensive git status for every repo in every workspace sequentially. Each repo required ~15 git process spawns. For 5 workspaces with 5 repos each, that was ~375 sequential git spawns (~7.5s at 20ms/spawn). All operations were read-only, making them safe to parallelize. But even with parallelization, gathering status for many repos takes noticeable time, and showing nothing until all data is ready creates a perception of hanging.

The original plan presented the approach as a single integrated design, not as competing alternatives. This record documents the key decisions within that design.

## Decision

Three complementary techniques: parallelize status gathering within and across workspaces via `Promise.all`, add progressive table rendering with ANSI cursor-up re-render, and add `--quick` as a fast path that skips status entirely.

The two-phase architecture separates fast metadata (Phase 1: workspace names, branches, repo counts — sequential) from slow status (Phase 2: per-repo git status — parallel). Progressive rendering shows the Phase 1 table immediately with "..." placeholders in the STATUS column, then re-renders in-place after Phase 2 completes. `--quick` simply skips Phase 2 and hides the STATUS column.

## Why This Is Noteworthy

The progressive rendering pattern uses ANSI cursor-up (`\x1b[<N>A`) to move back to the first data row and re-render each row in place. This adds implementation complexity but eliminates the perception of hanging — the user sees the workspace structure instantly. Non-TTY mode falls back to a single clean render (no ANSI codes in piped output).

The `--quick` flag is a product decision: trade data completeness for speed. It preserves workspace names, branches, bases, and repo counts but drops dirty/unpushed/behind/drifted information entirely. This gives instant orientation ("which workspaces exist, what branches?") without waiting for status.

The `onRepoScanned` callback on `gatherWorkspaceSummary()` enables a "Scanning N/total" progress counter on stderr, shared between `arb list` and `arb status`.

## Consequences

`arb list` shows the table skeleton instantly, then fills in status. The progress counter appears on stderr during scanning. `--quick` provides instant output without the STATUS column. Non-TTY output is always a single clean render. The callback pattern is available to any future command that needs repo-level progress reporting.
