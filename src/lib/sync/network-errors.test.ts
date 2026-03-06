import { describe, expect, test } from "bun:test";
import { classifyNetworkError, isNetworkError, networkErrorHint } from "./network-errors";

describe("classifyNetworkError", () => {
  test("classifies DNS resolution failures as offline", () => {
    expect(classifyNetworkError("fatal: unable to access '...': Could not resolve host: github.com")).toBe("offline");
  });

  test("classifies connection refused as offline", () => {
    expect(classifyNetworkError("fatal: unable to connect: Connection refused")).toBe("offline");
  });

  test("classifies Failed to connect as offline", () => {
    expect(classifyNetworkError("Failed to connect to github.com port 443")).toBe("offline");
  });

  test("classifies network unreachable as offline", () => {
    expect(classifyNetworkError("Network is unreachable")).toBe("offline");
  });

  test("classifies No route to host as offline", () => {
    expect(classifyNetworkError("No route to host")).toBe("offline");
  });

  test("classifies timeout as offline", () => {
    expect(classifyNetworkError("Operation timed out")).toBe("offline");
    expect(classifyNetworkError("Connection timed out")).toBe("offline");
  });

  test("classifies SSL errors as offline", () => {
    expect(classifyNetworkError("SSL_ERROR_SYSCALL, errno 54")).toBe("offline");
  });

  test("classifies unable to access as offline", () => {
    expect(classifyNetworkError("fatal: unable to access 'https://github.com/foo/bar.git/'")).toBe("offline");
  });

  test("classifies HTTP 401 as auth", () => {
    expect(classifyNetworkError("The requested URL returned error: 401")).toBe("auth");
    expect(classifyNetworkError("fatal: HTTP 401 Unauthorized")).toBe("auth");
  });

  test("classifies HTTP 403 as auth", () => {
    expect(classifyNetworkError("The requested URL returned error: 403")).toBe("auth");
    expect(classifyNetworkError("fatal: HTTP 403 Forbidden")).toBe("auth");
  });

  test("classifies authentication failed as auth", () => {
    expect(classifyNetworkError("fatal: Authentication failed for 'https://github.com/foo/bar.git/'")).toBe("auth");
  });

  test("classifies terminal prompts disabled as auth", () => {
    expect(
      classifyNetworkError("fatal: could not read Username for 'https://github.com': terminal prompts disabled"),
    ).toBe("auth");
  });

  test("classifies HTTP 404 as not-found", () => {
    expect(classifyNetworkError("The requested URL returned error: 404")).toBe("not-found");
    expect(classifyNetworkError("fatal: HTTP 404 Not Found")).toBe("not-found");
  });

  test("classifies Repository not found as not-found", () => {
    expect(classifyNetworkError("ERROR: Repository not found.")).toBe("not-found");
  });

  test("classifies not a git repository as not-found", () => {
    expect(classifyNetworkError("fatal: 'https://example.com/foo.git' does not appear to be a git repository")).toBe(
      "not-found",
    );
  });

  test("returns unknown for unrecognized errors", () => {
    expect(classifyNetworkError("fatal: some other error")).toBe("unknown");
    expect(classifyNetworkError("")).toBe("unknown");
  });

  test("prefers offline over auth when both match", () => {
    // "unable to access" matches offline first
    expect(classifyNetworkError("fatal: unable to access 'https://github.com': HTTP 403")).toBe("offline");
  });
});

describe("isNetworkError", () => {
  test("returns true for offline errors", () => {
    expect(isNetworkError("Could not resolve host: github.com")).toBe(true);
  });

  test("returns false for auth errors", () => {
    expect(isNetworkError("Authentication failed")).toBe(false);
  });

  test("returns false for unknown errors", () => {
    expect(isNetworkError("some other error")).toBe(false);
  });
});

describe("networkErrorHint", () => {
  test("returns hint for offline", () => {
    expect(networkErrorHint("offline")).toContain("check your connection");
  });

  test("returns hint for auth", () => {
    expect(networkErrorHint("auth")).toContain("credentials");
  });

  test("returns hint for not-found", () => {
    expect(networkErrorHint("not-found")).toContain("remote URL");
  });

  test("returns null for unknown", () => {
    expect(networkErrorHint("unknown")).toBeNull();
  });
});
