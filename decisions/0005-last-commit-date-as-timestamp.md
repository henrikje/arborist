# Last Commit Date as Workspace Timestamp

Date: 2026-02-17

## Context

When running `arb list`, users had no temporal context — a workspace could be from yesterday or three months ago. A timestamp helps gauge staleness and decide which workspaces to clean up. The question was which timestamp to show and where it comes from.

## Options

### Last commit date (per-workspace, across repos)
The date of the most recent commit on the feature branch across all repos in the workspace, via `git log -1 --format=%aI`.
- **Pros:** Pure git data — no state persistence needed. Semantically meaningful (reflects when work last happened). Works retroactively on all existing workspaces. Cannot become stale or out of sync.
- **Cons:** Doesn't distinguish "old commits, recently rebased" from "genuinely stale." For workspaces with no commits ahead of base, shows the base branch's latest commit date.

### Workspace creation date
A `created = <ISO timestamp>` line written to `.arbws/config` at creation time.
- **Pros:** Directly answers "how old is this workspace?"
- **Cons:** Requires persisted state. Not available for existing workspaces. Doesn't reflect activity.

### Last fetch/sync timestamp
A `lastSync` value written after each fetch/pull.
- **Pros:** Shows how stale remote tracking refs are.
- **Cons:** Requires persisted mutable state. Every fetch/pull must write state. Not available retroactively. Doesn't reflect work activity.

### Filesystem mtime of `.arbws/config`
Use the config file's modification time as a proxy.
- **Pros:** Zero code changes for storage. Available for all existing workspaces.
- **Cons:** Fragile — any config edit updates mtime. OS-dependent. Not semantically meaningful.

### Combined (last commit + creation date)
Show both timestamps.
- **Pros:** Maximum information.
- **Cons:** Two columns consume significant table width. Creation date has the retroactivity problem. More complexity for marginal benefit.

## Decision

Last commit date (Option A), displayed as relative time in TTY mode and ISO 8601 in `--json` output.

## Reasoning

Last commit date aligns with every architectural principle: git as source of truth (derived from `git log`, no state files), filesystem as database (no new persistence), retroactive (works on every existing workspace immediately), and actionable (a workspace whose last commit was 3 months ago is clearly a cleanup candidate).

The concern about not distinguishing "old commits, recently rebased" is acceptable because: rebase preserves author dates (the timestamp still reflects when work happened), and the existing status model already shows `behind base` for staleness relative to main. The timestamp serves a different purpose: "when did I last actively work on this feature?"

## Consequences

The LAST COMMIT column appears in `arb list`, `arb status` summary, and `arb remove` assessment. The value is computed as the maximum author date across all repos' HEAD commits. Relative time formatting ("3 days ago", "2 months ago") is implemented as a small utility with no external dependencies. No persistent state was added to `.arbws/config`.
