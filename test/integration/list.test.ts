import { describe, expect, test } from "bun:test";
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

  test("arb list does not show base-missing when base is merged into default", () =>
    withEnv(async (env) => {
      const repoA = join(env.projectDir, ".arb/repos/repo-a");
      await git(repoA, ["checkout", "-b", "feat/auth"]);
      await write(join(repoA, "auth.txt"), "auth");
      await git(repoA, ["add", "auth.txt"]);
      await git(repoA, ["commit", "-m", "auth feature"]);
      await git(repoA, ["push", "-u", "origin", "feat/auth"]);
      await git(repoA, ["checkout", "--detach"]);

      await arb(env, ["create", "stacked", "--base", "feat/auth", "-b", "feat/auth-ui", "repo-a"]);

      // Merge feat/auth into main via merge commit (do NOT delete feat/auth)
      const tmpMerge = join(env.testDir, "tmp-merge");
      await git(env.testDir, ["clone", join(env.originDir, "repo-a.git"), tmpMerge]);
      await git(tmpMerge, ["merge", "origin/feat/auth", "--no-ff", "-m", "merge feat/auth"]);
      await git(tmpMerge, ["push"]);

      await fetchAllRepos(env);

      const result = await arb(env, ["list", "--fetch", "--json"]);
      const data = JSON.parse(result.stdout);
      const ws = data.find((w: Record<string, unknown>) => w.workspace === "stacked");
      // Should show "base merged" but NOT "base missing"
      const counts = ws.statusCounts as { label: string }[];
      const labels = counts.map((c: { label: string }) => c.label);
      expect(labels).toContain("base merged");
      expect(labels).not.toContain("base missing");
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
      expect(ws).toHaveProperty("statusCounts");
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
      expect(ws).toHaveProperty("statusCounts");
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
      expect(ws).not.toHaveProperty("statusCounts");
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
