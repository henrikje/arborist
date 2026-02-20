# Template Substitution Mechanism

Date: 2026-02-19

## Context

Arborist's workspace template system needed a way to inject context-specific values (paths, names) into template files during `arb create`. Files like `.env`, `settings.json`, or CI configs often need the workspace path, repo name, or project root. The question was how to perform this substitution.

The original plan for this feature was not preserved. This record documents the decision as implemented; the options that were considered at the time are not available.

## Decision

Simple `string.replaceAll()` with 5 fixed placeholders and the `.arbtemplate` file extension convention. No template engine dependency. No conditionals, loops, or expressions.

The five placeholders: `__ROOT_PATH__`, `__WORKSPACE_NAME__`, `__WORKSPACE_PATH__`, `__WORKTREE_NAME__`, `__WORKTREE_PATH__`. The last two are only available in repo-scoped templates.

The `.arbtemplate` extension signals which files need substitution, provides namespacing (only arborist processes these files), and is stripped from the output (`config.json.arbtemplate` becomes `config.json`).

## Why This Is Noteworthy

The choice of simple `replaceAll` over a template engine is a deliberate constraint. The fixed placeholder set means template authors can't encode fragile assumptions about workspace structure — no conditionals, no iteration over repos, no computed expressions. Every real template use case (inject a path into `.env`, set a project name in `settings.json`) needs only string substitution.

The `.arbtemplate` extension solves three problems at once: it signals substitution, provides namespacing, and disappears from the output. If both `file.json` and `file.json.arbtemplate` exist in the same template directory, arb errors to prevent ambiguity.

## Consequences

Substitution runs during `arb create`, `arb add`, and `arb template apply`. Templates without the `.arbtemplate` extension are copied verbatim. The implementation is ~10 lines of `replaceAll` calls with no dependencies. The convention is set for any future placeholders.
