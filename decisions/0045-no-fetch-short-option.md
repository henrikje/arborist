# Short Option for --no-fetch

Date: 2026-02-28

## Context

Decision 0003 (fetch-by-default for mutations) and 0042 (auto-fetch for dashboard commands) shifted the balance of fetch flag usage: 6 of 8 fetch-flag commands now fetch by default (status, list, push, rebase, merge, rebranch), while only log and diff don't. The `-F` short option for `--fetch` was mostly redundant on the 6 commands where fetching is the default. Meanwhile, `--no-fetch` — the opt-out action — had no short option despite being the more commonly typed flag. GUIDELINES.md justified this with "infrequent; short space is crowded," but that reasoning no longer held.

## Options

### Option A: Add `-N` for `--no-fetch`, keep `-F` for `--fetch`

Additive change — both directions get a short option.

- **Pros:** No breakage. Both directions have a shortcut.
- **Cons:** Two short options for one boolean feels heavy. `-F` is mostly redundant on the 6 commands that fetch by default.

### Option B: Replace `-F` with `-N` — swap the short option to the opt-out side

Remove `-F` from `--fetch`, add `-N` to `--no-fetch` across all 8 commands.

- **Pros:** One short option per boolean. The short option serves the more frequent action. Cleaner `--help` output.
- **Cons:** Breaking change for users who use `-F` on log or diff (the 2 commands where opt-in matters). Also breaks `-F` on `status -q` (where fetch is off by default in quiet mode).

### Option C: Add `-N`, remove `-F` only where redundant

Remove `-F` from the 6 fetch-by-default commands, keep it on log and diff. Add `-N` everywhere.

- **Pros:** Each command's short option points to the non-default direction.
- **Cons:** Inconsistent — some commands have both `-F` and `-N`, others only `-N`.

## Decision

Option B: replace `-F` with `-N` across all 8 commands.

## Reasoning

Pre-release policy (GUIDELINES.md line 47) explicitly permits breaking changes when a better approach is found. `-F` on the 6 fetch-by-default commands was dead weight — it duplicated the default. On log and diff, users can type `--fetch` (7 characters, infrequent action). The short option should serve the action people actually reach for: skipping the fetch when refs are known to be fresh. One short option per boolean is cleaner and easier to remember. `-N` is mnemonic for "No fetch" and follows the pattern of uppercase letters for fetch-related flags.

## Consequences

- Users who relied on `-F` for `arb log` or `arb diff` must switch to `--fetch`. This is a pre-release breaking change.
- `-N` becomes the universal shorthand for skipping the pre-fetch across all commands.
- `--fetch` remains available as the long form for opt-in on log, diff, and `status -q`.
- GUIDELINES.md updated to reflect the new assignment: `-N` is the short, `--fetch` has no short.
