import { describe, expect, spyOn, test } from "bun:test";
import * as tty from "../terminal/tty";
import { fetchSuffix, getFetchFailedRepos, reportFetchFailures } from "./parallel-fetch";

describe("reportFetchFailures", () => {
  test("returns empty array when all succeed", () => {
    const results = new Map([
      ["repo-a", { exitCode: 0, output: "" }],
      ["repo-b", { exitCode: 0, output: "" }],
    ]);
    const failed = reportFetchFailures(["repo-a", "repo-b"], results);
    expect(failed).toEqual([]);
  });

  test("returns failed repos when exitCode !== 0", () => {
    const results = new Map([
      ["repo-a", { exitCode: 0, output: "" }],
      ["repo-b", { exitCode: 1, output: "error" }],
    ]);
    const failed = reportFetchFailures(["repo-a", "repo-b"], results);
    expect(failed).toEqual(["repo-b"]);
  });

  test("identifies timeout (exitCode 124)", () => {
    const results = new Map([["repo-a", { exitCode: 124, output: "timed out" }]]);
    const failed = reportFetchFailures(["repo-a"], results);
    expect(failed).toEqual(["repo-a"]);
  });

  test("handles missing results", () => {
    const results = new Map<string, { exitCode: number; output: string }>();
    const failed = reportFetchFailures(["repo-a"], results);
    expect(failed).toEqual(["repo-a"]);
  });
});

describe("fetchSuffix", () => {
  test("returns fetch message without hint by default", () => {
    const result = fetchSuffix(3);
    expect(result).toContain("Fetching 3 repos...");
    expect(result).not.toContain("<Esc to cancel>");
  });

  test("returns fetch message without hint when abortable is false", () => {
    const result = fetchSuffix(3, { abortable: false });
    expect(result).toContain("Fetching 3 repos...");
    expect(result).not.toContain("<Esc to cancel>");
  });

  test("returns singular form for 1 repo", () => {
    const result = fetchSuffix(1);
    expect(result).toContain("Fetching 1 repo...");
  });

  test("does not include hint when not in TTY mode", () => {
    const spy = spyOn(tty, "isTTY").mockReturnValue(false);
    const result = fetchSuffix(3, { abortable: true });
    expect(result).toContain("Fetching 3 repos...");
    expect(result).not.toContain("<Esc to cancel>");
    spy.mockRestore();
  });

  test("includes hint when abortable and in TTY mode with TTY stdin", () => {
    const spy = spyOn(tty, "isTTY").mockReturnValue(true);
    const saved = process.stdin.isTTY;
    process.stdin.isTTY = true;
    const result = fetchSuffix(3, { abortable: true });
    expect(result).toContain("Fetching 3 repos...");
    expect(result).toContain("<Esc to cancel>");
    process.stdin.isTTY = saved;
    spy.mockRestore();
  });
});

describe("getFetchFailedRepos", () => {
  test("returns empty array when all succeed", () => {
    const results = new Map([
      ["repo-a", { exitCode: 0, output: "" }],
      ["repo-b", { exitCode: 0, output: "" }],
    ]);
    expect(getFetchFailedRepos(["repo-a", "repo-b"], results)).toEqual([]);
  });

  test("returns repos with non-zero exitCode", () => {
    const results = new Map([
      ["repo-a", { exitCode: 0, output: "" }],
      ["repo-b", { exitCode: 1, output: "error" }],
      ["repo-c", { exitCode: 128, output: "fatal" }],
    ]);
    expect(getFetchFailedRepos(["repo-a", "repo-b", "repo-c"], results)).toEqual(["repo-b", "repo-c"]);
  });

  test("treats repos missing from results as failed", () => {
    const results = new Map([["repo-a", { exitCode: 0, output: "" }]]);
    expect(getFetchFailedRepos(["repo-a", "repo-b"], results)).toEqual(["repo-b"]);
  });

  test("handles mixed success, failure, and missing", () => {
    const results = new Map([
      ["repo-a", { exitCode: 0, output: "" }],
      ["repo-b", { exitCode: 1, output: "error" }],
    ]);
    expect(getFetchFailedRepos(["repo-a", "repo-b", "repo-c"], results)).toEqual(["repo-b", "repo-c"]);
  });
});
