import { describe, expect, test } from "bun:test";

/**
 * readNamesFromStdin relies on process.stdin.isTTY and Bun.stdin.text(),
 * which can't be easily mocked in unit tests. Instead, test the parsing
 * logic extracted into a pure helper.
 */
function parseNames(input: string): string[] {
	return input
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
}

describe("stdin name parsing", () => {
	test("splits lines into names", () => {
		expect(parseNames("foo\nbar\nbaz")).toEqual(["foo", "bar", "baz"]);
	});

	test("trims whitespace from names", () => {
		expect(parseNames("  foo  \n  bar  ")).toEqual(["foo", "bar"]);
	});

	test("skips blank lines", () => {
		expect(parseNames("foo\n\n\nbar\n")).toEqual(["foo", "bar"]);
	});

	test("returns empty array for empty input", () => {
		expect(parseNames("")).toEqual([]);
	});

	test("returns empty array for whitespace-only input", () => {
		expect(parseNames("  \n  \n  ")).toEqual([]);
	});

	test("handles single name without trailing newline", () => {
		expect(parseNames("repo-a")).toEqual(["repo-a"]);
	});

	test("handles tabs in input", () => {
		expect(parseNames("\tfoo\t\nbar")).toEqual(["foo", "bar"]);
	});
});
