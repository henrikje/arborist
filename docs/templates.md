# Workspace templates

Arborist can automatically seed files into new workspaces — `.env` files, AI agent settings, IDE config, anything you want pre-provisioned. Templates live in `.arb/templates/` and are copied into every new workspace.

## Managing templates

Use `arb template` to add, inspect, and maintain templates:

```bash
# Capture a file from your workspace as a template
cd my-feature/api
arb template add .env                    # auto-detects repo scope from CWD
arb template add .env --workspace        # override to workspace scope

# See what templates exist
arb template list

# Check for drift between templates and workspace copies
arb template diff

# Re-seed templates into an existing workspace
arb template apply                       # seeds only missing files (safe)
arb template apply --force               # also resets drifted files

# Remove a template
arb template remove .env --repo api
```

All template commands support `--repo <name>` and `--workspace` flags for explicit scope control. See `arb template --help` for all options.

## When templates are applied

- **`arb create`** — seeds workspace templates + repo templates for all created repos
- **`arb add`** — seeds repo templates for newly added repos only (workspace already set up)
- **`arb remove`** — lists any template files that differ from their originals, so you can update templates before the workspace is gone
- **No templates dir?** — silently skipped, zero noise

## Copy-if-missing semantics

Template files are only copied when the target doesn't already exist. Existing files are never overwritten — your customizations are always preserved. This makes templates safe to evolve over time: update the template and new workspaces get the latest version, while existing workspaces keep their current files.

## Template directory structure

```
.arb/
  templates/
    workspace/         # overlaid onto workspace root
      .editorconfig
    repos/
      api/             # overlaid onto api/ worktree
        .env
      web/             # overlaid onto web/ worktree
        .env
```

The template tree mirrors the workspace structure. `workspace/` files land at the workspace root, `repos/<name>/` files land inside the corresponding worktree.

## Placeholder substitution

Files ending with `.arbtemplate` undergo placeholder substitution when seeded. The extension is stripped at the destination (`config.json.arbtemplate` → `config.json`). Files without the extension are copied verbatim.

| Placeholder | Value | Scope |
|---|---|---|
| `__ROOT_PATH__` | Absolute path to the arb root | all |
| `__WORKSPACE_NAME__` | Workspace directory name | all |
| `__WORKSPACE_PATH__` | Absolute path to the workspace | all |
| `__WORKTREE_NAME__` | Repo/worktree directory name | repo only |
| `__WORKTREE_PATH__` | Absolute path to the worktree | repo only |

`__WORKTREE_NAME__` and `__WORKTREE_PATH__` are only replaced in repo-scoped templates. In workspace-scoped templates they are left as literal text.

Substitution happens wherever `.arbtemplate` files are processed: `arb create`, `arb add`, `arb template apply`, `arb template diff`, and `arb template apply --force`.

## Version-controlling templates

`arb init` creates `.arb/.gitignore` with a `repos/` entry, which means everything else in `.arb/` — including `templates/` — is version-controllable. You can commit your templates to a dotfiles repo, a team bootstrap repo, or just keep them local.

## Example: setting up `.env` templates

```bash
# From inside a workspace, capture files as templates
cd my-feature/api
arb template add .env.example
cd ../web
arb template add .env.example

# Every new workspace gets these automatically
arb create my-feature --all-repos
# → Seeded 2 template file(s)
```

