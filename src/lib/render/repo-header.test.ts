import { describe, expect, test } from "bun:test";
import { computeFlags } from "../status/status";
import { makeRepo } from "../status/test-helpers";
import type { RepoHeaderNode } from "./model";
import { buildRepoSkipHeader, repoHeaderNode } from "./repo-header";

describe("repoHeaderNode", () => {
	test("creates header without note", () => {
		const node = repoHeaderNode("api");
		expect(node.kind).toBe("repoHeader");
		expect(node.name).toBe("api");
		expect(node.note).toBeUndefined();
	});

	test("creates header with muted note", () => {
		const node = repoHeaderNode("api", "3 commits ahead");
		expect(node.note?.plain).toBe("3 commits ahead");
		expect(node.note?.spans[0]?.attention).toBe("muted");
	});
});

describe("buildRepoSkipHeader", () => {
	test("returns null for normal repo", () => {
		const repo = makeRepo();
		const flags = computeFlags(repo, "feature");
		expect(buildRepoSkipHeader(repo, "feature", flags, false)).toBeNull();
	});

	test("returns header with attention note for detached repo", () => {
		const repo = makeRepo({
			identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
		});
		const flags = computeFlags(repo, "feature");
		const nodes = buildRepoSkipHeader(repo, "feature", flags, false) ?? [];

		expect(nodes.length).toBeGreaterThan(0);
		const header = nodes[0] as RepoHeaderNode;
		expect(header.kind).toBe("repoHeader");
		expect(header.name).toBe("test-repo");
		expect(header.note?.plain).toBe("detached \u2014 skipping");
		expect(header.note?.spans[0]?.attention).toBe("attention");
	});

	test("returns header with branch info for drifted repo", () => {
		const repo = makeRepo({
			name: "web",
			identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other-branch" }, shallow: false },
		});
		const flags = computeFlags(repo, "feature");
		const nodes = buildRepoSkipHeader(repo, "feature", flags, false) ?? [];

		expect(nodes.length).toBeGreaterThan(0);
		const header = nodes[0] as RepoHeaderNode;
		expect(header.note?.plain).toBe("on other-branch, expected feature \u2014 skipping");
		expect(header.note?.spans[0]?.attention).toBe("attention");
	});

	test("includes trailing GapNode when not last", () => {
		const repo = makeRepo({
			identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
		});
		const flags = computeFlags(repo, "feature");
		const nodes = buildRepoSkipHeader(repo, "feature", flags, false) ?? [];

		expect(nodes).toHaveLength(2);
		expect(nodes[1]).toEqual({ kind: "gap" });
	});

	test("omits trailing GapNode when last", () => {
		const repo = makeRepo({
			identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
		});
		const flags = computeFlags(repo, "feature");
		const nodes = buildRepoSkipHeader(repo, "feature", flags, true) ?? [];

		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.kind).toBe("repoHeader");
	});
});
