import { describe, expect, test } from "bun:test";
import { BENIGN_SKIPS, RETARGET_EXEMPT_SKIPS } from "./skip-flags";

describe("BENIGN_SKIPS", () => {
  test("contains expected benign flags", () => {
    expect(BENIGN_SKIPS.has("already-merged")).toBe(true);
    expect(BENIGN_SKIPS.has("no-commits")).toBe(true);
    expect(BENIGN_SKIPS.has("no-share")).toBe(true);
    expect(BENIGN_SKIPS.has("no-base-branch")).toBe(true);
  });

  test("does not contain attention flags", () => {
    expect(BENIGN_SKIPS.has("detached-head")).toBe(false);
    expect(BENIGN_SKIPS.has("dirty")).toBe(false);
    expect(BENIGN_SKIPS.has("wrong-branch")).toBe(false);
    expect(BENIGN_SKIPS.has("fetch-failed")).toBe(false);
    expect(BENIGN_SKIPS.has("diverged")).toBe(false);
  });
});

describe("RETARGET_EXEMPT_SKIPS", () => {
  test("contains retarget exemptions", () => {
    expect(RETARGET_EXEMPT_SKIPS.has("no-base-branch")).toBe(true);
    expect(RETARGET_EXEMPT_SKIPS.has("retarget-target-not-found")).toBe(true);
  });

  test("does not contain blocking flags", () => {
    expect(RETARGET_EXEMPT_SKIPS.has("dirty")).toBe(false);
    expect(RETARGET_EXEMPT_SKIPS.has("wrong-branch")).toBe(false);
    expect(RETARGET_EXEMPT_SKIPS.has("retarget-base-not-found")).toBe(false);
  });
});
