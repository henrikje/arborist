# Aligned Plan Output Columns

Date: 2026-03-02

## Context

Plan output for `push`, `pull`, `rebase`, and `merge` displayed repo names followed by action text with a fixed three-space gap (`repo   action`). Because repo names vary in length, the action text started at different columns across rows, making plans harder to scan visually. Meanwhile, commands like `rebranch`, `delete`, and `clean` already used `renderTable()` to produce aligned REPO/ACTION columns with automatic padding.

## Options

### Extend `renderTable()` with `afterRow`

Reuse the existing `renderTable()` system, adding an `afterRow` callback for verbose/graph expansion blocks that need to appear after individual rows. Replace the per-line formatting helpers (`formatSkipLine`, `formatUpToDateLine`) with action-pair helpers that return `{ value, render }` for use as column data.

- **Pros:** Reuses proven alignment infrastructure, consistent with other commands, minimal new code.
- **Cons:** Requires refactoring three format functions and replacing two helpers.

### Build a parallel alignment mechanism

Compute max repo name width manually in each format function and pad accordingly, without touching `renderTable()`.

- **Pros:** Smaller diff per file, no changes to shared infrastructure.
- **Cons:** Duplicates alignment logic already solved by `renderTable()`, diverges from the pattern used by other commands.

## Decision

Extend `renderTable()` with an `afterRow` option and refactor all three plan formatters to use it.

## Reasoning

The table system already handles column width computation, header rendering, and the value/render split for ANSI-aware padding. Duplicating this logic would be a maintenance burden and would diverge from the established pattern. The `afterRow` extension is backwards-compatible — existing callers are unaffected — and naturally supports the verbose/graph expansion blocks needed by integrate and pull/push plans.

## Consequences

All plan outputs (push, pull, rebase, merge) now display REPO and ACTION column headers with padded alignment, matching the table format used by rebranch, delete, and clean. The `afterRow` callback is available for future commands that need post-row expansion content. The old `formatSkipLine` and `formatUpToDateLine` helpers have been replaced by `skipAction` and `upToDateAction` which return `{ value, render }` pairs suitable for table columns.
