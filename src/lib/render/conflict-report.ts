import { cell } from "./model";
import type { OutputNode } from "./model";

export interface ConflictEntry {
  repo: string;
  stdout: string;
  stderr: string;
  subcommand: "rebase" | "merge";
}

export function buildConflictReport(entries: ConflictEntry[]): OutputNode[] {
  if (entries.length === 0) return [];
  const nodes: OutputNode[] = [
    { kind: "gap" },
    { kind: "message", level: "default", text: `${entries.length} repo(s) have conflicts:` },
  ];
  for (const e of entries) {
    const combined = `${e.stdout}\n${e.stderr}`;
    const conflictLines = combined.split("\n").filter((l) => l.startsWith("CONFLICT"));
    nodes.push(
      { kind: "gap" },
      {
        kind: "section",
        header: cell(e.repo),
        items: [
          ...conflictLines.map((line) => cell(line, "muted")),
          cell(`cd ${e.repo}`),
          cell(`# fix conflicts, then: git ${e.subcommand} --continue`),
          cell(`# or to undo: git ${e.subcommand} --abort`),
          cell(`# or from workspace root: arb ${e.subcommand} --continue  /  arb ${e.subcommand} --abort`, "muted"),
        ],
      },
    );
  }
  return nodes;
}

export function buildStashPopFailureReport(repos: { repo: string }[], verb: string): OutputNode[] {
  if (repos.length === 0) return [];
  const nodes: OutputNode[] = [
    { kind: "gap" },
    { kind: "message", level: "default", text: `${repos.length} repo(s) need manual stash application:` },
  ];
  for (const r of repos) {
    nodes.push(
      { kind: "gap" },
      {
        kind: "section",
        header: cell(r.repo),
        items: [
          cell(`${verb} succeeded, but stash pop conflicted.`),
          cell(`cd ${r.repo}`),
          cell("git stash pop    # re-apply and resolve conflicts"),
          cell("# or: git stash show  # inspect stashed changes"),
        ],
      },
    );
  }
  return nodes;
}
