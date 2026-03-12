import { basename } from "node:path";
import { cell } from "../render/model";
import type { Cell, OutputNode } from "../render/model";
import { info, plural, warn } from "../terminal/output";
import {
  ARBTEMPLATE_EXT,
  type ConflictInfo,
  type OverlayResult,
  type TemplateDiff,
  type UnknownVariable,
} from "./types";

export function displayUnknownVariables(unknowns: UnknownVariable[]): OutputNode[] {
  if (unknowns.length === 0) return [];
  return [
    { kind: "gap" },
    {
      kind: "section",
      header: cell("Unknown template variables", "attention"),
      items: unknowns.map(({ varName, filePath }) => cell(`'${varName}' in ${filePath}`)),
    },
  ];
}

export function displayTemplateDiffs(templateDiffs: TemplateDiff[], suffix?: string): OutputNode[] {
  if (templateDiffs.length === 0) return [];
  const nodes: OutputNode[] = [];
  const modified = templateDiffs.filter((d) => d.kind === "modified");
  const deleted = templateDiffs.filter((d) => d.kind === "deleted");
  const stale = templateDiffs.filter((d) => d.kind === "stale");
  if (modified.length > 0) {
    nodes.push({
      kind: "section",
      header: cell(`Template files modified${suffix ?? ""}`, "attention"),
      items: modified.map((diff) => {
        const prefix = diff.scope === "repo" ? `[${diff.repo}] ` : "";
        return cell(`${prefix}${diff.relPath}`);
      }),
    });
    nodes.push({ kind: "gap" });
  }
  if (deleted.length > 0) {
    nodes.push({
      kind: "section",
      header: cell(`Template files deleted${suffix ?? ""}`, "attention"),
      items: deleted.map((diff) => {
        const prefix = diff.scope === "repo" ? `[${diff.repo}] ` : "";
        return cell(`${prefix}${diff.relPath}`);
      }),
    });
    nodes.push({ kind: "gap" });
  }
  if (stale.length > 0) {
    nodes.push({
      kind: "section",
      header: cell(`Template files with newer version available${suffix ?? ""}`, "muted"),
      items: stale.map((diff) => {
        const prefix = diff.scope === "repo" ? `[${diff.repo}] ` : "";
        return cell(`${prefix}${diff.relPath}`);
      }),
    });
    nodes.push({ kind: "gap" });
  }
  return nodes;
}

/** Aggregate template diffs across multiple workspaces into unified sections. */
export function displayAggregatedTemplateDiffs(
  assessments: { name: string; templateDiffs: TemplateDiff[] }[],
): OutputNode[] {
  if (assessments.every((a) => a.templateDiffs.length === 0)) return [];

  // Group by workspace, then by kind
  const byWsKind = new Map<string, Map<string, string[]>>();
  for (const a of assessments) {
    for (const diff of a.templateDiffs) {
      let wsMap = byWsKind.get(a.name);
      if (!wsMap) {
        wsMap = new Map();
        byWsKind.set(a.name, wsMap);
      }
      let files = wsMap.get(diff.kind);
      if (!files) {
        files = [];
        wsMap.set(diff.kind, files);
      }
      const prefix = diff.scope === "repo" ? `${diff.repo}/` : "";
      files.push(`${prefix}${diff.relPath}`);
    }
  }

  const buildItems = (kind: string) => {
    const items: Cell[] = [];
    for (const [ws, wsMap] of byWsKind) {
      const files = wsMap.get(kind);
      if (files) {
        items.push(cell(`[${ws}] ${files.join(", ")}`));
      }
    }
    return items;
  };

  const nodes: OutputNode[] = [];
  const modItems = buildItems("modified");
  if (modItems.length > 0) {
    nodes.push({
      kind: "section",
      header: cell("Template files modified", "attention"),
      items: modItems,
    });
    nodes.push({ kind: "gap" });
  }
  const delItems = buildItems("deleted");
  if (delItems.length > 0) {
    nodes.push({
      kind: "section",
      header: cell("Template files deleted", "attention"),
      items: delItems,
    });
    nodes.push({ kind: "gap" });
  }
  return nodes;
}

export function displayTemplateConflicts(conflicts: ConflictInfo[]): OutputNode[] {
  if (conflicts.length === 0) return [];
  return [
    { kind: "gap" },
    {
      kind: "section",
      header: cell("Conflicting templates (both plain and .arbtemplate versions exist)", "attention"),
      items: conflicts.map((c) => {
        const tplDir = c.scope === "workspace" ? ".arb/templates/workspace" : `.arb/templates/repos/${c.repo}`;
        const arbtplName = `${basename(c.relPath)}${ARBTEMPLATE_EXT}`;
        return cell(`remove either ${tplDir}/${c.relPath} or ${arbtplName}`);
      }),
    },
  ];
}

export function displayRepoDirectoryWarnings(warnings: string[]): OutputNode[] {
  if (warnings.length === 0) return [];
  return [
    { kind: "gap" },
    {
      kind: "section",
      header: cell("Workspace templates target repo directories", "attention"),
      items: warnings.map((dir) => cell(`'${dir}/' — use .arb/templates/repos/${dir}/ for repo-scoped templates`)),
    },
  ];
}

export function displayOverlaySummary(
  wsResult: OverlayResult,
  repoResult: OverlayResult,
  renderFn: (nodes: OutputNode[]) => string,
): void {
  const totalSeeded = wsResult.seeded.length + repoResult.seeded.length;
  const totalRegenerated = wsResult.regenerated.length + repoResult.regenerated.length;
  if (totalSeeded > 0) info(`Seeded ${plural(totalSeeded, "template file")}`);
  if (totalRegenerated > 0) info(`Regenerated ${plural(totalRegenerated, "template file")}`);
  const nodes: OutputNode[] = [...displayTemplateConflicts([...wsResult.conflicts, ...repoResult.conflicts])];
  for (const f of [...wsResult.failed, ...repoResult.failed]) {
    warn(`Failed to copy template ${f.path}: ${f.error}`);
  }
  nodes.push(
    ...displayUnknownVariables([...wsResult.unknownVariables, ...repoResult.unknownVariables]),
    ...displayRepoDirectoryWarnings(wsResult.repoDirectoryWarnings),
  );
  if (nodes.length > 0) {
    process.stderr.write(renderFn(nodes));
  }
}
