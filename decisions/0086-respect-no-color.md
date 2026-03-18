# Respect NO_COLOR and TERM=dumb

Date: 2026-03-18

## Context

Arborist used `isTTY()` as the single gate for both ANSI color output and interactive terminal features (prompts, cursor control, progress indicators). This function only checks `process.stderr.isTTY`, ignoring the `NO_COLOR` environment variable (no-color.org, adopted by 300+ tools) and `TERM=dumb`. The CLIG convention recommends disabling color when `NO_COLOR` is set or when `TERM=dumb`.

A user running `NO_COLOR=1 arb status` in a real terminal expects no colors but still wants interactive features like progress indicators and phased rendering. The conflated `isTTY()` check cannot express this separation.

## Options

### A: New `shouldColor()` function

Add a dedicated `shouldColor()` function that checks `NO_COLOR`, `TERM=dumb`, and falls back to `isTTY()`. Replace `isTTY()` with `shouldColor()` only at color-specific call sites. Keep `isTTY()` unchanged for interactive features.

- **Pros:** Clean separation of concerns. Interactive features unaffected by `NO_COLOR`. Each concern has a single, named function.
- **Cons:** ~20 call sites need updating. Two functions to understand.

### B: Modify `isTTY()` to check env vars

Make `isTTY()` return false when `NO_COLOR` is set or `TERM=dumb`.

- **Pros:** Zero call-site changes. Simplest diff.
- **Cons:** Breaks interactive features. `NO_COLOR=1` in a real TTY would disable prompts (requiring `--yes` everywhere), progress indicators, phased rendering, alternate screen, and watch mode.

## Decision

Option A: add `shouldColor()` as a separate function.

## Reasoning

Color and interactivity are genuinely separate concerns. `NO_COLOR` means "don't emit ANSI color escape codes" — it does not mean "pretend this isn't a terminal." A user who sets `NO_COLOR=1` for accessibility or log cleanliness should still get progress indicators, interactive prompts, and phased rendering. Option B would force `--yes` on every confirmation prompt just because the user doesn't want colors, violating the principle of least surprise.

The `shouldColor()` / `isTTY()` split also mirrors the existing documentation in QA.md, which already distinguishes between `process.stdin.isTTY` (for prompts) and `isTTY()` (for colors and progress). This change sharpens that distinction.

## Consequences

- `shouldColor()` is the single authority for color decisions. All `RenderContext.tty` values and `output.ts` color wrapping use it.
- `isTTY()` remains the authority for interactive features (cursor control, progress, alternate screen, phased rendering).
- Adding `--no-color` / `--color` CLI flags later is straightforward: add a module-level override in `tty.ts` (same pattern as `enableDebug()`).
- Adding `FORCE_COLOR` support later requires one additional check in `shouldColor()`.
- Inquirer prompt colors (via `node:util` `styleText()`) are not affected by this change — they depend on Bun's runtime `styleText()` implementation, which does not currently respect `NO_COLOR`.
