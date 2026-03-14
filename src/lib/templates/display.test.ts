import { describe, expect, test } from "bun:test";
import type { OutputNode, SectionNode } from "../render/model";
import {
  displayAggregatedTemplateDiffs,
  displayOverlaySummary,
  displayRepoDirectoryWarnings,
  displayTemplateConflicts,
  displayTemplateDiffs,
  displayUnknownVariables,
} from "./display";
import type { ConflictInfo, OverlayResult, TemplateDiff, UnknownVariable } from "./types";

// ── Helpers ──

function emptyOverlay(): OverlayResult {
  return {
    seeded: [],
    skipped: [],
    regenerated: [],
    conflicts: [],
    failed: [],
    unknownVariables: [],
    repoDirectoryWarnings: [],
    seededHashes: {},
  };
}

function sections(nodes: OutputNode[]): SectionNode[] {
  return nodes.filter((n): n is SectionNode => n.kind === "section");
}

// ── displayUnknownVariables ──

describe("displayUnknownVariables", () => {
  test("returns empty array when no unknowns", () => {
    expect(displayUnknownVariables([])).toEqual([]);
  });

  test("returns gap + section for a single unknown", () => {
    const unknowns: UnknownVariable[] = [{ varName: "FOO", filePath: "a.txt" }];
    const result = displayUnknownVariables(unknowns);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ kind: "gap" });
    const section = result[1] as SectionNode;
    expect(section.kind).toBe("section");
    expect(section.header.plain).toBe("Unknown template variables");
    expect(section.header.spans[0]?.attention).toBe("attention");
    expect(section.items).toHaveLength(1);
    expect(section.items[0]?.plain).toBe("'FOO' in a.txt");
  });

  test("lists multiple unknowns as separate items", () => {
    const unknowns: UnknownVariable[] = [
      { varName: "A", filePath: "x.txt" },
      { varName: "B", filePath: "y.txt" },
    ];
    const result = displayUnknownVariables(unknowns);
    const section = result[1] as SectionNode;
    expect(section.items).toHaveLength(2);
    expect(section.items[0]?.plain).toBe("'A' in x.txt");
    expect(section.items[1]?.plain).toBe("'B' in y.txt");
  });
});

// ── displayTemplateDiffs ──

describe("displayTemplateDiffs", () => {
  test("returns empty array for no diffs", () => {
    expect(displayTemplateDiffs([])).toEqual([]);
  });

  test("shows modified section", () => {
    const diffs: TemplateDiff[] = [{ relPath: "a.txt", scope: "workspace", kind: "modified" }];
    const result = displayTemplateDiffs(diffs);
    const secs = sections(result);
    expect(secs).toHaveLength(1);
    expect(secs[0]?.header.plain).toBe("Template files modified");
    expect(secs[0]?.items[0]?.plain).toBe("a.txt");
  });

  test("shows deleted section", () => {
    const diffs: TemplateDiff[] = [{ relPath: "b.txt", scope: "workspace", kind: "deleted" }];
    const result = displayTemplateDiffs(diffs);
    const secs = sections(result);
    expect(secs).toHaveLength(1);
    expect(secs[0]?.header.plain).toBe("Template files deleted");
  });

  test("shows stale section with muted attention", () => {
    const diffs: TemplateDiff[] = [{ relPath: "c.txt", scope: "workspace", kind: "stale" }];
    const result = displayTemplateDiffs(diffs);
    const secs = sections(result);
    expect(secs).toHaveLength(1);
    expect(secs[0]?.header.plain).toBe("Template files with newer version available");
    expect(secs[0]?.header.spans[0]?.attention).toBe("muted");
  });

  test("shows all three sections when mixed kinds", () => {
    const diffs: TemplateDiff[] = [
      { relPath: "a.txt", scope: "workspace", kind: "modified" },
      { relPath: "b.txt", scope: "workspace", kind: "deleted" },
      { relPath: "c.txt", scope: "workspace", kind: "stale" },
    ];
    const result = displayTemplateDiffs(diffs);
    const secs = sections(result);
    expect(secs).toHaveLength(3);
    expect(secs[0]?.header.plain).toContain("modified");
    expect(secs[1]?.header.plain).toContain("deleted");
    expect(secs[2]?.header.plain).toContain("newer version");
  });

  test("prefixes repo-scoped diffs with [repo]", () => {
    const diffs: TemplateDiff[] = [{ relPath: "config.json", scope: "repo", repo: "frontend", kind: "modified" }];
    const result = displayTemplateDiffs(diffs);
    const secs = sections(result);
    expect(secs[0]?.items[0]?.plain).toBe("[frontend] config.json");
  });

  test("does not prefix workspace-scoped diffs", () => {
    const diffs: TemplateDiff[] = [{ relPath: "config.json", scope: "workspace", kind: "modified" }];
    const result = displayTemplateDiffs(diffs);
    const secs = sections(result);
    expect(secs[0]?.items[0]?.plain).toBe("config.json");
  });

  test("appends suffix to section headers", () => {
    const diffs: TemplateDiff[] = [{ relPath: "a.txt", scope: "workspace", kind: "modified" }];
    const result = displayTemplateDiffs(diffs, " (workspace: my-ws)");
    const secs = sections(result);
    expect(secs[0]?.header.plain).toBe("Template files modified (workspace: my-ws)");
  });

  test("inserts gap after each section", () => {
    const diffs: TemplateDiff[] = [
      { relPath: "a.txt", scope: "workspace", kind: "modified" },
      { relPath: "b.txt", scope: "workspace", kind: "deleted" },
    ];
    const result = displayTemplateDiffs(diffs);
    // pattern: section, gap, section, gap
    expect(result[0]?.kind).toBe("section");
    expect(result[1]?.kind).toBe("gap");
    expect(result[2]?.kind).toBe("section");
    expect(result[3]?.kind).toBe("gap");
  });
});

// ── displayAggregatedTemplateDiffs ──

describe("displayAggregatedTemplateDiffs", () => {
  test("returns empty array when all workspaces have no diffs", () => {
    const assessments = [
      { name: "ws-a", templateDiffs: [] },
      { name: "ws-b", templateDiffs: [] },
    ];
    expect(displayAggregatedTemplateDiffs(assessments)).toEqual([]);
  });

  test("groups modified diffs by workspace", () => {
    const assessments = [
      {
        name: "ws-a",
        templateDiffs: [{ relPath: "a.txt", scope: "workspace" as const, kind: "modified" as const }],
      },
    ];
    const result = displayAggregatedTemplateDiffs(assessments);
    const secs = sections(result);
    expect(secs).toHaveLength(1);
    expect(secs[0]?.header.plain).toBe("Template files modified");
    expect(secs[0]?.items[0]?.plain).toBe("[ws-a] a.txt");
  });

  test("groups deleted diffs by workspace", () => {
    const assessments = [
      {
        name: "ws-a",
        templateDiffs: [{ relPath: "b.txt", scope: "workspace" as const, kind: "deleted" as const }],
      },
    ];
    const result = displayAggregatedTemplateDiffs(assessments);
    const secs = sections(result);
    expect(secs).toHaveLength(1);
    expect(secs[0]?.header.plain).toBe("Template files deleted");
  });

  test("shows both modified and deleted sections", () => {
    const assessments = [
      {
        name: "ws-a",
        templateDiffs: [
          { relPath: "a.txt", scope: "workspace" as const, kind: "modified" as const },
          { relPath: "b.txt", scope: "workspace" as const, kind: "deleted" as const },
        ],
      },
    ];
    const result = displayAggregatedTemplateDiffs(assessments);
    const secs = sections(result);
    expect(secs).toHaveLength(2);
    expect(secs[0]?.header.plain).toBe("Template files modified");
    expect(secs[1]?.header.plain).toBe("Template files deleted");
  });

  test("aggregates multiple workspaces into separate items", () => {
    const assessments = [
      {
        name: "ws-a",
        templateDiffs: [{ relPath: "a.txt", scope: "workspace" as const, kind: "modified" as const }],
      },
      {
        name: "ws-b",
        templateDiffs: [{ relPath: "b.txt", scope: "workspace" as const, kind: "modified" as const }],
      },
    ];
    const result = displayAggregatedTemplateDiffs(assessments);
    const secs = sections(result);
    expect(secs).toHaveLength(1);
    expect(secs[0]?.items).toHaveLength(2);
    expect(secs[0]?.items[0]?.plain).toBe("[ws-a] a.txt");
    expect(secs[0]?.items[1]?.plain).toBe("[ws-b] b.txt");
  });

  test("prefixes repo-scoped diffs with repo name", () => {
    const assessments = [
      {
        name: "ws-a",
        templateDiffs: [{ relPath: "config.json", scope: "repo" as const, repo: "api", kind: "modified" as const }],
      },
    ];
    const result = displayAggregatedTemplateDiffs(assessments);
    const secs = sections(result);
    expect(secs[0]?.items[0]?.plain).toBe("[ws-a] api/config.json");
  });

  test("joins multiple files from the same workspace with commas", () => {
    const assessments = [
      {
        name: "ws-a",
        templateDiffs: [
          { relPath: "a.txt", scope: "workspace" as const, kind: "modified" as const },
          { relPath: "b.txt", scope: "workspace" as const, kind: "modified" as const },
        ],
      },
    ];
    const result = displayAggregatedTemplateDiffs(assessments);
    const secs = sections(result);
    expect(secs[0]?.items[0]?.plain).toBe("[ws-a] a.txt, b.txt");
  });
});

// ── displayTemplateConflicts ──

describe("displayTemplateConflicts", () => {
  test("returns empty array for no conflicts", () => {
    expect(displayTemplateConflicts([])).toEqual([]);
  });

  test("shows workspace-scope conflict with correct path", () => {
    const conflicts: ConflictInfo[] = [{ scope: "workspace", relPath: "setup.sh" }];
    const result = displayTemplateConflicts(conflicts);
    expect(result[0]).toEqual({ kind: "gap" });
    const section = result[1] as SectionNode;
    expect(section.kind).toBe("section");
    expect(section.header.plain).toContain("Conflicting templates");
    expect(section.items[0]?.plain).toContain(".arb/templates/workspace/setup.sh");
    expect(section.items[0]?.plain).toContain("setup.sh.arbtemplate");
  });

  test("shows repo-scope conflict with repo-specific path", () => {
    const conflicts: ConflictInfo[] = [{ scope: "repo", repo: "backend", relPath: ".env" }];
    const result = displayTemplateConflicts(conflicts);
    const section = result[1] as SectionNode;
    expect(section.items[0]?.plain).toContain(".arb/templates/repos/backend/.env");
    expect(section.items[0]?.plain).toContain(".env.arbtemplate");
  });

  test("lists multiple conflicts as separate items", () => {
    const conflicts: ConflictInfo[] = [
      { scope: "workspace", relPath: "a.txt" },
      { scope: "repo", repo: "api", relPath: "b.txt" },
    ];
    const result = displayTemplateConflicts(conflicts);
    const section = result[1] as SectionNode;
    expect(section.items).toHaveLength(2);
  });
});

// ── displayRepoDirectoryWarnings ──

describe("displayRepoDirectoryWarnings", () => {
  test("returns empty array for no warnings", () => {
    expect(displayRepoDirectoryWarnings([])).toEqual([]);
  });

  test("shows warnings with repo-scoped template hint", () => {
    const result = displayRepoDirectoryWarnings(["frontend"]);
    expect(result[0]).toEqual({ kind: "gap" });
    const section = result[1] as SectionNode;
    expect(section.kind).toBe("section");
    expect(section.header.plain).toContain("Workspace templates target repo directories");
    expect(section.items[0]?.plain).toContain("'frontend/'");
    expect(section.items[0]?.plain).toContain(".arb/templates/repos/frontend/");
  });

  test("lists multiple warnings", () => {
    const result = displayRepoDirectoryWarnings(["frontend", "backend"]);
    const section = result[1] as SectionNode;
    expect(section.items).toHaveLength(2);
    expect(section.items[0]?.plain).toContain("'frontend/'");
    expect(section.items[1]?.plain).toContain("'backend/'");
  });
});

// ── displayOverlaySummary ──

describe("displayOverlaySummary", () => {
  test("does nothing when both results are empty", () => {
    let rendered = false;
    displayOverlaySummary(emptyOverlay(), emptyOverlay(), () => {
      rendered = true;
      return "";
    });
    expect(rendered).toBe(false);
  });

  test("calls renderFn when there are conflicts", () => {
    const ws = emptyOverlay();
    ws.conflicts = [{ scope: "workspace", relPath: "a.txt" }];
    let renderedNodes: OutputNode[] = [];
    displayOverlaySummary(ws, emptyOverlay(), (nodes) => {
      renderedNodes = nodes;
      return "rendered";
    });
    expect(renderedNodes.length).toBeGreaterThan(0);
    expect(renderedNodes.some((n) => n.kind === "section")).toBe(true);
  });

  test("calls renderFn when there are unknown variables", () => {
    const repo = emptyOverlay();
    repo.unknownVariables = [{ varName: "X", filePath: "f.txt" }];
    let renderedNodes: OutputNode[] = [];
    displayOverlaySummary(emptyOverlay(), repo, (nodes) => {
      renderedNodes = nodes;
      return "rendered";
    });
    const secs = sections(renderedNodes);
    expect(secs.some((s) => s.header.plain.includes("Unknown template variables"))).toBe(true);
  });

  test("includes repo directory warnings from workspace result", () => {
    const ws = emptyOverlay();
    ws.repoDirectoryWarnings = ["frontend"];
    let renderedNodes: OutputNode[] = [];
    displayOverlaySummary(ws, emptyOverlay(), (nodes) => {
      renderedNodes = nodes;
      return "rendered";
    });
    const secs = sections(renderedNodes);
    expect(secs.some((s) => s.header.plain.includes("repo directories"))).toBe(true);
  });

  test("merges conflicts from both ws and repo results", () => {
    const ws = emptyOverlay();
    ws.conflicts = [{ scope: "workspace", relPath: "a.txt" }];
    const repo = emptyOverlay();
    repo.conflicts = [{ scope: "repo", repo: "api", relPath: "b.txt" }];
    let renderedNodes: OutputNode[] = [];
    displayOverlaySummary(ws, repo, (nodes) => {
      renderedNodes = nodes;
      return "rendered";
    });
    const conflictSection = sections(renderedNodes).find((s) => s.header.plain.includes("Conflicting"));
    expect(conflictSection?.items).toHaveLength(2);
  });
});
