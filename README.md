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
├── add-dark-mode/          ← workspace on branch "add-dark-mode"
│   ├── frontend/
│   └── backend/
│
└── fix-login-crash/        ← workspace on branch "fix-login-crash"
    └── frontend/
```

You work in the workspaces. Each workspace represents one feature or issue. It contains a separate worktree for each selected repository, with the feature branch checked out. Workspaces can exist side by side and are removed when the task is complete. The canonical clones under `.arb/` are managed by arb — you never touch them directly.

Keeping your work in sync involves two axes: integrating upstream changes from the base branch (using `rebase` or `merge`) and sharing your feature branch with collaborators (using `push` and `pull`). Arborist's synchronization commands handle both across all repos at once.


## A quick tour

### Setup

```
git clone https://github.com/henrikje/arborist
cd arborist
./install.sh
```

The installer builds from source, installs the `arb` binary to `~/.local/bin`, and adds shell integration (wrapper function + tab completion) for bash and zsh.

```bash
mkdir ~/my-project
cd ~/my-project
arb init
arb repo clone https://github.com/example/frontend.git
arb repo clone https://github.com/example/backend.git
arb repo clone https://github.com/example/shared.git
```

`arb init` creates the top-level directory that holds all your workspaces. The three `repo clone` commands store canonical clones in `.arb/repos` — they are managed by arb, and you never touch them directly.

### Start a feature

```bash
arb create add-dark-mode frontend backend
```

You use `arb create` to create a workspace `add-dark-mode` and will work on repos `frontend` and `backend` as part of it. Not every feature touches every repo — picking just the ones you need keeps the workspace focused. Both repos will be checked out on the `add-dark-mode` branch.

```bash
cd frontend
# hack hack hack
git commit -am "Add dark mode toggle to navbar"
```

You get to work using your regular tools.

### Handle an interrupt

Then a bug report comes in: logins are crashing! You need to fix it now, but your dark mode work is mid-flight. No problem — create a second workspace:

```bash
arb create fix-login-crash frontend
```

Both workspaces now exist side by side. `arb list` shows the full picture:

```
  WORKSPACE         BRANCH            REPOS    LAST COMMIT    STATUS
* fix-login-crash   fix-login-crash   1        just now       no issues
  add-dark-mode     add-dark-mode     2        2 minutes      unpushed
```

Fix the bug, push, and clean up:

```bash
cd frontend
# hack hack hack
git commit -am "Fix null pointer in login flow"
arb push
arb remove fix-login-crash
```

### Back to the feature

The hotfix is shipped. Pick up where you left off:

```bash
arb cd add-dark-mode/backend
# hack hack hack
git commit -am "Add dark mode API endpoint"
```

Let's run `arb status` to get an overview. The hotfix landed on `main` while you were away, so `frontend` is now one commit behind:

```
  REPO        BRANCH          LAST COMMIT    BASE                               SHARE                               LOCAL
* backend     add-dark-mode   just now       origin/main  1 ahead               origin/add-dark-mode  1 to push     clean
  frontend    add-dark-mode   5 minutes      origin/main  1 ahead, 1 behind     origin/add-dark-mode  1 to push     clean
```

Rebase to integrate the upstream changes:

```bash
arb rebase
```

Arb shows a plan and asks for confirmation before proceeding:

```
  backend    up to date
  frontend   rebase add-dark-mode onto origin/main — 1 behind, 1 ahead (conflict unlikely)  (HEAD a1b2c3d)

? Rebase 1 repo? (y/N)
```

Then push both repos:

```bash
arb push
```

### Clean up

```bash
arb remove add-dark-mode
```

Now you're ready to create new workspaces to tackle new tasks!

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
