import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectTicketFromCommits, detectTicketFromName } from "./ticket-detection";

describe("detectTicketFromName", () => {
	test("ticket at start of branch name", () => {
		expect(detectTicketFromName("ester-208-fix-login")).toBe("ESTER-208");
	});

	test("ticket after prefix", () => {
		expect(detectTicketFromName("feat/ESTER-208-dark-mode")).toBe("ESTER-208");
	});

	test("ticket as entire name", () => {
		expect(detectTicketFromName("ESTER-208")).toBe("ESTER-208");
	});

	test("lowercase ticket is uppercased", () => {
		expect(detectTicketFromName("proj-42-something")).toBe("PROJ-42");
	});

	test("mixed case ticket is uppercased", () => {
		expect(detectTicketFromName("Proj-42-something")).toBe("PROJ-42");
	});

	test("single-letter project prefix doesn't match (requires 2+ chars)", () => {
		expect(detectTicketFromName("X-1-quick-fix")).toBeNull();
	});

	test("alphanumeric project prefix", () => {
		expect(detectTicketFromName("AB2-99-thing")).toBe("AB2-99");
	});

	test("returns first match when multiple present", () => {
		expect(detectTicketFromName("ESTER-208-and-PROJ-42")).toBe("ESTER-208");
	});

	test("no ticket returns null", () => {
		expect(detectTicketFromName("fix-login-crash")).toBeNull();
	});

	test("number-only prefix doesn't match", () => {
		expect(detectTicketFromName("123-something")).toBeNull();
	});

	test("empty string returns null", () => {
		expect(detectTicketFromName("")).toBeNull();
	});

	test("just numbers with dash doesn't match", () => {
		expect(detectTicketFromName("42-fix")).toBeNull();
	});

	test("PR-prefixed token is skipped", () => {
		expect(detectTicketFromName("svc-riskman-pr-74")).toBeNull();
	});

	test("MR-prefixed token is skipped", () => {
		expect(detectTicketFromName("fix-mr-12-something")).toBeNull();
	});

	test("skips PR prefix and finds subsequent ticket", () => {
		expect(detectTicketFromName("pr-74-ester-208")).toBe("ESTER-208");
	});

	test("PR as standalone branch returns null", () => {
		expect(detectTicketFromName("PR-74")).toBeNull();
	});
});

describe("detectTicketFromCommits", () => {
	let repoDir: string;

	beforeEach(() => {
		repoDir = mkdtempSync(join(tmpdir(), "ticket-commits-test-"));
		Bun.spawnSync(["git", "init", repoDir]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "--allow-empty", "-m", "init"]);
	});

	afterEach(() => {
		rmSync(repoDir, { recursive: true, force: true });
	});

	test("finds ticket from commit subject", async () => {
		const mainHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();
		Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
		writeFileSync(join(repoDir, "a.txt"), "content");
		Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix: resolve login ESTER-208"]);

		const result = await detectTicketFromCommits(repoDir, mainHead);
		expect(result).toBe("ESTER-208");
	});

	test("finds ticket from commit body", async () => {
		const mainHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();
		Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
		writeFileSync(join(repoDir, "a.txt"), "content");
		Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix: resolve login\n\nReferences: PROJ-42"]);

		const result = await detectTicketFromCommits(repoDir, mainHead);
		expect(result).toBe("PROJ-42");
	});

	test("returns most frequent ticket when multiple present", async () => {
		const mainHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();
		Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);

		writeFileSync(join(repoDir, "a.txt"), "a");
		Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "first ESTER-208"]);

		writeFileSync(join(repoDir, "b.txt"), "b");
		Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "second PROJ-99"]);

		writeFileSync(join(repoDir, "c.txt"), "c");
		Bun.spawnSync(["git", "-C", repoDir, "add", "c.txt"]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "third PROJ-99"]);

		const result = await detectTicketFromCommits(repoDir, mainHead);
		expect(result).toBe("PROJ-99");
	});

	test("returns null when no tickets in commits", async () => {
		const mainHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();
		Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
		writeFileSync(join(repoDir, "a.txt"), "content");
		Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix: resolve login crash"]);

		const result = await detectTicketFromCommits(repoDir, mainHead);
		expect(result).toBeNull();
	});

	test("returns null for empty range", async () => {
		const result = await detectTicketFromCommits(repoDir, "HEAD");
		expect(result).toBeNull();
	});

	test("uppercases lowercase tickets", async () => {
		const mainHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();
		Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
		writeFileSync(join(repoDir, "a.txt"), "content");
		Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix: something proj-42"]);

		const result = await detectTicketFromCommits(repoDir, mainHead);
		expect(result).toBe("PROJ-42");
	});

	test("ignores PR-prefixed references in commit messages", async () => {
		const mainHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();
		Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);
		writeFileSync(join(repoDir, "a.txt"), "content");
		Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "Merge PR-74 into main"]);

		const result = await detectTicketFromCommits(repoDir, mainHead);
		expect(result).toBeNull();
	});

	test("skips MR prefix and counts real tickets", async () => {
		const mainHead = Bun.spawnSync(["git", "-C", repoDir, "rev-parse", "HEAD"]).stdout.toString().trim();
		Bun.spawnSync(["git", "-C", repoDir, "checkout", "-b", "feature"]);

		writeFileSync(join(repoDir, "a.txt"), "a");
		Bun.spawnSync(["git", "-C", repoDir, "add", "a.txt"]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "fix MR-1 and PROJ-42"]);

		writeFileSync(join(repoDir, "b.txt"), "b");
		Bun.spawnSync(["git", "-C", repoDir, "add", "b.txt"]);
		Bun.spawnSync(["git", "-C", repoDir, "commit", "-m", "more work on PROJ-42"]);

		const result = await detectTicketFromCommits(repoDir, mainHead);
		expect(result).toBe("PROJ-42");
	});
});
