import { describe, expect, test } from "bun:test";
import { parseSplitPoints, parseSplitPointValue } from "./parse-split-points";

describe("parseSplitPointValue", () => {
  test("bare SHA", () => {
    const spec = parseSplitPointValue("abc1234");
    expect(spec).toEqual({ repo: null, commitish: "abc1234" });
  });

  test("repo:commit-ish", () => {
    const spec = parseSplitPointValue("api:abc1234");
    expect(spec).toEqual({ repo: "api", commitish: "abc1234" });
  });

  test("repo:HEAD~3", () => {
    const spec = parseSplitPointValue("api:HEAD~3");
    expect(spec).toEqual({ repo: "api", commitish: "HEAD~3" });
  });

  test("bare tag name", () => {
    const spec = parseSplitPointValue("v1.0-infra");
    expect(spec).toEqual({ repo: null, commitish: "v1.0-infra" });
  });

  test("throws on empty repo prefix", () => {
    expect(() => parseSplitPointValue(":abc123")).toThrow();
  });

  test("throws on empty commitish", () => {
    expect(() => parseSplitPointValue("api:")).toThrow();
  });
});

describe("parseSplitPoints", () => {
  test("single value", () => {
    const specs = parseSplitPoints(["abc123"]);
    expect(specs).toEqual([{ repo: null, commitish: "abc123" }]);
  });

  test("comma-separated values", () => {
    const specs = parseSplitPoints(["abc123,def456"]);
    expect(specs).toEqual([
      { repo: null, commitish: "abc123" },
      { repo: null, commitish: "def456" },
    ]);
  });

  test("multiple array values", () => {
    const specs = parseSplitPoints(["abc123", "def456"]);
    expect(specs).toEqual([
      { repo: null, commitish: "abc123" },
      { repo: null, commitish: "def456" },
    ]);
  });

  test("mixed repo-prefixed and bare", () => {
    const specs = parseSplitPoints(["abc123,api:HEAD~3"]);
    expect(specs).toEqual([
      { repo: null, commitish: "abc123" },
      { repo: "api", commitish: "HEAD~3" },
    ]);
  });

  test("trims whitespace", () => {
    const specs = parseSplitPoints(["abc123 , def456"]);
    expect(specs).toEqual([
      { repo: null, commitish: "abc123" },
      { repo: null, commitish: "def456" },
    ]);
  });

  test("skips empty segments", () => {
    const specs = parseSplitPoints(["abc123,,def456"]);
    expect(specs).toEqual([
      { repo: null, commitish: "abc123" },
      { repo: null, commitish: "def456" },
    ]);
  });
});
