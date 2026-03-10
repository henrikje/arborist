export interface RelativeTimeParts {
  num: string;
  unit: string;
}

export function formatRelativeTimeParts(isoDate: string): RelativeTimeParts {
  const then = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - then.getTime();

  if (diffMs < 0) return { num: "", unit: "just now" };

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return { num: `${years}`, unit: years === 1 ? "year" : "years" };
  if (months > 0) return { num: `${months}`, unit: months === 1 ? "month" : "months" };
  if (weeks > 0) return { num: `${weeks}`, unit: weeks === 1 ? "week" : "weeks" };
  if (days > 0) return { num: `${days}`, unit: days === 1 ? "day" : "days" };
  if (hours > 0) return { num: `${hours}`, unit: hours === 1 ? "hour" : "hours" };
  if (minutes > 0) return { num: `${minutes}`, unit: minutes === 1 ? "minute" : "minutes" };
  return { num: "", unit: "just now" };
}

export function formatRelativeTime(isoDate: string): string {
  const { num, unit } = formatRelativeTimeParts(isoDate);
  return num ? `${num} ${unit}` : unit;
}

export interface LastCommitWidths {
  maxNum: number;
  maxUnit: number;
  total: number;
}

export function computeLastCommitWidths(allParts: RelativeTimeParts[]): LastCommitWidths {
  let maxNum = 0;
  let maxUnit = 0;
  for (const p of allParts) {
    if (p.num.length > maxNum) maxNum = p.num.length;
    if (p.unit.length > maxUnit) maxUnit = p.unit.length;
  }
  // Ensure "LAST COMMIT" header (11 chars) fits
  const dataWidth = maxNum > 0 ? maxNum + 1 + maxUnit : maxUnit;
  if (dataWidth < 11) {
    maxUnit += 11 - dataWidth;
  }
  const total = maxNum > 0 ? maxNum + 1 + maxUnit : maxUnit;
  return { maxNum, maxUnit, total };
}

/** Find the most recent date from a list of ISO date strings. */
export function latestCommitDate(dates: (string | null)[]): string | null {
  let latest: string | null = null;
  let latestMs = -1;
  for (const d of dates) {
    if (d) {
      const ms = new Date(d).getTime();
      if (ms > latestMs) {
        latestMs = ms;
        latest = d;
      }
    }
  }
  return latest;
}

const DURATION_UNITS: Record<string, number> = {
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  m: 30 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

/** Parse a duration string like "30d", "2w", "3m", "1y" into milliseconds. Returns null for invalid input. */
export function parseDuration(s: string): number | null {
  const match = /^(\d+)([dwmy])$/.exec(s.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1] as string, 10);
  if (n <= 0) return null;
  const unit = DURATION_UNITS[match[2] as string];
  return unit !== undefined ? n * unit : null;
}

/** Render a last-commit cell with right-aligned number and left-aligned unit. */
export function formatLastCommitCell(parts: RelativeTimeParts, widths: LastCommitWidths, pad: boolean): string {
  if (parts.num) {
    const numPad = " ".repeat(widths.maxNum - parts.num.length);
    const unitPad = pad ? " ".repeat(widths.maxUnit - parts.unit.length) : "";
    return `${numPad}${parts.num} ${parts.unit}${unitPad}`;
  }
  if (parts.unit) {
    const trailingPad = pad ? " ".repeat(widths.total - parts.unit.length) : "";
    return `${parts.unit}${trailingPad}`;
  }
  return pad ? " ".repeat(widths.total) : "";
}
