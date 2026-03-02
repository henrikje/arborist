import { describe, expect, test } from "bun:test";
import { BENIGN_SKIPS } from "./skip-flags";

describe("BENIGN_SKIPS", () => {
	test("contains expected benign flags", () => {
		expect(BENIGN_SKIPS.has("already-merged")).toBe(true);
		expect(BENIGN_SKIPS.has("no-commits")).toBe(true);
		expect(BENIGN_SKIPS.has("not-pushed")).toBe(true);
		expect(BENIGN_SKIPS.has("no-base-branch")).toBe(true);
	});

	test("does not contain attention flags", () => {
		expect(BENIGN_SKIPS.has("detached-head")).toBe(false);
		expect(BENIGN_SKIPS.has("dirty")).toBe(false);
		expect(BENIGN_SKIPS.has("drifted")).toBe(false);
		expect(BENIGN_SKIPS.has("fetch-failed")).toBe(false);
		expect(BENIGN_SKIPS.has("diverged")).toBe(false);
	});
});
