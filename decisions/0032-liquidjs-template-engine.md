# LiquidJS Template Engine

Date: 2026-02-24

Supersedes: [0014 — Template Substitution Mechanism](0014-template-substitution-mechanism.md)

## Context

Arborist's template system used `string.replaceAll()` with 5 fixed placeholders to inject context into `.arbtemplate` files during workspace creation. This was sufficient for simple variable substitution but could not produce content that varies by workspace membership — e.g., an IntelliJ `workspace.xml` listing one `<module>` per worktree, or a Claude `settings.local.json` granting `Read`/`Write` permissions per worktree path.

Two concrete use cases drove the need for iteration: IDE config files that enumerate all repos in a workspace, and AI agent permission files that list paths for all attached repos.

## Options

### Hand-rolled `__EACH_REPO__` markers

Extend `substitutePlaceholders()` with block markers for iteration.

- **Pros:** Zero dependencies
- **Cons:** No trailing comma handling, no whitespace control, no conditionals, custom syntax that becomes a homegrown template engine over time

### LiquidJS (chosen)

Replace `substitutePlaceholders()` with LiquidJS rendering.

- **Pros:** Native `forloop.last` for trailing commas, `{%-`/`-%}` whitespace control, no HTML escaping by default, `{{ var }}`/`{% for %}` syntax readable by non-programmers, TypeScript-native, actively maintained, only dependency (`commander`) already in Arborist's dep tree
- **Cons:** 1.77 MB added to dep tree (compiled into single binary)

### Lifecycle hooks

Scripts in `.arb/hooks/` invoked on workspace events.

- **Pros:** Maximum flexibility
- **Cons:** No built-in template integration, no user-edit protection

## Decision

Replace the rendering engine with LiquidJS and unify the template lifecycle so that all templates — static and worktree-aware — follow the same model with user-edit protection via previous-state comparison.

## Reasoning

LiquidJS wins on three critical requirements: no HTML escaping by default (essential for JSON/XML generation), native `forloop.last` for trailing comma handling, and `{%-`/`-%}` whitespace control. Its `{{ var }}`/`{% for %}` syntax is readable by non-programmers. The hand-rolled approach would inevitably accumulate the same features as a template engine but with custom syntax and no ecosystem support. The hooks approach solves a different problem (arbitrary scripting) and doesn't provide template integration.

The unified lifecycle — where membership changes trigger re-rendering with previous-state comparison — emerged from recognizing that "seed" templates and "worktree-aware" templates are the same concept: both render content from context, and the only difference is whether the output changes when the worktree list changes. Previous-state comparison naturally handles both: if output is context-independent, old render == new render, so the file is either unchanged or user-edited; if output depends on worktrees, comparing the file against the old render detects whether the user has edited it.

## Consequences

Template authors now use Liquid syntax (`{{ workspace.path }}`, `{% for wt in workspace.worktrees %}`) instead of `__WORKSPACE_PATH__` placeholders. The `.arbtemplate` extension is retained — it signals "arb processes this" regardless of the rendering engine.

All templates are re-rendered on `arb attach` and `arb detach`. Files whose output changed and the user hasn't edited are automatically regenerated. Files the user has edited are left untouched. `arb template apply --force` always overwrites.

The available template context is expanded:

- `root.path` — absolute path to arb root
- `workspace.name` — workspace directory name
- `workspace.path` — absolute path to workspace
- `workspace.worktrees[]` — array of `{ name, path }` for all repos in workspace
- `worktree.name` — repo name (repo-scoped templates only)
- `worktree.path` — absolute path to worktree (repo-scoped templates only)

Existing templates using the old placeholder syntax must be migrated to Liquid syntax. LiquidJS adds ~1.77 MB to the dependency tree but introduces no new transitive dependencies since its only dep (`commander`) is already present.
