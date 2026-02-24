import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectArbRoot } from "./arb-root";

describe("detectArbRoot", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "arb-basedir-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("finds .arb marker in start directory", () => {
		writeFileSync(join(tmpDir, ".arb"), "");
		expect(detectArbRoot(tmpDir)).toBe(tmpDir);
	});

	test("finds .arb marker walking up from nested dir", () => {
		writeFileSync(join(tmpDir, ".arb"), "");
		const nested = join(tmpDir, "a", "b", "c");
		mkdirSync(nested, { recursive: true });

		expect(detectArbRoot(nested)).toBe(tmpDir);
	});

	test("returns null when .arb not found", () => {
		const nested = join(tmpDir, "a", "b");
		mkdirSync(nested, { recursive: true });

		expect(detectArbRoot(nested)).toBeNull();
	});
});
