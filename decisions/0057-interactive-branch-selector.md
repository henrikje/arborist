# 0057 — Interactive branch selector in `arb create`

Date: 2026-03-05

## Context

`arb create` handles three branch scenarios transparently: creating a new branch, checking out an existing remote branch, and attaching an existing local branch. However, the interactive flow offered only a free-text input for the branch name, with no way to discover what branches already exist. Users had to know the branch name to type it in, making the "check out existing branch" workflow invisible.

The prompt order (name → branch → base → repos) also meant branch discovery could not leverage the selected repos — we couldn't show remote branches without knowing which repos to query.

A secondary issue: creating an empty workspace (no repos) was allowed but almost never intended. Users reported accidentally pressing enter before selecting repos in the checkbox picker.

## Options

### A. Add hint text only

Update the branch prompt message and help text to mention existing branches. No structural changes.

- **Pros:** Minimal change, no risk of breaking anything.
- **Cons:** Doesn't solve the core discoverability problem — users still need to know the branch name.

### B. Reorder prompts and add a branch selector

Move repo selection before the branch prompt, then show an `@inquirer/select` picker listing existing remote branches alongside a "create new" option.

- **Pros:** Makes existing branches first-class discoverable. Common flows complete in a single prompt. Branch discovery uses the selected repos' share remotes.
- **Cons:** Changes the interactive prompt order (not a breaking change — non-interactive flow is unaffected). Adds a git query step (listing remote branches) before workspace creation.

### C. Add a separate `arb checkout` command

Create a new command specifically for checking out existing branches into a workspace.

- **Pros:** Clear intent separation.
- **Cons:** Splits the mental model — "create workspace" and "checkout workspace" do the same thing underneath. Two commands to learn and maintain. Violates the "do one thing and do it well" principle since both commands would create workspaces.

## Decision

**Option B — reorder prompts and add a branch selector.**

Additionally: require at least one repo in `arb create` (re-prompt on empty selection in interactive mode, error in non-interactive mode).

## Reasoning

The fundamental concept is sound — `arb create` always creates a workspace, and branch resolution (new vs existing) is an implementation detail that arborist handles automatically. The fix is discoverability, not new surface area. A selector surfaces existing branches at the moment the user needs them, without requiring a separate command or prior knowledge.

Reordering prompts (name → repos → branch → base) is the key enabler: once repos are selected, their share remotes can be queried for existing branches. The selector groups choices into a "suggested" section (auto-derived name + "Enter a different name...") and an "existing branches" section separated by a visual divider. The most common flows — new branch matching workspace name, or picking an existing branch — complete in a single prompt selection.

The auto-derived branch name (workspace name lowercased) is preserved as the first option in the selector and as the default in the input fallback. This maintains the ergonomic shortcut for the common case while making the selector the primary discovery mechanism.

Requiring at least one repo eliminates the confusing empty-workspace state that was almost never intentional. The interactive picker now re-prompts with a warning on empty selection rather than silently creating a workspace with no repos.

## Consequences

- The interactive prompt order changes from name → branch → base → repos to name → repos → branch → base. Non-interactive usage (`arb create my-ws -b feat/x repo-a`) is unaffected.
- Existing remote branches are now visible during workspace creation, making collaboration and branch resumption discoverable.
- The branch selector shows whenever repos are selected interactively or the session is on a TTY — even if the workspace name was given on the command line. This means `arb create my-ws` in a terminal still gets the interactive branch selector after repo selection.
- Selected repos are fetched before displaying the branch selector, ensuring the branch list reflects the latest remote state.
- The "Enter a different name..." option drops the default suggestion, since the user explicitly rejected the auto-derived name by choosing that option.
- The base branch prompt is skipped when an existing branch is selected (base is irrelevant for existing branches). It also only appears when the branch was interactively selected, not when `-b` was given on the command line.
- Empty workspaces can no longer be created directly. The workaround is `arb create my-ws --all-repos` followed by `arb detach`.
- A `listRemoteBranches` utility is added to the git module for querying branch names from locally cached remote refs.
