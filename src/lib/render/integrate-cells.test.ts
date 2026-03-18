import { describe, expect, test } from "bun:test";
import { type IntegrateActionDesc, integrateActionCell } from "./integrate-cells";

function makeDesc(overrides: Partial<IntegrateActionDesc> = {}): IntegrateActionDesc {
  return {
    kind: "rebase",
    baseRef: "origin/main",
    branch: "feature",
    diff: { behind: 3, ahead: 1 },
    conflictRisk: null,
    stash: "none",
    headSha: "abc1234",
    ...overrides,
  };
}

describe("integrateActionCell", () => {
  test("normal rebase text", () => {
    const c = integrateActionCell(makeDesc());
    expect(c.plain).toContain("rebase feature onto origin/main");
    expect(c.plain).toContain("3 behind, 1 ahead");
    expect(c.plain).toContain("(HEAD abc1234)");
  });

  test("normal merge text with three-way", () => {
    const c = integrateActionCell(makeDesc({ kind: "merge", mergeType: "three-way" }));
    expect(c.plain).toContain("merge origin/main into feature (three-way)");
  });

  test("normal merge text with fast-forward", () => {
    const c = integrateActionCell(
      makeDesc({ kind: "merge", mergeType: "fast-forward", diff: { behind: 3, ahead: 0 } }),
    );
    expect(c.plain).toContain("merge origin/main into feature (fast-forward)");
  });

  test("matched count breakdown", () => {
    const c = integrateActionCell(makeDesc({ diff: { behind: 5, ahead: 3, matchedCount: 3 } }));
    expect(c.plain).toContain("5 behind (3 same, 2 new)");
  });

  test("conflict likely — attention span", () => {
    const c = integrateActionCell(makeDesc({ conflictRisk: "likely" }));
    expect(c.plain).toContain("(conflict likely)");
    const conflictSpan = c.spans.find((s) => s.text.includes("conflict likely"));
    expect(conflictSpan?.attention).toBe("attention");
  });

  test("will-conflict — attention span", () => {
    const c = integrateActionCell(makeDesc({ kind: "merge", mergeType: "three-way", conflictRisk: "will-conflict" }));
    expect(c.plain).toContain("(will conflict)");
    const conflictSpan = c.spans.find((s) => s.text.includes("will conflict"));
    expect(conflictSpan?.attention).toBe("attention");
  });

  test("no-conflict — default span", () => {
    const c = integrateActionCell(makeDesc({ conflictRisk: "no-conflict" }));
    expect(c.plain).toContain("(no conflict)");
    const conflictSpan = c.spans.find((s) => s.text.includes("no conflict"));
    expect(conflictSpan?.attention).toBe("default");
  });

  test("conflict unlikely — default span", () => {
    const c = integrateActionCell(makeDesc({ conflictRisk: "unlikely" }));
    expect(c.plain).toContain("(conflict unlikely)");
    const conflictSpan = c.spans.find((s) => s.text.includes("conflict unlikely"));
    expect(conflictSpan?.attention).toBe("default");
  });

  test("warning — attention span", () => {
    const c = integrateActionCell(
      makeDesc({
        kind: "retarget-config",
        retargetFrom: "feat/old",
        warning: "base branch feat/old may not be merged",
      }),
    );
    expect(c.plain).toContain("(base branch feat/old may not be merged)");
    const warningSpan = c.spans.find((s) => s.text.includes("may not be merged"));
    expect(warningSpan?.attention).toBe("attention");
  });

  test("autostash suffix", () => {
    const c = integrateActionCell(makeDesc({ stash: "autostash" }));
    expect(c.plain).toContain("(autostash)");
  });

  test("pop-conflict-likely — attention span", () => {
    const c = integrateActionCell(makeDesc({ stash: "pop-conflict-likely" }));
    expect(c.plain).toContain("stash pop conflict likely");
    const stashSpan = c.spans.find((s) => s.text.includes("stash pop conflict likely"));
    expect(stashSpan?.attention).toBe("attention");
  });

  test("pop-conflict-unlikely — default span", () => {
    const c = integrateActionCell(makeDesc({ stash: "pop-conflict-unlikely" }));
    expect(c.plain).toContain("stash pop conflict unlikely");
    const stashSpan = c.spans.find((s) => s.text.includes("stash pop conflict unlikely"));
    expect(stashSpan?.attention).toBe("default");
  });

  test("HEAD sha — muted span", () => {
    const c = integrateActionCell(makeDesc());
    const headSpan = c.spans.find((s) => s.text.includes("HEAD abc1234"));
    expect(headSpan?.attention).toBe("muted");
  });

  test("retarget-merged text", () => {
    const c = integrateActionCell(makeDesc({ kind: "retarget-merged", replayCount: 2, skipCount: 3 }));
    expect(c.plain).toContain("rebase onto origin/main (merged)");
    expect(c.plain).toContain("rebase 2 new commits, skip 3 already merged");
  });

  test("retarget-merged singular commit", () => {
    const c = integrateActionCell(makeDesc({ kind: "retarget-merged", replayCount: 1, skipCount: 0 }));
    expect(c.plain).toContain("rebase 1 new commit");
    expect(c.plain).not.toContain("commits");
    expect(c.plain).not.toContain("skip");
  });

  test("retarget-config with replay breakdown", () => {
    const c = integrateActionCell(
      makeDesc({ kind: "retarget-config", retargetFrom: "feat/old", replayCount: 2, skipCount: 3 }),
    );
    expect(c.plain).toContain("rebase onto origin/main from feat/old (retarget)");
    expect(c.plain).toContain("5 local, 3 already on target, 2 to rebase");
  });

  test("retarget-config with only replayCount", () => {
    const c = integrateActionCell(
      makeDesc({ kind: "retarget-config", retargetFrom: "feat/old", replayCount: 4, skipCount: 0 }),
    );
    expect(c.plain).toContain("4 to rebase");
    expect(c.plain).not.toContain("already on target");
  });

  test("no HEAD suffix when headSha is undefined", () => {
    const c = integrateActionCell(makeDesc({ headSha: undefined }));
    expect(c.plain).not.toContain("HEAD");
    expect(c.spans.every((s) => !s.text.includes("HEAD"))).toBe(true);
  });

  test("baseFallback — attention span with not-found text", () => {
    const c = integrateActionCell(makeDesc({ baseFallback: "big-filter-overview" }));
    expect(c.plain).toContain("(base big-filter-overview not found)");
    const fallbackSpan = c.spans.find((s) => s.text.includes("base big-filter-overview not found"));
    expect(fallbackSpan?.attention).toBe("attention");
  });

  test("baseFallback not shown when undefined", () => {
    const c = integrateActionCell(makeDesc());
    expect(c.plain).not.toContain("not found");
  });

  test("baseFallback works with retarget-merged", () => {
    const c = integrateActionCell(
      makeDesc({ kind: "retarget-merged", replayCount: 2, skipCount: 0, baseFallback: "old-base" }),
    );
    expect(c.plain).toContain("(base old-base not found)");
  });

  test("baseFallback works with retarget-config", () => {
    const c = integrateActionCell(
      makeDesc({ kind: "retarget-config", retargetFrom: "feat/old", baseFallback: "old-base" }),
    );
    expect(c.plain).toContain("(base old-base not found)");
  });
});
