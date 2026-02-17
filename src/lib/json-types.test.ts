import { describe, expect, test } from "bun:test";
import type { ListJsonEntry, StatusJsonOutput, StatusJsonRepo } from "./json-types";
import type { RepoStatus, WorkspaceSummary } from "./status";

// These assignments verify structural compatibility at compile time.
// If RepoStatus or WorkspaceSummary drift from the public JSON types,
// TypeScript will report an error here.

describe("json-types structural compatibility", () => {
	test("RepoStatus is assignable to StatusJsonRepo", () => {
		const repo: RepoStatus = {} as RepoStatus;
		const _json: StatusJsonRepo = repo;
		expect(true).toBe(true);
	});

	test("WorkspaceSummary is assignable to StatusJsonOutput", () => {
		const summary: WorkspaceSummary = {} as WorkspaceSummary;
		const _json: StatusJsonOutput = summary;
		expect(true).toBe(true);
	});

	test("ListJsonEntry has expected fields", () => {
		const entry: ListJsonEntry = {
			workspace: "test",
			active: true,
			branch: "main",
			base: null,
			repoCount: 2,
			status: null,
		};
		expect(entry.workspace).toBe("test");
	});
});
