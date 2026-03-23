# Terminal Width Adaptation Strategy

Date: 2026-03-23

## Context

`arb status` and other table-based commands adapt their output to the terminal. Two distinct mechanisms are in play: (1) columns like BRANCH, BASE, and SHARE are shown or hidden based on whether their data is redundant across all repos, and (2) the `baseName` and `remoteName` cells are truncated (with ellipsis) when the table exceeds the terminal width. The question arose whether dynamically adapting output to terminal width is an anti-pattern for CLI tools, and whether explicit verbosity flags (`--wide`, `--short`) would be a better approach.

## Options

### Width-driven column hiding
Hide entire columns when the terminal is too narrow to fit them, similar to `htop` or `top`.
- **Pros:** Zero-config usability on narrow terminals; no line wrapping.
- **Cons:** Users silently miss relevant data without knowing it; behavior varies unpredictably across terminal sizes; harder to document.

### Verbosity flags only
Always show a fixed set of columns. Provide `--wide` (show all columns, no truncation) and `--short` (compact view) flags for user control, similar to `kubectl -o wide` or `docker ps --no-trunc`.
- **Pros:** Explicit, predictable, documentable output. Users know exactly what they asked for.
- **Cons:** Default output wraps on narrow terminals, destroying table alignment. Requires users to discover and remember flags. Doesn't address the redundancy problem (showing identical base refs on every row).

### Data-driven hiding + width-driven truncation (current approach)
Hide columns when their data is redundant (all repos share the same value), surfacing the shared value in a parenthetical header note. Truncate cell values (not columns) when the table exceeds terminal width, preserving remote prefixes like `origin/` plus at least 3 characters.
- **Pros:** Removes noise without losing information (parenthetical preserves hidden values). Truncation prevents line wrapping — a standard pattern used by `gh`, `docker ps`, and `git log`. No flags needed for the common case.
- **Cons:** Branch names can become hard to read at extreme widths. Users may not notice the parenthetical header note.

## Decision

Keep the current approach: data-driven column visibility combined with width-driven value truncation. Do not introduce width-driven column hiding.

## Reasoning

The two mechanisms serve different purposes and should not be conflated. Data-driven hiding is an information design decision — showing `BASE origin/main` on every row when all repos share that base is pure noise, regardless of terminal width. This is the same principle behind `git status` only showing sections with content, or `kubectl` varying columns by resource type. The parenthetical header note (`base origin/main, share origin/feature-x`) ensures no information is lost.

Width-driven truncation of values is standard practice across modern CLI tools. The alternative — line wrapping — destroys table alignment and is objectively worse for readability. The current implementation is careful: it preserves remote prefixes (`origin/`) plus at least 3 characters before adding an ellipsis, and respects a configurable minimum column width.

Width-driven column *hiding* is where the approach would cross into anti-pattern territory. If a column contains relevant, non-redundant data (e.g., one repo is behind its base while others are not), hiding it based on terminal width means users on 80-column terminals silently miss important information. This violates the principle that the default view should surface all actionable state.

## Consequences

Verbosity flags (`--wide`, `--short`) are not ruled out but should only be added in response to concrete user demand, not preemptively. A `--wide` flag that disables truncation and shows full refs could be useful for scripting or debugging. The current design leaves room for this without requiring it. If truncation proves too aggressive at common terminal widths (80-100 columns), the first adjustment should be raising `truncate.min` values, not adding flags.
