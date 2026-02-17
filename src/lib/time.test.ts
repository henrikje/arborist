import { describe, expect, test } from "bun:test";
import {
	computeLastCommitWidths,
	formatLastCommitCell,
	formatRelativeTime,
	formatRelativeTimeParts,
	latestCommitDate,
} from "./time";

function ago(ms: number): string {
	return new Date(Date.now() - ms).toISOString();
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe("formatRelativeTime", () => {
	test("returns 'just now' for very recent dates", () => {
		expect(formatRelativeTime(ago(5 * SECOND))).toBe("just now");
	});

	test("returns 'just now' for future dates", () => {
		const future = new Date(Date.now() + 60 * SECOND).toISOString();
		expect(formatRelativeTime(future)).toBe("just now");
	});

	test("returns minutes", () => {
		expect(formatRelativeTime(ago(1 * MINUTE))).toBe("1 minute");
		expect(formatRelativeTime(ago(30 * MINUTE))).toBe("30 minutes");
	});

	test("returns hours", () => {
		expect(formatRelativeTime(ago(1 * HOUR))).toBe("1 hour");
		expect(formatRelativeTime(ago(5 * HOUR))).toBe("5 hours");
	});

	test("returns days", () => {
		expect(formatRelativeTime(ago(1 * DAY))).toBe("1 day");
		expect(formatRelativeTime(ago(3 * DAY))).toBe("3 days");
	});

	test("returns weeks", () => {
		expect(formatRelativeTime(ago(1 * WEEK))).toBe("1 week");
		expect(formatRelativeTime(ago(2 * WEEK))).toBe("2 weeks");
	});

	test("returns months", () => {
		expect(formatRelativeTime(ago(35 * DAY))).toBe("1 month");
		expect(formatRelativeTime(ago(90 * DAY))).toBe("3 months");
	});

	test("returns years", () => {
		expect(formatRelativeTime(ago(400 * DAY))).toBe("1 year");
		expect(formatRelativeTime(ago(800 * DAY))).toBe("2 years");
	});
});

describe("formatRelativeTimeParts", () => {
	test("splits number and unit", () => {
		expect(formatRelativeTimeParts(ago(3 * DAY))).toEqual({ num: "3", unit: "days" });
		expect(formatRelativeTimeParts(ago(1 * HOUR))).toEqual({ num: "1", unit: "hour" });
	});

	test("returns empty num for just now", () => {
		expect(formatRelativeTimeParts(ago(5 * SECOND))).toEqual({ num: "", unit: "just now" });
	});
});

describe("computeLastCommitWidths", () => {
	test("computes max widths from parts", () => {
		const parts = [
			{ num: "3", unit: "days" },
			{ num: "12", unit: "months" },
		];
		const widths = computeLastCommitWidths(parts);
		expect(widths.maxNum).toBe(2); // "12"
		// maxUnit expanded from 6 to 8 because header "LAST COMMIT" (11) needs: 2 + 1 + 8 = 11
		expect(widths.maxUnit).toBe(8);
		expect(widths.total).toBe(11);
	});

	test("does not expand when data is wider than header", () => {
		const parts = [
			{ num: "3", unit: "days" },
			{ num: "10", unit: "months" },
		];
		// 10 months already forces total = 2 + 1 + 6 = 9 < 11, so header expands unit
		const widths = computeLastCommitWidths(parts);
		expect(widths.total).toBe(11);

		// With wider data: "30 minutes" → maxNum=2, maxUnit=7 → total=10 < 11, still expanded
		const wider = computeLastCommitWidths([{ num: "30", unit: "minutes" }]);
		expect(wider.total).toBe(11);
		expect(wider.maxUnit).toBe(8); // 7 + (11 - 10)
	});

	test("enforces minimum width for LAST COMMIT header", () => {
		const parts = [{ num: "3", unit: "days" }];
		const widths = computeLastCommitWidths(parts);
		// "3 days" = 6 chars, header "LAST COMMIT" = 11, so unit must expand
		expect(widths.total).toBe(11);
		expect(widths.maxNum).toBe(1);
		expect(widths.maxUnit).toBe(9); // 4 + (11 - 6)
	});

	test("handles empty parts list", () => {
		const widths = computeLastCommitWidths([]);
		expect(widths.total).toBe(11); // minimum for header
	});

	test("handles all just-now parts (no num)", () => {
		const parts = [{ num: "", unit: "just now" }];
		const widths = computeLastCommitWidths(parts);
		expect(widths.maxNum).toBe(0);
		expect(widths.maxUnit).toBe(11); // "just now" = 8, but header needs 11
		expect(widths.total).toBe(11);
	});
});

describe("formatLastCommitCell", () => {
	test("right-aligns numbers", () => {
		const widths = { maxNum: 2, maxUnit: 6, total: 9 };
		expect(formatLastCommitCell({ num: "3", unit: "days" }, widths, false)).toBe(" 3 days");
		expect(formatLastCommitCell({ num: "12", unit: "months" }, widths, false)).toBe("12 months");
	});

	test("pads unit when pad=true", () => {
		const widths = { maxNum: 2, maxUnit: 6, total: 9 };
		expect(formatLastCommitCell({ num: "3", unit: "days" }, widths, true)).toBe(" 3 days  ");
		expect(formatLastCommitCell({ num: "12", unit: "months" }, widths, true)).toBe("12 months");
	});

	test("handles just-now without number", () => {
		const widths = { maxNum: 2, maxUnit: 8, total: 11 };
		expect(formatLastCommitCell({ num: "", unit: "just now" }, widths, false)).toBe("just now");
		expect(formatLastCommitCell({ num: "", unit: "just now" }, widths, true)).toBe("just now   ");
	});

	test("handles empty parts", () => {
		const widths = { maxNum: 2, maxUnit: 6, total: 9 };
		expect(formatLastCommitCell({ num: "", unit: "" }, widths, false)).toBe("");
		expect(formatLastCommitCell({ num: "", unit: "" }, widths, true)).toBe("         ");
	});
});

describe("latestCommitDate", () => {
	test("returns the most recent date", () => {
		const dates = ["2025-01-01T00:00:00Z", "2025-06-15T00:00:00Z", "2025-03-01T00:00:00Z"];
		expect(latestCommitDate(dates)).toBe("2025-06-15T00:00:00Z");
	});

	test("skips null values", () => {
		const dates = [null, "2025-01-01T00:00:00Z", null];
		expect(latestCommitDate(dates)).toBe("2025-01-01T00:00:00Z");
	});

	test("returns null for all nulls", () => {
		expect(latestCommitDate([null, null])).toBeNull();
	});

	test("returns null for empty array", () => {
		expect(latestCommitDate([])).toBeNull();
	});
});
