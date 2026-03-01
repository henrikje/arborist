import { describe, expect, test } from "bun:test";
import { extractPrNumber } from "./pr-detection";

describe("extractPrNumber", () => {
	describe("GitHub merge commit", () => {
		test("standard format", () => {
			expect(extractPrNumber("Merge pull request #123 from user/branch")).toBe(123);
		});

		test("large PR number", () => {
			expect(extractPrNumber("Merge pull request #98765 from org/feat/dark-mode")).toBe(98765);
		});
	});

	describe("Azure DevOps merge commit", () => {
		test("standard format", () => {
			expect(extractPrNumber("Merged PR 456: Add dark mode toggle")).toBe(456);
		});

		test("large PR number", () => {
			expect(extractPrNumber("Merged PR 12345: Fix login crash")).toBe(12345);
		});
	});

	describe("GitHub squash merge", () => {
		test("standard format", () => {
			expect(extractPrNumber("Add dark mode toggle (#42)")).toBe(42);
		});

		test("with trailing whitespace", () => {
			expect(extractPrNumber("Fix login crash (#99)  ")).toBe(99);
		});

		test("conventional commit style", () => {
			expect(extractPrNumber("feat: add dark mode (#123)")).toBe(123);
		});
	});

	describe("no match", () => {
		test("plain commit message", () => {
			expect(extractPrNumber("Fix the login crash")).toBeNull();
		});

		test("issue reference mid-string", () => {
			expect(extractPrNumber("Fix #42 in the login flow")).toBeNull();
		});

		test("empty string", () => {
			expect(extractPrNumber("")).toBeNull();
		});

		test("GitLab merge format (not supported)", () => {
			expect(extractPrNumber("Merge branch 'feature' into 'main'")).toBeNull();
		});
	});

	describe("priority", () => {
		test("GitHub merge takes priority over squash pattern", () => {
			expect(extractPrNumber("Merge pull request #10 from user/branch (#20)")).toBe(10);
		});

		test("Azure DevOps merge takes priority over squash pattern", () => {
			expect(extractPrNumber("Merged PR 10: Something (#20)")).toBe(10);
		});
	});
});
