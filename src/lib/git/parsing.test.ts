import { describe, expect, test } from "bun:test";
import { parseDiffShortstat } from "./parsing";

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
