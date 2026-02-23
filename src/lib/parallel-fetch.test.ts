import { describe, expect, test } from "bun:test";
import { reportFetchFailures } from "./parallel-fetch";

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
