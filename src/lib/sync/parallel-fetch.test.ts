import { describe, expect, test } from "bun:test";
import { fetchSuffix, reportFetchFailures } from "./parallel-fetch";

describe("reportFetchFailures", () => {
	test("returns empty array when all succeed", () => {
		const results = new Map([
			["repo-a", { exitCode: 0, output: "" }],
			["repo-b", { exitCode: 0, output: "" }],
		]);
		const failed = reportFetchFailures(["repo-a", "repo-b"], results);
		expect(failed).toEqual([]);
	});

	test("returns failed repos when exitCode !== 0", () => {
		const results = new Map([
			["repo-a", { exitCode: 0, output: "" }],
			["repo-b", { exitCode: 1, output: "error" }],
		]);
		const failed = reportFetchFailures(["repo-a", "repo-b"], results);
		expect(failed).toEqual(["repo-b"]);
	});

	test("identifies timeout (exitCode 124)", () => {
		const results = new Map([["repo-a", { exitCode: 124, output: "timed out" }]]);
		const failed = reportFetchFailures(["repo-a"], results);
		expect(failed).toEqual(["repo-a"]);
	});

	test("handles missing results", () => {
		const results = new Map<string, { exitCode: number; output: string }>();
		const failed = reportFetchFailures(["repo-a"], results);
		expect(failed).toEqual(["repo-a"]);
	});
});

describe("fetchSuffix", () => {
	test("returns fetch message without hint by default", () => {
		const result = fetchSuffix(3);
		expect(result).toContain("Fetching 3 repos...");
		expect(result).not.toContain("<Esc to cancel>");
	});

	test("returns fetch message without hint when abortable is false", () => {
		const result = fetchSuffix(3, { abortable: false });
		expect(result).toContain("Fetching 3 repos...");
		expect(result).not.toContain("<Esc to cancel>");
	});

	test("returns singular form for 1 repo", () => {
		const result = fetchSuffix(1);
		expect(result).toContain("Fetching 1 repo...");
	});

	// Note: abortable hint only appears when both isTTY() and process.stdin.isTTY are true.
	// In test environment stdin is not a TTY, so the hint is not included even with abortable: true.
	test("does not include hint when stdin is not a TTY", () => {
		const result = fetchSuffix(3, { abortable: true });
		expect(result).toContain("Fetching 3 repos...");
		expect(result).not.toContain("<Esc to cancel>");
	});
});
