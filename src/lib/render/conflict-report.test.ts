import { describe, expect, test } from "bun:test";
import { type ConflictEntry, buildConflictReport, buildStashPopFailureReport } from "./conflict-report";
import type { MessageNode, SectionNode } from "./model";

describe("buildConflictReport", () => {
	test("returns empty array for no entries", () => {
		expect(buildConflictReport([])).toEqual([]);
	});

	test("produces gap + message + gap + section for a single entry", () => {
		const entries: ConflictEntry[] = [
			{ repo: "api", stdout: "CONFLICT (content): Merge conflict in index.ts\n", stderr: "", subcommand: "rebase" },
		];
		const nodes = buildConflictReport(entries);

		expect(nodes[0]).toEqual({ kind: "gap" });
		const msg = nodes[1] as MessageNode;
		expect(msg.kind).toBe("message");
		expect(msg.text).toBe("1 repo(s) have conflicts:");

		expect(nodes[2]).toEqual({ kind: "gap" });
		const section = nodes[3] as SectionNode;
		expect(section.kind).toBe("section");
		expect(section.header.plain).toBe("api");
		expect(section.items[0]?.spans[0]?.attention).toBe("muted");
		expect(section.items[0]?.plain).toBe("CONFLICT (content): Merge conflict in index.ts");
		expect(section.items[1]?.plain).toBe("cd api");
		expect(section.items[2]?.plain).toBe("# fix conflicts, then: git rebase --continue");
		expect(section.items[3]?.plain).toBe("# or to undo: git rebase --abort");
	});

	test("filters only CONFLICT lines from combined stdout/stderr", () => {
		const entries: ConflictEntry[] = [
			{
				repo: "web",
				stdout: "Applying: abc\nCONFLICT (content): file.ts\nFailed to merge\n",
				stderr: "error: could not apply\nCONFLICT (modify/delete): old.ts\n",
				subcommand: "merge",
			},
		];
		const nodes = buildConflictReport(entries);
		const section = nodes[3] as SectionNode;
		const conflictItems = section.items.filter((i) => i.spans[0]?.attention === "muted");
		expect(conflictItems).toHaveLength(2);
		expect(conflictItems[0]?.plain).toBe("CONFLICT (content): file.ts");
		expect(conflictItems[1]?.plain).toBe("CONFLICT (modify/delete): old.ts");
	});

	test("uses correct subcommand in recovery instructions", () => {
		const mergeEntries: ConflictEntry[] = [{ repo: "lib", stdout: "", stderr: "", subcommand: "merge" }];
		const mergeNodes = buildConflictReport(mergeEntries);
		const section = mergeNodes[3] as SectionNode;
		expect(section.items.some((i) => i.plain.includes("git merge --continue"))).toBe(true);
		expect(section.items.some((i) => i.plain.includes("git merge --abort"))).toBe(true);
	});

	test("produces gap between multiple repo sections", () => {
		const entries: ConflictEntry[] = [
			{ repo: "api", stdout: "", stderr: "", subcommand: "rebase" },
			{ repo: "web", stdout: "", stderr: "", subcommand: "rebase" },
		];
		const nodes = buildConflictReport(entries);

		const msg = nodes[1] as MessageNode;
		expect(msg.text).toBe("2 repo(s) have conflicts:");

		// Structure: gap, message, gap, section(api), gap, section(web)
		const kinds = nodes.map((n) => n.kind);
		expect(kinds).toEqual(["gap", "message", "gap", "section", "gap", "section"]);
	});
});

describe("buildStashPopFailureReport", () => {
	test("returns empty array for no repos", () => {
		expect(buildStashPopFailureReport([], "Rebase")).toEqual([]);
	});

	test("produces gap + message + gap + section for a single repo", () => {
		const nodes = buildStashPopFailureReport([{ repo: "api" }], "Rebase");

		expect(nodes[0]).toEqual({ kind: "gap" });
		const msg = nodes[1] as MessageNode;
		expect(msg.text).toBe("1 repo(s) need manual stash application:");

		expect(nodes[2]).toEqual({ kind: "gap" });
		const section = nodes[3] as SectionNode;
		expect(section.header.plain).toBe("api");
		expect(section.items[0]?.plain).toBe("Rebase succeeded, but stash pop conflicted.");
		expect(section.items[1]?.plain).toBe("cd api");
		expect(section.items[2]?.plain).toBe("git stash pop    # re-apply and resolve conflicts");
		expect(section.items[3]?.plain).toBe("# or: git stash show  # inspect stashed changes");
	});

	test("uses provided verb in description", () => {
		const nodes = buildStashPopFailureReport([{ repo: "web" }], "Pull");
		const section = nodes[3] as SectionNode;
		expect(section.items[0]?.plain).toBe("Pull succeeded, but stash pop conflicted.");
	});

	test("produces gap between multiple repo sections", () => {
		const nodes = buildStashPopFailureReport([{ repo: "api" }, { repo: "web" }], "Merge");
		const kinds = nodes.map((n) => n.kind);
		expect(kinds).toEqual(["gap", "message", "gap", "section", "gap", "section"]);
	});
});
