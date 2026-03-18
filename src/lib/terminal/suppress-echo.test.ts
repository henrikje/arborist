import { describe, test } from "bun:test";
import { suppressEcho } from "./suppress-echo";

describe("suppressEcho", () => {
  test("returns a no-op restore when stdin is not a TTY", () => {
    // In test environment, stdin is not a TTY
    const { restore } = suppressEcho();
    restore(); // should not throw
  });

  test("restore is idempotent", () => {
    const { restore } = suppressEcho();
    restore();
    restore(); // calling twice should not throw
  });
});
