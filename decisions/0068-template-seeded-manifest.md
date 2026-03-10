# Template Seeded-Content Manifest

Date: 2026-03-10

## Context

When a template source file changes after a workspace is created, `template list` and `template diff` report the seeded workspace file as "modified" — even if the user never touched it. This happens because drift detection re-renders the current template and compares byte-for-byte against the workspace file. Once the template source changes, the rendered output differs from what was originally seeded, making the comparison indistinguishable from a genuine user edit.

The existing membership-change mechanism (`previousRepos`) solves a related problem — detecting user edits when repos are added or removed — but it cannot help when the template source itself changes. The original rendered content is unrecoverable without stored state.

## Options

### Store SHA-256 hashes of seeded content in `.arbws/templates.json`

At seed time, record the hash of each file's rendered content. During drift detection, check whether the workspace file still matches its seeded hash. If it does, the user hasn't touched it — classify as "stale" (template changed) rather than "modified" (user changed).

- **Pros:** Simple, fast, works for both workspace and repo templates, backwards-compatible (no manifest = fall back to current behavior), covers all file types.
- **Cons:** Introduces stored state in a project that prefers filesystem-as-database.

### Use git history for repo-scoped templates

For files inside git worktrees, check git log to find the initial commit's content and compare.

- **Pros:** No stored state for repo templates.
- **Cons:** Doesn't work for workspace-level templates. Slower (git process per file). Fragile with rebases and committed edits. Requires a separate fallback for workspace templates.

### Store template source hash at seed time

Record the hash of the template source (pre-render) rather than the rendered output.

- **Pros:** Can precisely identify template-source changes.
- **Cons:** Still needs rendered-content comparison for user-edit detection. Two hashes to maintain. Over-engineered.

## Decision

Store SHA-256 hashes of seeded file contents in `.arbws/templates.json`.

## Reasoning

The "Filesystem as database" guideline (GUIDELINES.md) says to avoid stored state when information can be inferred from the directory tree or git. Here, the original rendered content genuinely cannot be inferred once the template source changes — storing it is justified.

The manifest fits naturally alongside `.arbws/config.json`, is human-inspectable, and adds no external dependencies (`node:crypto` is built-in). The git-based alternative is fragile and incomplete (workspace templates aren't in git). The template-source-hash approach adds unnecessary complexity for the same outcome.

A new `"stale"` drift kind preserves the "visibility" principle — users can see that a newer template version is available without the misleading "modified" label. `template diff` excludes stale files since the user didn't change them.

## Consequences

- `.arbws/templates.json` is a new file that must be written on every seeding path: `overlayDirectory`, `forceOverlayDirectory`, `applySingleFile`, and their higher-level callers.
- Workspaces created before this change have no manifest and fall back to the previous behavior (all drifted files reported as "modified"). Running `template apply --force` populates the manifest for existing workspaces.
- The manifest must be kept in sync — any new seeding code path must collect and write hashes. This is enforced by `OverlayResult.seededHashes` and `ForceOverlayResult.seededHashes` being part of the return type.
