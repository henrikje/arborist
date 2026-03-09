import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configGet, configGetList, configSetList, writeConfig } from "./config";

describe("config", () => {
  let tmpDir: string;
  let configFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "arb-config-test-"));
    configFile = join(tmpDir, "config");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("configGet", () => {
    test("returns null for missing file", () => {
      expect(configGet(join(tmpDir, "nonexistent"), "branch")).toBeNull();
    });

    test("returns null for missing key", () => {
      writeConfig(configFile, "main");
      expect(configGet(configFile, "nonexistent")).toBeNull();
    });

    test("returns value for existing key", () => {
      writeConfig(configFile, "develop");
      expect(configGet(configFile, "branch")).toBe("develop");
    });

    test("handles multi-line configs", () => {
      writeFileSync(configFile, "branch = main\nremote = origin\n");
      expect(configGet(configFile, "branch")).toBe("main");
      expect(configGet(configFile, "remote")).toBe("origin");
    });
  });

  describe("writeConfig", () => {
    test("writes correct format", () => {
      writeConfig(configFile, "feature-branch");
      expect(readFileSync(configFile, "utf-8")).toBe("branch = feature-branch\n");
    });

    test("file is readable back via configGet", () => {
      writeConfig(configFile, "my-branch");
      expect(configGet(configFile, "branch")).toBe("my-branch");
    });

    test("writes base when provided", () => {
      writeConfig(configFile, "feat/ui", "feat/auth");
      const content = readFileSync(configFile, "utf-8");
      expect(content).toBe("branch = feat/ui\nbase = feat/auth\n");
    });

    test("base is readable back via configGet", () => {
      writeConfig(configFile, "feat/ui", "feat/auth");
      expect(configGet(configFile, "branch")).toBe("feat/ui");
      expect(configGet(configFile, "base")).toBe("feat/auth");
    });

    test("omits base line when base is undefined", () => {
      writeConfig(configFile, "my-branch", undefined);
      expect(readFileSync(configFile, "utf-8")).toBe("branch = my-branch\n");
      expect(configGet(configFile, "base")).toBeNull();
    });

    test("writes branchRenameFrom when provided", () => {
      writeConfig(configFile, "new-name", "main", "old-name");
      const content = readFileSync(configFile, "utf-8");
      expect(content).toBe("branch = new-name\nbase = main\nbranch_rename_from = old-name\n");
      expect(configGet(configFile, "branch_rename_from")).toBe("old-name");
    });

    test("omits branchRenameFrom when null", () => {
      writeConfig(configFile, "my-branch", "main", null);
      expect(readFileSync(configFile, "utf-8")).toBe("branch = my-branch\nbase = main\n");
      expect(configGet(configFile, "branch_rename_from")).toBeNull();
    });

    test("writes workspaceRenameTo when provided", () => {
      writeConfig(configFile, "new-name", "main", "old-name", "new-ws");
      const content = readFileSync(configFile, "utf-8");
      expect(content).toBe(
        "branch = new-name\nbase = main\nbranch_rename_from = old-name\nworkspace_rename_to = new-ws\n",
      );
      expect(configGet(configFile, "workspace_rename_to")).toBe("new-ws");
    });

    test("omits workspaceRenameTo when null", () => {
      writeConfig(configFile, "my-branch", "main", null, null);
      expect(readFileSync(configFile, "utf-8")).toBe("branch = my-branch\nbase = main\n");
      expect(configGet(configFile, "workspace_rename_to")).toBeNull();
    });
  });

  describe("configGetList", () => {
    test("returns empty array for missing file", () => {
      expect(configGetList(join(tmpDir, "nonexistent"), "repos")).toEqual([]);
    });

    test("returns empty array for missing key", () => {
      writeFileSync(configFile, "branch = main\n");
      expect(configGetList(configFile, "repos")).toEqual([]);
    });

    test("returns parsed comma-separated values", () => {
      writeFileSync(configFile, "repos = repo-a,repo-b,repo-c\n");
      expect(configGetList(configFile, "repos")).toEqual(["repo-a", "repo-b", "repo-c"]);
    });

    test("trims whitespace from values", () => {
      writeFileSync(configFile, "repos = repo-a , repo-b , repo-c\n");
      expect(configGetList(configFile, "repos")).toEqual(["repo-a", "repo-b", "repo-c"]);
    });

    test("filters out empty values", () => {
      writeFileSync(configFile, "repos = repo-a,,repo-b,\n");
      expect(configGetList(configFile, "repos")).toEqual(["repo-a", "repo-b"]);
    });
  });

  describe("configSetList", () => {
    test("creates file with list value when file does not exist", () => {
      configSetList(configFile, "repos", ["repo-a", "repo-b"]);
      expect(readFileSync(configFile, "utf-8")).toBe("repos = repo-a,repo-b\n");
    });

    test("updates existing list value", () => {
      writeFileSync(configFile, "branch = main\nrepos = old-repo\n");
      configSetList(configFile, "repos", ["new-a", "new-b"]);
      const content = readFileSync(configFile, "utf-8");
      expect(content).toContain("repos = new-a,new-b");
      expect(content).toContain("branch = main");
    });

    test("removes key when values array is empty", () => {
      writeFileSync(configFile, "branch = main\nrepos = repo-a\n");
      configSetList(configFile, "repos", []);
      const content = readFileSync(configFile, "utf-8");
      expect(content).not.toContain("repos");
      expect(content).toContain("branch = main");
    });

    test("appends new key to existing file", () => {
      writeFileSync(configFile, "branch = main\n");
      configSetList(configFile, "repos", ["repo-a"]);
      const content = readFileSync(configFile, "utf-8");
      expect(content).toContain("branch = main");
      expect(content).toContain("repos = repo-a");
    });

    test("does not create file when values are empty and file does not exist", () => {
      configSetList(configFile, "repos", []);
      expect(require("node:fs").existsSync(configFile)).toBe(false);
    });
  });
});
