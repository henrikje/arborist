import { describe, test } from "bun:test";
import { suppressStdin } from "./suppress-stdin";

describe("suppressStdin", () => {
	test("returns a no-op restore when stdin is not a TTY", () => {
		// In test environment, stdin is not a TTY
		const { restore } = suppressStdin();
		restore(); // should not throw
	});

	test("restore is idempotent", () => {
		const { restore } = suppressStdin();
		restore();
		restore(); // calling twice should not throw
	});
});
