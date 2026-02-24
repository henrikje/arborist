# Rename Remote Role `upstream` to `base` and `baseDir` to `arbRootDir`

Date: 2026-02-24

## Context

Arborist's two-layer naming used different terms for the same axis: the remote role was called `upstream` in `RepoRemotes`, but the status section was called `base` in `RepoStatus`. Decision 0009 (publish to share) had already unified the sharing axis so both layers used `share`. The integration axis remained split: developers had to remember that the role `upstream` corresponded to the status section `base`.

Separately, `ArbContext.baseDir` referred to the arb root directory (the directory containing `.arb/`). Once `base` also became the integration remote role name, `baseDir` would be ambiguous.

## Options

### Rename role to `base` (full alignment)

Both layers use `base`/`share`. Eliminates the two-layer terminology. Follows the precedent of decision 0009. Pre-1.0 "prefer correctness over compatibility" principle applies.

- **Pros:** Simpler mental model. Variable names (`baseRemote`) are descriptive. GUIDELINES.md terminology section simplifies.
- **Cons:** Mechanical rename across ~500 occurrences in source, tests, and docs. The `baseDir` rename adds another ~300 occurrences.

### Keep `upstream`/`share` (status quo)

Matches existing GUIDELINES.md conventions. "Upstream" is familiar git terminology for fork workflows.

- **Pros:** Zero effort. Documented and working.
- **Cons:** Perpetuates cognitive overhead. Inconsistent with the sharing axis.

## Decision

Rename the remote role from `upstream` to `base` in `RepoRemotes` and all derived code. Rename `ArbContext.baseDir` to `ArbContext.arbRootDir` and `base-dir.ts` to `arb-root.ts`.

The `--upstream` CLI flag stays unchanged (it describes the git-level action of adding a remote named "upstream", not the derived role). The git remote name `"upstream"` in detection logic stays unchanged. The `RepoListJsonEntry.upstream` field becomes `base` (breaking change, acceptable pre-1.0).

## Reasoning

The rename is mechanical and type-driven: changing the `RepoRemotes` interface and `ArbContext` interface causes TypeScript to flag every missed access. The precedent from decision 0009 shows that aligning terminology across layers reduces confusion. GUIDELINES.md principle 9 ("prefer correctness over backwards compatibility") supports making this change before 1.0.

Renaming `baseDir` to `arbRootDir` was necessary to disambiguate: with `base` now meaning the integration remote role, `baseDir` could be confused with a directory related to the base remote. `arbRootDir` is precise and unambiguous.

## Consequences

Both layers now use `base`/`share` consistently. The GUIDELINES.md terminology section is simpler. New contributors learn one set of terms.

The `RepoListJsonEntry` JSON contract changes from `upstream` to `base`. Any external scripts parsing `arb repo list --json` must update. This is acceptable pre-1.0.

The CLI flag `--upstream` remains, which may cause brief confusion ("why is the flag called --upstream but the role is base?"). The flag describes a git action (adding a remote named "upstream"), not a role assignment. This distinction is documented in fork-workflows.md.
