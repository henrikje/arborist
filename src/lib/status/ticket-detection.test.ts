import { describe, expect, test } from "bun:test";
import { detectTicketFromName } from "./ticket-detection";

describe("detectTicketFromName", () => {
  test("ticket at start of branch name", () => {
    expect(detectTicketFromName("proj-208-fix-login")).toBe("PROJ-208");
  });

  test("ticket after prefix", () => {
    expect(detectTicketFromName("feat/PROJ-208-dark-mode")).toBe("PROJ-208");
  });

  test("ticket as entire name", () => {
    expect(detectTicketFromName("PROJ-208")).toBe("PROJ-208");
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
    expect(detectTicketFromName("PROJ-208-and-PROJ-42")).toBe("PROJ-208");
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

  test("does not match when digits are followed by letters", () => {
    expect(detectTicketFromName("add-debug-command-60ZRQ")).toBeNull();
  });

  test("does not match when prefix is preceded by a digit", () => {
    expect(detectTicketFromName("fix-0COMMAND-60")).toBeNull();
  });

  test("PR-prefixed token is skipped", () => {
    expect(detectTicketFromName("svc-riskman-pr-74")).toBeNull();
  });

  test("MR-prefixed token is skipped", () => {
    expect(detectTicketFromName("fix-mr-12-something")).toBeNull();
  });

  test("skips PR prefix and finds subsequent ticket", () => {
    expect(detectTicketFromName("pr-74-proj-208")).toBe("PROJ-208");
  });

  test("PR as standalone branch returns null", () => {
    expect(detectTicketFromName("PR-74")).toBeNull();
  });
});
