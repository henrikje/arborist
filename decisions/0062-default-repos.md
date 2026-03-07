# Default Repos

Date: 2026-03-07

## Context

Every `arb create` requires repo selection via positional args, `--all-repos`, or the interactive picker. Teams with many repos frequently select the same subset (e.g., always including `claude-config` for Claude tooling). There was no mechanism for workspace composition defaults — the template system handles files seeded into workspaces, but not which repos to include.

A user reported always selecting the same repos per `arb init` and wanted them pre-selected. A previous plan explored full named presets (`arb preset save`), but the actual need was lighter: a way to mark repos as defaults.

## Options

### Marker directories in `.arb/defaults/`
Empty subdirectories (one per default repo) in a new `.arb/defaults/` directory.
- **Pros:** Follows the "filesystem as database" principle literally.
- **Cons:** Empty directories aren't preserved by git, making defaults impossible to version control. This defeats the purpose of project-level shared configuration.

### Project-level config file `.arb/config`
A `defaults = repo-a,repo-b` key in a `key = value` config file, following the `.arbws/config` precedent.
- **Pros:** Git-trackable, simple, reuses existing `configGet()` infrastructure, naturally extensible for future project-level settings.
- **Cons:** Introduces a config file, which the GUIDELINES discourage. However, the filesystem cannot express this (empty dirs aren't tracked), making a config file the pragmatic choice.

### Subcommand under `repo` with implicit add action
`arb repo default <names>` adds to defaults, `arb repo default -r <names>` removes, bare `arb repo default` lists.
- **Pros:** Follows `git tag` precedent (default action = create, flag = delete). Minimal friction for the common case. Single modifier flag, not two competing verb-flags.
- **Cons:** Slightly asymmetric (add is implicit, remove is explicit).

### Explicit `--add`/`--remove` flags
`arb repo default --add <names>` and `arb repo default --remove <names>`.
- **Pros:** Explicit, symmetric.
- **Cons:** Uses flags as verbs — an anti-pattern where flags define the action rather than modifying it.

## Decision

Use `.arb/config` with a `defaults` key for storage, and `arb repo default` with implicit-add semantics for the command surface.

## Reasoning

The `.arbws/config` precedent establishes `key = value` config files as an accepted pattern in arb. Extending this to project-level with `.arb/config` is natural and consistent. The filesystem-as-database principle can't apply here because empty directories aren't tracked by git — and git-trackability is essential for shared project configuration.

The implicit-add pattern (`arb repo default <name>` adds, `-r` removes) follows `git tag`'s precedent and avoids the flag-as-verb anti-pattern. The asymmetry is intentional: adding is the primary and more frequent action.

## Consequences

- A new `.arb/config` file is introduced. Future project-level settings (e.g., named presets) can use additional keys in this file.
- Default repos are pre-checked in interactive pickers for `create` and `attach`. Users can uncheck them.
- In non-interactive mode, defaults serve as the fallback repo set when no repos are specified via args, stdin, or `--all-repos`.
- Stale defaults (repos removed after being marked as default) are harmless — `create` filters against available repos, and the picker only shows repos that exist. `arb repo default -r` can remove stale entries.
- Named presets could be added later as additional keys (e.g., `preset.backend = api,shared`) or via a separate mechanism, without changing the defaults feature.
