import { describe, expect, test } from "bun:test";
import { parseDiffShortstat, parseGitNumstat, parseGitVersion, stagedType, unstagedType } from "./parsing";

describe("stagedType", () => {
  test('"A" returns "new file"', () => {
    expect(stagedType("A")).toBe("new file");
  });

  test('"M" returns "modified"', () => {
    expect(stagedType("M")).toBe("modified");
  });

  test('"D" returns "deleted"', () => {
    expect(stagedType("D")).toBe("deleted");
  });

  test('"R" returns "renamed"', () => {
    expect(stagedType("R")).toBe("renamed");
  });

  test('"C" returns "copied"', () => {
    expect(stagedType("C")).toBe("copied");
  });

  test('unknown code returns "modified" (default)', () => {
    expect(stagedType("X")).toBe("modified");
    expect(stagedType("?")).toBe("modified");
  });
});

describe("unstagedType", () => {
  test('"D" returns "deleted"', () => {
    expect(unstagedType("D")).toBe("deleted");
  });

  test('"M" returns "modified" (default)', () => {
    expect(unstagedType("M")).toBe("modified");
  });

  test('unknown code returns "modified"', () => {
    expect(unstagedType("X")).toBe("modified");
    expect(unstagedType("?")).toBe("modified");
  });
});

describe("parseGitNumstat", () => {
  test("parses normal line", () => {
    const result = parseGitNumstat("10\t5\tfile.ts");
    expect(result).toEqual([{ file: "file.ts", insertions: 10, deletions: 5 }]);
  });

  test("parses binary file (dashes)", () => {
    const result = parseGitNumstat("-\t-\tbinary.png");
    expect(result).toEqual([{ file: "binary.png", insertions: 0, deletions: 0 }]);
  });

  test("parses multi-line output", () => {
    const result = parseGitNumstat("10\t5\tfile.ts\n3\t1\tother.ts");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ file: "file.ts", insertions: 10, deletions: 5 });
    expect(result[1]).toEqual({ file: "other.ts", insertions: 3, deletions: 1 });
  });

  test("returns empty array for empty input", () => {
    expect(parseGitNumstat("")).toEqual([]);
    expect(parseGitNumstat("  \n  ")).toEqual([]);
  });

  test("filters out malformed lines with fewer than 3 tab-separated parts", () => {
    const result = parseGitNumstat("10\t5\tfile.ts\nmalformed\n3\t1\tother.ts");
    expect(result).toHaveLength(2);
  });

  test("preserves filename with rename arrow", () => {
    const result = parseGitNumstat("5\t3\told.ts => new.ts");
    expect(result).toEqual([{ file: "old.ts => new.ts", insertions: 5, deletions: 3 }]);
  });
});

describe("parseGitVersion", () => {
  test("parses valid version string", () => {
    expect(parseGitVersion("git version 2.34.5")).toEqual({ major: 2, minor: 34, patch: 5 });
  });

  test("returns null for invalid format", () => {
    expect(parseGitVersion("not a version")).toBeNull();
  });

  test("returns null for partial match", () => {
    expect(parseGitVersion("git version 2.34")).toBeNull();
  });

  test("parses version with extra text after", () => {
    expect(parseGitVersion("git version 2.39.3 (Apple Git-146)")).toEqual({ major: 2, minor: 39, patch: 3 });
  });
});

describe("parseDiffShortstat", () => {
  test("parses full shortstat output", () => {
    const result = parseDiffShortstat(" 47 files changed, 320 insertions(+), 180 deletions(-)\n");
    expect(result).toEqual({ files: 47, insertions: 320, deletions: 180 });
  });

  test("parses insertions only", () => {
    const result = parseDiffShortstat(" 3 files changed, 50 insertions(+)\n");
    expect(result).toEqual({ files: 3, insertions: 50, deletions: 0 });
  });

  test("parses deletions only", () => {
    const result = parseDiffShortstat(" 1 file changed, 10 deletions(-)\n");
    expect(result).toEqual({ files: 1, insertions: 0, deletions: 10 });
  });

  test("parses singular form", () => {
    const result = parseDiffShortstat(" 1 file changed, 1 insertion(+), 1 deletion(-)\n");
    expect(result).toEqual({ files: 1, insertions: 1, deletions: 1 });
  });

  test("returns null for empty output", () => {
    expect(parseDiffShortstat("")).toBeNull();
    expect(parseDiffShortstat("\n")).toBeNull();
  });
});
