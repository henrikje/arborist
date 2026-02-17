# Arborist Command Reference

Complete reference for all 18 `arb` commands. Global options available on every command:

- `-C <directory>` — Run as if arb was started in `<directory>` (like `git -C`)
- `-w, --workspace <name>` — Target a specific workspace (overrides auto-detect)
- `-v, --version` — Show version
- `-h, --help` — Show help

**Important:** Global options must come **before** the command name (e.g., `arb -w my-ws push`, NOT `arb push -w my-ws`).

---

## Setup Commands

### init

Initialize a new arb root directory.

```
arb init [path]
```

Creates the `.arb/` marker directory and scaffolding. The current directory (or given path) becomes the arb root — canonical repos go in `.arb/repos/`, and workspaces are created as top-level directories.

**Arguments:**
- `[path]` — Directory to initialize (defaults to current directory)

---

### clone

Clone a repository into `.arb/repos/`.

```
arb clone <url> [name] [--upstream <url>]
```

Clones a git repository into `.arb/repos/<name>` as a canonical copy. These permanent clones are never worked in directly — arb creates worktrees that point back to them. The repo name is derived from the URL if not specified.

**Arguments:**
- `<url>` — Git repository URL (required)
- `[name]` — Repository name (optional; derived from URL)

**Flags:**
- `--upstream <url>` — Add an upstream remote for fork workflows. Use this when cloning your fork so arb knows where to fetch the canonical branch from.

---

### repos

List all cloned repositories.

```
arb repos
```

Lists all repositories in `.arb/repos/`. No flags.

---

## Workspace Commands

### create

Create a new workspace.

```
arb create [name] [repos...] [-a] [-b <branch>] [--base <branch>]
```

Creates a workspace with worktrees for selected repos on a shared feature branch. Automatically seeds files from `.arb/templates/` if configured. Prompts interactively for name, branch, and repos when run without arguments.

**Arguments:**
- `[name]` — Workspace name (prompted if not provided)
- `[repos...]` — Repos to include (prompted if not provided)

**Flags:**
- `-a, --all-repos` — Include all cloned repos in the workspace
- `-b, --branch <branch>` — Branch name (defaults to workspace name)
- `--base <branch>` — Base branch to branch from (e.g., `develop` instead of the repo default)
- `-y, --yes` — Skip confirmation prompt

**Non-interactive usage:** Always pass `-y`. Provide name and either repo names or `-a`.

---

### remove

Remove one or more workspaces.

```
arb remove [names...] [-f] [-d] [-a] [-n]
```

Removes workspaces and their worktrees. Shows status of each worktree before proceeding. Prompts with a picker when run without arguments.

**Arguments:**
- `[names...]` — Workspace names to remove (prompted if not provided)

**Flags:**
- `-f, --force` — Force removal of at-risk workspaces (implies `--yes`)
- `-d, --delete-remote` — Also delete remote branches
- `-a, --all-ok` — Remove all workspaces with clean status
- `-n, --dry-run` — Show what would be removed without executing

**Non-interactive usage:** Use `--dry-run` first to preview, then `--force` to execute. NEVER use without user confirmation.

---

### list

List all workspaces.

```
arb list [-f] [-q] [--json]
```

Lists all workspaces with aggregate status. The active workspace is marked with `*`.

**Flags:**
- `-f, --fetch` — Fetch all repos before listing for fresh remote data
- `-q, --quick` — Skip per-repo status gathering (faster)
- `--json` — Machine-readable JSON output

**JSON output structure:**
```json
[
  {
    "workspace": "feature-login",
    "active": true,
    "branch": "feature-login",
    "base": "main",
    "repoCount": 3,
    "status": null,
    "withIssues": 1,
    "issueLabels": ["dirty", "unpushed"],
    "issueCounts": [
      { "label": "dirty", "count": 1 },
      { "label": "unpushed", "count": 1 }
    ]
  }
]
```

Fields `withIssues`, `issueLabels`, and `issueCounts` are omitted when `--quick` is used. The `issueCounts` array provides per-flag counts in display order. The `status` field is `null` for normal workspaces, `"config-missing"` if `.arbws/config` is absent, or `"empty"` if the workspace has no worktrees.

---

### path

Print a path.

```
arb path [name]
```

Prints the absolute path to the arb root, a workspace, or a worktree.

**Arguments:**
- `[name]` — Workspace name or `workspace/repo` path. Omit for arb root.

---

### cd

Navigate to a workspace directory.

```
arb cd [name]
```

Changes into a workspace or worktree directory. Requires shell integration for actual directory change; without it, prints the path.

**Arguments:**
- `[name]` — Workspace name or `workspace/repo` path.

---

## Worktree Commands

### add

Add worktrees to the current workspace.

```
arb add [repos...] [-a]
```

Adds worktrees for repos to the current workspace on its feature branch. Seeds from `.arb/templates/repos/` if configured.

**Arguments:**
- `[repos...]` — Repository names to add (prompted if not provided)

**Flags:**
- `-a, --all-repos` — Add all repos not yet in the workspace

---

### drop

Drop worktrees from the current workspace.

```
arb drop [repos...] [-f] [-a] [--delete-branch]
```

Removes worktrees from the workspace without deleting the workspace itself.

**Arguments:**
- `[repos...]` — Repository names to drop (prompted if not provided)

**Flags:**
- `-f, --force` — Force removal even with uncommitted changes
- `-a, --all-repos` — Drop all repos
- `--delete-branch` — Delete the local branch from the canonical repo

---

### status

Show workspace status.

```
arb status [-d] [-r] [-f] [--verbose] [--json]
```

Shows each worktree's position relative to the base branch, push status, and local changes.

**Flags:**
- `-d, --dirty` — Only show repos with local changes
- `-r, --at-risk` — Only show repos needing attention (unpushed, drifted, dirty)
- `-f, --fetch` — Fetch remotes before showing status
- `--verbose` — Show file-level detail
- `--json` — Machine-readable JSON output

**JSON output structure:**
```json
{
  "workspace": "feature-login",
  "branch": "feature-login",
  "base": "main",
  "repos": [
    {
      "name": "frontend",
      "identity": {
        "worktreeKind": "linked",
        "headMode": { "kind": "attached", "branch": "feature-login" },
        "shallow": false
      },
      "local": {
        "staged": 0,
        "modified": 2,
        "untracked": 1,
        "conflicts": 0
      },
      "base": {
        "remote": "origin",
        "ref": "main",
        "ahead": 3,
        "behind": 0
      },
      "publish": {
        "remote": "origin",
        "ref": "origin/feature-login",
        "refMode": "configured",
        "toPush": 0,
        "toPull": 0
      },
      "operation": null
    }
  ],
  "total": 2,
  "withIssues": 1,
  "issueLabels": ["dirty"]
}
```

---

### fetch

Fetch all repos from remotes.

```
arb fetch
```

Fetches from all configured remotes for every repo in the workspace, in parallel. Nothing is merged.

---

### pull

Pull the feature branch from the publish remote.

```
arb pull [repos...] [-n] [-y] [--rebase] [--merge]
```

Pulls the feature branch for all or specified repos. Fetches first, shows a plan, then pulls. Skips repos that haven't been pushed or where the remote branch is gone. Reports conflicts at the end.

**Arguments:**
- `[repos...]` — Repos to pull (all if not specified)

**Flags:**
- `-n, --dry-run` — Show what would be pulled without executing
- `-y, --yes` — Skip confirmation prompt
- `--rebase` — Pull with rebase
- `--merge` — Pull with merge

**Non-interactive usage:** Use `--dry-run` first to preview, then `--yes` to execute.

---

### push

Push the feature branch to the publish remote.

```
arb push [repos...] [-f] [--no-fetch] [-n] [-y]
```

Fetches all repos, then pushes the feature branch. Sets up tracking on first push. Shows a plan before pushing. Skips repos without a remote.

**Arguments:**
- `[repos...]` — Repos to push (all if not specified)

**Flags:**
- `-f, --force` — Force push with lease (use after rebase)
- `--no-fetch` — Skip fetching before push
- `-n, --dry-run` — Show what would be pushed without executing
- `-y, --yes` — Skip confirmation prompt

**Non-interactive usage:** Use `--dry-run` first to preview, then `--yes` to execute. Use `-f` only after rebase.

---

### rebase

Rebase feature branches onto the base branch.

```
arb rebase [repos...] [-F] [-n] [-y]
```

Fetches all repos, then rebases the feature branch onto the updated base branch. Skips repos with uncommitted changes or already up to date. Reports conflicts at the end with per-repo resolution instructions.

**Arguments:**
- `[repos...]` — Repos to rebase (all if not specified)

**Flags:**
- `-F, --no-fetch` — Skip fetching before rebase
- `-n, --dry-run` — Show what would be rebased without executing
- `-y, --yes` — Skip confirmation prompt

**Non-interactive usage:** Use `--dry-run` first to preview, then `--yes` to execute.

---

### merge

Merge the base branch into feature branches.

```
arb merge [repos...] [-F] [-n] [-y]
```

Fetches all repos, then merges the base branch into the feature branch. Same behavior as rebase for skip logic and conflict reporting.

**Arguments:**
- `[repos...]` — Repos to merge (all if not specified)

**Flags:**
- `-F, --no-fetch` — Skip fetching before merge
- `-n, --dry-run` — Show what would be merged without executing
- `-y, --yes` — Skip confirmation prompt

**Non-interactive usage:** Use `--dry-run` first to preview, then `--yes` to execute.

---

### exec

Run a command in each worktree.

```
arb exec [-d] <command...>
```

Runs the given command sequentially in each worktree. Each worktree output is preceded by an `==> repo <==` header. Arb flags must come before the command; everything after is passed through verbatim.

**Flags:**
- `-d, --dirty` — Only run in repos with local changes

**Examples:**
```
arb exec git status
arb exec --dirty git diff
arb exec npm install
arb exec -- bash -c 'echo hello'
```

---

### open

Open worktrees in an application.

```
arb open [-d] <command...>
```

Runs a command with all worktree directories as arguments (absolute paths). Arb flags must come before the command.

**Flags:**
- `-d, --dirty` — Only open dirty worktrees

**Examples:**
```
arb open code
arb open --dirty vim
arb open code -n --add
```
