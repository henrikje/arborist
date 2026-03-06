import { describe, expect, test } from "bun:test";
import { arb, withEnv } from "./helpers/env";

describe("create info lines", () => {
	test("name + repos shows all four lines with hints on branch and base", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "my-ws", "repo-a", "repo-b"]);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("Workspace: my-ws");
			expect(result.stderr).toContain("Branch: my-ws");
			expect(result.stderr).toContain("same as workspace, use --branch to override");
			expect(result.stderr).toContain("Base: repo default");
			expect(result.stderr).toContain("use --base to override");
			expect(result.stderr).toContain("Repos: repo-a, repo-b");
		}));

	test("name + --branch + repos shows branch without hint", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "my-ws", "--branch", "feat/thing", "repo-a"]);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("Workspace: my-ws");
			expect(result.stderr).toContain("Branch: feat/thing");
			expect(result.stderr).not.toContain("same as workspace");
			expect(result.stderr).toContain("Base: repo default");
			expect(result.stderr).toContain("Repos: repo-a");
		}));

	test("--branch only + --all-repos shows workspace derived from branch", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "--branch", "feat/thing", "-a"]);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("Workspace: thing");
			expect(result.stderr).toContain("derived from branch");
			expect(result.stderr).toContain("Branch: feat/thing");
			expect(result.stderr).not.toContain("same as workspace");
		}));

	test("all explicit + repos shows no hints on branch or base", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "my-ws", "--branch", "feat/thing", "--base", "develop", "repo-a"]);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("Workspace: my-ws");
			expect(result.stderr).toContain("Branch: feat/thing");
			expect(result.stderr).not.toContain("same as workspace");
			expect(result.stderr).toContain("Base: develop");
			expect(result.stderr).not.toContain("use --base to override");
			expect(result.stderr).toContain("Repos: repo-a");
		}));

	test("name + --base + repos shows branch with hint, base without hint", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "my-ws", "--base", "develop", "repo-a"]);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("Branch: my-ws");
			expect(result.stderr).toContain("same as workspace, use --branch to override");
			expect(result.stderr).toContain("Base: develop");
			expect(result.stderr).not.toContain("use --base to override");
		}));

	test("name + --all-repos shows repos line as all", () =>
		withEnv(async (env) => {
			const result = await arb(env, ["create", "my-ws", "-a"]);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toContain("Workspace: my-ws");
			expect(result.stderr).toContain("Repos: all");
		}));
});
