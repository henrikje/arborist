# Operation Record and Recovery Model

Date: 2026-03-25

Supersedes: 0025-rebranch-migration-state.md

## Context

Arborist's multi-repo operations (rebase, merge, pull, retarget, branch rename, workspace rename, reset) can fail partway through — some repos succeed, others conflict or error. The original approach (DR-0025) used a config key (`branch_rename_from`) to track in-progress state, scoped only to branch rename.

This needed to generalize: every mutating multi-repo command needed tracking, recovery (continue after conflicts), and reversal (undo). The design questions were:

1. Where to store in-progress state (config vs. separate file)
2. How users resume after conflicts (auto-continue vs. explicit `--continue`)
3. How users cancel or reverse operations (`--abort` vs. `arb undo` vs. both)
4. What scope `arb undo` should cover (in-progress only, completed only, or both)

## Options

### Auto-continue (re-run the command)
Re-running the same command auto-detects the in-progress record and enters continue mode. No `--continue` flag. `arb undo` replaces `--abort`.
- **Pros:** Fewer flags. Simple mental model ("just re-run").
- **Cons:** Non-idempotent — same command does different things based on hidden state. `arb rename` (no args) silently continues instead of showing "missing argument" error. Violates git muscle memory.

### Explicit `--continue`, no `--abort` (arb undo only)
`--continue` flag for explicit resume. `arb undo` handles both abort and reversal.
- **Pros:** Explicit intent. Git-familiar `--continue`.
- **Cons:** Missing `--abort` is conspicuous when `--continue` exists. Users who type `arb rebase --abort` (from git habit) get an unhelpful "unknown option" error.

### Explicit `--continue` + `--abort`, scoped `arb undo` (completed only)
Per-command flags own the in-progress lifecycle. `arb undo` only reverses completed operations.
- **Pros:** Clean scope separation. No overlap.
- **Cons:** User must know whether the operation is in-progress or completed to pick the right tool. `arb undo` during in-progress gives a frustrating redirect.

### Explicit `--continue` + `--abort`, universal `arb undo` (chosen)
Per-command flags for explicit recovery. `arb undo` works for both in-progress and completed operations. `--abort` and `arb undo` overlap for in-progress operations — intentionally.
- **Pros:** Maximum discoverability. No wrong answer for the user. Git muscle memory works. Both recovery paths visible in `--help`.
- **Cons:** `--abort` duplicates `arb undo` for in-progress operations. But the duplication is intentional — it's "meet users where they are."

## Decision

Explicit `--continue` and `--abort` per command, with `arb undo` as a universal top-level command that works for both in-progress and completed operations.

State is stored in `.arbws/operation.json` (not in workspace config), validated by Zod on read and write.

## Reasoning

**Git alignment.** GUIDELINES §Align with Git: "A developer who knows Git should feel at home immediately." Git uses `--continue` and `--abort` on `rebase`, `merge`, `cherry-pick`. Arborist should mirror this. Auto-continue violates git muscle memory — when a git user sees "rebase in progress," they reach for `--continue`, not a bare re-run.

**The Schrödinger's command problem.** With auto-continue, `arb rename` (no args) does two completely different things depending on whether `.arbws/operation.json` exists. This is genuinely confusing and violates the principle that the same input should produce the same behavior. Explicit `--continue` eliminates this.

**`--abort` alongside `arb undo`.** When `--continue` exists, the absence of `--abort` is conspicuous. The recovery options should live on the command that caused the problem — the user shouldn't need to discover `arb undo` as a separate concept to cancel an operation. Both `--abort` and `arb undo` resolve to the same infrastructure, and accepting both is more helpful than refusing one on a technicality.

**Universal `arb undo`.** Scoping `arb undo` to completed-only would create a bad edge case: the user runs `arb undo` during an in-progress operation and gets "use `--abort` instead." The user's intent is clear — refusing it is pedantic. The overlap between `--abort` and `arb undo` is a feature, not a bug.

**Separate file, not config.** The operation record is transient state, not configuration. Storing it in `.arbws/config.json` (as DR-0025 did with `branch_rename_from`) conflates two concerns. A separate file makes the state inspectable, deleteable, and invisible to config readers.

## Consequences

- Every sync/rename command that writes an operation record also accepts `--continue` and `--abort`. Push and reset are excluded (no conflicts to continue from).
- Running a bare command during an in-progress operation is blocked with guidance mentioning `--continue` and `--abort`.
- `arb undo` is the universal escape hatch — works for in-progress (abort) and completed (reversal). Drift detection prevents accidental data loss.
- The `branch_rename_from` and `workspace_rename_to` config keys from DR-0025 are removed. The config schema is cleaner.
- The operation record file (`.arbws/operation.json`) is a new artifact that users may encounter. `arb undo --force` provides an escape hatch for corrupted records.
- The shared infrastructure (`continue-flow.ts`, `abort-flow.ts`, `operation.ts`) is reused by all commands — adding a new command type requires only a thin handler and an undo switch case.
