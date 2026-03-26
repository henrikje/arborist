# Remove the diff command

Date: 2026-03-26

## Context

DR-0023 introduced `arb diff` as the third overview command alongside `status` and `log`, forming a coherent triad. The command shows the cumulative diff of the feature branch since diverging from the base branch across all repos, with TTY, pipe, and JSON output modes.

After using the command in practice, the value proposition turned out to be thin. In a workspace with multiple repos, the full diff across all repos is overwhelming and rarely useful — developers diff interactively in their editor or one repo at a time. The `--stat` summary mode was the most useful output, but it remains a thin wrapper around `git diff --stat` with merge-base resolution.

## Options

### A: Remove `arb diff` entirely

Users who need the diff use `arb exec -- git diff --stat $(git merge-base origin/main HEAD)` or work in individual repos.

- **Pros:** Maximum surface area reduction (~500 lines of command code, ~587 lines of integration tests). Simplifies the overview layer. One fewer command to learn, document, test, and maintain.
- **Cons:** Breaks the "overview triad" from DR-0023. Loses cross-repo summary stats and JSON output.

### B: Fold diff into `arb log --diff`

Add a `--diff` flag to `arb log` that shows per-commit patches or cumulative diffstat.

- **Pros:** Retains some diff capability.
- **Cons:** Cumulative changeset and per-commit patches are fundamentally different operations. Expands log's scope beyond its core question, violating "do one thing well." `--verbose` already shows per-commit changed files.

### C: Keep `arb diff` (status quo)

No changes.

- **Pros:** The triad remains complete.
- **Cons:** Maintaining a command with thin value.

## Decision

Option A: remove `arb diff` entirely.

## Reasoning

The "Evaluating new operations" framework in GUIDELINES.md asks: "Would `arb exec` leave users meaningfully worse off?" For diff, the answer is no. The command does not involve conflict prediction, divergence analysis, plan/confirm flows, or state machines — the hallmarks of commands that earn their place per the "Minimal, semantic CLI" principle. Its only meaningful coordination value is merge-base resolution, which is a single well-known git command.

Option B was rejected because grafting cumulative-diff semantics onto `arb log` creates conceptual confusion. If the command does not earn its place as a standalone, attaching it to another command does not change that.

## Consequences

- The overview command layer is now `status` and `log`. GUIDELINES.md references are updated accordingly.
- DR-0023 remains unchanged as a historical record. Its reasoning about the authoring boundary (`arb commit`, `arb pr`) still holds; only the diff inclusion is reversed.
- DR-0031 (diff merge-base against working tree) is now historical context with no active code.
- Users who relied on `arb diff --json` for scripting need to adapt. This is acceptable during pre-release per "Prefer correctness over backwards compatibility."
