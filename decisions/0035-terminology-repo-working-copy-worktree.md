# Three-Tier Terminology: repo, working copy, worktree

Date: 2026-02-25

## Context

Arborist manages three distinct concepts: canonical repos (permanent clones in `.arb/repos/`), workspace-level directories (what users work in daily), and the Git worktree mechanism that makes workspace directories possible. The codebase inconsistently used both "worktree" and "repo" for workspace-level directories — "repo" dominated CLI output, column headers, JSON, summary lines, and error messages, while "worktree" appeared in help text descriptions, the template variable API (`workspace.worktrees`, `worktree.name`), and some info messages. CLI arguments like `[repos...]` and `--repo` were consistently "repo" but these are about repo selection, which is correct regardless of terminology.

## Options

### "repo" everywhere, hard rename

Use "repo" consistently for workspace-level directories in all user-facing surfaces. Reserve "worktree" for Git mechanism references only. Introduce "working copy" for conceptual/introductory prose where precision matters. Hard rename template variables with no backwards compatibility.

- **Pros:** Matches the dominant existing pattern; matches how developers think ("I want to push frontend"); simpler mental model; pre-1.0 status makes breaking changes acceptable per GUIDELINES.md
- **Cons:** Technically imprecise (workspace directories are Git worktrees, not repos); template authors must update `.arbtemplate` files (one-time cost)

### "worktree" everywhere

Use "worktree" consistently for workspace-level directories. Use "repo" only for canonical repos.

- **Pros:** Technically precise; clean separation between canonical repos and workspace instances
- **Cons:** Massive change against the grain of the codebase; "worktree" is Git jargon many developers don't know; awkward phrasing ("Pushed 3 worktrees", `--all-worktrees`)

### Keep split as-is

Fix only the most jarring inconsistencies but preserve the mixed vocabulary.

- **Pros:** Minimal change; no breaking changes
- **Cons:** Template authors see different vocabulary than CLI users; doesn't resolve the conceptual split for contributors

## Decision

Three-tier vocabulary: "repo" for operational/terse contexts (CLI output, summaries, help text, messages, template variables, column headers, arguments), "working copy" for conceptual/introductory prose (explaining what workspace directories are), and "worktree" reserved for the Git mechanism only (internal code calling `git worktree`, `worktreeKind` status field, "under the hood" docs).

## Reasoning

"repo" already dominated the codebase — column headers, messages, JSON output, the entire CLI surface said "repo". The inconsistency was that help text prose and templates sometimes said "worktree" instead. Aligning to the dominant pattern was the path of least resistance. Developers think in terms of repos, not worktrees — the worktree is an implementation detail that Arborist manages for them.

"working copy" fills the precision gap in conceptual prose. Calling workspace directories "repos" creates potential ambiguity with canonical repos in introductory text. "Working copy" is precise without being nerdy — it immediately communicates "an editable instance of a repository." But it's too verbose for operational text ("No working copies match the filter" is clunky; "No repos match the filter" is crisp), so its use is limited to definitional/explanatory text like the README mental model section and the daily-use guide opening.

Pre-1.0 is the right time for this change. GUIDELINES.md says "prefer correctness over backwards compatibility" during pre-release. The only breaking change is the template variable rename (`workspace.worktrees` → `workspace.repos`, `worktree.*` → `repo.*`), which is a straightforward find-and-replace for template authors.

## Consequences

- Template variable API changed: `workspace.repos` (was `workspace.worktrees`), `repo.name`/`repo.path`/`repo.baseRemote`/`repo.shareRemote` (was `worktree.*`). Template authors must update existing `.arbtemplate` files.
- Internal type renamed: `RepoInfo` (was `WorktreeInfo`), `repoName`/`repoPath` (was `worktreeName`/`worktreePath`) in `TemplateContext`.
- All help text and documentation now uses "repo" for workspace-level directories, "working copy" in introductory prose, and "worktree" only for Git mechanism descriptions.
- Future features should follow this three-tier vocabulary. When writing help text or messages about workspace directories, use "repo". When explaining the concept to new users, use "working copy". When describing Git internals, use "worktree".
- Files like `worktrees.ts`, `clean.ts`, and `worktreeKind` in status types remain unchanged — they describe the Git mechanism.
