# Positive filter terms and negation prefix for --where

Date: 2026-02-24

## Context

All 13 `RepoFlags` represent negative/problem conditions (isDirty, isUnpushed, needsRebase, etc.), and all 15 `--where` filter terms select repos that *have* a problem. There is no way to express "show me repos that are clean" or "show me workspaces that are up-to-date with their base." The motivating example: finding all worktrees that are equal with their base branch — today you can find worktrees that are *behind* base (`--where behind-base`) but not worktrees that are synced.

Positive states are the absence of attention-worthy conditions — trivially derived from existing flags. No new `RepoFlags` are needed (GUIDELINES.md says flags represent "conditions that need attention"). The right place for positive terms is `FILTER_TERMS`, not `RepoFlags`.

## Options

### A: Named positive filter terms (curated subset)

Add named terms to `FILTER_TERMS` for the most useful counter-statuses: `clean`, `pushed`, `synced-base`, `synced-share`, `synced`, `safe`. Each is a one-liner derived from existing flags.

- **Pros:** Readable and discoverable. `--where clean` reads better than any negation syntax. Composite terms like `safe` and `synced` combine multiple flags into meaningful concepts. Shows up in `--help` and validation errors.
- **Cons:** Only covers curated terms — you can't negate arbitrary terms. Grows the term list from 15 to 21. Each new term is a naming decision.

### B: `^` negation prefix on existing terms

Support `^` prefix on any term: `--where ^dirty`, `--where ^at-risk`. Shell-safe (no quoting needed), has negation precedent in regex and git.

- **Pros:** Covers all 15 terms automatically with zero naming decisions. Composable: `^dirty+^unpushed` means "clean AND pushed."
- **Cons:** Can't express composite positive concepts like "safe" (would need `^at-risk`). Less discoverable — doesn't show up in `--help` term lists.

### C: Both — named positive terms + `^` negation

Add curated positive terms from A, and also support `^` negation for generality.

- **Pros:** Named terms for common cases (`--where safe`), negation for rare one-offs (`--where ^shallow`). Best of both discoverability and coverage.
- **Cons:** Two ways to express the same thing (`safe` vs `^at-risk`). Larger surface area to document and test.

### D: `no-` prefix instead of `^`

Use `no-` instead of `^`: `--where no-dirty`. Consistent with existing `--no-fetch` convention.

- **Pros:** Natural English. No shell escaping.
- **Cons:** Verbose (`no-behind-base` is awkward). Conflicts with potential future terms starting with `no-`. Still misses composite positive concepts.

## Decision

Option C: named positive filter terms plus `^` negation prefix.

## Reasoning

Named terms address the common use cases with readable, discoverable names. `--where clean` and `--where safe` are immediately clear, appear in `--help` output and validation error messages, and can express composite conditions (`safe` = no at-risk flags) that negation alone can't express concisely. The `^` prefix provides complete coverage for any term without a named positive counterpart, following the existing convention of shell-safe operator symbols (`+` for AND, `,` for OR, `^` for NOT). Decision record 0006's principle of named terms tied to the canonical flag model is preserved — `^` is a syntax feature, not a new term class.

The `no-` prefix (Option D) was rejected because `no-behind-base` reads poorly and the prefix could conflict with future terms. `^` is concise, shell-safe, and has clear negation precedent in both regex (`[^abc]`) and git (`^commit`).

## Consequences

- `FILTER_TERMS` grows from 15 to 21 entries. `VALID_TERMS` auto-updates and lists all terms in error messages, aiding discoverability.
- `^` can be applied to any term, including positive terms (`^clean` = `dirty`). Double-negation (`^^dirty`) is caught by validation as an unknown term.
- No changes to `RepoFlags`, `computeFlags`, `FLAG_LABELS`, or display code. Positive states remain derived, not stored.
- Additional positive terms (e.g. `active` for unmerged branches) can be added later as one-liners in `FILTER_TERMS` if demand arises.
