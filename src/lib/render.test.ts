import { describe, expect, test } from "bun:test";
import { type RenderContext, render, renderCell } from "./render";
import type { MessageNode, SectionNode, SummaryNode, TableNode } from "./render-model";
import { cell, spans } from "./render-model";

const TTY: RenderContext = { tty: true };
const NO_TTY: RenderContext = { tty: false };

describe("renderCell", () => {
	test("renders plain text when tty is false", () => {
		const c = cell("hello", "attention");
		expect(renderCell(c, NO_TTY)).toBe("hello");
	});

	test("renders ANSI yellow when tty and attention", () => {
		const c = cell("warn", "attention");
		const result = renderCell(c, TTY);
		expect(result).toContain("warn");
		expect(result).toContain("\x1b[0;33m"); // yellow
	});

	test("renders no color for default attention", () => {
		const c = cell("normal");
		expect(renderCell(c, TTY)).toBe("normal");
	});

	test("renders multi-span cell with mixed colors", () => {
		const c = spans({ text: "merged, ", attention: "default" }, { text: "1 to push", attention: "attention" });
		const result = renderCell(c, TTY);
		expect(result).toContain("merged, ");
		expect(result).toContain("\x1b[0;33m1 to push");
	});

	test("renders dim", () => {
		const c = cell("hash", "muted");
		const result = renderCell(c, TTY);
		expect(result).toContain("\x1b[2m");
	});

	test("renders danger as red", () => {
		const c = cell("error", "danger");
		const result = renderCell(c, TTY);
		expect(result).toContain("\x1b[0;31m");
	});

	test("renders success as green", () => {
		const c = cell("done", "success");
		const result = renderCell(c, TTY);
		expect(result).toContain("\x1b[0;32m");
	});
});

describe("render table", () => {
	test("renders basic table with header and rows", () => {
		const table: TableNode = {
			kind: "table",
			columns: [
				{ header: "NAME", key: "name" },
				{ header: "STATUS", key: "status" },
			],
			rows: [
				{ cells: { name: cell("foo"), status: cell("ok") } },
				{ cells: { name: cell("bar-long"), status: cell("fail") } },
			],
		};

		const result = render([table], NO_TTY);
		const lines = result.split("\n");

		// Header should be indented with 2 spaces
		expect(lines[0]).toMatch(/^ {2}NAME/);
		expect(lines[0]).toContain("STATUS");

		// Data rows should be indented with 2 spaces
		expect(lines[1]).toMatch(/^ {2}foo/);
		expect(lines[2]).toMatch(/^ {2}bar-long/);

		// Columns should be aligned — "foo" padded to match "bar-long"
		const nameEnd1 = (lines[1] as string).indexOf("ok");
		const nameEnd2 = (lines[2] as string).indexOf("fail");
		expect(nameEnd1).toBe(nameEnd2);
	});

	test("handles marked rows", () => {
		const table: TableNode = {
			kind: "table",
			columns: [{ header: "REPO", key: "repo" }],
			rows: [{ cells: { repo: cell("frontend") }, marked: true }, { cells: { repo: cell("backend") } }],
		};

		const result = render([table], TTY);
		const lines = result.split("\n");
		expect(lines[1]).toContain("*"); // marked with bold *
		expect(lines[2]).toMatch(/^ {2}/); // not marked
	});

	test("hides columns with show: false", () => {
		const table: TableNode = {
			kind: "table",
			columns: [
				{ header: "NAME", key: "name" },
				{ header: "HIDDEN", key: "hidden", show: false },
				{ header: "STATUS", key: "status" },
			],
			rows: [{ cells: { name: cell("foo"), hidden: cell("secret"), status: cell("ok") } }],
		};

		const result = render([table], NO_TTY);
		expect(result).not.toContain("HIDDEN");
		expect(result).not.toContain("secret");
	});

	test("renders grouped columns with sub-gap", () => {
		const table: TableNode = {
			kind: "table",
			columns: [
				{ header: "NAME", key: "name" },
				{ header: "", key: "baseName", group: "BASE" },
				{ header: "", key: "baseDiff", group: "BASE" },
			],
			rows: [
				{
					cells: {
						name: cell("repo"),
						baseName: cell("origin/main"),
						baseDiff: cell("2 ahead"),
					},
				},
			],
		};

		const result = render([table], NO_TTY);
		const lines = result.split("\n");

		// Header should show group name "BASE", not individual headers
		expect(lines[0]).toContain("BASE");

		// Sub-columns should be separated by 2 spaces (default SUB_GAP)
		expect(lines[1]).toContain("origin/main  2 ahead");
	});

	test("right-aligns columns with align: right", () => {
		const table: TableNode = {
			kind: "table",
			columns: [
				{ header: "", key: "num", group: "COMMIT", align: "right" },
				{ header: "", key: "unit", group: "COMMIT" },
			],
			rows: [{ cells: { num: cell("3"), unit: cell("days") } }, { cells: { num: cell("12"), unit: cell("hours") } }],
		};

		const result = render([table], NO_TTY);
		const lines = result.split("\n");

		// "3" should be right-aligned (padded on the left)
		// "12" should not have leading padding
		const line1 = lines[1] as string;
		const line2 = lines[2] as string;
		// The "3" should appear further right than the start
		const numPos1 = line1.indexOf("3");
		const numPos2 = line2.indexOf("1");
		expect(numPos1).toBeGreaterThan(numPos2); // "3" is further right
	});

	test("empty table returns empty string", () => {
		const table: TableNode = {
			kind: "table",
			columns: [{ header: "NAME", key: "name" }],
			rows: [],
		};
		expect(render([table], NO_TTY)).toBe("");
	});
});

describe("render message", () => {
	test("renders message with indent", () => {
		const msg: MessageNode = { kind: "message", level: "muted", text: "(no repos)" };
		const result = render([msg], NO_TTY);
		expect(result).toBe("  (no repos)\n");
	});

	test("renders colored message in tty", () => {
		const msg: MessageNode = { kind: "message", level: "attention", text: "warning!" };
		const result = render([msg], TTY);
		expect(result).toContain("\x1b[0;33m");
		expect(result).toContain("warning!");
	});
});

describe("render section", () => {
	test("renders section with header and items", () => {
		const section: SectionNode = {
			kind: "section",
			header: cell("Behind base:", "muted"),
			items: [
				spans({ text: "abc123", attention: "muted" }, { text: " fix bug", attention: "default" }),
				spans({ text: "def456", attention: "muted" }, { text: " add feature", attention: "default" }),
			],
		};

		const result = render([section], NO_TTY);
		const lines = result.split("\n");
		expect(lines[0]).toContain("Behind base:");
		expect(lines[1]).toContain("abc123 fix bug");
		expect(lines[2]).toContain("def456 add feature");
	});

	test("uses 6-space indent for header and 10-space indent for items", () => {
		const section: SectionNode = {
			kind: "section",
			header: cell("Header:"),
			items: [cell("item1"), cell("item2")],
		};

		const result = render([section], NO_TTY);
		const lines = result.split("\n");
		expect(lines[0]).toBe("      Header:");
		expect(lines[1]).toBe("          item1");
		expect(lines[2]).toBe("          item2");
	});
});

describe("render summary", () => {
	test("renders success summary", () => {
		const summary: SummaryNode = {
			kind: "summary",
			parts: [cell("Pushed 3 repos")],
			hasErrors: false,
		};
		const result = render([summary], TTY);
		expect(result).toContain("\x1b[0;32m"); // green
		expect(result).toContain("Pushed 3 repos");
	});

	test("renders error summary in yellow", () => {
		const summary: SummaryNode = {
			kind: "summary",
			parts: [cell("2 skipped")],
			hasErrors: true,
		};
		const result = render([summary], TTY);
		expect(result).toContain("\x1b[0;33m"); // yellow
	});

	test("renders plain text when no tty", () => {
		const summary: SummaryNode = {
			kind: "summary",
			parts: [cell("Done")],
			hasErrors: false,
		};
		const result = render([summary], NO_TTY);
		expect(result).toBe("Done\n");
		expect(result).not.toContain("\x1b[");
	});
});

describe("render gap", () => {
	test("renders blank line", () => {
		expect(render([{ kind: "gap" }], NO_TTY)).toBe("\n");
	});
});

describe("render repoHeader", () => {
	test("renders header with bold in tty", () => {
		const result = render([{ kind: "repoHeader", name: "frontend" }], TTY);
		expect(result).toContain("==> frontend <==");
		expect(result).toContain("\x1b[1m"); // bold
	});

	test("renders header without ANSI when no tty", () => {
		const result = render([{ kind: "repoHeader", name: "backend" }], NO_TTY);
		expect(result).toBe("==> backend <==\n");
	});

	test("renders header with note", () => {
		const result = render([{ kind: "repoHeader", name: "api", note: cell("(skipped)", "attention") }], NO_TTY);
		expect(result).toBe("==> api <== (skipped)\n");
	});
});

describe("render hint", () => {
	test("renders hint cell", () => {
		const result = render([{ kind: "hint", cell: cell("Run 'arb rebase'", "muted") }], NO_TTY);
		expect(result).toBe("Run 'arb rebase'\n");
	});
});

describe("render multiple nodes", () => {
	test("renders nodes in sequence", () => {
		const nodes = [
			{ kind: "message" as const, level: "muted" as const, text: "(no repos)" },
			{ kind: "gap" as const },
			{ kind: "message" as const, level: "default" as const, text: "Done" },
		];
		const result = render(nodes, NO_TTY);
		expect(result).toBe("  (no repos)\n\n  Done\n");
	});
});

describe("terminal truncation", () => {
	test("truncates columns with truncate option when terminal is narrow", () => {
		const table: TableNode = {
			kind: "table",
			columns: [
				{ header: "NAME", key: "name" },
				{ header: "REMOTE", key: "remote", truncate: { min: 10 } },
			],
			rows: [
				{
					cells: {
						name: cell("repo"),
						remote: cell("origin/very-long-feature-branch-name"),
					},
				},
			],
		};

		// With wide terminal — no truncation
		const wide = render([table], { tty: false, terminalWidth: 200 });
		expect(wide).toContain("origin/very-long-feature-branch-name");

		// With narrow terminal — truncation applied
		const narrow = render([table], { tty: false, terminalWidth: 30 });
		expect(narrow).toContain("…");
		expect(narrow).not.toContain("origin/very-long-feature-branch-name");
	});
});
