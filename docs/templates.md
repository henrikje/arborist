# Workspace templates

Arborist can automatically seed files into new workspaces — `.env` files, AI agent settings, IDE config, anything you want pre-provisioned. Templates live in `.arb/templates/` and are copied into every new workspace.

## Managing templates

The `.arb/templates/` directory is user-owned space — add and remove template files directly with your shell or editor. Workspace templates go in `.arb/templates/workspace/`, repo templates go in `.arb/templates/repos/<name>/`.

```bash
# Add a template by copying a file into .arb/templates/
cp my-feature/api/.env .arb/templates/repos/api/.env
cp my-feature/.editorconfig .arb/templates/workspace/.editorconfig

# See what templates exist
arb template list

# Check for drift between templates and workspace copies
arb template diff

# Re-seed templates into an existing workspace
arb template apply                       # seeds only missing files (safe)
arb template apply --force               # also resets drifted files

# Remove a template
rm .arb/templates/repos/api/.env
```

The `arb template` subcommands (`list`, `diff`, `apply`) provide operations that require Arborist's template rendering engine. Adding and removing template files doesn't need Arborist — the filesystem is the interface.

## Template scopes

Templates exist at two levels: **workspace** and **repo**. The scope determines where a template is overlaid and what variables are available during rendering.

### Workspace scope

Workspace templates live in `.arb/templates/workspace/` and are overlaid onto the workspace root directory. Use them for files that belong at the workspace level or that need to reference all repos in the workspace.

Typical uses:
- IDE project files that list all repos as modules
- AI agent config with permissions scoped to each repo
- Shared editor config (`.editorconfig`, `.prettierrc`)
- Workspace-level documentation or scripts

### Repo scope

Repo templates live in `.arb/templates/repos/<name>/` and are overlaid into the corresponding repo. Use them for files that belong inside individual repos.

Typical uses:
- `.env` files with service-specific defaults
- Local config overrides (`.vscode/settings.json`)
- Git hooks or tool config

### Directory structure

```
.arb/
  templates/
    workspace/                    # → overlaid onto <workspace>/
      .editorconfig               #     plain file, copied verbatim
      .claude/
        settings.local.json.arbtemplate  #     rendered, .arbtemplate stripped
      .idea/
        jb-workspace.xml.arbtemplate
    repos/
      api/                        # → overlaid onto <workspace>/api/
        .env
      web/                        # → overlaid onto <workspace>/web/
        .env
```

The template tree mirrors the workspace structure. `workspace/` files land at the workspace root, `repos/<name>/` files land inside the corresponding repo.

## Template lifecycle

### Initial seed on `arb create`

When you create a workspace, all templates are rendered and copied into the new workspace:

1. Workspace templates are overlaid onto the workspace root
2. Repo templates are overlaid into each attached repo

Every file that doesn't already exist at the destination is **seeded** — written for the first time.

```bash
arb create my-feature --all-repos
# → Seeded 5 template file(s)
```

### Regeneration on `arb attach`

When repos are added to an existing workspace, templates are re-evaluated:

1. Repo templates for the newly attached repos are seeded (the new repos didn't have them yet)
2. All `.arbtemplate` files across both scopes are checked — if a template's output would change because the repo list grew (e.g. a `{% for repo in workspace.repos %}` loop now has an extra entry), the file is regenerated

```bash
arb attach shared
# → Seeded 1 template file(s), regenerated 2
```

### Regeneration on `arb detach`

When repos are removed, the same regeneration logic runs for the remaining repos. Templates that reference `workspace.repos` are re-rendered to reflect the smaller membership.

```bash
arb detach shared
# → Regenerated 2 template file(s)
```

### Drift detection on `arb delete`

Before deleting a workspace, arb checks whether any template-generated files have been modified. If they have, the modified files are listed so you can capture changes back into your templates before the workspace is gone.

### Manual re-application

`arb template apply` re-seeds missing files into an existing workspace. Combined with `--force`, it also resets drifted files to the current template output:

```bash
arb template apply              # seed only missing files (safe, non-destructive)
arb template apply --force      # also overwrite files that differ from template output
```

### No templates directory?

If `.arb/templates/` doesn't exist, all template operations are silently skipped — zero noise.

## User-edit protection

Template files are only copied when the target doesn't already exist. Once seeded, the file belongs to the workspace and you're free to edit it. Arborist never overwrites your changes during normal operation.

### How regeneration protects edits

When a membership change triggers regeneration of `.arbtemplate` files, arborist uses a three-way comparison to decide whether overwriting is safe:

1. **Render with new context** — render the template with the updated repo list
2. **Compare to existing file** — if the file already matches the new render, it's already correct → **skip**
3. **Render with previous context** — reconstruct the repo list from *before* the membership change and render the template with it
4. **Compare existing to previous render:**
   - Matches previous render → user hasn't touched it → safe to overwrite → **regenerated**
   - Differs from previous render → user has edited → **skipped** (not overwritten)

The previous state is reconstructed by reversing the membership change: on attach, the newly added repos are removed from the current list; on detach, the removed repos are added back.

This means:
- If you've never edited a template-generated file, it stays in sync automatically as repos come and go
- If you've customized a file, your edits are always preserved — arborist never silently overwrites them
- If you want to reset a file to the template version, use `arb template apply --force`

### Detecting drift

Use `arb template diff` to see which files have diverged from their templates:

```bash
arb template diff                   # show all drift
arb template diff .env --repo api   # check a specific file
```

`arb template list` also annotates modified files when run inside a workspace.

## LiquidJS rendering

Files ending with `.arbtemplate` are rendered with [LiquidJS](https://liquidjs.com/) when seeded or regenerated. The extension is stripped at the destination (`config.json.arbtemplate` → `config.json`). Files without the extension are copied verbatim.

### Available variables

| Variable | Value | Scope |
|---|---|---|
| `{{ root.path }}` | Absolute path to the arb root | all |
| `{{ workspace.name }}` | Workspace directory name | all |
| `{{ workspace.path }}` | Absolute path to the workspace | all |
| `{{ workspace.repos }}` | Array of repo objects (each has `name`, `path`, `baseRemote`, `shareRemote`) | all |
| `{{ repo.name }}` | Repo directory name | repo only |
| `{{ repo.path }}` | Absolute path to the repo | repo only |
| `{{ repo.baseRemote.name }}` | Git remote name for the base (integration target) | repo only |
| `{{ repo.baseRemote.url }}` | Git remote URL for the base | repo only |
| `{{ repo.shareRemote.name }}` | Git remote name for sharing (push/pull) | repo only |
| `{{ repo.shareRemote.url }}` | Git remote URL for sharing | repo only |

The same `baseRemote` and `shareRemote` fields are available on each item in `workspace.repos` (e.g. `repo.baseRemote.url` in a `{% for %}` loop) in all scopes.

`repo.*` variables are only populated in repo-scoped templates. `workspace.repos` is available in all scopes — a repo template can reference sibling repos.

The base remote is the integration target (rebase/merge towards), while the share remote is where feature branches are pushed. In fork workflows these point to different remotes (`upstream` vs `origin`). If remotes can't be resolved for a repo, both fields default to empty strings.

### Iteration

Use `{% for %}` loops to generate content for each repo in the workspace:

```liquid
{% for repo in workspace.repos %}
  {{ repo.name }}: {{ repo.path }}
{% endfor %}
```

Use `forloop.last` for trailing comma handling in JSON:

```liquid
{%- for repo in workspace.repos %}
"{{ repo.name }}"{% unless forloop.last %},{% endunless %}
{%- endfor %}
```

Use `{%-` and `-%}` for whitespace control — the `-` strips whitespace on that side of the tag.

### Static vs dynamic files

Not every template needs LiquidJS. A plain file without the `.arbtemplate` extension is copied verbatim — no rendering, no variables. Use plain files for static content like `.env` defaults. Use `.arbtemplate` when the content depends on workspace context.

If both `file.json` and `file.json.arbtemplate` exist in the same template directory, arb reports a conflict and skips the file.

## Examples

### Claude Code permissions per repo

Grant file access and tool permissions scoped to each repo in the workspace.

`.arb/templates/workspace/.claude/settings.local.json.arbtemplate`:

```liquid
{
  "permissions": {
    "allow": [
      "Bash(arb:*)",
      "Bash(git status)",
{%- for repo in workspace.repos %}
      "Bash(arb -C {{ repo.path }} :*)",
      "Bash(git -C {{ repo.path }} status)",
{%- endfor %}
      "Read({{ workspace.path }}/**)",
      "Write({{ workspace.path }}/**)"
    ]
  }
}
```

When you attach or detach repos, the permissions list is regenerated to include exactly the repos in the current workspace.

### JetBrains workspace with all repos

Register each repo as a separate project in a JetBrains IDE workspace.

`.arb/templates/workspace/.idea/jb-workspace.xml.arbtemplate`:

```liquid
<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="WorkspaceSettings">
{%- for repo in workspace.repos %}
    <project name="{{ repo.name }}" path="$PROJECT_DIR$/{{ repo.name }}">
      <vcs id="Git" remoteUrl="{{ repo.shareRemote.url }}" />
    </project>
{%- endfor %}
    <option name="workspace" value="true" />
  </component>
</project>
```

### Static `.env` per repo

It is common for repos to contain an `.env.example` file that you are expected to copy to `.env` and customize.

`.arb/templates/repos/api/.env`:

```
DATABASE_URL=postgres://localhost:5432/myapp_dev
REDIS_URL=redis://localhost:6379
```

`.arb/templates/repos/web/.env`:

```
API_URL=http://localhost:3000
```

## Version-controlling templates

`arb init` creates `.arb/.gitignore` with a `repos/` entry, which means everything else in `.arb/` — including `templates/` — is version-controllable. You can commit your templates to a dotfiles repo, a team bootstrap repo, or just keep them local.
