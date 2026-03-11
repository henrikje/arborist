# Remove ticket detection column from arb list

Date: 2026-03-11

## Context

Decision [0048](0048-external-tool-detection.md) introduced convention-based detection of both PR numbers and ticket keys from local git data. Ticket detection extracts JIRA/Linear-style keys (e.g. `PROJ-208`) from branch names and commit messages via regex, displaying them in a conditional TICKET column in `arb list` and in `--json` output.

In practice, the regex pattern (`[A-Z][A-Z0-9]+-\d+`) matches any `WORD-NUMBER` combination, producing a high false positive rate. Real-world example from a 13-workspace project: all 3 detected tickets were wrong — `AUTOFIX-2` (branch naming convention), `SHA-256` (hash algorithm in commit messages), and `NODE-20` (Node.js version reference). The blocklist approach (only `PR` and `MR` blocked) cannot scale to cover all non-ticket prefixes.

When ticket detection does work correctly, the ticket key is already visible in the WORKSPACE and BRANCH columns, making the TICKET column redundant.

PR detection, by contrast, matches specific machine-generated commit message formats from GitHub, Azure DevOps, Bitbucket, and GitLab — these have no false positive risk.

## Options

### A: Remove ticket detection column entirely

Delete the TICKET column from `arb list`, the `detectedTicket` field from JSON output, the `detectTicketFromCommits` function, and the `pickMostCommonTicket` helper. Keep `detectTicketFromName` because it is used by PR detection as a fallback (finding PR numbers via ticket-referenced commits on base).

- **Pros:** Eliminates all false positives. Removes ~57 LOC implementation + ~194 LOC tests. Cleaner output.
- **Cons:** Breaking change for `--json` consumers that read `detectedTicket`. Users who relied on the column lose it.

### B: Improve heuristics (bigger blocklist, minimum prefix length)

Add more blocked prefixes, require 3+ letter prefixes, or other heuristics.

- **Pros:** Reduces some false positives while keeping the feature.
- **Cons:** Whack-a-mole — the pattern `WORD-NUMBER` is too common. Even with improvements, the column is redundant with the branch name.

### C: Make ticket detection opt-in via config

Keep the code but disable by default.

- **Pros:** No false positives by default.
- **Cons:** Added config surface for a feature that provides no information beyond what the branch name already shows.

## Decision

Option A. Remove the ticket detection column and all supporting code. Keep `detectTicketFromName` for PR detection fallback.

## Reasoning

The fundamental problem is that `WORD-NUMBER` patterns are ubiquitous in software — version numbers (`NODE-20`), hash algorithms (`SHA-256`), feature suffixes (`AUTOFIX-2`). No reasonable blocklist or heuristic can distinguish these from real ticket keys without external context (API calls or user configuration). A 100% false positive rate in real usage is worse than no detection at all — it erodes trust in arb's output.

The TICKET column was intended to answer "what ticket is this workspace for?" but the answer is already visible in the branch name. PR detection answers a genuinely different question ("which PR merged this?") using machine-generated patterns with near-zero false positive risk — a fundamentally different reliability profile.

## Consequences

- The `detectedTicket` field is removed from `WorkspaceSummary`, `StatusJsonOutputSchema`, and `ListJsonEntrySchema`. This is a breaking change for `--json` consumers.
- The `detectTicketFromCommits` function and `pickMostCommonTicket` helper are deleted.
- `detectTicketFromName` remains exported from `status/` for use by PR detection fallback in `gatherRepoStatus`.
- `arb list` no longer shows a TICKET column under any circumstances.
- If authoritative ticket detection is needed in the future, it should use API-based lookup (option C from [0048](0048-external-tool-detection.md)) rather than regex heuristics.
