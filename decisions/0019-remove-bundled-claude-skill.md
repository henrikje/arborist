# Remove Bundled Claude Code Skill

Date: 2026-02-20

## Context

Arborist shipped a Claude Code skill (`skill/SKILL.md` + `skill/references/commands.md`) that taught Claude how to drive `arb` commands. The installer copied these files into `~/.claude/skills/arb/` when Claude Code was detected. Documentation referenced the skill in several places, including a dedicated `docs/ai-agents.md` page.

The skill was a vendor-specific extension in an otherwise vendor-agnostic tool, and wasn't ready for general use yet.

## Options

### Remove skill files and all Claude-specific content
Remove the skill directory, installer section, `docs/ai-agents.md`, Claude Code template examples, and all references.
- **Pros:** Clean break. Repo becomes fully vendor-agnostic. No vestigial references.
- **Cons:** Loses the general advice in `ai-agents.md` about using `arb exec` with AI agents.

### Remove skill files, keep general AI agent guidance
Remove Claude-specific content but keep `docs/ai-agents.md` with vendor-neutral advice.
- **Pros:** Preserves useful operational tips about `arb exec` with agents.
- **Cons:** The file becomes very thin once Claude-specific material is stripped — just "start from workspace root" and two examples.

## Decision

Remove everything — skill files, installer section, `docs/ai-agents.md`, Claude Code template examples, and all references.

## Reasoning

The `ai-agents.md` content is thin once stripped of Claude-specific material: "start from the workspace root" and two `arb exec` examples. That level of advice fits better as a sentence in the `arb exec` docs than as a standalone page. A clean removal is simpler and leaves no loose ends. If general AI agent guidance is wanted later, it can be added without the Claude baggage.

The skill itself can continue to live locally outside the repo for personal use without coupling the project to a specific vendor.

## Consequences

Arborist is vendor-agnostic. The installer no longer touches `~/.claude/`. Any future AI integration would be designed as a general-purpose feature (e.g., machine-readable output, `--json` flags) rather than a vendor-specific skill.
