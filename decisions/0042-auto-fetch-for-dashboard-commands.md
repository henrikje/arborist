# Auto-Fetch for Dashboard Commands

Date: 2026-02-27

## Context

A user ran `arb status` and saw stale data — it didn't show that the remote had new commits. After running `arb rebase` (which auto-fetches), declining the confirmation, and running `arb status` again, the correct state appeared. This is a UX paper cut: the most common "what's going on?" command was showing potentially misleading information.

Decision 0003 established the asymmetry: mutation commands fetch by default (stale data causes real damage), while overview commands do not (designed for speed). However, `status` and `list` already have two-phase/three-phase rendering that shows stale data instantly while fetch runs in the background, largely eliminating the latency concern.

## Options

### Fetch by default on status and list only

Change `status` and `list` to fetch by default. Leave `log` and `diff` as opt-in.

- **Pros:** Solves the reported problem with minimal change. Status and list are "dashboard" commands where freshness matters most. Two-phase rendering already ensures no perceived latency.
- **Cons:** Split convention between dashboard commands (status/list fetch) and content commands (log/diff don't). Offline users see fetch warnings on every `arb status`.

### Fetch by default on all overview commands

Change `status`, `list`, `log`, and `diff` to all fetch by default.

- **Pros:** Simple mental model — every command fetches. Eliminates the split convention.
- **Cons:** `log` and `diff` lack phased rendering — fetch would block the entire command, adding 1-3s of real latency. Adding phased rendering to them is complex since their entire output changes when base refs update.

### Staleness-based auto-fetch

Fetch automatically only when the last fetch was more than N seconds ago.

- **Pros:** Best of both worlds for performance and freshness.
- **Cons:** Adds hidden state, arbitrary thresholds, race conditions, and significant complexity. The two-phase rendering already makes always-fetch feel fast.

## Decision

Fetch by default on `status` and `list` only. Quiet mode (`-q`) skips fetching by default for scripting speed — pass `-F` explicitly to override. Non-TTY fetch failures warn and continue rather than aborting.

## Reasoning

Status and list are the commands users run to "check the state of things" — showing stale data there is genuinely misleading. The existing two-phase/three-phase rendering means users see instant results while fetch runs in the background, so there's no perceived latency increase.

Log and diff are content commands where users examine their own work. Stale base refs affect the commit range but are less confusing than stale behind/ahead counts in status. They also lack phased rendering, so fetching would block the entire command. This can be revisited if users report pain.

Quiet mode is designed for scripting (piping repo names, loops), where network latency on every invocation is unacceptable. Users who want fresh data in quiet mode can pass `-F` explicitly.

Non-TTY fetch failures now warn and continue (matching TTY behavior) instead of aborting. Aborting by default could break CI scripts that pipe `arb status -q`.

## Consequences

`arb status` and `arb list` now show fresh remote-tracking data without needing `-F`. The GUIDELINES.md "Universal fetch flags" section is updated to reflect a three-tier system: sync commands and dashboard commands fetch by default; content commands do not. Decision 0003's asymmetry still holds for log and diff. If users report stale data pain in log/diff, phased rendering can be added to those commands in a future change.
