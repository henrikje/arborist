# Reject $current Workspace Symlink

Date: 2026-02-19

## Context

Arborist workspaces live at `${baseDir}/${workspace-name}/`, so the path changes with each workspace. The hypothesis was that a stable path would help IDE and tool configurations survive workspace switches — VS Code workspace files, docker-compose volumes, .env paths, and similar artifacts that embed directory paths.

Two solutions were proposed: a `$current` symlink pointing to the active workspace, and a named "link" system allowing multiple aliases. The project already had three mechanisms that address parts of this problem: the template system (`.arbtemplate` files with path placeholders baked at creation time), `arb path` (dynamic path resolution for scripts), and `arb open` (launches tools with correct worktree paths).

## Options

### $current symlink directory
A symlink at `${baseDir}/.arb/current` pointing to the active workspace, updated when the user runs `arb select` or `arb cd`.
- **Pros:** Provides a stable filesystem path; simple concept; one-line shell aliases work.
- **Cons:** Content changes silently corrupt IDE state, build caches, and file watchers. Race conditions when switching during active builds. Symlinks and git/tools interact poorly (macOS FSEvents, Linux inotify). Stale pointers when workspaces are removed. Global singleton contradicts arborist's parallel workspace model.

### Named link system
Multiple named links (e.g., `$api-dev`, `$frontend-test`) stored in `.arb/links/` or `.arb/config`.
- **Pros:** More flexible than a single pointer; supports parallel workflows.
- **Cons:** All the same symlink/content-change problems, multiplied by N links. Significantly more complexity. Cognitive overhead of remembering link names. Adds a configuration layer to a convention-over-configuration tool.

### Do nothing — existing tools already cover this
Rely on the template system for per-workspace config seeding, `arb path` for dynamic resolution, and `arb open` for launching tools.
- **Pros:** Templates already solve the main use case (per-workspace VS Code files, docker-compose, .env). `arb path` solves scripting. `arb open` solves editor launching. No content-change problem since each workspace has its own baked-in config. No new failure modes.
- **Cons:** No single stable filesystem path. Users must open a new editor window per workspace.

## Decision

Do nothing. The existing template system, `arb path`, and `arb open` already cover the underlying needs.

## Reasoning

A stable path to changing content is worse than a changing path to stable content. Every development tool — language servers, build systems, file watchers, IDE state — assumes that if the directory path hasn't changed, the content is the same project. Violating that assumption causes silent state corruption that is far harder to debug than opening a new editor window.

The template system is the correct solution: it gives each workspace its own properly-configured files at creation time, with no shared mutable state. The `$current` symlink also violates "filesystem as database" (implicit global state) and "visibility and control" (pointer changes silently), and contradicts the parallel workspace model that is arborist's core value.

## Consequences

The template system becomes the primary mechanism for tool configuration across workspaces. Future improvements should focus on the template system (more placeholders, better drift detection, re-seeding) rather than stable-path approaches. Users who want IDE-per-workspace workflows use `arb open` or workspace-scoped config files seeded by templates.
