import { describe, expect, test } from "bun:test";
import type { ExtractAssessment } from "../lib/sync/types";
import { formatExtractPlan } from "./extract";

const DIR = "/tmp/test";

function makeAssessment(overrides: Partial<ExtractAssessment> = {}): ExtractAssessment {
  return {
    repo: "repo-a",
    repoDir: `${DIR}/repo-a`,
    branch: "ws",
    direction: "prefix",
    targetBranch: "prereq",
    boundary: "abc1234def",
    mergeBase: "000base",
    commitsExtracted: 3,
    commitsRemaining: 2,
    headSha: "fff9999",
    shallow: false,
    baseRemote: "origin",
    outcome: "will-extract",
    ...overrides,
  } as ExtractAssessment;
}

// ── Prefix plan ──

describe("formatExtractPlan (prefix)", () => {
  test("shows EXTRACTED and STAYS headers with workspace names", () => {
    const plan = formatExtractPlan([makeAssessment()], "ws", "prereq", "prereq", "prefix", null);
    expect(plan).toContain("EXTRACTED (prereq)");
    expect(plan).toContain("STAYS (ws)");
  });

  test("shows commit counts for will-extract repos", () => {
    const plan = formatExtractPlan(
      [makeAssessment({ commitsExtracted: 3, commitsRemaining: 2 })],
      "ws",
      "prereq",
      "prereq",
      "prefix",
      null,
    );
    expect(plan).toContain("3 commits");
    expect(plan).toContain("2 commits");
  });

  test("shows 'all' when all commits are extracted", () => {
    const plan = formatExtractPlan(
      [makeAssessment({ commitsExtracted: 5, commitsRemaining: 0 })],
      "ws",
      "prereq",
      "prereq",
      "prefix",
      null,
    );
    expect(plan).toContain("all 5 commits");
    expect(plan).toContain("no commits");
  });

  test("shows 'all' on stays side for no-op repos", () => {
    const plan = formatExtractPlan(
      [makeAssessment({ outcome: "no-op", commitsExtracted: 0, commitsRemaining: 4, boundary: null })],
      "ws",
      "prereq",
      "prereq",
      "prefix",
      null,
    );
    expect(plan).toContain("all 4 commits");
    expect(plan).toContain("no commits");
  });

  test("shows 'ending with' boundary on extracted side", () => {
    const endpoints = new Map([["repo-a", { extractEnd: "abc1234", remainEnd: "def5678" }]]);
    const plan = formatExtractPlan([makeAssessment()], "ws", "prereq", "prereq", "prefix", null, endpoints);
    expect(plan).toContain("ending with abc1234");
  });

  test("shows 'starting with' boundary on stays side", () => {
    const endpoints = new Map([["repo-a", { extractEnd: "abc1234", remainEnd: "def5678" }]]);
    const plan = formatExtractPlan([makeAssessment()], "ws", "prereq", "prereq", "prefix", null, endpoints);
    expect(plan).toContain("starting with def5678");
  });

  test("shows autostash on stays side for prefix", () => {
    const plan = formatExtractPlan([makeAssessment({ needsStash: true })], "ws", "prereq", "prereq", "prefix", null);
    expect(plan).toContain("(autostash)");
    // autostash should be on the stays side (which has the remaining commits)
    const lines = plan.split("\n");
    const dataLine = lines.find((l) => l.includes("repo-a"));
    expect(dataLine).toBeDefined();
    // The stays column comes after the extracted column in prefix mode
    // Check that autostash is near the remaining count, not the extracted count
    if (dataLine) {
      const extractedIdx = dataLine.indexOf("3 commits");
      const autostashIdx = dataLine.indexOf("(autostash)");
      expect(autostashIdx).toBeGreaterThan(extractedIdx);
    }
  });

  test("shows skip reason for skipped repos", () => {
    const plan = formatExtractPlan(
      [makeAssessment({ outcome: "skip", skipReason: "uncommitted changes (use --autostash)", skipFlag: "dirty" })],
      "ws",
      "prereq",
      "prereq",
      "prefix",
      null,
    );
    expect(plan).toContain("skipped");
    expect(plan).toContain("uncommitted changes");
  });

  test("shows base change hint for prefix", () => {
    const plan = formatExtractPlan([makeAssessment()], "ws", "prereq", "prereq", "prefix", "main");
    expect(plan).toContain("ws base: main");
    expect(plan).toContain("prereq");
  });
});

// ── Suffix plan ──

describe("formatExtractPlan (suffix)", () => {
  test("shows STAYS before EXTRACTED for suffix direction", () => {
    const plan = formatExtractPlan(
      [makeAssessment({ direction: "suffix", commitsExtracted: 2, commitsRemaining: 3 })],
      "ws",
      "cont",
      "cont",
      "suffix",
      null,
    );
    // In suffix mode, STAYS column should come before EXTRACTED
    const staysIdx = plan.indexOf("STAYS (ws)");
    const extractedIdx = plan.indexOf("EXTRACTED (cont)");
    expect(staysIdx).toBeGreaterThan(-1);
    expect(extractedIdx).toBeGreaterThan(-1);
    expect(staysIdx).toBeLessThan(extractedIdx);
  });

  test("shows autostash on extracted side for suffix", () => {
    const plan = formatExtractPlan(
      [makeAssessment({ direction: "suffix", commitsExtracted: 2, commitsRemaining: 3, needsStash: true })],
      "ws",
      "cont",
      "cont",
      "suffix",
      null,
    );
    expect(plan).toContain("(autostash)");
  });

  test("shows base hint stacking on original workspace for suffix", () => {
    const plan = formatExtractPlan(
      [makeAssessment({ direction: "suffix", commitsExtracted: 2, commitsRemaining: 3 })],
      "ws",
      "cont",
      "cont",
      "suffix",
      null,
    );
    expect(plan).toContain("base: ws");
  });

  test("shows 'all' when all commits stay (no-op in suffix)", () => {
    const plan = formatExtractPlan(
      [
        makeAssessment({
          outcome: "no-op",
          direction: "suffix",
          commitsExtracted: 0,
          commitsRemaining: 5,
          boundary: null,
        }),
      ],
      "ws",
      "cont",
      "cont",
      "suffix",
      null,
    );
    expect(plan).toContain("all 5 commits");
    expect(plan).toContain("no commits");
  });

  test("shows 'starting with' on extracted side for suffix", () => {
    const endpoints = new Map([["repo-a", { extractEnd: "abc1234", remainEnd: "def5678" }]]);
    const plan = formatExtractPlan(
      [makeAssessment({ direction: "suffix", commitsExtracted: 2, commitsRemaining: 3 })],
      "ws",
      "cont",
      "cont",
      "suffix",
      null,
      endpoints,
    );
    expect(plan).toContain("starting with abc1234");
  });

  test("shows 'ending with' on stays side for suffix", () => {
    const endpoints = new Map([["repo-a", { extractEnd: "abc1234", remainEnd: "def5678" }]]);
    const plan = formatExtractPlan(
      [makeAssessment({ direction: "suffix", commitsExtracted: 2, commitsRemaining: 3 })],
      "ws",
      "cont",
      "cont",
      "suffix",
      null,
      endpoints,
    );
    expect(plan).toContain("ending with def5678");
  });
});

// ── Multi-repo ──

describe("formatExtractPlan (multi-repo)", () => {
  test("shows mixed will-extract and no-op repos", () => {
    const plan = formatExtractPlan(
      [
        makeAssessment({ repo: "api", repoDir: `${DIR}/api`, commitsExtracted: 3, commitsRemaining: 2 }),
        makeAssessment({
          repo: "web",
          repoDir: `${DIR}/web`,
          outcome: "no-op",
          commitsExtracted: 0,
          commitsRemaining: 4,
          boundary: null,
        }),
      ],
      "ws",
      "prereq",
      "prereq",
      "prefix",
      null,
    );
    expect(plan).toContain("api");
    expect(plan).toContain("web");
    expect(plan).toContain("3 commits");
    expect(plan).toContain("all 4 commits");
  });
});
