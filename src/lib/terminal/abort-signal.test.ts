import { describe, expect, test } from "bun:test";
import { listenForAbortSignal } from "./abort-signal";

describe("listenForAbortSignal", () => {
  test("returns a non-aborted signal when stdin is not a TTY", () => {
    // In test environment, stdin is not a TTY
    const { signal, cleanup } = listenForAbortSignal();
    expect(signal.aborted).toBe(false);
    cleanup(); // should be a no-op but should not throw
  });

  test("cleanup is idempotent", () => {
    const { cleanup } = listenForAbortSignal();
    cleanup();
    cleanup(); // calling twice should not throw
  });
});
