# Escape to Cancel Background Fetch

Date: 2026-02-28

## Context

Dashboard commands (`status`, `list`) and `branch --verbose` use phased rendering: stale data appears instantly on stderr while a background fetch runs, then fresh data replaces it on stdout. During the 1–5s fetch wait, the user has already read the stale output and may want to move on. The only options were Ctrl-C (kills the process — nothing on stdout, breaks piping) or `--no-fetch` (must be planned ahead).

Content commands (`log`, `diff`) fetch only when `--fetch` is explicitly given, and block before showing any output. There is no stale data to fall back to, so cancellation semantics don't apply there.

Mutation commands (`push`, `rebase`, `merge`) use post-fetch assessment to determine safety. Operating on stale refs could cause force-pushes to wrong branches or rebases onto stale bases.

## Options

### Escape-to-cancel with raw mode listener

New `listenForAbortKeypress()` utility enables raw stdin mode, listens for standalone Escape (`0x1b`), and fires an `AbortSignal`. The signal is passed to `parallelFetch`, which kills in-flight git processes. The cached stale table is written to stdout as final output. A dim `<Esc to cancel>` hint appears in the fetch suffix line.

- **Pros:** Solves the exact problem. Safe (read-only). Clean exit with stdout output. Escape is universally understood as "cancel." Follows existing AbortController pattern in `parallelFetch`.
- **Cons:** Raw mode adds terminal state risk (mitigated by cleanup in `try/finally` + `process.on("exit")`). Escape detection requires distinguishing standalone `0x1b` from escape sequences (handled by `data.length === 1` heuristic).

### Background process detach

Fork the fetch to a background process, exit CLI immediately with stale data. Background process updates refs for next run.

- **Pros:** Fetch still happens (refs stay fresh). User gets prompt back without pressing anything.
- **Cons:** Much more complex. Background process can fail silently. Git lock contention if user runs another command. No failure reporting. No precedent in codebase.

### Do nothing

Rely on `--no-fetch` or Ctrl-C.

- **Pros:** Zero risk. No new code.
- **Cons:** Ctrl-C produces no stdout output (breaks piping). `--no-fetch` requires forethought.

## Decision

Escape-to-cancel with raw mode listener, scoped to dashboard commands (`status`, `list`) and `branch --verbose` — the commands that use phased rendering with a visible stale-data phase.

## Reasoning

The stale data shown in Phase 1 is the same data `--no-fetch` would produce. Pressing Escape says "cancel the fetch, I've seen enough." This is a natural, low-stakes interaction for read-only commands. The worst outcome is slightly staler data — no mutations, no data loss. This aligns with the "safety first" principle from GUIDELINES.md.

Escape was chosen over Enter because it's universally understood as "cancel/dismiss," has no other meaning during passive output, and avoids confusion with Enter-as-confirm. The angle-bracket hint (`<Esc to cancel>`) follows keyboard shortcut label conventions and is rendered dim to stay non-intrusive.

Mutation commands are explicitly excluded — they rely on fresh refs for safety assessments, and operating on stale data could cause harm. Content commands (`log`, `diff`) don't use phased rendering when fetching, so there's no stale data to fall back to.

## Consequences

Users can press Escape during the fetch wait to get stale data on stdout and return to their shell. Ctrl-C continues to work as before (kills process, no stdout). `--no-fetch` is unchanged. Non-TTY/piped contexts are unaffected (the keypress listener is a no-op when `process.stdin.isTTY` is false).

The `listenForAbortKeypress` utility is generic and could be reused for other interruptible waits, though extending to mutation commands would require careful analysis of safety implications. The raw-mode pattern introduces a new concept ("interruptible phases") to the codebase.
