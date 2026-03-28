import type { OperationRecord } from "../../core/operation";
import type { Cell, OutputNode } from "../../render/model";
import { cell, suffix } from "../../render/model";
import { type RenderContext, render } from "../../render/render";
import { verboseCommitsToNodes } from "../../render/status-verbose";
import { plural } from "../../terminal/output";
import { shouldColor } from "../../terminal/tty";
import type { RepoUndoAssessment, UndoStats } from "./types";

export function formatUndoPlan(
  record: OperationRecord,
  assessments: RepoUndoAssessment[],
  verb: "undo" | "abort",
  verbose?: boolean,
): string {
  const commandLabel = record.command === "branch-rename" ? "branch rename" : record.command;
  const verbLabel = verb === "abort" ? "Abort" : "Undo";

  const nodes: OutputNode[] = [
    { kind: "gap" },
    { kind: "message", level: "default", text: `${verbLabel} ${commandLabel} from ${formatTime(record.startedAt)}` },
    { kind: "gap" },
  ];

  const rows = assessments
    .filter((a) => a.action !== "skip")
    .map((a) => {
      let actionCell: Cell;
      let afterRow: OutputNode[] | undefined;
      switch (a.action) {
        case "needs-undo": {
          actionCell = a.forced ? cell(a.detail ?? "undo", "attention") : cell(a.detail ?? "undo");
          if (a.stats?.hasStash) {
            actionCell = suffix(actionCell, `, restore stash${stashFilesSuffix(a.stats)}`, "default");
          }
          if (verbose && a.verbose?.commits && a.verbose.commits.length > 0) {
            afterRow = verboseCommitsToNodes(a.verbose.commits, a.verbose.totalCommits, "Rolling back:", {
              diffStats: a.verbose.diffStats,
            });
          }
          break;
        }
        case "needs-abort":
          actionCell = cell(a.detail ?? "abort in-progress operation");
          break;
        case "already-at-target":
          actionCell = cell("already at original state", "muted");
          break;
        case "already-undone":
          actionCell = cell("already undone", "muted");
          break;
        case "no-action":
          actionCell = cell(a.detail ?? "no action needed", "muted");
          break;
        case "drifted":
          actionCell = cell(`drifted — ${a.detail}`, "danger");
          break;
        default:
          actionCell = cell("unknown");
      }
      return { cells: { repo: cell(a.repo), action: actionCell }, afterRow };
    });

  nodes.push({
    kind: "table",
    columns: [
      { header: "REPO", key: "repo" },
      { header: "ACTION", key: "action" },
    ],
    rows,
  });

  nodes.push({ kind: "gap" });

  const rCtx: RenderContext = { tty: shouldColor() };
  return render(nodes, rCtx);
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function stashFilesSuffix(stats: UndoStats): string {
  return stats.stashFilesChanged != null && stats.stashFilesChanged > 0
    ? ` (${plural(stats.stashFilesChanged, "file")})`
    : "";
}
