import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cleanupTestEnv, createTestEnv, git, withEnv } from "./env";

/**
 * Verify that the template-based env (used by `withEnv`) produces the same
 * logical result as a fresh `createTestEnv()`. This catches regressions in
 * the copy + path-fixup logic.
 */
describe("env template", () => {
  test("template copy matches a fresh env", async () => {
    const fresh = await createTestEnv();
    try {
      await withEnv(async (copied) => {
        for (const name of ["repo-a", "repo-b"]) {
          const freshRepo = join(fresh.projectDir, `.arb/repos/${name}`);
          const copiedRepo = join(copied.projectDir, `.arb/repos/${name}`);

          // Remote URLs must point to each env's own origin, not the template's
          const freshUrl = (await git(freshRepo, ["remote", "get-url", "origin"])).trim();
          const copiedUrl = (await git(copiedRepo, ["remote", "get-url", "origin"])).trim();
          expect(freshUrl).toContain(fresh.originDir);
          expect(copiedUrl).toContain(copied.originDir);
          expect(copiedUrl).not.toContain(fresh.originDir);

          // Same branch structure
          const freshBranches = (await git(freshRepo, ["branch", "-a"])).trim();
          const copiedBranches = (await git(copiedRepo, ["branch", "-a"])).trim();
          expect(copiedBranches).toBe(freshBranches);

          // Same file tree in the repo working directory
          const freshFiles = await readdir(freshRepo);
          const copiedFiles = await readdir(copiedRepo);
          expect(copiedFiles.sort()).toEqual(freshFiles.sort());
        }

        // .arb/ marker structure matches
        const freshArb = (await readdir(join(fresh.projectDir, ".arb"))).sort();
        const copiedArb = (await readdir(join(copied.projectDir, ".arb"))).sort();
        expect(copiedArb).toEqual(freshArb);

        // Git config file should not contain any reference to the template
        const template = await readFile(join(copied.projectDir, ".arb/repos/repo-a/.git/config"), "utf-8");
        expect(template).not.toContain(fresh.testDir);
      });
    } finally {
      await cleanupTestEnv(fresh);
    }
  });
});
