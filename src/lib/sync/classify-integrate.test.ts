import { describe, expect, test } from "bun:test";
import { makeRepo } from "../status/test-helpers";
import { assessIntegrateRepo, classifyRepo } from "./classify-integrate";

const DIR = "/tmp/test-repo";

describe("classifyRepo", () => {
  test("returns up-to-date when behind base is 0", () => {
    const assessment = classifyRepo(makeRepo(), DIR, "feature", [], false, "abc1234");
    expect(assessment.outcome).toBe("up-to-date");
    expect(assessment.baseBranch).toBe("main");
  });
});

describe("assessIntegrateRepo", () => {
  test("treats merged-new-work as normal merge work in merge mode", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "main",
        configuredRef: null,
        ahead: 4,
        behind: 3,
        merge: { kind: "merge", newCommitsAfter: 2 },
        baseMergedIntoDefault: null,
      },
    });

    const assessment = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      {
        retarget: false,
        retargetExplicit: null,
        autostash: false,
        includeWrongBranch: false,
        cache: { getDefaultBranch: async () => "main" },
        mode: "merge",
      },
      { getShortHead: async () => "abc1234" },
    );

    expect(assessment.outcome).toBe("will-operate");
    expect(assessment.baseBranch).toBe("main");
    expect(assessment.behind).toBe(3);
    expect(assessment.ahead).toBe(4);
  });

  test("reports missing explicit retarget target as a blocked skip", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/old",
        configuredRef: null,
        ahead: 1,
        behind: 2,
        baseMergedIntoDefault: "merge",
      },
    });

    const assessment = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      {
        retarget: true,
        retargetExplicit: "main",
        autostash: false,
        includeWrongBranch: false,
        cache: { getDefaultBranch: async () => "main" },
        mode: "rebase",
      },
      {
        getShortHead: async () => "abc1234",
        remoteBranchExists: async () => false,
      },
    );

    expect(assessment.outcome).toBe("skip");
    expect(assessment.skipFlag).toBe("retarget-target-not-found");
    expect(assessment.retarget?.blocked).toBe(true);
  });

  test("reports auto-retarget failure when the default branch cannot be resolved", async () => {
    const status = makeRepo({
      base: {
        remote: "origin",
        ref: "feat/old",
        configuredRef: null,
        ahead: 1,
        behind: 2,
        baseMergedIntoDefault: "merge",
      },
    });

    const assessment = await assessIntegrateRepo(
      status,
      DIR,
      "feature",
      [],
      {
        retarget: true,
        retargetExplicit: null,
        autostash: false,
        includeWrongBranch: false,
        cache: { getDefaultBranch: async () => null },
        mode: "rebase",
      },
      { getShortHead: async () => "abc1234" },
    );

    expect(assessment.outcome).toBe("skip");
    expect(assessment.skipFlag).toBe("retarget-no-default");
  });
});
