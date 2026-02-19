# Arborist Command Reference

Complete reference for all `arb` commands. Global options available on every command:

- `-C <directory>` — Run as if arb was started in `<directory>` (like `git -C`)
- `-v, --version` — Show version
- `-h, --help` — Show help

**Important:** Global options must come **before** the command name (e.g., `arb -C my-ws status`, NOT `arb status -C my-ws`).

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

### repo

Manage canonical repos.

```
arb repo <subcommand>
```

Subcommands for managing the canonical repository clones in `.arb/repos/`. These permanent clones are never worked in directly — arb creates worktrees that point back to them.

#### repo clone

```
arb repo clone <url> [name] [--upstream <url>]
```

Clone a git repository into `.arb/repos/<name>` as a canonical copy. The repo name is derived from the URL if not specified.

**Arguments:**
- `<url>` — Git repository URL (required)
- `[name]` — Repository name (optional; derived from URL)

**Flags:**
- `--upstream <url>` — Add an upstream remote for fork workflows. Use this when cloning your fork so arb knows where to fetch the canonical branch from.

#### repo list

```
arb repo list
```

List all repositories in `.arb/repos/`. No flags.

---

### template

Manage workspace template files.

```
arb template <subcommand>
```

Subcommands for managing template files that are automatically seeded into new workspaces. Templates live in `.arb/templates/` and are copied during `arb create` and `arb add`.

#### template add

```
arb template add <file> [--repo <name>] [--workspace] [-f]
```

Capture a file from the current workspace as a template. Scope is auto-detected from CWD (workspace root or repo worktree). The file must exist.

**Arguments:**
- `<file>` — File path to capture (resolved relative to CWD)

**Flags:**
- `--repo <name>` — Target repo scope (repeatable for multiple repos)
- `--workspace` — Target workspace scope
- `-f, --force` — Overwrite existing template if content differs

**Behavior:** If the template already exists with identical content, succeeds silently. If content differs, refuses unless `--force` is used.

#### template remove

```
arb template remove <file> [--repo <name>] [--workspace]
```

Delete a template file from `.arb/templates/`. Does not delete seeded copies in existing workspaces.

**Arguments:**
- `<file>` — Template file path to remove

**Flags:**
- `--repo <name>` — Target repo scope (repeatable)
- `--workspace` — Target workspace scope

#### template list

```
arb template list
```

Show all defined template files. When run inside a workspace, annotates files that differ from their seeded copy with `(modified)`. No flags.

#### template diff

```
arb template diff [file] [--repo <name>] [--workspace]
```

Show content differences between templates and their workspace copies using unified diff format. Exits with code 1 if any drift is found (useful for CI). Requires workspace context.

**Arguments:**
- `[file]` — Optional file path to diff only that template

**Flags:**
- `--repo <name>` — Filter to specific repo (repeatable)
- `--workspace` — Filter to workspace templates only

**Combining flags:** `--workspace --repo api` shows workspace templates and api templates.

#### template apply

```
arb template apply [file] [--repo <name>] [--workspace] [-f]
```

Re-seed template files into the current workspace. By default, only copies files that don't already exist (safe, non-destructive). Requires workspace context.

**Arguments:**
- `[file]` — Optional file path to apply only that template

**Flags:**
- `--repo <name>` — Apply only to specific repo (repeatable)
- `--workspace` — Apply only workspace templates
- `-f, --force` — Overwrite drifted files (reset to template version)

**Scoping:**
- No flags → workspace + all repos
- `--repo api` → only api repo templates
- `--workspace` → only workspace templates
- `--workspace --repo api` → workspace + api

---

## Workspace Commands

### create

Create a new workspace.

```
arb create [name] [repos...] [-a] [-b <branch>] [--base <branch>]
```

Creates a workspace with worktrees for selected repos on a shared feature branch. Automatically seeds files from `.arb/templates/` if configured. Prompts interactively for name, branch, and repos when run without arguments. With the shell integration, auto-cds into the new workspace on success.

**Arguments:**
- `[name]` — Workspace name (prompted if not provided)
- `[repos...]` — Repos to include (prompted if not provided)

**Flags:**
- `-a, --all-repos` — Include all cloned repos in the workspace
- `-b, --branch <branch>` — Branch name (defaults to workspace name)
- `--base <branch>` — Base branch to branch from (e.g., `develop` instead of the repo default)

**Non-interactive usage:** Provide name and either repo names or `-a`. No `-y` flag needed — runs non-interactively when all arguments are supplied.

---

### remove

Remove one or more workspaces.

```
arb remove [names...] [-f] [-d] [-a] [-w <filter>] [-n]
```

Removes workspaces and their worktrees. Shows status of each worktree before proceeding. Prompts with a picker when run without arguments.

**Arguments:**
- `[names...]` — Workspace names to remove (prompted if not provided)

**Flags:**
- `-f, --force` — Force removal of at-risk workspaces (implies `--yes`)
- `-d, --delete-remote` — Also delete remote branches
- `-a, --all-safe` — Remove all workspaces with safe status (no work would be lost)
- `-w, --where <filter>` — Filter workspaces by repo status flags (comma-separated, OR logic). Combines with `--all-safe` using AND.
- `-n, --dry-run` — Show what would be removed without executing

**Non-interactive usage:** Use `--dry-run` first to preview, then `--force` to execute. NEVER use without user confirmation.

---

### list

List all workspaces.

```
arb list [-f] [-q] [-w <filter>] [--json]
```

Lists all workspaces with aggregate status. The active workspace is marked with `*`. Shows a LAST COMMIT column with the most recent commit author date across all repos (as relative time in TTY, ISO 8601 in JSON).

**Flags:**
- `-f, --fetch` — Fetch all repos before listing for fresh remote data
- `-q, --quick` — Skip per-repo status gathering (faster)
- `-w, --where <filter>` — Filter workspaces by repo status flags (comma-separated, OR logic). Cannot combine with `--quick`.
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
    ],
    "lastCommit": "2025-01-15T10:30:00+01:00"
  }
]
```

Fields `withIssues`, `issueLabels`, `issueCounts`, and `lastCommit` are omitted when `--quick` is used. The `issueCounts` array provides per-flag counts in display order. The `status` field is `null` for normal workspaces, `"config-missing"` if `.arbws/config` is absent, or `"empty"` if the workspace has no worktrees.

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
arb status [-d] [-w <filter>] [-f] [-v] [--json]
```

Shows each worktree's position relative to the base branch, push status, and local changes. The summary includes the workspace's last commit date (most recent author date across all repos).

**Flags:**
- `-d, --dirty` — Only show repos with local changes (shorthand for `--where dirty`)
- `-w, --where <filter>` — Filter repos by status flags (comma-separated, OR logic): dirty, unpushed, behind-share, behind-base, diverged, drifted, detached, operation, local, gone, shallow, at-risk
- `-f, --fetch` — Fetch remotes before showing status
- `-v, --verbose` — Show file-level detail
- `--json` — Machine-readable JSON output (filtered when `--where` is active)

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
      "share": {
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
  "issueLabels": ["dirty"],
  "lastCommit": "2025-01-15T10:30:00+01:00"
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

Pull the feature branch from the share remote.

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

Push the feature branch to the share remote.

```
arb push [repos...] [-f] [--no-fetch] [-n] [-y]
```

Fetches all repos, then pushes the feature branch. Sets up tracking on first push. Shows a plan before pushing. Skips repos without a remote.

**Arguments:**
- `[repos...]` — Repos to push (all if not specified)

**Flags:**
- `-f, --force` — Force push with lease (implies `--yes`)
- `--no-fetch` — Skip fetching before push
- `-n, --dry-run` — Show what would be pushed without executing
- `-y, --yes` — Skip confirmation prompt

**Non-interactive usage:** Use `--dry-run` first to preview, then `--yes` to execute. Use `--force` only after rebase (implies `--yes`).

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
arb exec [--repo <name>] [-d] [-w <filter>] <command...>
```

Runs the given command sequentially in each worktree. Each worktree output is preceded by an `==> repo <==` header. Arb flags must come before the command; everything after is passed through verbatim.

**Flags:**
- `--repo <name>` — Only run in specified repos (repeatable, AND logic with `--where`/`--dirty`)
- `-d, --dirty` — Only run in repos with local changes (shorthand for `--where dirty`)
- `-w, --where <filter>` — Only run in repos matching status filter (comma-separated, OR logic)

**Examples:**
```
arb exec git status
arb exec --repo api --repo web -- npm test
arb exec --dirty git diff
arb exec -w unpushed git log --oneline
arb exec npm install
arb exec -- bash -c 'echo hello'
```

---

### open

Open worktrees in an application.

```
arb open [--repo <name>] [-d] [-w <filter>] <command...>
```

Runs a command with all worktree directories as arguments (absolute paths). Arb flags must come before the command.

**Flags:**
- `--repo <name>` — Only open specified repos (repeatable, AND logic with `--where`/`--dirty`)
- `-d, --dirty` — Only open dirty worktrees (shorthand for `--where dirty`)
- `-w, --where <filter>` — Only open worktrees matching status filter (comma-separated, OR logic)

**Examples:**
```
arb open code
arb open --repo api --repo web code
arb open --dirty vim
arb open -w dirty,unpushed code
arb open code -n --add
```
