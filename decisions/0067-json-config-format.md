# JSON config format with Zod validation

Date: 2026-03-09

## Context

Arborist stores workspace config (`.arbws/config.json`) and project config (`.arb/config.json`) in a home-grown INI format (`key = value` per line). The parser in `core/config.ts` exposes a string-based API (`configGet(file, key) → string | null`) with no schema validation and no type safety. Zod is already the single source of truth for JSON output contracts (decision 0046), making the untyped INI config an inconsistency.

## Options

### Format-only swap

Keep the string-based `configGet`/`writeConfig` API, change only the on-disk format from INI to JSON.

- **Pros:** Smallest diff, low risk.
- **Cons:** No schema validation, no type safety at call sites. JSON is just a format swap without leveraging Zod.

### Typed config API with Zod schemas

Replace the string-based functions with typed `readWorkspaceConfig`/`writeWorkspaceConfig` backed by Zod schemas. Derive TypeScript types via `z.infer<>`.

- **Pros:** Full type safety, runtime validation, consistent with the Zod convention from decision 0046. Eliminates fragile positional parameters in `writeConfig`.
- **Cons:** Larger diff — every call site needs updating. But the transformation is mechanical.

### Hybrid (typed internals, string-based wrappers)

Provide typed read functions internally but keep `configGet` as a backward-compatible wrapper.

- **Pros:** Minimal call-site changes.
- **Cons:** Two abstraction levels. No benefit in a pre-release codebase.

## Decision

Use the typed config API with Zod schemas. Migrate existing INI files to JSON transparently on first read.

## Reasoning

The "correctness over backwards compatibility" principle (GUIDELINES.md) allows changing the API freely during pre-release. The typed API eliminates a class of bugs (wrong key names, missing null checks) and makes config access self-documenting through TypeScript types. The Zod schemas catch invalid config at read time with clear error messages identifying the file and validation issues, replacing the previous behavior where corrupted config silently returned null for every key.

The ~25 call-site updates are mechanical (`configGet(file, "base")` → `readWorkspaceConfig(file)?.base`) and the "filesystem as database" principle is preserved since JSON is equally inspectable.

## Consequences

- Config files are JSON with 2-space indent. `WorkspaceConfig` has `branch` (required), `base`, `branch_rename_from`, `workspace_rename_to` (optional). `ProjectConfig` has `defaults` (optional string array).
- Legacy INI files are auto-migrated to JSON on first read, then rewritten in place. No user action required.
- Invalid or corrupted config files now throw `ArbError` with a message identifying the file and validation issues, instead of silently returning null.
- The `configGet`, `configGetList`, `configSetList`, and `writeConfig` functions are removed. All config access uses the typed API.
