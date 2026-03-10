# Interactive Selection for delete --where and --all-safe

Date: 2026-03-10

## Context

The `arb delete --where` and `--all-safe` flags auto-select all matching workspaces and present a binary yes/no confirmation. There is no way to deselect individual matches. This is frustrating when the filter almost-but-not-quite matches what you want — for example, deleting all `gone` workspaces except one you want to keep. The user must fall back to naming workspaces explicitly, losing the convenience of filters.

## Options

### Table then plain checkbox picker
Show the full colored table first, then present an `@inquirer/checkbox` with just workspace names.
- **Pros:** Reuses both `displayDeleteTable` and `selectInteractive` as-is. Minimal code.
- **Cons:** The table scrolls away when the checkbox renders. User must memorize which workspaces to deselect. Disconnected UX.

### Columnar checkbox with dimmed table header
Format each checkbox choice as a padded row with status info. Replace inquirer's native `? message` prompt with a dimmed table header using theme customization (`prefix: ""`, custom `style.message`).
- **Pros:** Status visible inline during selection. Plain text avoids ANSI nesting issues with inquirer's highlight. Uses public theme API.
- **Cons:** No color coding in the picker (plain text only). A second colored table is shown after selection for final confirmation.

### ANSI-colored checkbox names with custom theme
Embed ANSI escape codes in choice names and override `theme.style.highlight` to avoid double-coloring.
- **Pros:** Full color during selection.
- **Cons:** Fragile coupling to inquirer internals. `highlight` wraps the entire line (cursor + icon + name) in cyan, overriding inner ANSI codes on the active row. Breaks across terminal emulators and inquirer updates.

### Custom createPrompt with live preview (chosen)
Build a custom prompt using `@inquirer/core`'s `createPrompt`, returning a `[content, bottomContent]` tuple. The checkbox list is `content` (cursor stays here), the colored plan display is `bottomContent` (recomputed on each toggle). A `preview` callback supplies the domain-specific rendering.
- **Pros:** True live-updating plan display during selection. Uses the documented `[content, bottomContent]` API of ScreenManager. Reusable `checkboxWithPreview` module.
- **Cons:** Must maintain checkbox logic (~100 lines adapted from @inquirer/checkbox). Adds `@inquirer/core`, `@inquirer/ansi`, `@inquirer/figures` as direct dependencies.

## Decision

Custom `checkboxWithPreview<T>` prompt in `src/lib/terminal/checkbox-with-preview.ts`, built on `createPrompt` with `[content, bottomContent]` tuple. The delete command supplies a `preview` callback that renders the colored table, template diffs, and at-risk warnings from the currently-checked assessments. The prompt clears on completion (`clearPromptOnDone: true`), then the existing static plan display and confirmation flow runs.

## Reasoning

The "visibility" principle (GUIDELINES.md) requires that users always know the exact state of what they're about to modify. A live-updating plan display during selection gives immediate feedback — the user sees exactly what will be deleted, including template diffs and at-risk warnings, as they toggle each workspace. The `[content, bottomContent]` tuple is a documented feature of `@inquirer/core`'s ScreenManager, not a hack.

The checkbox logic from `@inquirer/checkbox` is small (~100 lines) and uses only public hooks from `@inquirer/core`. Maintaining it is low-risk. The generic `checkboxWithPreview` interface (`preview: (selected: T[]) => string`) separates prompt mechanics from domain rendering, making it reusable for future commands.

The `--yes` flag and non-TTY mode skip the interactive picker entirely, preserving scripting behavior.

## Consequences

- `--where` and `--all-safe` now have a live-updating interactive selection in TTY mode. The plan display (table, template diffs, at-risk warnings) updates instantly as checkboxes are toggled.
- `--yes` skips both the picker and confirmation, keeping CI/scripting workflows unchanged.
- `@inquirer/core`, `@inquirer/ansi`, and `@inquirer/figures` are now direct dependencies (were previously transitive via `@inquirer/checkbox`).
- The `checkboxWithPreview` module can be reused by other commands that need selection with live feedback.
