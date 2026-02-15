import { describe, expect, test } from "bun:test";
import type { RepoStatus } from "./status";
import { isDirty, isUnpushed } from "./status";

function makeRepo(overrides: Partial<RepoStatus> = {}): RepoStatus {
	return {
		name: "test-repo",
		branch: { expected: "feature", actual: "feature", drifted: false, detached: false },
		base: { name: "main", ahead: 0, behind: 0 },
		remote: { pushed: true, ahead: 0, behind: 0, local: false, trackingBranch: "origin/feature" },
		remotes: { upstream: "origin", publish: "origin" },
		local: { staged: 0, modified: 0, untracked: 0, conflicts: 0 },
		operation: null,
		...overrides,
	};
}

describe("isDirty", () => {
	test("returns false when all counts are zero", () => {
		expect(isDirty(makeRepo())).toBe(false);
	});

	test("returns true when staged > 0", () => {
		expect(isDirty(makeRepo({ local: { staged: 1, modified: 0, untracked: 0, conflicts: 0 } }))).toBe(true);
	});

	test("returns true when modified > 0", () => {
		expect(isDirty(makeRepo({ local: { staged: 0, modified: 1, untracked: 0, conflicts: 0 } }))).toBe(true);
	});

	test("returns true when untracked > 0", () => {
		expect(isDirty(makeRepo({ local: { staged: 0, modified: 0, untracked: 1, conflicts: 0 } }))).toBe(true);
	});

	test("returns true when conflicts > 0", () => {
		expect(isDirty(makeRepo({ local: { staged: 0, modified: 0, untracked: 0, conflicts: 1 } }))).toBe(true);
	});
});

describe("isUnpushed", () => {
	test("returns false when aligned with remote", () => {
		expect(isUnpushed(makeRepo())).toBe(false);
	});

	test("returns true when remote.ahead > 0", () => {
		expect(
			isUnpushed(
				makeRepo({ remote: { pushed: true, ahead: 2, behind: 0, local: false, trackingBranch: "origin/feature" } }),
			),
		).toBe(true);
	});

	test("returns true when not pushed and base has commits ahead", () => {
		expect(
			isUnpushed(
				makeRepo({
					remote: { pushed: false, ahead: 0, behind: 0, local: false, trackingBranch: null },
					base: { name: "main", ahead: 3, behind: 0 },
				}),
			),
		).toBe(true);
	});

	test("returns false when not pushed but base has no commits ahead", () => {
		expect(
			isUnpushed(
				makeRepo({
					remote: { pushed: false, ahead: 0, behind: 0, local: false, trackingBranch: null },
					base: { name: "main", ahead: 0, behind: 0 },
				}),
			),
		).toBe(false);
	});

	test("returns false when not pushed and base is null", () => {
		expect(
			isUnpushed(
				makeRepo({
					remote: { pushed: false, ahead: 0, behind: 0, local: false, trackingBranch: null },
					base: null,
				}),
			),
		).toBe(false);
	});
});
