import { describe, expect, test } from "bun:test";
import { listenForAbortKeypress } from "./abort-keypress";

describe("listenForAbortKeypress", () => {
	test("returns a non-aborted signal when stdin is not a TTY", () => {
		// In test environment, stdin is not a TTY
		const { signal, cleanup } = listenForAbortKeypress();
		expect(signal.aborted).toBe(false);
		cleanup(); // should be a no-op but should not throw
	});

	test("cleanup is idempotent", () => {
		const { cleanup } = listenForAbortKeypress();
		cleanup();
		cleanup(); // calling twice should not throw
	});
});
