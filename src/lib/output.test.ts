import { afterEach, describe, expect, test } from "bun:test";
import { ArbError } from "./errors";
import { finishSummary } from "./output";

describe("finishSummary", () => {
	let captured = "";
	const original = process.stderr.write;

	afterEach(() => {
		process.stderr.write = original;
		captured = "";
	});

	function captureStderr() {
		process.stderr.write = (chunk: string | Uint8Array) => {
			captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
			return true;
		};
	}

	test("writes summary to stderr on success", () => {
		captureStderr();
		finishSummary(["Pushed 3 repos", "1 up to date"], false);
		expect(captured).toContain("Pushed 3 repos");
		expect(captured).toContain("1 up to date");
		expect(captured).toEndWith("\n");
	});

	test("does not throw on success", () => {
		captureStderr();
		expect(() => finishSummary(["All good"], false)).not.toThrow();
	});

	test("writes summary and throws ArbError on error", () => {
		captureStderr();
		expect(() => finishSummary(["2 failed", "1 skipped"], true)).toThrow(ArbError);
		expect(captured).toContain("2 failed");
	});

	test("error message joins parts with comma", () => {
		captureStderr();
		try {
			finishSummary(["2 failed", "1 skipped"], true);
		} catch (e) {
			expect((e as ArbError).message).toBe("2 failed, 1 skipped");
		}
	});
});
