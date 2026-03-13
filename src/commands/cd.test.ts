import { describe, expect, test } from "bun:test";
import { buildCdSelectConfig } from "./cd";

describe("buildCdSelectConfig", () => {
  test("builds workspace choices without forcing page size", () => {
    expect(buildCdSelectConfig(["ws-a", "ws-b", "ws-c"], "Select a workspace")).toEqual({
      message: "Select a workspace",
      choices: [
        { name: "ws-a", value: "ws-a" },
        { name: "ws-b", value: "ws-b" },
        { name: "ws-c", value: "ws-c" },
      ],
      loop: false,
    });
  });

  test("builds repo choices without forcing page size", () => {
    expect(buildCdSelectConfig(["repo-a", "repo-b"], "Select a repo in 'my-workspace'")).toEqual({
      message: "Select a repo in 'my-workspace'",
      choices: [
        { name: "repo-a", value: "repo-a" },
        { name: "repo-b", value: "repo-b" },
      ],
      loop: false,
    });
  });
});
