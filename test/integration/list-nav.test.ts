import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { arb, deleteWorkspaceConfig, fetchAllRepos, git, withEnv, write } from "./helpers/env";

// ── list ─────────────────────────────────────────────────────────

describe("list", () => {
  test("arb list shows workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await arb(env, ["create", "ws-two", "repo-b"]);
      const result = await arb(env, ["list"]);
      expect(result.output).toContain("ws-one");
      expect(result.output).toContain("ws-two");
    }));

  test("arb list highlights active workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await arb(env, ["create", "ws-two", "repo-b"]);
      const result = await arb(env, ["list"], { cwd: join(env.projectDir, "ws-one") });
      expect(result.output).toMatch(/\*\s*ws-one/);
    }));

  test("arb list ignores dirs without .arbws", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "not-a-workspace"), { recursive: true });
      await arb(env, ["create", "real-ws", "--all-repos"]);
      const result = await arb(env, ["list"]);
      expect(result.output).toContain("real-ws");
      expect(result.output).not.toContain("not-a-workspace");
    }));

  test("arb list piped to cat has no escape sequences", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list"]);
      expect(result.output).not.toContain("\x1b");
    }));

  test("arb list with no workspaces shows hint", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["list"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("arb create");
    }));

  test("arb list shows repo count", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a", "repo-b"]);
      const result = await arb(env, ["list"]);
      expect(result.output).toContain("2");
    }));

  test("arb list shows no issues status for fresh branch with no commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list"]);
      expect(result.output).toContain("no issues");
    }));

  test("arb list shows no issues status when pushed", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await write(join(env.projectDir, "ws-one/repo-a/f.txt"), "change");
      await git(join(env.projectDir, "ws-one/repo-a"), ["add", "f.txt"]);
      await git(join(env.projectDir, "ws-one/repo-a"), ["commit", "-m", "commit"]);
      await git(join(env.projectDir, "ws-one/repo-a"), ["push", "-u", "origin", "ws-one"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["fetch", "origin"]);
      const result = await arb(env, ["list"]);
      expect(result.output).toContain("no issues");
    }));

  test("arb list shows per-flag status labels", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await write(join(env.projectDir, "ws-one/repo-a/f.txt"), "change");
      await git(join(env.projectDir, "ws-one/repo-a"), ["add", "f.txt"]);
      await git(join(env.projectDir, "ws-one/repo-a"), ["commit", "-m", "commit"]);
      await write(join(env.projectDir, "ws-one/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["list"]);
      expect(result.output).toContain("dirty");
      expect(result.output).toContain("unpushed");
      expect(result.output).not.toContain("with issues");
    }));

  test("arb list shows UPPERCASE headers", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list"]);
      expect(result.output).toContain("WORKSPACE");
      expect(result.output).toContain("BRANCH");
      expect(result.output).toContain("REPOS");
      expect(result.output).toContain("LAST COMMIT");
      expect(result.output).toContain("STATUS");
    }));

  test("arb list --no-status hides LAST COMMIT column", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--no-status"]);
      expect(result.output).not.toContain("LAST COMMIT");
    }));

  test("arb list shows relative time in LAST COMMIT column", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
      const wt = join(env.projectDir, "ws-one/repo-a");
      await git(wt, ["commit", "--allow-empty", "-m", "old commit", "--date", threeDaysAgo]);
      const result = await arb(env, ["list"]);
      expect(result.output).toContain("3 days");
    }));

  test("arb list shows months for old commits", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
      const wt = join(env.projectDir, "ws-one/repo-a");
      await git(wt, ["commit", "--allow-empty", "-m", "old commit", "--date", ninetyDaysAgo]);
      const result = await arb(env, ["list"]);
      expect(result.output).toContain("3 months");
    }));

  test("arb list LAST COMMIT column appears between REPOS and STATUS", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--no-fetch"]);
      const header = result.output.split("\n")[0] ?? "";
      const reposPos = header.indexOf("REPOS");
      const commitPos = header.indexOf("LAST COMMIT");
      const statusPos = header.indexOf("STATUS");
      expect(commitPos).toBeGreaterThan(reposPos);
      expect(commitPos).toBeLessThan(statusPos);
    }));

  test("arb list shows branch name", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "--branch", "feat/payments", "repo-a"]);
      const result = await arb(env, ["list"]);
      expect(result.output).toContain("feat/payments");
    }));

  test("arb list shows BASE column for stacked workspaces", () =>
    withEnv(async (env) => {
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["checkout", "-b", "feat/auth"]);
      await write(join(env.projectDir, ".arb/repos/repo-a/auth.txt"), "auth");
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["add", "auth.txt"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["commit", "-m", "auth"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["push", "-u", "origin", "feat/auth"]);
      await git(join(env.projectDir, ".arb/repos/repo-a"), ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);
      await arb(env, ["create", "normal", "repo-b"]);
      const result = await arb(env, ["list"]);
      expect(result.output).toContain("BASE");
      expect(result.output).toContain("feat/auth");
    }));

  test("arb list hides BASE column when no stacked workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list"]);
      expect(result.output).not.toContain("BASE");
    }));

  test("arb list --no-status shows workspaces without STATUS column", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await arb(env, ["create", "ws-two", "repo-b"]);
      const result = await arb(env, ["list", "--no-status"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
      expect(result.output).toContain("ws-two");
      expect(result.output).toContain("WORKSPACE");
      expect(result.output).toContain("BRANCH");
      expect(result.output).toContain("REPOS");
      expect(result.output).not.toContain("STATUS");
      expect(result.output).not.toContain("no issues");
    }));

  test("arb list -q outputs one workspace name per line", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await arb(env, ["create", "ws-two", "repo-b"]);
      const result = await arb(env, ["list", "-q"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
      expect(result.output).toContain("ws-two");
      expect(result.output).not.toContain("WORKSPACE");
      expect(result.output).not.toContain("STATUS");
      expect(result.output).not.toContain("\x1b");
    }));

  test("arb list piped output has no progress escape sequences", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await arb(env, ["create", "ws-two", "repo-b"]);
      const result = await arb(env, ["list"]);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences
      expect(result.stdout).not.toMatch(/\x1b\[.*A/);
    }));

  test("arb list fetches by default", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list"], { cwd: join(env.projectDir, "ws-one") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
    }));

  test("arb list --no-fetch skips fetching", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--no-fetch"], { cwd: join(env.projectDir, "ws-one") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
      expect(result.output).not.toContain("Fetched");
    }));

  test("arb list --fetch fetches before listing", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--fetch"], { cwd: join(env.projectDir, "ws-one") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fetched");
      expect(result.output).toContain("ws-one");
    }));

  test("arb list -N skips fetch (short for --no-fetch)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "-N"], { cwd: join(env.projectDir, "ws-one") });
      expect(result.exitCode).toBe(0);
      expect(result.output).not.toContain("Fetched");
      expect(result.output).toContain("ws-one");
    }));

  test("arb list -q skips fetch by default", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "-q"], { cwd: join(env.projectDir, "ws-one") });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
      expect(result.output).not.toContain("Fetched");
    }));

  test("arb list --fetch shows status after fetch", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("no issues");
    }));

  test("arb list --fetch with dirty repo shows dirty status", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await write(join(env.projectDir, "ws-one/repo-a/dirty.txt"), "dirty");
      const result = await arb(env, ["list", "--fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("dirty");
    }));

  test("arb list --fetch --json outputs valid JSON with status", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--fetch", "--json"]);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      const ws = data[0];
      expect(ws.workspace).toBe("ws-one");
      expect(ws).toHaveProperty("statusLabels");
    }));

  test("arb list --fetch --quiet outputs workspace names", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--fetch", "--quiet"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
      expect(result.output).not.toContain("WORKSPACE");
    }));

  test("arb list --json outputs valid JSON", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["list", "--no-fetch", "--json"]);
      expect(result.exitCode).toBe(0);
      JSON.parse(result.stdout);
    }));

  test("arb list --json includes workspace fields", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["list", "--no-fetch", "--json"]);
      const data = JSON.parse(result.stdout);
      const ws = data[0];
      expect(ws.workspace).toBe("my-feature");
      expect(ws.branch).toBe("my-feature");
      expect(ws.repoCount).toBe(2);
      expect(ws.status).toBeNull();
      expect(ws).toHaveProperty("atRiskCount");
      expect(ws).toHaveProperty("statusLabels");
      expect(ws).toHaveProperty("lastCommit");
      expect(typeof ws.lastCommit).toBe("string");
    }));

  test("arb list --json marks active workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await arb(env, ["create", "ws-two", "repo-b"]);
      const result = await arb(env, ["list", "--no-fetch", "--json"], { cwd: join(env.projectDir, "ws-one") });
      const data = JSON.parse(result.stdout);
      const byName: Record<string, Record<string, unknown>> = {};
      for (const ws of data) {
        byName[ws.workspace] = ws;
      }
      expect(byName["ws-one"].active).toBe(true);
      expect(byName["ws-two"].active).toBe(false);
    }));

  test("arb list --json handles config-missing workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      await deleteWorkspaceConfig(env, "my-feature");
      const result = await arb(env, ["list", "--no-fetch", "--json"]);
      const data = JSON.parse(result.stdout);
      const ws = data[0];
      expect(ws.status).toBe("config-missing");
      expect(ws.branch).toBeNull();
      expect(ws.base).toBeNull();
      expect(ws.repoCount).toBeNull();
    }));

  test("arb list --json handles empty workspace", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "empty-ws/.arbws"), { recursive: true });
      await write(
        join(env.projectDir, "empty-ws/.arbws/config.json"),
        `${JSON.stringify({ branch: "empty-ws" }, null, 2)}\n`,
      );
      const result = await arb(env, ["list", "--no-fetch", "--json"]);
      const data = JSON.parse(result.stdout);
      const ws = data.find((w: Record<string, unknown>) => w.workspace === "empty-ws");
      expect(ws.status).toBe("empty");
      expect(ws.repoCount).toBe(0);
      expect(ws.branch).toBe("empty-ws");
    }));

  test("arb list --json --no-status omits aggregate fields", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["list", "--no-fetch", "--json", "--no-status"]);
      const data = JSON.parse(result.stdout);
      const ws = data[0];
      expect(ws.workspace).toBe("my-feature");
      expect(ws.branch).toBe("my-feature");
      expect(ws.repoCount).toBe(1);
      expect(ws).not.toHaveProperty("atRiskCount");
      expect(ws).not.toHaveProperty("statusLabels");
    }));

  test("arb list --json --no-status includes basic metadata", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["list", "--no-fetch", "--json", "--no-status"]);
      const data = JSON.parse(result.stdout);
      const ws = data[0];
      expect(ws).toHaveProperty("workspace");
      expect(ws).toHaveProperty("active");
      expect(ws).toHaveProperty("branch");
      expect(ws).toHaveProperty("base");
      expect(ws).toHaveProperty("repoCount");
      expect(ws).toHaveProperty("status");
    }));

  test("arb list --json contains no ANSI escape codes", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--json"]);
      expect(result.stdout).not.toContain("\x1b");
    }));

  test("arb list --json with no workspaces outputs empty array", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["list", "--json"]);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toEqual([]);
    }));
});

// ── path ─────────────────────────────────────────────────────────

describe("path", () => {
  test("arb path returns correct path", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "--all-repos"]);
      const result = await arb(env, ["path", "my-feature"]);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature"));
    }));

  test("arb path with no argument returns project root from workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["path"], { cwd: join(env.projectDir, "my-feature/repo-a") });
      expect(result.output.trim()).toBe(env.projectDir);
    }));

  test("arb path with subpath returns repo path", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["path", "my-feature/repo-a"]);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));

  test("arb path with no argument outside workspace returns project root", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["path"]);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(env.projectDir);
    }));

  test("arb path with invalid subpath fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["path", "my-feature/nonexistent"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not found in workspace");
    }));

  test("arb path with nonexistent workspace fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["path", "does-not-exist"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("does not exist");
    }));
});

// ── cd ───────────────────────────────────────────────────────────

describe("cd", () => {
  test("arb cd prints correct workspace path", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "--all-repos"]);
      const result = await arb(env, ["cd", "my-feature"]);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature"));
    }));

  test("arb cd with subpath prints correct repo path", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["cd", "my-feature/repo-a"]);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));

  test("arb cd with nonexistent workspace fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["cd", "does-not-exist"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("does not exist");
    }));

  test("arb cd with nonexistent subpath fails", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["cd", "my-feature/nonexistent"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not found in workspace");
    }));

  test("arb cd with no arg in non-TTY fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["cd"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Usage: arb cd");
    }));

  test("arb cd rejects non-workspace directory", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "not-a-workspace"), { recursive: true });
      const result = await arb(env, ["cd", "not-a-workspace"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("does not exist");
    }));

  test("arb cd path output is clean when stdout is captured (shell wrapper pattern)", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "--all-repos"]);
      const result = await arb(env, ["cd", "my-feature"]);
      expect(result.stdout.trim()).toBe(join(env.projectDir, "my-feature"));
    }));

  test("arb cd subpath output is clean when stdout is captured", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["cd", "my-feature/repo-a"]);
      expect(result.stdout.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));
});

// ── cd scope-aware ───────────────────────────────────────────────

describe("cd scope-aware", () => {
  test("arb cd resolves repo name when inside a workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["cd", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));

  test("arb cd resolves repo from a nested repo directory", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      await mkdir(join(env.projectDir, "my-feature/repo-a/src"), { recursive: true });
      const result = await arb(env, ["cd", "repo-b"], { cwd: join(env.projectDir, "my-feature/repo-a/src") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-b"));
    }));

  test("arb cd falls back to workspace when name is not a repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-alpha", "repo-a"]);
      await arb(env, ["create", "ws-beta", "repo-b"]);
      const result = await arb(env, ["cd", "ws-beta"], { cwd: join(env.projectDir, "ws-alpha") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "ws-beta"));
    }));

  test("arb cd prefers repo over workspace when ambiguous", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "repo-a", "repo-b"]);
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["cd", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));

  test("arb cd explicit ws/repo syntax still works from inside a workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-alpha", "repo-a"]);
      await arb(env, ["create", "ws-beta", "repo-b"]);
      const result = await arb(env, ["cd", "ws-beta/repo-b"], { cwd: join(env.projectDir, "ws-alpha") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "ws-beta/repo-b"));
    }));

  test("arb cd error when name matches neither repo nor workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["cd", "nonexistent"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("is not a repo in workspace");
      expect(result.output).toContain("or a workspace");
    }));

  test("arb cd behavior unchanged when at project root", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["cd", "my-feature"], { cwd: env.projectDir });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature"));
    }));
});

// ── path scope-aware ─────────────────────────────────────────────

describe("path scope-aware", () => {
  test("arb path resolves repo name when inside a workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["path", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));

  test("arb path falls back to workspace when not a repo", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-alpha", "repo-a"]);
      await arb(env, ["create", "ws-beta", "repo-b"]);
      const result = await arb(env, ["path", "ws-beta"], { cwd: join(env.projectDir, "ws-alpha") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "ws-beta"));
    }));

  test("arb path prefers repo over workspace when ambiguous", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "repo-a", "repo-b"]);
      await arb(env, ["create", "my-feature", "repo-a", "repo-b"]);
      const result = await arb(env, ["path", "repo-a"], { cwd: join(env.projectDir, "my-feature") });
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(join(env.projectDir, "my-feature/repo-a"));
    }));
});

// ── -C / --chdir ─────────────────────────────────────────────────

describe("-C / --chdir", () => {
  test("arb -C targets the given directory", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["-C", env.projectDir, "repo", "list"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("arb -C resolves relative paths", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["-C", "project", "repo", "list"], { cwd: env.testDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
    }));

  test("arb -C with non-existent directory fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["-C", "/no/such/directory", "repo", "list"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot change to");
      expect(result.output).toContain("no such directory");
    }));

  test("arb -C with init creates project in target directory", () =>
    withEnv(async (env) => {
      await mkdir(join(env.testDir, "new-root"), { recursive: true });
      const result = await arb(env, ["-C", join(env.testDir, "new-root"), "init"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.testDir, "new-root/.arb"))).toBe(true);
    }));

  test("arb -C with status detects workspace from target directory", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["-C", join(env.projectDir, "my-feature"), "status"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
    }));

  test("arb -C with list shows workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["-C", env.projectDir, "list", "--no-status"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("my-feature");
    }));

  test("arb -C with path prints correct path", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["-C", env.projectDir, "path"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(env.projectDir);
    }));

  test("arb -C with cd outputs correct directory", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "my-feature", "repo-a"]);
      const result = await arb(env, ["-C", env.projectDir, "cd", "my-feature"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(join(env.projectDir, "my-feature"));
    }));
});

// ── list filters ─────────────────────────────────────────────────

describe("list filters", () => {
  test("arb list --dirty filters to dirty workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-clean", "repo-a"]);
      await arb(env, ["create", "ws-dirty", "repo-a"]);
      await write(join(env.projectDir, "ws-dirty/repo-a/dirty.txt"), "uncommitted");
      const result = await arb(env, ["list", "--dirty"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-dirty");
      expect(result.output).not.toContain("ws-clean");
    }));

  test("arb list -d filters to dirty workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-clean", "repo-a"]);
      await arb(env, ["create", "ws-dirty", "repo-a"]);
      await write(join(env.projectDir, "ws-dirty/repo-a/dirty.txt"), "uncommitted");
      const result = await arb(env, ["list", "-d"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-dirty");
      expect(result.output).not.toContain("ws-clean");
    }));

  test("arb list --dirty --where conflicts", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--dirty", "--where", "unpushed"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot combine --dirty with --where");
    }));

  test("arb list --dirty --no-status conflicts", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--dirty", "--no-status"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("--where");
    }));
});

// ── list quiet ───────────────────────────────────────────────────

describe("list quiet", () => {
  test("arb list --quiet outputs workspace names only", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await arb(env, ["create", "ws-two", "repo-b"]);
      const result = await arb(env, ["list", "--quiet"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
      expect(result.output).toContain("ws-two");
      expect(result.output).not.toContain("WORKSPACE");
      expect(result.output).not.toContain("BRANCH");
    }));

  test("arb list --quiet --where filters workspace names", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-clean", "repo-a"]);
      await arb(env, ["create", "ws-dirty", "repo-a"]);
      await write(join(env.projectDir, "ws-dirty/repo-a/dirty.txt"), "uncommitted");
      const result = await arb(env, ["list", "--quiet", "--where", "dirty"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-dirty");
      expect(result.output).not.toContain("ws-clean");
    }));

  test("arb list -q includes config-missing workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      await deleteWorkspaceConfig(env, "ws-one");
      const result = await arb(env, ["list", "-q"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("ws-one");
    }));

  test("arb list -q includes empty workspaces", () =>
    withEnv(async (env) => {
      await mkdir(join(env.projectDir, "empty-ws/.arbws"), { recursive: true });
      await write(
        join(env.projectDir, "empty-ws/.arbws/config.json"),
        `${JSON.stringify({ branch: "empty-ws" }, null, 2)}\n`,
      );
      const result = await arb(env, ["list", "-q"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("empty-ws");
    }));

  test("arb list --quiet --json conflicts", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--quiet", "--json"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot combine --quiet with --json");
    }));
});

// ── repo list quiet/json ─────────────────────────────────────────

describe("repo list quiet/json", () => {
  test("arb repo list --quiet outputs repo names only", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "list", "-q"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
      expect(result.output).not.toContain("REPO");
      expect(result.output).not.toContain("URL");
    }));

  test("arb repo list --json outputs valid JSON with share and base", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "list", "--json"]);
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBe(2);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("url");
      expect(data[0]).toHaveProperty("share");
      expect(data[0]).toHaveProperty("base");
      expect(data[0].share).toHaveProperty("name");
      expect(data[0].share).toHaveProperty("url");
      expect(data[0].base).toHaveProperty("name");
      expect(data[0].base).toHaveProperty("url");
    }));

  test("arb repo list --quiet --json conflicts", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "list", "--quiet", "--json"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot combine --quiet with --json");
    }));

  test("arb repo list --verbose --quiet conflicts", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "list", "--verbose", "--quiet"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot combine --quiet with --verbose");
    }));

  test("arb repo list --verbose --json conflicts", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "list", "--verbose", "--json"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot combine --verbose with --json");
    }));
});

// ── schema ───────────────────────────────────────────────────────

describe("schema", () => {
  test("arb list --schema outputs valid JSON Schema without requiring workspace", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["list", "--schema"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      const schema = JSON.parse(result.stdout);
      expect(schema).toHaveProperty("$schema");
      expect(schema.type).toBe("array");
      expect(schema.items.properties).toHaveProperty("workspace");
    }));

  test("arb repo list --schema outputs valid JSON Schema without requiring workspace", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "list", "--schema"], { cwd: "/tmp" });
      expect(result.exitCode).toBe(0);
      const schema = JSON.parse(result.stdout);
      expect(schema).toHaveProperty("$schema");
      expect(schema.type).toBe("array");
      expect(schema.items.properties).toHaveProperty("name");
      expect(schema.items.properties).toHaveProperty("share");
    }));
});

// ── fetch ────────────────────────────────────────────────────────

describe("fetch", () => {
  test("arb list --fetch only fetches repos used in workspaces", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "ws-one", "repo-a"]);
      const result = await arb(env, ["list", "--fetch"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Fetched 1 repo");
      expect(result.output).not.toContain("Fetched 2 repos");
    }));
});

// ── squash-merged ────────────────────────────────────────────────

describe("squash-merged", () => {
  test("arb list suppresses diverged and behind-base for squash-merged workspace", () =>
    withEnv(async (env) => {
      await arb(env, ["create", "merged-ws", "repo-a"]);
      const wt = join(env.projectDir, "merged-ws/repo-a");

      // Make feature work and push
      await write(join(wt, "feature.txt"), "feature content");
      await git(wt, ["add", "feature.txt"]);
      await git(wt, ["commit", "-m", "feature work"]);
      await arb(env, ["push", "--yes"], { cwd: join(env.projectDir, "merged-ws") });

      // Squash merge + delete remote branch
      const bare = join(env.originDir, "repo-a.git");
      const tmp = join(env.testDir, "tmp-squash-list");
      await git(env.testDir, ["clone", bare, tmp]);
      await git(tmp, ["merge", "--squash", "origin/merged-ws"]);
      await git(tmp, ["commit", "-m", "squash merge"]);
      await git(tmp, ["push", "origin", "main"]);
      await rm(tmp, { recursive: true });
      await git(bare, ["branch", "-D", "merged-ws"]);
      await fetchAllRepos(env);

      const result = await arb(env, ["list"]);
      expect(result.output).toContain("merged");
      expect(result.output).toContain("gone");
      expect(result.output).not.toContain("diverged");
      expect(result.output).not.toContain("behind base");
    }));
});

// ── help flag ────────────────────────────────────────────────────

describe("help flag", () => {
  test("arb -C is visible in --help output", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("-C <directory>");
    }));
});
