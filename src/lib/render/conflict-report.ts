import { cell } from "./model";
import type { OutputNode } from "./model";

export interface ConflictEntry {
  repo: string;
  stdout: string;
  stderr: string;
  /** The arb command name: "rebase", "merge", "pull", "retarget" */
  mode: string;
}

export function buildConflictReport(entries: ConflictEntry[]): OutputNode[] {
  if (entries.length === 0) return [];
  const header = entries.length === 1 ? "1 repo has conflicts:" : `${entries.length} repos have conflicts:`;
  const nodes: OutputNode[] = [{ kind: "gap" }, { kind: "message", level: "default", text: header }];
  for (const e of entries) {
    const combined = `${e.stdout}\n${e.stderr}`;
    const conflictLines = combined.split("\n").filter((l) => l.startsWith("CONFLICT"));
    nodes.push(
      { kind: "gap" },
      {
        kind: "section",
        header: cell(e.repo),
        items: conflictLines.map((line) => cell(line, "muted")),
      },
    );
  }
  // Safe: guarded by early return when entries is empty
  const mode = entries[0]?.mode ?? "rebase";
  const gitSub = mode === "merge" ? "merge" : "rebase";
  nodes.push(
    { kind: "gap" },
    { kind: "message", level: "default", text: `Fix conflicts, then: arb ${mode} --continue` },
    { kind: "message", level: "default", text: `Or to abort:         arb ${mode} --abort` },
    {
      kind: "message",
      level: "muted",
      text: `                     (or use git ${gitSub} --continue/--abort per repo)`,
    },
  );
  return nodes;
}

export function buildStashPopFailureReport(repos: { repo: string }[], verb: string): OutputNode[] {
  if (repos.length === 0) return [];
  const nodes: OutputNode[] = [
    { kind: "gap" },
    {
      kind: "message",
      level: "default",
      text: `${repos.length === 1 ? "1 repo needs" : `${repos.length} repos need`} manual stash resolution:`,
    },
  ];
  for (const r of repos) {
    nodes.push(
      { kind: "gap" },
      {
        kind: "section",
        header: cell(r.repo),
        items: [
          cell(`${verb} succeeded, but stash pop conflicted.`),
          cell("Resolve the conflict markers, then:"),
          cell(`  cd ${r.repo}`),
          cell("  git add <resolved files>"),
          cell("  git stash drop         # remove the preserved stash entry"),
        ],
      },
    );
  }
  return nodes;
}
