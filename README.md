# Arborist (`arb`)

**Arborist** is a workspace manager that makes multi-repo development safe and simple.

It lets you work on multiple features across several repositories in parallel, without juggling branches, feeling lost, or losing changes.

Based on [Git worktrees](https://git-scm.com/docs/git-worktree), Arborist does not replace Git but helps you coordinate across repositories.

> **arborist** (noun) _ˈär-bə-rist_ — a specialist in the care and maintenance of trees

## Mental model

Git worktrees make it possible to check out multiple branches of the same repository at the same time, each in its own directory. Arborist builds on this by keeping a stable canonical clone of each repository and creating temporary workspaces for actual development.

Here's what that looks like on disk:

```
~/my-project/
├── .arb/repos/
│   ├── frontend/           ← canonical clones, managed by arb
│   ├── backend/
│   └── shared/
│
├── fix-login/              ← workspace on branch "fix-login"
│   ├── frontend/
│   └── backend/
│
└── dark-mode/              ← workspace on branch "feat/dark-mode"
    ├── frontend/
    └── shared/
```

You work in the workspaces. Each workspace represents one feature or issue. It contains a separate worktree for each selected repository, with the feature branch checked out. Workspaces can exist side by side and are removed when the task is complete. The canonical clones under `.arb/` are managed by arb — you never touch them directly.

Keeping your work in sync involves two axes: integrating upstream changes from the base branch (using `rebase` or `merge`) and sharing your feature branch with collaborators (using `push` and `pull`). Arborist's synchronization commands handle both across all repos at once.


## 5-minute quickstart

### 1. Install

```
git clone https://github.com/henrikje/arborist
cd arborist
./install.sh
```

### 2. Initialize an arb root

```bash
mkdir ~/my-project
cd ~/my-project
arb init
```

This will be the top-level directory that holds all your workspaces. A `.arb` directory is created inside.

### 3. Clone repositories

```bash
arb repo clone https://github.com/example/frontend.git
arb repo clone https://github.com/example/backend.git
arb repo clone https://github.com/example/shared.git
```

Canonical clones are stored in `.arb/repos`. They are managed by arb, and you never touch them directly.

### 4. Create a workspace

```bash
arb create fix-login frontend backend
```

This creates a `fix-login` directory with worktrees for the `frontend` and `backend` repos with the `fix-login` branch checked out. Picking just the repos you need keeps the workspace focused and makes operations faster to perform.

### 5. Work normally

You edit files, run builds, and use Git exactly as you normally would.

```bash
arb cd fix-login/frontend
# hack hack hack
git commit -am "Fix the login page"

arb cd fix-login/backend
# hack hack hack
git commit -am "Fix the login endpoint"
```

### 6. Check status

```bash
arb status
```

This shows the state of each worktree in a compact table with labeled columns.

```
  REPO        BRANCH       LAST COMMIT    BASE                              SHARE                          LOCAL
* backend     fix-login    just now       origin/main  1 ahead              origin/fix-login  1 to push    1 untracked
  frontend    fix-login    20 minutes     origin/main  1 ahead, 1 behind    origin/fix-login  1 to push    clean
```

This view is designed to give you the full picture in one glance. Yellow highlights brings focus to that which needs attention.

### 7. Rebase and push

When teammates merge their work to the `main` branch:

```bash
arb rebase
```

You will see a plan of what will happen to each repo and ask for confirmation before proceeding.

```
  backend    skipped — uncommitted changes
  frontend   rebase fix-login onto origin/main — 1 behind, 1 ahead (conflict unlikely)  (HEAD 2502048)

? Rebase 1 repo? (y/N)
```

And when you're ready to share your changes with others:

```bash
arb push
```

### 8. Remove the workspace

When you're done with the feature, just delete the workspace.

```bash
arb remove fix-login
```

Done! You can now start a new feature on a fresh workspace.

## Core concepts

Now that you've seen the basics, let's take a look at the ideas behind Arborist.

### Safety by default

Arborist is designed to be safe and predictable. It attempts to give you maximum visibility into your workspace. All operations that change your repository will show a plan and ask for confirmation, and risky actions are blocked unless forced.

### Two synchronization axes

Each repo in a workspace tracks two independent relationships: integration and sharing.

| Axis            | Purpose                               | Target                           | Commands          |
|-----------------|---------------------------------------|----------------------------------|-------------------|
| **Integration** | Keep your feature branch up to date   | Base branch, e.g. `main `        | `merge`, `rebase` |
| **Sharing**     | Share your feature branch with others | Feature branch, e.g. `fix-login` | `push`, `pull`    |

All synchronization commands will fetch all repos to make sure they operate on fresh data. Like the `rebase` example above, they will also show you a plan of what will happen to each repository and ask for confirmation before proceeding.

### Alignment with conventions

Arborist builds on Git and tries to align with its conventions. It uses Git and the filesystem as the authoritative source of truth for workspace state, and does not store any additional internal metadata. 

## Further reading

To learn more about Arborist, check out the following resources:

- [Day-to-day usage](docs/daily-use.md), a deeper dive into the commands you use when working in a workspace.
- [Managing workspaces](docs/workspaces.md), how to create, navigate, and remove workspaces.
- [Workspace templates](docs/templates.md), a way to seed files into new workspaces.
- [Fork workflows](docs/fork-workflows.md), how to use Arborist with fork-based development.
- [Scripting and automation](docs/scripting-automation.md), using Arborist from scripts and pipelines.
- [Working with AI agents](docs/ai-agents.md), how to use Claude Code to manage AI agents.
- [Tips and tricks](docs/tips.md), useful tips and tricks for day-to-day usage.
- [Under the hood](docs/under-the-hood.md), how Arborist works under the hood.

## License

[MIT](LICENSE.md)
