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
- **`arb attach`** — seeds repo templates for newly attached repos, regenerates worktree-aware templates across all scopes
- **`arb detach`** — regenerates worktree-aware templates for remaining repos
- **`arb delete`** — lists any template files that differ from their originals, so you can update templates before the workspace is gone
- **No templates dir?** — silently skipped, zero noise

## Copy-if-missing and user-edit protection

Template files are only copied when the target doesn't already exist. For worktree-aware templates (those referencing `workspace.worktrees`), membership changes (`arb attach` / `arb detach`) trigger re-rendering:

1. If the file matches the previous render → safe to overwrite → **regenerated**
2. If the file differs from the previous render → user has edited → **skipped** (not overwritten)

This means your customizations are always preserved. Use `arb template apply --force` to reset a file to the template version.

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

## LiquidJS rendering

Files ending with `.arbtemplate` are rendered with [LiquidJS](https://liquidjs.com/) when seeded. The extension is stripped at the destination (`config.json.arbtemplate` → `config.json`). Files without the extension are copied verbatim.

### Available variables

| Variable | Value | Scope |
|---|---|---|
| `{{ root.path }}` | Absolute path to the arb root | all |
| `{{ workspace.name }}` | Workspace directory name | all |
| `{{ workspace.path }}` | Absolute path to the workspace | all |
| `{{ workspace.worktrees }}` | Array of `{ name, path }` for all repos | all |
| `{{ worktree.name }}` | Repo/worktree directory name | repo only |
| `{{ worktree.path }}` | Absolute path to the worktree | repo only |

`worktree.name` and `worktree.path` are only populated in repo-scoped templates. `workspace.worktrees` is available in all scopes — a repo template can reference sibling repos.

### Iteration

Use `{% for %}` loops to generate content for each repo in the workspace:

```liquid
{% for wt in workspace.worktrees %}
  {{ wt.name }}: {{ wt.path }}
{% endfor %}
```

Use `forloop.last` for trailing comma handling in JSON:

```liquid
{%- for wt in workspace.worktrees %}
"{{ wt.name }}"{% unless forloop.last %},{% endunless %}
{%- endfor %}
```

Use `{%-` and `-%}` for whitespace control.

### Examples

**Claude permissions** (`.arb/templates/workspace/.claude/settings.local.json.arbtemplate`):

```liquid
{
  "permissions": {
    "allow": [
{%- for wt in workspace.worktrees %}
      "Read({{ wt.path }})",
      "Write({{ wt.path }})"{% unless forloop.last %},{% endunless %}
{%- endfor %}
    ]
  }
}
```

**IntelliJ modules** (`.arb/templates/workspace/.idea/workspace.xml.arbtemplate`):

```liquid
<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="ProjectModuleManager">
    <modules>
{%- for wt in workspace.worktrees %}
      <module fileurl="file://{{ wt.path }}/{{ wt.name }}.iml" filepath="{{ wt.path }}/{{ wt.name }}.iml" />
{%- endfor %}
    </modules>
  </component>
</project>
```

Rendering happens wherever `.arbtemplate` files are processed: `arb create`, `arb attach`, `arb detach`, `arb template apply`, `arb template diff`, and `arb template apply --force`.

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
