import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type WorkspaceConfig,
  readProjectConfig,
  readWorkspaceConfig,
  writeProjectConfig,
  writeWorkspaceConfig,
} from "./config";

describe("config", () => {
  let tmpDir: string;
  let configFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "arb-config-test-"));
    configFile = join(tmpDir, "config.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("readWorkspaceConfig", () => {
    test("returns null for missing file", () => {
      expect(readWorkspaceConfig(join(tmpDir, "nonexistent"))).toBeNull();
    });

    test("reads JSON config", () => {
      writeFileSync(configFile, `${JSON.stringify({ branch: "develop" }, null, 2)}\n`);
      const config = readWorkspaceConfig(configFile);
      expect(config).toEqual({ branch: "develop" });
    });

    test("reads config with all fields", () => {
      const full: WorkspaceConfig = {
        branch: "new-name",
        base: "main",
        branch_rename_from: "old-name",
        workspace_rename_to: "new-ws",
      };
      writeFileSync(configFile, `${JSON.stringify(full, null, 2)}\n`);
      const config = readWorkspaceConfig(configFile);
      expect(config).toEqual(full);
    });

    test("optional fields are omitted when absent", () => {
      writeFileSync(configFile, `${JSON.stringify({ branch: "my-branch" }, null, 2)}\n`);
      const config = readWorkspaceConfig(configFile);
      expect(config).toEqual({ branch: "my-branch" });
      expect(config?.base).toBeUndefined();
      expect(config?.branch_rename_from).toBeUndefined();
      expect(config?.workspace_rename_to).toBeUndefined();
    });

    test("throws on invalid JSON content", () => {
      writeFileSync(configFile, "not json and not ini either {{{");
      expect(() => readWorkspaceConfig(configFile)).toThrow("Failed to parse config");
    });

    test("throws on missing required branch field", () => {
      writeFileSync(configFile, `${JSON.stringify({ base: "main" }, null, 2)}\n`);
      expect(() => readWorkspaceConfig(configFile)).toThrow("Invalid config");
    });
  });

  describe("writeWorkspaceConfig", () => {
    test("writes JSON with 2-space indent and trailing newline", () => {
      writeWorkspaceConfig(configFile, { branch: "feature-branch" });
      const content = readFileSync(configFile, "utf-8");
      expect(content).toBe('{\n  "branch": "feature-branch"\n}\n');
    });

    test("round-trips with readWorkspaceConfig", () => {
      writeWorkspaceConfig(configFile, { branch: "my-branch" });
      expect(readWorkspaceConfig(configFile)).toEqual({ branch: "my-branch" });
    });

    test("writes base when provided", () => {
      writeWorkspaceConfig(configFile, { branch: "feat/ui", base: "feat/auth" });
      const config = readWorkspaceConfig(configFile);
      expect(config?.branch).toBe("feat/ui");
      expect(config?.base).toBe("feat/auth");
    });

    test("writes all migration fields", () => {
      const full: WorkspaceConfig = {
        branch: "new-name",
        base: "main",
        branch_rename_from: "old-name",
        workspace_rename_to: "new-ws",
      };
      writeWorkspaceConfig(configFile, full);
      expect(readWorkspaceConfig(configFile)).toEqual(full);
    });

    test("strips undefined optional fields from JSON", () => {
      writeWorkspaceConfig(configFile, { branch: "my-branch" });
      const content = readFileSync(configFile, "utf-8");
      expect(content).not.toContain("base");
      expect(content).not.toContain("branch_rename_from");
      expect(content).not.toContain("workspace_rename_to");
    });
  });

  describe("readProjectConfig", () => {
    test("returns null for missing file", () => {
      expect(readProjectConfig(join(tmpDir, "nonexistent"))).toBeNull();
    });

    test("reads defaults array", () => {
      writeFileSync(configFile, `${JSON.stringify({ defaults: ["repo-a", "repo-b", "repo-c"] }, null, 2)}\n`);
      const config = readProjectConfig(configFile);
      expect(config?.defaults).toEqual(["repo-a", "repo-b", "repo-c"]);
    });

    test("reads empty config", () => {
      writeFileSync(configFile, `${JSON.stringify({}, null, 2)}\n`);
      const config = readProjectConfig(configFile);
      expect(config).toEqual({});
    });
  });

  describe("writeProjectConfig", () => {
    test("round-trips with readProjectConfig", () => {
      writeProjectConfig(configFile, { defaults: ["repo-a", "repo-b"] });
      expect(readProjectConfig(configFile)).toEqual({ defaults: ["repo-a", "repo-b"] });
    });

    test("writes JSON format", () => {
      writeProjectConfig(configFile, { defaults: ["repo-a"] });
      const content = readFileSync(configFile, "utf-8");
      expect(content).toBe('{\n  "defaults": [\n    "repo-a"\n  ]\n}\n');
    });
  });

  describe("INI migration", () => {
    test("migrates workspace INI to JSON on read", () => {
      writeFileSync(configFile, "branch = my-feature\n");
      const config = readWorkspaceConfig(configFile);
      expect(config).toEqual({ branch: "my-feature" });
      // File should now be JSON
      const content = readFileSync(configFile, "utf-8");
      expect(JSON.parse(content)).toEqual({ branch: "my-feature" });
    });

    test("migrates workspace INI with base", () => {
      writeFileSync(configFile, "branch = feat/ui\nbase = feat/auth\n");
      const config = readWorkspaceConfig(configFile);
      expect(config?.branch).toBe("feat/ui");
      expect(config?.base).toBe("feat/auth");
    });

    test("migrates workspace INI with migration state", () => {
      writeFileSync(
        configFile,
        "branch = new-name\nbase = main\nbranch_rename_from = old-name\nworkspace_rename_to = new-ws\n",
      );
      const config = readWorkspaceConfig(configFile);
      expect(config).toEqual({
        branch: "new-name",
        base: "main",
        branch_rename_from: "old-name",
        workspace_rename_to: "new-ws",
      });
    });

    test("migrates project INI with defaults", () => {
      writeFileSync(configFile, "defaults = repo-a,repo-b,repo-c\n");
      const config = readProjectConfig(configFile);
      expect(config?.defaults).toEqual(["repo-a", "repo-b", "repo-c"]);
    });

    test("migrates project INI with whitespace in defaults", () => {
      writeFileSync(configFile, "defaults = repo-a , repo-b , repo-c\n");
      const config = readProjectConfig(configFile);
      expect(config?.defaults).toEqual(["repo-a", "repo-b", "repo-c"]);
    });

    test("rewrites INI file as JSON after migration", () => {
      writeFileSync(configFile, "branch = develop\nbase = main\n");
      readWorkspaceConfig(configFile);
      const content = readFileSync(configFile, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed).toEqual({ branch: "develop", base: "main" });
    });

    test("subsequent reads are pure JSON", () => {
      writeFileSync(configFile, "branch = develop\n");
      readWorkspaceConfig(configFile);
      // Second read should work on JSON
      const config = readWorkspaceConfig(configFile);
      expect(config).toEqual({ branch: "develop" });
    });
  });

  describe("legacy filename migration", () => {
    let legacyFile: string;

    beforeEach(() => {
      legacyFile = join(tmpDir, "config");
    });

    test("reads from legacy file when config.json is missing", () => {
      writeFileSync(legacyFile, `${JSON.stringify({ branch: "my-feature" }, null, 2)}\n`);
      const config = readWorkspaceConfig(configFile);
      expect(config).toEqual({ branch: "my-feature" });
    });

    test("writes config.json and deletes legacy file", () => {
      writeFileSync(legacyFile, `${JSON.stringify({ branch: "my-feature" }, null, 2)}\n`);
      readWorkspaceConfig(configFile);
      expect(existsSync(configFile)).toBe(true);
      expect(existsSync(legacyFile)).toBe(false);
      const content = readFileSync(configFile, "utf-8");
      expect(JSON.parse(content)).toEqual({ branch: "my-feature" });
    });

    test("migrates legacy INI to config.json", () => {
      writeFileSync(legacyFile, "branch = develop\nbase = main\n");
      const config = readWorkspaceConfig(configFile);
      expect(config).toEqual({ branch: "develop", base: "main" });
      expect(existsSync(configFile)).toBe(true);
      expect(existsSync(legacyFile)).toBe(false);
    });

    test("migrates legacy project config", () => {
      writeFileSync(legacyFile, `${JSON.stringify({ defaults: ["repo-a"] }, null, 2)}\n`);
      const config = readProjectConfig(configFile);
      expect(config).toEqual({ defaults: ["repo-a"] });
      expect(existsSync(configFile)).toBe(true);
      expect(existsSync(legacyFile)).toBe(false);
    });

    test("prefers config.json when both exist", () => {
      writeFileSync(configFile, `${JSON.stringify({ branch: "from-json" }, null, 2)}\n`);
      writeFileSync(legacyFile, `${JSON.stringify({ branch: "from-legacy" }, null, 2)}\n`);
      const config = readWorkspaceConfig(configFile);
      expect(config).toEqual({ branch: "from-json" });
      // Legacy file should remain untouched
      expect(existsSync(legacyFile)).toBe(true);
    });

    test("returns null when neither file exists", () => {
      expect(readWorkspaceConfig(configFile)).toBeNull();
    });
  });
});
