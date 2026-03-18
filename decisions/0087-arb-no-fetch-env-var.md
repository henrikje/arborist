# ARB_NO_FETCH Environment Variable

Date: 2026-03-18

## Context

Users who routinely want to skip automatic fetching — CI pipelines, offline work, slow networks, scripting — must pass `-N`/`--no-fetch` to every command. This is tedious and error-prone. The `NO_COLOR` convention demonstrates that environment variables are the standard way to globally suppress a default CLI behavior.

Arborist already uses environment variables for similar opt-outs (`ARB_NO_UPDATE_CHECK`, `ARB_DEBUG`). A global fetch-suppression variable is a natural extension.

## Options

### Option A: `ARB_NO_FETCH` — any non-empty value

Follow the `NO_COLOR` convention: any non-empty string activates it (`ARB_NO_FETCH=1`, `ARB_NO_FETCH=true`, etc.).

- **Pros:** Matches the widely-adopted `NO_COLOR` convention. More forgiving — `export ARB_NO_FETCH=yes` works.
- **Cons:** Diverges from arb's existing `=== "1"` checks on `ARB_NO_UPDATE_CHECK` and `ARB_DEBUG`.

### Option B: `ARB_NO_FETCH=1` only

Match the existing arb convention: only the exact string `"1"` activates it.

- **Pros:** Internally consistent with existing env vars.
- **Cons:** Surprising to users familiar with `NO_COLOR`. `ARB_NO_FETCH=true` silently does nothing.

## Decision

Option A: `ARB_NO_FETCH` with any non-empty value, and align `ARB_NO_UPDATE_CHECK` and `ARB_DEBUG` to the same convention.

## Reasoning

The `NO_COLOR` convention is well-established and matches user expectations for boolean environment variables. Internal consistency matters, but it's better to fix the inconsistency across all three variables than to perpetuate a less-forgiving convention. Since arb is pre-release, this is a safe time to make the change. The `=== "1"` value continues to work, so existing users are not broken.

Explicit `--fetch` overrides `ARB_NO_FETCH`, following the same pattern as `status -q --fetch` (where quiet mode's no-fetch default is overridden by an explicit flag). `pull` is unaffected — it always fetches by design (GUIDELINES.md: "it inherently needs fresh remote state").

## Consequences

- `ARB_NO_FETCH` globally suppresses auto-fetch on all commands that fetch by default (status, list, branch verbose, push, rebase, merge, reset, delete, rename, create, attach, detach).
- `pull` is unaffected — it has no `--no-fetch` flag and always fetches.
- `log` and `diff` are unaffected — they already default to no-fetch.
- Explicit `--fetch` overrides the env var.
- `ARB_NO_UPDATE_CHECK` and `ARB_DEBUG` now accept any non-empty value (previously only `"1"`). Existing `=1` usage continues to work.
