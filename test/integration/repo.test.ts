import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { arb, git, initBareRepo, withBareEnv, withEnv, write } from "./helpers/env";

// ── repo bare invocation (defaults to list) ─────────────────────

describe("repo bare invocation", () => {
  test("arb repo defaults to arb repo list", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("arb repo --quiet defaults to arb repo list --quiet", () =>
    withEnv(async (env) => {
      const explicitResult = await arb(env, ["repo", "list", "--quiet"]);
      expect(explicitResult.exitCode).toBe(0);
      const implicitResult = await arb(env, ["repo", "--quiet"]);
      expect(implicitResult.exitCode).toBe(0);
      expect(implicitResult.output).toBe(explicitResult.output);
    }));
});

// ── repo list ────────────────────────────────────────────────────

describe("repo list", () => {
  test("arb repo list lists cloned repo names", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("repo-a");
      expect(result.output).toContain("repo-b");
    }));

  test("arb repo list outputs header plus one repo per line", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "list"]);
      expect(result.exitCode).toBe(0);
      const lines = result.output.trimEnd().split("\n");
      expect(lines.length).toBe(3);
    }));

  test("arb repo list shows SHARE and BASE columns", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("SHARE");
      expect(result.output).toContain("BASE");
      expect(result.output).toContain("origin");
    }));

  test("arb repo list --verbose shows URLs", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "list", "--verbose"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("origin/repo-a.git");
      expect(result.output).toContain("origin/repo-b.git");
    }));

  test("arb repo list outside project fails", () =>
    withBareEnv(async (env) => {
      const result = await arb(env, ["repo", "list"], { cwd: "/tmp" });
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Not inside a project");
    }));
});

// ── repo clone ───────────────────────────────────────────────────

describe("repo clone", () => {
  test("arb repo clone clones a repo into repos/", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "clone-test"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, ".arb/repos/clone-test/.git"))).toBe(true);
    }));

  test("arb repo clone derives name from URL", () =>
    withEnv(async (env) => {
      await initBareRepo(env.testDir, join(env.originDir, "derived-name.git"), "main");
      const result = await arb(env, ["repo", "clone", join(env.originDir, "derived-name.git")]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, ".arb/repos/derived-name/.git"))).toBe(true);
    }));

  test("arb repo clone detaches HEAD in canonical repo", () =>
    withEnv(async (env) => {
      const cloneResult = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "detach-test"]);
      expect(cloneResult.exitCode).toBe(0);
      const statusOutput = await git(join(env.projectDir, ".arb/repos/detach-test"), ["status"]);
      expect(statusOutput).toContain("HEAD detached");
    }));

  test("arb repo clone allows workspace on default branch", () =>
    withEnv(async (env) => {
      const cloneResult = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "main-test"]);
      expect(cloneResult.exitCode).toBe(0);
      const createResult = await arb(env, ["create", "main-ws", "--branch", "main", "main-test"]);
      expect(createResult.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, "main-ws/main-test"))).toBe(true);
      const branch = (await git(join(env.projectDir, "main-ws/main-test"), ["symbolic-ref", "--short", "HEAD"])).trim();
      expect(branch).toBe("main");
    }));

  test("arb repo clone fails if repo already exists", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "repo-a"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("already cloned");
    }));

  test("arb repo clone fails with invalid path", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "clone", "/nonexistent/path/repo.git"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Clone failed");
    }));

  test("arb repo clone without args fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "clone"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("missing required argument");
    }));
});

// ── repo remove ──────────────────────────────────────────────────

describe("repo remove", () => {
  test("arb repo remove deletes a canonical repo", () =>
    withEnv(async (env) => {
      const cloneResult = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "remove-me"]);
      expect(cloneResult.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, ".arb/repos/remove-me/.git"))).toBe(true);
      const result = await arb(env, ["repo", "remove", "remove-me", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, ".arb/repos/remove-me"))).toBe(false);
      expect(result.output).toContain("[remove-me] removed");
      expect(result.output).toContain("Removed 1 repo");
    }));

  test("arb repo remove cleans up template directory", () =>
    withEnv(async (env) => {
      const cloneResult = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "tpl-rm"]);
      expect(cloneResult.exitCode).toBe(0);
      const tplDir = join(env.projectDir, ".arb/templates/repos/tpl-rm");
      await mkdir(tplDir, { recursive: true });
      await write(join(tplDir, ".env"), "content");
      const result = await arb(env, ["repo", "remove", "tpl-rm", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, ".arb/templates/repos/tpl-rm"))).toBe(false);
    }));

  test("arb repo remove refuses when workspace uses repo", () =>
    withEnv(async (env) => {
      const createResult = await arb(env, ["create", "ws-using-repo", "-a"]);
      expect(createResult.exitCode).toBe(0);
      const result = await arb(env, ["repo", "remove", "repo-a", "--yes"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("Cannot remove repo-a");
      expect(result.output).toContain("ws-using-repo");
      expect(existsSync(join(env.projectDir, ".arb/repos/repo-a/.git"))).toBe(true);
    }));

  test("arb repo remove fails for nonexistent repo", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "remove", "does-not-exist", "--yes"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("not cloned");
    }));

  test("arb repo remove removes multiple repos", () =>
    withEnv(async (env) => {
      const cloneA = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "multi-a"]);
      expect(cloneA.exitCode).toBe(0);
      const cloneB = await arb(env, ["repo", "clone", join(env.originDir, "repo-b.git"), "multi-b"]);
      expect(cloneB.exitCode).toBe(0);
      const result = await arb(env, ["repo", "remove", "multi-a", "multi-b", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, ".arb/repos/multi-a"))).toBe(false);
      expect(existsSync(join(env.projectDir, ".arb/repos/multi-b"))).toBe(false);
      expect(result.output).toContain("Removed 2 repos");
    }));

  test("arb repo remove --all-repos removes all repos", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "remove", "--all-repos", "--yes"]);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Removed");
      const listResult = await arb(env, ["repo", "list"]);
      expect(listResult.output.trim()).toBe("");
    }));

  test("arb repo remove without args in non-TTY fails", () =>
    withEnv(async (env) => {
      const result = await arb(env, ["repo", "remove"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain("No repos specified");
    }));

  test("arb repo remove --dry-run shows plan but does not remove", () =>
    withEnv(async (env) => {
      const cloneResult = await arb(env, ["repo", "clone", join(env.originDir, "repo-a.git"), "dry-rm"]);
      expect(cloneResult.exitCode).toBe(0);
      const result = await arb(env, ["repo", "remove", "dry-rm", "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(env.projectDir, ".arb/repos/dry-rm"))).toBe(true);
      expect(result.output).toContain("dry-rm");
      expect(result.output).toContain("Dry run");
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
