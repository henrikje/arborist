import { describe, expect, test } from "bun:test";
import { computePaginationWindow, formatPaginationStatus, resolvePromptPageSize } from "./pagination-status";

describe("resolvePromptPageSize", () => {
  test("caps page size to available terminal rows", () => {
    expect(resolvePromptPageSize(50, { terminalRows: 20, reservedRows: 6 })).toBe(14);
  });

  test("shows all items when they fit in available space", () => {
    expect(resolvePromptPageSize(8, { terminalRows: 20, reservedRows: 6 })).toBe(8);
  });

  test("respects the minimum page size when the terminal is short", () => {
    expect(resolvePromptPageSize(50, { terminalRows: 8, reservedRows: 6, minPageSize: 5 })).toBe(5);
  });
});

describe("computePaginationWindow", () => {
  test("shows the first page at the top of the list", () => {
    expect(computePaginationWindow(30, 0, 10)).toEqual({
      start: 0,
      end: 10,
      hasMoreAbove: false,
      hasMoreBelow: true,
    });
  });

  test("centers the active item when possible", () => {
    expect(computePaginationWindow(30, 12, 10)).toEqual({
      start: 7,
      end: 17,
      hasMoreAbove: true,
      hasMoreBelow: true,
    });
  });

  test("pins the final page at the bottom", () => {
    expect(computePaginationWindow(30, 29, 10)).toEqual({
      start: 20,
      end: 30,
      hasMoreAbove: true,
      hasMoreBelow: false,
    });
  });
});

describe("formatPaginationStatus", () => {
  test("hides the status line when all items fit", () => {
    expect(formatPaginationStatus({ start: 0, end: 8, hasMoreAbove: false, hasMoreBelow: false }, 8)).toBe("");
  });

  test("shows the visible range and downward hint", () => {
    expect(formatPaginationStatus({ start: 0, end: 10, hasMoreAbove: false, hasMoreBelow: true }, 30)).toContain(
      "Showing 1-10 of 30",
    );
  });

  test("uses the same range text in the middle of the list", () => {
    expect(formatPaginationStatus({ start: 10, end: 20, hasMoreAbove: true, hasMoreBelow: true }, 30)).toContain(
      "Showing 11-20 of 30",
    );
  });
});
