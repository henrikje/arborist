import { describe, expect, test } from "bun:test";
import { bold, countLines, dim, green, red, yellow } from "./output";

describe("countLines", () => {
  describe("without terminalWidth (legacy behavior)", () => {
    test("empty string has 0 lines", () => {
      expect(countLines("")).toBe(0);
    });

    test("single newline counts as 1", () => {
      expect(countLines("\n")).toBe(1);
    });

    test("counts newlines in simple text", () => {
      expect(countLines("a\nb\nc\n")).toBe(3);
    });

    test("text without trailing newline", () => {
      expect(countLines("a\nb")).toBe(1);
    });

    test("multiple consecutive newlines", () => {
      expect(countLines("\n\n\n")).toBe(3);
    });

    test("single line with no newline is 0", () => {
      expect(countLines("hello")).toBe(0);
    });
  });

  describe("with terminalWidth", () => {
    test("empty string has 0 lines", () => {
      expect(countLines("", 80)).toBe(0);
    });

    test("single short line", () => {
      expect(countLines("hello\n", 80)).toBe(1);
    });

    test("single line that fits exactly in terminal width", () => {
      expect(countLines(`${"a".repeat(80)}\n`, 80)).toBe(1);
    });

    test("single line that wraps once", () => {
      expect(countLines(`${"a".repeat(81)}\n`, 80)).toBe(2);
    });

    test("single line that wraps twice", () => {
      expect(countLines(`${"a".repeat(161)}\n`, 80)).toBe(3);
    });

    test("single line exactly double the terminal width", () => {
      expect(countLines(`${"a".repeat(160)}\n`, 80)).toBe(2);
    });

    test("empty line counts as 1 visual row", () => {
      expect(countLines("\n", 80)).toBe(1);
    });

    test("multiple empty lines", () => {
      expect(countLines("\n\n\n", 80)).toBe(3);
    });

    test("mixed short and long lines", () => {
      const text = `short\n${"a".repeat(200)}\nalso short\n`;
      // short = 1 row, 200 chars at width 80 = ceil(200/80) = 3 rows, also short = 1 row
      expect(countLines(text, 80)).toBe(5);
    });

    test("trailing newline does not add extra line", () => {
      expect(countLines("hello\n", 80)).toBe(1);
      expect(countLines("hello\nworld\n", 80)).toBe(2);
    });

    test("text without trailing newline matches legacy path (cursor on last line)", () => {
      // Cursor is on the last content line, so no upward move needed for it
      expect(countLines("hello", 80)).toBe(0);
    });

    test("single char without newline is 0", () => {
      expect(countLines("x", 80)).toBe(0);
    });

    test("ANSI color codes are stripped for width calculation", () => {
      // Red text: \x1b[0;31m + content + \x1b[0m — ANSI codes don't take visual space
      const colored = red("a".repeat(81));
      expect(countLines(`${colored}\n`, 80)).toBe(2);
    });

    test("multiple ANSI-colored segments on one line", () => {
      // 40 red + 41 green = 81 visible chars → wraps to 2 lines
      const text = red("a".repeat(40)) + green("b".repeat(41));
      expect(countLines(`${text}\n`, 80)).toBe(2);
    });

    test("ANSI codes that fit within terminal width do not wrap", () => {
      // 80 visible chars with color → exactly 1 line
      const text = yellow("a".repeat(80));
      expect(countLines(`${text}\n`, 80)).toBe(1);
    });

    test("dim and bold ANSI codes are stripped correctly", () => {
      const text = `${dim("header")}  ${bold("value")}`;
      // "header  value" = 13 chars, fits in 80
      expect(countLines(`${text}\n`, 80)).toBe(1);
    });

    test("very narrow terminal causes many wraps", () => {
      // 20 chars at width 5 = 4 rows
      expect(countLines(`${"a".repeat(20)}\n`, 5)).toBe(4);
    });

    test("width of 1 wraps every character", () => {
      expect(countLines("abc\n", 1)).toBe(3);
    });

    test("realistic table output with multiple rows", () => {
      const header = "  REPO        ACTION\n";
      const row1 = "  arborist    1 commit to push (new branch: origin/feature-branch)  (HEAD abc1234)\n";
      const row2 = "  backend     up to date\n";
      const text = `\n${header}${row1}${row2}\n`;
      // At width 120: blank(1) + header(1) + row1(1) + row2(1) + blank(1) = 5
      expect(countLines(text, 120)).toBe(5);
    });

    test("realistic table output on narrow terminal with wrapping", () => {
      const header = "  REPO        ACTION\n";
      const row = "  arborist    1 commit to push (new branch: origin/feature-branch)  (HEAD abc1234)\n";
      const text = `\n${header}${row}\n`;
      // row is 81 chars visible, at width 40 → ceil(81/40) = 3 visual lines
      // blank(1) + header(ceil(20/40)=1) + row(3) + blank(1) = 6
      expect(countLines(text, 40)).toBe(6);
    });

    test("terminalWidth of 0 falls back to newline counting", () => {
      expect(countLines(`${"a".repeat(200)}\n`, 0)).toBe(1);
    });

    test("negative terminalWidth falls back to newline counting", () => {
      expect(countLines(`${"a".repeat(200)}\n`, -1)).toBe(1);
    });

    test("undefined terminalWidth falls back to newline counting", () => {
      expect(countLines(`${"a".repeat(200)}\n`, undefined)).toBe(1);
    });

    test("no trailing newline with wrapping subtracts 1", () => {
      // 161 chars at width 80 = 3 visual lines, cursor on 3rd → 2 moves up
      expect(countLines("a".repeat(161), 80)).toBe(2);
    });

    test("no trailing newline with ANSI wrapping subtracts 1", () => {
      const colored = red("a".repeat(161));
      expect(countLines(colored, 80)).toBe(2);
    });

    test("fetchSuffix pattern: table ending with newline + suffix without newline", () => {
      const table = "\n  REPO        ACTION\n  arborist    1 commit to push\n\n";
      const suffix = dim("Fetching 1 repo...");
      const text = table + suffix;
      // table: 4 newlines = 4 lines. suffix adds 1 visual line but cursor is on it → no extra move
      // Total: 4 moves up
      expect(countLines(text, 120)).toBe(4);
    });

    test("consistency: wide terminal matches legacy path for text ending with newline", () => {
      const inputs = ["hello\n", "a\nb\nc\n", "\n", "\n\n\n", "a\nb\nc\nd\ne\n"];
      for (const input of inputs) {
        expect(countLines(input, 10000)).toBe(countLines(input));
      }
    });

    test("consistency: wide terminal matches legacy path for text without trailing newline", () => {
      const inputs = ["hello", "a\nb", "a\nb\nc", ""];
      for (const input of inputs) {
        expect(countLines(input, 10000)).toBe(countLines(input));
      }
    });
  });
});
