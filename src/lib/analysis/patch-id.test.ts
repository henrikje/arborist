import { describe, expect, test } from "bun:test";
import { crossMatchPatchIds, parsePatchIdOutput } from "./patch-id";

describe("parsePatchIdOutput", () => {
  test("parses standard patch-id output", () => {
    const input = "abc123 def456\nghi789 jkl012\n";
    const result = parsePatchIdOutput(input);
    expect(result.size).toBe(2);
    expect(result.get("abc123")).toBe("def456");
    expect(result.get("ghi789")).toBe("jkl012");
  });

  test("handles empty input", () => {
    const result = parsePatchIdOutput("");
    expect(result.size).toBe(0);
  });

  test("handles trailing newlines and blank lines", () => {
    const input = "abc123 def456\n\n\n";
    const result = parsePatchIdOutput(input);
    expect(result.size).toBe(1);
    expect(result.get("abc123")).toBe("def456");
  });

  test("ignores malformed lines", () => {
    const input = "abc123 def456\nmalformed\nghi789 jkl012\n";
    const result = parsePatchIdOutput(input);
    expect(result.size).toBe(2);
  });
});

describe("crossMatchPatchIds", () => {
  test("matches entries with shared patch-ids", () => {
    const mapA = new Map([
      ["patch1", "hashA1"],
      ["patch2", "hashA2"],
      ["patch3", "hashA3"],
    ]);
    const mapB = new Map([
      ["patch1", "hashB1"],
      ["patch4", "hashB4"],
      ["patch2", "hashB2"],
    ]);
    const result = crossMatchPatchIds(mapA, mapB);
    expect(result.size).toBe(2);
    expect(result.get("hashB1")).toBe("hashA1");
    expect(result.get("hashB2")).toBe("hashA2");
  });

  test("returns empty map when no matches", () => {
    const mapA = new Map([["patch1", "hashA1"]]);
    const mapB = new Map([["patch2", "hashB2"]]);
    const result = crossMatchPatchIds(mapA, mapB);
    expect(result.size).toBe(0);
  });

  test("handles empty maps", () => {
    const result = crossMatchPatchIds(new Map(), new Map());
    expect(result.size).toBe(0);
  });
});
