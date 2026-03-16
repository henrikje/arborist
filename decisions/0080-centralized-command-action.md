# Centralized Command Action Wrapper

Date: 2026-03-16

## Context

Every command manually resolved the arb project context (`getCtx()`), created a `GitCache`, and optionally loaded/saved the `AnalysisCache`. This was repetitive across 22+ commands, error-prone (easy to forget cache saving), and made adding cross-cutting concerns (like the analysis cache) require touching every command file. The `getCtx` callback was passed from `index.ts` to each `register*Command()` function, adding a parameter that every command had to thread through.

## Options

### arbAction() wrapper function
A wrapper that each command's `.action()` uses. It resolves the arb root, creates `GitCache`, loads `AnalysisCache`, runs the command, and saves the cache in a `finally` block. Commands without context (init, help) don't use the wrapper.

- **Pros:** Single place for cross-cutting concerns, eliminates `getCtx` callback, automatic cache lifecycle, explicit opt-out.
- **Cons:** Every command file changes, `any[]` boundary with Commander's untyped args.

### Commander preAction/postAction hooks
Global hooks on the program object that create/save shared state.

- **Pros:** Minimal diff.
- **Cons:** Global mutable state, unreliable async `postAction`, no compile-time distinction between "has context" and "doesn't have context".

## Decision

arbAction() wrapper function. Commands that need project context use `arbAction()`. Commands that don't (init, help) use plain action handlers. Commands with `--schema` (which should work without a project) handle the schema flag before invoking `arbAction()`.

## Reasoning

The wrapper makes the lifecycle explicit at each command's registration site. The `CommandContext extends ArbContext` type means existing library code that accepts `ArbContext` works unchanged. The `any[]` boundary matches Commander's own type safety level — Commander doesn't enforce typed args at the framework level.

The `--schema` flag is handled as a pre-check outside the wrapper because schema printing doesn't need project context. This is the same pattern as init/help — an explicit opt-out from context resolution.

## Consequences

- `getCtx()` callback is eliminated from `index.ts` and all command registration signatures.
- Adding new cross-cutting concerns (telemetry, diagnostics, etc.) requires changes only in `arbAction()`, not in every command.
- `CommandContext` is the standard type for command action handlers, carrying `cache` and `analysisCache` alongside the arb root info.
- Commands with `--schema` have a slightly more complex action structure (outer async function with schema check, inner arbAction call).
