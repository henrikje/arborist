import { describe, expect, test } from "bun:test";
import { headShaCell, skipCell, stashHintCell, upToDateCell, withSuffixes } from "./plan-format";

describe("skipCell", () => {
	test("returns attention for non-benign skip", () => {
		const c = skipCell("HEAD is detached", "detached-head");
		expect(c.plain).toBe("skipped — HEAD is detached");
		expect(c.spans[0]?.attention).toBe("attention");
	});

	test("returns muted for benign skip", () => {
		const c = skipCell("already merged into main", "already-merged");
		expect(c.plain).toBe("skipped — already merged into main");
		expect(c.spans[0]?.attention).toBe("muted");
	});

	test("returns attention when no skip flag", () => {
		const c = skipCell("some reason");
		expect(c.spans[0]?.attention).toBe("attention");
	});
});

describe("upToDateCell", () => {
	test("returns default attention", () => {
		const c = upToDateCell();
		expect(c.plain).toBe("up to date");
		expect(c.spans[0]?.attention).toBe("default");
	});
});

describe("stashHintCell", () => {
	test("returns null when no stash needed", () => {
		expect(stashHintCell({ needsStash: false })).toBeNull();
		expect(stashHintCell({})).toBeNull();
	});

	test("returns autostash when no conflict info", () => {
		const c = stashHintCell({ needsStash: true });
		expect(c?.plain).toBe(" (autostash)");
		expect(c?.spans[0]?.attention).toBe("default");
	});

	test("returns stash pop conflict likely when files present", () => {
		const c = stashHintCell({ needsStash: true, stashPopConflictFiles: ["file.ts"] });
		expect(c?.plain).toContain("stash pop conflict likely");
		expect(c?.spans[0]?.attention).toBe("attention");
	});

	test("returns stash pop conflict unlikely when files empty", () => {
		const c = stashHintCell({ needsStash: true, stashPopConflictFiles: [] });
		expect(c?.plain).toContain("stash pop conflict unlikely");
		expect(c?.spans[0]?.attention).toBe("default");
	});
});

describe("headShaCell", () => {
	test("returns muted cell with HEAD prefix", () => {
		const c = headShaCell("abc1234");
		expect(c.plain).toBe("  (HEAD abc1234)");
		expect(c.spans[0]?.attention).toBe("muted");
	});
});

describe("withSuffixes", () => {
	test("appends stash and head sha", () => {
		const base = { plain: "3 commits to push", spans: [{ text: "3 commits to push", attention: "default" as const }] };
		const result = withSuffixes(base, { needsStash: true, headSha: "abc1234" });
		expect(result.plain).toContain("(autostash)");
		expect(result.plain).toContain("(HEAD abc1234)");
	});

	test("returns base unchanged when no suffixes", () => {
		const base = { plain: "ok", spans: [{ text: "ok", attention: "default" as const }] };
		const result = withSuffixes(base, {});
		expect(result.plain).toBe("ok");
	});
});
