import { describe, expect, test } from "bun:test";
import type { TableNode } from "./render-model";
import type { WorkspaceSummary } from "./status";
import { type StatusViewContext, buildStatusView } from "./status-view";
import { makeRepo } from "./test-helpers";

function makeSummary(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
	return {
		workspace: "test-ws",
		branch: "feature",
		base: null,
		repos: [makeRepo()],
		total: 1,
		atRiskCount: 0,
		rebasedOnlyCount: 0,
		statusLabels: [],
		statusCounts: [],
		lastCommit: null,
		detectedTicket: null,
		...overrides,
	};
}

function defaultCtx(overrides: Partial<StatusViewContext> = {}): StatusViewContext {
	return {
		expectedBranch: "feature",
		conflictRepos: new Set(),
		currentRepo: null,
		...overrides,
	};
}

describe("buildStatusView", () => {
	test("returns message node when no repos", () => {
		const nodes = buildStatusView(makeSummary({ repos: [], total: 0 }), defaultCtx());
		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.kind).toBe("message");
	});

	test("returns table node for repos", () => {
		const nodes = buildStatusView(makeSummary(), defaultCtx());
		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.kind).toBe("table");
	});

	test("table has correct column keys", () => {
		const nodes = buildStatusView(makeSummary(), defaultCtx());
		const table = nodes[0] as TableNode;
		const keys = table.columns.map((c) => c.key);
		expect(keys).toContain("repo");
		expect(keys).toContain("branch");
		expect(keys).toContain("baseName");
		expect(keys).toContain("baseDiff");
		expect(keys).toContain("remoteName");
		expect(keys).toContain("remoteDiff");
		expect(keys).toContain("local");
		expect(keys).toContain("lastCommitNum");
		expect(keys).toContain("lastCommitUnit");
	});

	test("BRANCH column is hidden when no drift", () => {
		const nodes = buildStatusView(makeSummary(), defaultCtx());
		const table = nodes[0] as TableNode;
		const branchCol = table.columns.find((c) => c.key === "branch");
		expect(branchCol?.show).toBe(false);
	});

	test("BRANCH column shown when drifted", () => {
		const driftedRepo = makeRepo({
			identity: { worktreeKind: "linked", headMode: { kind: "attached", branch: "other" }, shallow: false },
		});
		const nodes = buildStatusView(makeSummary({ repos: [driftedRepo] }), defaultCtx());
		const table = nodes[0] as TableNode;
		const branchCol = table.columns.find((c) => c.key === "branch");
		expect(branchCol?.show).toBe(true);
	});

	test("BRANCH column shown when detached", () => {
		const detachedRepo = makeRepo({
			identity: { worktreeKind: "linked", headMode: { kind: "detached" }, shallow: false },
		});
		const nodes = buildStatusView(makeSummary({ repos: [detachedRepo] }), defaultCtx());
		const table = nodes[0] as TableNode;
		const branchCol = table.columns.find((c) => c.key === "branch");
		expect(branchCol?.show).toBe(true);
	});

	test("marks current repo", () => {
		const repos = [makeRepo({ name: "frontend" }), makeRepo({ name: "backend" })];
		const nodes = buildStatusView(makeSummary({ repos, total: 2 }), defaultCtx({ currentRepo: "backend" }));
		const table = nodes[0] as TableNode;
		expect(table.rows[0]?.marked).toBeFalsy();
		expect(table.rows[1]?.marked).toBe(true);
	});

	test("grouped columns: BASE has two sub-columns", () => {
		const nodes = buildStatusView(makeSummary(), defaultCtx());
		const table = nodes[0] as TableNode;
		const baseCols = table.columns.filter((c) => c.group === "BASE");
		expect(baseCols).toHaveLength(2);
		expect(baseCols.map((c) => c.key)).toEqual(["baseName", "baseDiff"]);
	});

	test("grouped columns: SHARE has two sub-columns", () => {
		const nodes = buildStatusView(makeSummary(), defaultCtx());
		const table = nodes[0] as TableNode;
		const shareCols = table.columns.filter((c) => c.group === "SHARE");
		expect(shareCols).toHaveLength(2);
		expect(shareCols.map((c) => c.key)).toEqual(["remoteName", "remoteDiff"]);
	});

	test("grouped columns: LAST COMMIT has two sub-columns", () => {
		const nodes = buildStatusView(makeSummary(), defaultCtx());
		const table = nodes[0] as TableNode;
		const lcCols = table.columns.filter((c) => c.group === "LAST COMMIT");
		expect(lcCols).toHaveLength(2);
		expect(lcCols[0]?.align).toBe("right");
	});

	test("remoteName column has truncate", () => {
		const nodes = buildStatusView(makeSummary(), defaultCtx());
		const table = nodes[0] as TableNode;
		const remoteNameCol = table.columns.find((c) => c.key === "remoteName");
		expect(remoteNameCol?.truncate).toEqual({ min: 10 });
	});

	test("row cells contain correct plain text", () => {
		const nodes = buildStatusView(makeSummary(), defaultCtx());
		const table = nodes[0] as TableNode;
		const row = table.rows[0] as (typeof table.rows)[number];
		expect(row.cells.repo?.plain).toBe("test-repo");
		expect(row.cells.branch?.plain).toBe("feature");
		expect(row.cells.baseName?.plain).toBe("origin/main");
		expect(row.cells.baseDiff?.plain).toBe("equal");
		expect(row.cells.remoteName?.plain).toBe("origin/feature");
		expect(row.cells.remoteDiff?.plain).toBe("up to date");
		expect(row.cells.local?.plain).toBe("clean");
	});

	test("conflict repos get attention on baseDiff", () => {
		const repo = makeRepo({
			base: {
				remote: "origin",
				ref: "main",
				configuredRef: null,
				ahead: 2,
				behind: 3,
				mergedIntoBase: null,
				baseMergedIntoDefault: null,
				detectedPr: null,
			},
		});
		const nodes = buildStatusView(
			makeSummary({ repos: [repo] }),
			defaultCtx({ conflictRepos: new Set(["test-repo"]) }),
		);
		const table = nodes[0] as TableNode;
		const baseDiff = table.rows[0]?.cells.baseDiff;
		expect(baseDiff?.spans[0]?.attention).toBe("attention");
	});

	test("multiple repos produce correct number of rows", () => {
		const repos = [makeRepo({ name: "a" }), makeRepo({ name: "b" }), makeRepo({ name: "c" })];
		const nodes = buildStatusView(makeSummary({ repos, total: 3 }), defaultCtx());
		const table = nodes[0] as TableNode;
		expect(table.rows).toHaveLength(3);
	});
});
