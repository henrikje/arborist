import { describe, expect, test } from "bun:test";
import { toJsonVerbose } from "./verbose-detail";

describe("toJsonVerbose", () => {
  test("empty detail returns empty object", () => {
    const result = toJsonVerbose({});
    expect(result).toEqual({});
  });

  test("aheadOfBase with matchedOnBase includes mergedAs field", () => {
    const detail = {
      aheadOfBase: [
        {
          hash: "aaa111",
          shortHash: "aaa1111",
          subject: "feat: add thing",
          matchedOnBase: { hash: "base999", shortHash: "bas9999" },
        },
      ],
    };
    const result = toJsonVerbose(detail);
    expect(result?.aheadOfBase?.[0]?.mergedAs).toBe("base999");
  });

  test("aheadOfBase with merge.newCommitsAfter: commits beyond n get mergedAs merge.commitHash", () => {
    const detail = {
      aheadOfBase: [
        { hash: "new1", shortHash: "new1234", subject: "new commit" },
        { hash: "old1", shortHash: "old1234", subject: "old commit 1" },
        { hash: "old2", shortHash: "old2345", subject: "old commit 2" },
      ],
    };
    const base = { merge: { newCommitsAfter: 1, commitHash: "merge123456" } };
    const result = toJsonVerbose(detail, base);
    expect(result?.aheadOfBase?.[0]?.mergedAs).toBeUndefined();
    expect(result?.aheadOfBase?.[1]?.mergedAs).toBe("merge123456");
    expect(result?.aheadOfBase?.[2]?.mergedAs).toBe("merge123456");
  });

  test("behindBase with rebaseOf includes rebaseOf hash (stripped from object)", () => {
    const detail = {
      behindBase: [
        {
          hash: "xxx999",
          shortHash: "xxx9999",
          subject: "upstream change",
          rebaseOf: { hash: "local111", shortHash: "loc1111" },
        },
      ],
    };
    const result = toJsonVerbose(detail);
    expect(result?.behindBase?.[0]?.rebaseOf).toBe("local111");
  });

  test("behindBase with squashOf includes hashes array", () => {
    const detail = {
      behindBase: [
        {
          hash: "squash1",
          shortHash: "squa123",
          subject: "squashed commit",
          squashOf: { hashes: ["aaa", "bbb", "ccc"], shortHashes: ["aaa1234", "bbb1234", "ccc1234"] },
        },
      ],
    };
    const result = toJsonVerbose(detail);
    expect(result?.behindBase?.[0]?.squashOf).toEqual(["aaa", "bbb", "ccc"]);
  });

  test("unpushed preserves rebased flag", () => {
    const detail = {
      unpushed: [
        { hash: "push1", shortHash: "pus1234", subject: "local commit", rebased: true },
        { hash: "push2", shortHash: "pus5678", subject: "another commit", rebased: false },
      ],
    };
    const result = toJsonVerbose(detail);
    expect(result?.unpushed?.[0]?.rebased).toBe(true);
    expect(result?.unpushed?.[1]?.rebased).toBe(false);
    expect(result?.unpushed?.[0]).not.toHaveProperty("shortHash");
  });

  test("toPull preserves superseded flag", () => {
    const detail = {
      toPull: [
        { hash: "pull1", shortHash: "pul1234", subject: "remote commit", superseded: true },
        { hash: "pull2", shortHash: "pul5678", subject: "another remote", superseded: false },
      ],
    };
    const result = toJsonVerbose(detail);
    expect(result?.toPull?.[0]?.superseded).toBe(true);
    expect(result?.toPull?.[1]?.superseded).toBe(false);
    expect(result?.toPull?.[0]).not.toHaveProperty("shortHash");
  });

  test("staged/unstaged/untracked passthrough", () => {
    const detail = {
      staged: [{ file: "src/index.ts", type: "modified" as const }],
      unstaged: [{ file: "src/app.ts", type: "deleted" as const }],
      untracked: ["tmp.log"],
    };
    const result = toJsonVerbose(detail);
    expect(result?.staged).toEqual([{ file: "src/index.ts", type: "modified" }]);
    expect(result?.unstaged).toEqual([{ file: "src/app.ts", type: "deleted" }]);
    expect(result?.untracked).toEqual(["tmp.log"]);
  });

  test("aheadOfBase without matchedOnBase and without merge data has no mergedAs", () => {
    const detail = {
      aheadOfBase: [
        { hash: "aaa111", shortHash: "aaa1111", subject: "feat: new thing" },
        { hash: "bbb222", shortHash: "bbb2222", subject: "fix: bug" },
      ],
    };
    const result = toJsonVerbose(detail);
    expect(result?.aheadOfBase?.[0]?.mergedAs).toBeUndefined();
    expect(result?.aheadOfBase?.[1]?.mergedAs).toBeUndefined();
  });

  test("matchedOnBase takes priority over merge position for mergedAs", () => {
    const detail = {
      aheadOfBase: [
        { hash: "new1", shortHash: "new1234", subject: "new commit" },
        {
          hash: "old1",
          shortHash: "old1234",
          subject: "old commit",
          matchedOnBase: { hash: "matched123", shortHash: "mat1234" },
        },
      ],
    };
    // Even with merge data that would set mergedAs for index >= 1, matchedOnBase wins
    const base = { merge: { newCommitsAfter: 1, commitHash: "merge456" } };
    const result = toJsonVerbose(detail, base);
    // First commit (index 0) has no match and is within newCommitsAfter → no mergedAs
    expect(result?.aheadOfBase?.[0]?.mergedAs).toBeUndefined();
    // Second commit (index 1) has matchedOnBase → uses that, not the merge commitHash
    expect(result?.aheadOfBase?.[1]?.mergedAs).toBe("matched123");
  });

  test("base with null merge does not add mergedAs", () => {
    const detail = {
      aheadOfBase: [{ hash: "aaa111", shortHash: "aaa1111", subject: "commit" }],
    };
    const result = toJsonVerbose(detail, null);
    expect(result?.aheadOfBase?.[0]?.mergedAs).toBeUndefined();
  });

  test("base with merge but no commitHash does not add mergedAs", () => {
    const detail = {
      aheadOfBase: [
        { hash: "new1", shortHash: "new1234", subject: "new" },
        { hash: "old1", shortHash: "old1234", subject: "old" },
      ],
    };
    const base = { merge: { newCommitsAfter: 1 } }; // no commitHash
    const result = toJsonVerbose(detail, base);
    expect(result?.aheadOfBase?.[1]?.mergedAs).toBeUndefined();
  });
});
