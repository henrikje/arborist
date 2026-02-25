# Exception-based exit handling

Date: 2026-02-25

## Context

Every error path in commands and library code called `process.exit()` directly. This worked but had two problems: (1) commands were untestable in-process because `process.exit()` terminates the entire runtime, and (2) exit handling was scattered across dozens of call sites with no centralized control — making it easy for new code to exit without cleanup or with inconsistent exit codes.

## Options

### Keep process.exit() at each call site
Continue the existing pattern. Each error path calls `error()` then `process.exit(1)`.
- **Pros:** Simple, no new abstractions.
- **Cons:** Untestable without mocking globals. Exit logic is duplicated. No way to add centralized cleanup or logging later.

### Exception-based exit with centralized handler
Replace `process.exit()` with `throw new ArbError(msg)` for errors (exit 1) and `throw new ArbAbort()` for user cancellations (exit 130). A single try/catch in `index.ts` maps exceptions to exit codes.
- **Pros:** Commands become testable by catching exceptions. Single place controls exit behavior. Consistent exit codes by construction.
- **Cons:** Requires a convention that every throw site also calls `error()` for user-facing output, since the top-level handler does not print ArbError messages.

### Return result types
Commands return `{ ok: true }` or `{ error: "message" }` and the caller decides whether to exit.
- **Pros:** Explicit control flow, no exceptions.
- **Cons:** Requires threading result types through every function. Verbose. Doesn't compose well with Commander's action handler signature.

## Decision

Use exception-based exit handling with `ArbError` and `ArbAbort` classes, caught by a single top-level handler in `index.ts`.

## Reasoning

The exception approach gives centralized exit control with minimal disruption to existing code. Each `process.exit(1)` becomes `throw new ArbError(msg)` — a mechanical, one-line change. The Commander action handler signature stays the same. The top-level handler is the only place that calls `process.exit()`, making exit behavior easy to audit and extend.

The convention is: call `error()` (or `warn()`) for user-facing output, then throw for control flow. The top-level handler never prints the `ArbError` message — it only maps the exception type to an exit code. This keeps output formatting in the command layer where it belongs.

`ArbAbort` exists as a separate class because user cancellations (Ctrl-C, declining a prompt) are not errors — they exit 130 (per Unix convention) and print "Aborted." via `info()`, not `error()`.

## Consequences

Commands and library functions can be tested by asserting that they throw `ArbError` or `ArbAbort`, without mocking `process.exit()`. The top-level handler is the single place to add future cleanup logic (temp file removal, lock release). New code must follow the convention: always call `error()` before `throw new ArbError()` so the user sees a message. The `SIGINT` handler still calls `process.exit(130)` directly because signal handlers cannot throw into an async context. See "Exception-based exit handling" in GUIDELINES.md.
