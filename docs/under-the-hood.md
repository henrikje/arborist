# How it works

Arb uses marker directories and Git worktrees — no database, no daemon, no config outside the project root.

## Filesystem layout

`arb init` creates an `.arb/` marker at the root. Every other command finds its context by walking up from the current directory.

```
~/my-project/
├── .arb/
│   ├── config.json              # project-level settings (e.g. default repos)
│   └── repos/
│       ├── frontend/            # canonical clone
│       ├── backend/
│       └── shared/
├── fix-login/
│   ├── .arbws/
│   │   └── config.json          # {"branch": "fix-login"}
│   ├── frontend/                # git worktree → .arb/repos/frontend
│   └── backend/
└── dark-mode/
    ├── .arbws/
    │   └── config.json          # {"branch": "feat/dark-mode"}
    ├── frontend/
    └── shared/
```

The canonical repos in `.arb/repos/` are kept in detached HEAD state. Git requires that no two worktrees share the same checked-out branch, so the canonical clone steps aside to let workspaces own the branches.

Each workspace has a `.arbws/config.json` file that records the branch name (and optionally a base branch):

```json
{
  "branch": "fix-login"
}
```

Arb auto-detects each repo's default branch by checking the upstream remote's HEAD ref (e.g. `refs/remotes/origin/HEAD` for single-remote repos, `refs/remotes/upstream/HEAD` for forks), falling back to the repo's local HEAD. Each repo resolves independently, so `main`, `master`, and `develop` can coexist across repos in the same workspace. To override a workspace's base branch explicitly, add it to the config:

```json
{
  "branch": "fix-login",
  "base": "develop"
}
```

Arborist does not record which repos belong to a workspace — it simply looks at which worktree directories exist inside it. If you `rm -rf` a single repo's worktree, arb will stop tracking it for that workspace. Git's internal worktree metadata is cleaned up automatically by `arb delete` or `git worktree prune`.

You can rename a workspace directory with a plain `mv`:

```bash
mv fix-login auth-fix
```

Arb detects the rename and silently repairs Git's internal worktree references the next time any command runs inside the workspace. No special command is needed — arb treats the filesystem as the source of truth.

## Commit matching

When you rebase, amend, or squash, Git creates new commits that replace old ones. The old and new commits have different hashes but represent the same work. Arborist matches them automatically so that status and plans show what's *genuinely new* versus what you've already seen.

The primary technique is **patch-id matching**. For each commit, arb computes a content-based hash of the diff (using `git patch-id --stable`) that is independent of commit metadata like author date or parent hash. If a local commit and a remote commit produce the same patch-id, they represent the same change — even if one is a rebased copy of the other.

For squash merges, where multiple commits become one, arb compares the cumulative diff of your local commits against the incoming squashed commit. If the combined content matches, your work is already reflected upstream.

When patch-id matching is insufficient — for example, when a branch has been rebased multiple times or when analyzing old merged branches — arb falls back to **reflog history**. It examines whether any commit the branch previously pointed to now appears in the remote's history, catching cases where the commit content was preserved but the structure changed.

This matching is what allows `arb push` to safely force-push after a rebase without requiring `--force`, and what lets `arb status` break down push/pull counts into "outdated" and "new" commits.

## Conflict prediction

Before a rebase, merge, or pull runs, arb predicts whether it will produce conflicts — and in which files — without modifying your working tree.

It does this using `git merge-tree --write-tree`, which performs a full three-way merge in memory and reports the result without touching any files. For a merge or pull, arb tests whether combining the incoming branch with your HEAD would conflict. For a rebase, it simulates each incoming commit individually, identifying which specific commits would conflict and listing the affected files.

The result appears in the plan before you confirm:

```
  api        rebase add-auth onto origin/main — 4 behind, 3 ahead (conflict unlikely) (autostash)
  payments   rebase fix-checkout onto origin/main — 6 behind, 2 ahead (conflict likely: README.md)
  shared     up to date
```

For repos with uncommitted changes, arb also predicts whether re-applying a stash after the operation would conflict, and suggests `--autostash` when it's safe.

The prediction runs in milliseconds per repo since it's a dry-run that reads Git's object store without writing anything. It requires Git 2.38+ — on older versions, arb skips the prediction and the operation proceeds without advance warning.

## Phased rendering

When `arb status` or `arb list` needs to fetch from remotes, it doesn't make you wait for the network.

Instead, arb renders in two phases. **Phase 1** displays a status table immediately using locally cached refs — whatever was last fetched. You see branch state, ahead/behind counts, and local changes right away. **Phase 2** runs the fetch in the background across all repos in parallel. Once fresh data arrives, arb re-gathers status and atomically replaces the Phase 1 output with the updated table.

The transition is seamless: the old table clears and the new one appears in place. There is no blank-screen gap — you always have content to read. If the fetch reveals that nothing changed, arb skips the re-render entirely.

In a workspace with many repos or a slow network, this means you get actionable information in milliseconds rather than waiting seconds for the fetch. Press Escape during the fetch phase to cancel it and keep the stale data.
