import { describe, expect, test } from "bun:test";
import { buildRepoCheckboxConfig } from "./repos";

describe("buildRepoCheckboxConfig", () => {
  test("preserves defaults without forcing page size", () => {
    expect(buildRepoCheckboxConfig(["alpha", "beta", "gamma"], "Select repos", new Set(["beta"]))).toEqual({
      message: "Select repos",
      choices: [
        { name: "alpha", value: "alpha", checked: false },
        { name: "beta", value: "beta", checked: true },
        { name: "gamma", value: "gamma", checked: false },
      ],
      loop: false,
    });
  });

  test("supports required repo selection validation", () => {
    const config = buildRepoCheckboxConfig(["repo-a", "repo-z"], "Repos:", new Set(["repo-a"]), (selected) =>
      selected.length > 0 ? true : "At least one repo must be selected.",
    );

    expect(config.message).toBe("Repos:");
    expect(config.choices).toEqual([
      { name: "repo-a", value: "repo-a", checked: true },
      { name: "repo-z", value: "repo-z", checked: false },
    ]);
    expect(config.loop).toBe(false);
    expect(config.validate?.(["repo-a"])).toBe(true);
    expect(config.validate?.([])).toBe("At least one repo must be selected.");
  });
});
