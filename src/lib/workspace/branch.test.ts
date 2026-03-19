import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as git from "../git/git";
import * as output from "../terminal/output";
import { workspaceBranch } from "./branch";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "arb-branch-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("workspaceBranch", () => {
  test("returns branch from config when config exists", async () => {
    const wsDir = join(tmpDir, "ws");
    mkdirSync(join(wsDir, ".arbws"), { recursive: true });
    writeFileSync(join(wsDir, ".arbws", "config.json"), JSON.stringify({ branch: "my-feature" }));

    const result = await workspaceBranch(wsDir);
    expect(result).not.toBeNull();
    expect(result?.branch).toBe("my-feature");
    expect(result?.inferred).toBe(false);
  });

  test("returns null when no config and no repos", async () => {
    const wsDir = join(tmpDir, "empty-ws");
    mkdirSync(join(wsDir, ".arbws"), { recursive: true });

    const result = await workspaceBranch(wsDir);
    expect(result).toBeNull();
  });

  test("infers branch from first repo when config missing", async () => {
    const wsDir = join(tmpDir, "infer-ws");
    mkdirSync(join(wsDir, ".arbws"), { recursive: true });

    // Create a repo with a branch
    const repoDir = join(wsDir, "repo-a");
    Bun.spawnSync(["git", "init", repoDir], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync(["git", "-C", repoDir, "config", "user.email", "test@test.com"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    Bun.spawnSync(["git", "-C", repoDir, "config", "user.name", "Test"], { stdout: "ignore", stderr: "ignore" });
    writeFileSync(join(repoDir, "file.txt"), "content");
    Bun.spawnSync(["git", "-C", repoDir, "add", "."], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "init", "--no-gpg-sign"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    // Create a .git file to make it look like a worktree
    // Actually, workspaceRepoDirs looks for dirs with .git file or dir
    // The repo already has a .git dir from git init

    const result = await workspaceBranch(wsDir);
    expect(result).not.toBeNull();
    expect(result?.inferred).toBe(true);
    // Default branch name varies by git config (main or master)
    expect(result?.branch).toBeTruthy();
  });

  test("returns null when config missing and first repo has detached HEAD", async () => {
    const wsDir = join(tmpDir, "detached-ws");
    mkdirSync(join(wsDir, ".arbws"), { recursive: true });

    const repoDir = join(wsDir, "repo-a");
    Bun.spawnSync(["git", "init", repoDir], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync(["git", "-C", repoDir, "config", "user.email", "test@test.com"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    Bun.spawnSync(["git", "-C", repoDir, "config", "user.name", "Test"], { stdout: "ignore", stderr: "ignore" });
    writeFileSync(join(repoDir, "file.txt"), "content");
    Bun.spawnSync(["git", "-C", repoDir, "add", "."], { stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "init", "--no-gpg-sign"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    // Detach HEAD
    Bun.spawnSync(["git", "-C", repoDir, "checkout", "--detach"], { stdout: "ignore", stderr: "ignore" });

    const result = await workspaceBranch(wsDir);
    expect(result).toBeNull();
  });

  test("emits 'Config missing' warning only once for repeated calls on the same workspace", async () => {
    const wsDir = join(tmpDir, "dedup-ws");
    mkdirSync(join(wsDir, ".arbws"), { recursive: true });

    // Create a fake repo dir with a .git marker (so workspaceRepoDirs finds it)
    const repoDir = join(wsDir, "repo-a");
    mkdirSync(join(repoDir, ".git"), { recursive: true });

    // Mock gitLocal to return a branch without spawning a real git process
    const gitSpy = spyOn(git, "gitLocal").mockResolvedValue({ exitCode: 0, stdout: "my-feature\n", stderr: "" });
    const warnSpy = spyOn(output, "warn");

    try {
      const r1 = await workspaceBranch(wsDir);
      expect(r1).not.toBeNull();
      expect(r1?.branch).toBe("my-feature");
      expect(r1?.inferred).toBe(true);

      const r2 = await workspaceBranch(wsDir);
      expect(r2).not.toBeNull();
      expect(r2?.branch).toBe("my-feature");
      expect(r2?.inferred).toBe(true);

      // Warning should have been called exactly once
      const configMissingCalls = warnSpy.mock.calls.filter(
        (args) => typeof args[0] === "string" && args[0].includes("Config missing"),
      );
      expect(configMissingCalls).toHaveLength(1);
    } finally {
      gitSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
