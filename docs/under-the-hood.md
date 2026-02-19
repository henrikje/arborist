# How it works

Arb uses marker directories and Git worktrees — no database, no daemon, no config outside the arb root.

`arb init` creates an `.arb/` marker at the root. Every other command finds its context by walking up from the current directory.

```
~/my-project/
├── .arb/
│   └── repos/
│       ├── frontend/            # canonical clone
│       ├── backend/
│       └── shared/
├── fix-login/
│   ├── .arbws/
│   │   └── config               # branch = fix-login
│   ├── frontend/                # git worktree → .arb/repos/frontend
│   └── backend/
└── dark-mode/
    ├── .arbws/
    │   └── config               # branch = feat/dark-mode
    ├── frontend/
    └── shared/
```

The canonical repos in `.arb/repos/` are kept in detached HEAD state. Git requires that no two worktrees share the same checked-out branch, so the canonical clone steps aside to let workspaces own the branches.

Each workspace has a `.arbws/config` file that records the branch name (and optionally a base branch):

```ini
branch = fix-login
```

Arb auto-detects each repo's default branch by checking the upstream remote's HEAD ref (e.g. `refs/remotes/origin/HEAD` for single-remote repos, `refs/remotes/upstream/HEAD` for forks), falling back to the repo's local HEAD. Each repo resolves independently, so `main`, `master`, and `develop` can coexist across repos in the same workspace. To override a workspace's base branch explicitly, add it to the config:

```ini
branch = fix-login
base = develop
```

Arborist does not record which repos belong to a workspace — it simply looks at which worktree directories exist inside it. If you `rm -rf` a single repo's worktree, arb will stop tracking it for that workspace. Git's internal worktree metadata is cleaned up automatically by `arb remove` or `git worktree prune`.
