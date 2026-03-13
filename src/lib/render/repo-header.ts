import type { RepoFlags, RepoStatus } from "../status/types";
import { cell } from "./model";
import type { OutputNode, RepoHeaderNode } from "./model";

/**
 * Build a RepoHeaderNode with an optional note (dimmed by default).
 */
export function repoHeaderNode(name: string, note?: string): RepoHeaderNode {
  return {
    kind: "repoHeader",
    name,
    note: note ? cell(note, "muted") : undefined,
  };
}

/**
 * Check for detached/wrong-branch skip conditions and return skip header nodes.
 * Returns null if the repo was not skipped (caller should continue to render the repo).
 * Includes a trailing GapNode when `isLast` is false.
 */
export function buildRepoSkipHeader(
  repo: RepoStatus,
  branch: string,
  flags: RepoFlags,
  isLast: boolean,
): OutputNode[] | null {
  let skipNote: string | undefined;

  if (flags.isDetached) {
    skipNote = "detached \u2014 skipping";
  } else if (flags.isWrongBranch && repo.identity.headMode.kind === "attached") {
    const actual = repo.identity.headMode.branch;
    skipNote = `on ${actual}, expected ${branch} \u2014 skipping`;
  }

  if (!skipNote) return null;

  const nodes: OutputNode[] = [
    {
      kind: "repoHeader",
      name: repo.name,
      note: cell(skipNote, "attention"),
    },
  ];
  if (!isLast) nodes.push({ kind: "gap" });
  return nodes;
}
