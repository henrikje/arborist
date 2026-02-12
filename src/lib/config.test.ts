import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configGet, writeConfig } from "./config";

describe("config", () => {
	let tmpDir: string;
	let configFile: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "arb-config-test-"));
		configFile = join(tmpDir, "config");
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("configGet", () => {
		test("returns null for missing file", () => {
			expect(configGet(join(tmpDir, "nonexistent"), "branch")).toBeNull();
		});

		test("returns null for missing key", () => {
			writeConfig(configFile, "main");
			expect(configGet(configFile, "nonexistent")).toBeNull();
		});

		test("returns value for existing key", () => {
			writeConfig(configFile, "develop");
			expect(configGet(configFile, "branch")).toBe("develop");
		});

		test("handles multi-line configs", () => {
			writeFileSync(configFile, "branch = main\nremote = origin\n");
			expect(configGet(configFile, "branch")).toBe("main");
			expect(configGet(configFile, "remote")).toBe("origin");
		});
	});

	describe("writeConfig", () => {
		test("writes correct format", () => {
			writeConfig(configFile, "feature-branch");
			expect(readFileSync(configFile, "utf-8")).toBe("branch = feature-branch\n");
		});

		test("file is readable back via configGet", () => {
			writeConfig(configFile, "my-branch");
			expect(configGet(configFile, "branch")).toBe("my-branch");
		});
	});
});
