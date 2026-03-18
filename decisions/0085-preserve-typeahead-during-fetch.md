# Preserve Typeahead During Fetch

Date: 2026-03-18

## Context

Dashboard commands (`status`, `list`, `branch --verbose`) use phased rendering: stale data appears instantly on stderr while a background fetch runs, then fresh data replaces it on stdout. During the 1-5s fetch wait, users often start typing their next command. The previous implementation entered raw mode via `listenForAbortKeypress()` to detect the Escape key and suppress stray input from corrupting the output. Raw mode consumes characters from the kernel's tty input buffer — once read by the process, they are gone. On modern macOS (Darwin 22+), `TIOCSTI` is removed, so there is no way to re-inject consumed characters. The result: keystrokes typed during the fetch are lost.

## Options

### Keep raw mode with Escape detection (status quo)

Continue using `listenForAbortKeypress()` in raw mode. Escape cancels the fetch; all other characters are discarded.

- **Pros:** Escape-to-cancel works. Well-tested.
- **Cons:** Typeahead is lost. No workaround on modern systems since `TIOCSTI` is gone.

### Disable echo only (`stty -echo noflsh`) with SIGINT-based abort

Replace raw mode with `stty -echo noflsh`. Do not read from stdin at all — characters stay in the kernel buffer, invisible but preserved. Use a temporary SIGINT handler (Ctrl+C) to abort the fetch instead of raw-mode Escape detection.

- **Pros:** Typeahead is preserved. Fetch cancellation still works via Ctrl+C. No stdin reading means zero risk of consuming characters.
- **Cons:** Escape key no longer cancels (must use Ctrl+C). Requires `stty` subprocess calls (~5ms each).

### Shell integration bridge (file-based)

Keep raw mode but buffer non-special characters. On cleanup, write them to a temp file. A shell function wrapper reads the file after arb exits and injects characters into the readline buffer (`print -z` in zsh).

- **Pros:** Preserves both Escape detection and typeahead.
- **Cons:** Requires user shell setup. Full support limited to zsh. Fragile (stale files, timing).

## Decision

Disable echo only (`stty -echo noflsh`) with SIGINT-based abort. Dashboard commands use `suppressEcho()` for echo suppression and `listenForAbortSignal()` for Ctrl+C-based fetch cancellation. Mutation commands retain the existing raw-mode behavior.

## Reasoning

The fundamental constraint is that raw mode and typeahead preservation are mutually exclusive without `TIOCSTI`. On modern macOS, re-injection is not possible. The choice is between consuming characters (for Escape detection) and preserving them (for the shell).

Ctrl+C is a suitable replacement for Escape: it generates SIGINT at the kernel level without requiring stdin reads, is universally understood as "cancel," and the temporary SIGINT handler pattern cleanly aborts the fetch while preserving the option for a second Ctrl+C to use the normal kill-and-exit path. The `noflsh` flag prevents the kernel from flushing the input queue when SIGINT is generated, so typeahead survives even when Ctrl+C is pressed.

The scope is limited to dashboard commands where the user "glances and moves on." Mutation commands continue using raw mode — the user is waiting for a plan, and preserving typeahead could be harmful (a buffered 'y' could auto-confirm before the user reads the plan).

## Consequences

- Characters typed during the fetch phase survive and appear at the shell prompt after arb exits.
- Escape no longer cancels the fetch for dashboard commands. Ctrl+C replaces it with the same effect: cancel fetch, output stale data to stdout, exit cleanly.
- The hint text changes from `<Esc to cancel>` to `<Ctrl+C to cancel>`.
- `listenForAbortKeypress` (raw-mode Escape detection) is superseded by `listenForAbortSignal` (SIGINT-based) for dashboard commands. Decision 0047 is partially superseded: the Escape mechanism it introduced is replaced by Ctrl+C, but the cancellation concept and safety analysis remain valid.
- If a future macOS version restores `TIOCSTI` or provides an equivalent, the raw-mode approach could be revisited to support both Escape detection and typeahead preservation.
