# Arborist (`arb`)

**Arborist** lets you work on multiple features across several repositories in parallel, without juggling branches, losing your place, or losing changes.

Based on [Git worktrees](https://git-scm.com/docs/git-worktree), Arborist does not replace Git but helps you coordinate across repositories.

_Arborist is under active development._

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

Arborist requires Git and works on macOS and Linux. It currently needs [Bun](https://bun.sh) to build from source, but pre-built binaries are coming. :-)

```
git clone https://github.com/henrikje/arborist
cd arborist
./install.sh
```

The installer puts the `arb` binary in `~/.local/bin`, and adds shell integration (wrapper function + tab completion) for bash and zsh.

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

Arb shows a plan, including a conflict prediction for each repo, and asks for confirmation before proceeding:

```
  backend    up to date
  frontend   rebase add-dark-mode onto origin/main — 1 behind, 1 ahead (conflict unlikely)  (HEAD a1b2c3d)

? Rebase 1 repo? (y/N)
```

### Wrap up

Then push both repos and clean up:

```bash
arb push
arb remove add-dark-mode
```

Now you're ready to create new workspaces to tackle new tasks!

## What else can Arborist do?

The tour covered the essentials. Here are more capabilities worth knowing about.

### Conflict prediction and recovery

Before a rebase or merge runs, Arborist performs a trial three-way merge in memory (using the same algorithm Git uses) against each repo to identify actual file-level conflicts. The result appears in the plan:

```
  backend    up to date
  frontend   rebase add-dark-mode onto origin/main — 1 behind, 1 ahead (conflict unlikely)
```

You see which repos will conflict before you commit to the operation. The same check runs for `pull` and appears in `arb status` when a repo's integration would conflict.

If a rebase or merge does hit a conflict, Arborist continues with the remaining repos and reports everything at the end. One conflicting repo never blocks the others. You see per-repo conflict details and resolution instructions in a single pass.

### Keeping in sync

Each repo in a workspace tracks two independent relationships:

| Axis            | Commands          | Purpose                                                      |
|-----------------|-------------------|--------------------------------------------------------------|
| **Integration** | `rebase`, `merge` | Keep your feature branch up to date with the base branch     |
| **Sharing**     | `push`, `pull`    | Share your feature branch with collaborators                 |

Synchronization commands automatically fetch all repos in parallel before operating, so you always work against the latest remote state. Every command shows a plan of what will happen to each repo and asks for confirmation before proceeding.

### Filter by status

```bash
arb status --where dirty,unpushed
arb list --where at-risk
```

Arborist tracks status flags across repos — dirty, unpushed, behind-base, diverged, drifted, and more. The `--where` flag lets you filter by any combination, and works across `status`, `list`, `exec`, `open`, and `remove` — so you can check which workspaces need attention, run commands only in dirty repos, or clean up safely. Use `--dirty` as a shorthand for `--where dirty`.

### Run commands across repos

```bash
arb exec npm install
arb exec --dirty git stash
```

`arb exec` runs any command in each worktree, using the worktree directory as working directory. Combine with `--dirty` or `--where` to narrow the scope. Arb flags come before the command — everything after passes through verbatim.

### Open worktrees in your editor

```bash
arb open code
arb open idea
```

`arb open` runs a command with all worktree paths as arguments — useful for editors like VS Code or IntelliJ that accept directories on the command line. Worktree directories change with every workspace, so remembering paths gets old fast. `arb open` always gives you the right ones.

### Seed files into new workspaces

```bash
cd my-feature/api
arb template add .env
# from now on, every new workspace gets api/.env automatically
```

Templates let you capture files and have them seeded into every new workspace. Common uses include `.env` files, IDE settings, and AI agent config. Templates live in `.arb/templates/` and are version-controllable.

### Branch from a feature branch

```bash
arb create auth-ui --base feat/auth --all-repos
```

The `--base` flag creates a workspace that branches from a specific base instead of the default, letting you stack feature branches. When the base branch is later merged into the default branch (e.g. via a PR), `arb status` detects this and shows "base merged" — preventing the common and painful mistake of rebasing onto a branch that's already been merged. Run `arb rebase --retarget` to cleanly rebase onto the default branch and update the workspace config. For deeper stacks (e.g. A → B → C), use `arb rebase --retarget feat/A` to retarget to a specific branch.

### Fork-based development

```bash
arb repo clone https://github.com/you/api.git --upstream https://github.com/org/api.git
```

One command clones your fork and registers the canonical repository. Arborist auto-detects remote roles from git config, so `rebase` targets upstream while `push` goes to your fork — no arb-specific configuration needed. Different repos in the same workspace can use different remote layouts — some forked, some single-origin — and arb resolves remote roles independently for each, so `rebase` targets the right upstream and `push` goes to the right fork without per-repo configuration.

### Script-friendly by design

```bash
arb push --dry-run          # preview without executing
arb rebase --yes            # skip confirmation
arb status --json | jq ...  # machine-readable output
```

All state-changing commands support `--dry-run` to preview the plan and `--yes` to skip confirmation prompts. `status` and `list` support `--json` for structured output. Exit codes are meaningful: 0 for success, 1 for issues, 130 for user abort. Human-facing output goes to stderr, machine-parseable data to stdout — so piping works naturally.

### Discover more with `--help`

```bash
arb --help              # list all commands
arb create --help       # detailed usage for a specific command
```

Every command supports `--help`. If you're unsure what flags are available or how a command works, `--help` is the fastest way to find out.

## Further reading

To learn more about Arborist, check out the following resources:

- [Day-to-day usage](docs/daily-use.md), a deeper dive into the commands you use when working in a workspace.
- [Managing workspaces](docs/workspaces.md), how to create, navigate, and remove workspaces.
- [Workspace templates](docs/templates.md), a way to seed files into new workspaces.
- [Fork workflows](docs/fork-workflows.md), how to use Arborist with fork-based development.
- [Scripting and automation](docs/scripting-automation.md), using Arborist from scripts and pipelines.
- [Tips and tricks](docs/tips.md), useful tips and tricks for day-to-day usage.
- [Under the hood](docs/under-the-hood.md), how Arborist works under the hood.

## License

[MIT](LICENSE.md)
