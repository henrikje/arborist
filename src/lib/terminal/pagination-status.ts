import { dim } from "./output";

const DEFAULT_TERMINAL_ROWS = 24;
const MIN_PAGE_SIZE = 5;

export interface PaginationWindow {
  start: number;
  end: number;
  hasMoreAbove: boolean;
  hasMoreBelow: boolean;
}

export interface PromptPageSizeOptions {
  terminalRows?: number;
  reservedRows?: number;
  minPageSize?: number;
}

export function resolvePromptPageSize(
  totalItems: number,
  {
    terminalRows = process.stderr.rows ?? DEFAULT_TERMINAL_ROWS,
    reservedRows = 6,
    minPageSize = MIN_PAGE_SIZE,
  }: PromptPageSizeOptions = {},
): number {
  if (totalItems <= 0) return 0;

  const availableRows = Math.max(minPageSize, terminalRows - reservedRows);
  return Math.min(totalItems, availableRows);
}

export function computePaginationWindow(totalItems: number, activeIndex: number, pageSize: number): PaginationWindow {
  if (totalItems <= 0 || pageSize <= 0) {
    return { start: 0, end: 0, hasMoreAbove: false, hasMoreBelow: false };
  }

  if (totalItems <= pageSize) {
    return { start: 0, end: totalItems, hasMoreAbove: false, hasMoreBelow: false };
  }

  const clampedActive = Math.max(0, Math.min(activeIndex, totalItems - 1));
  const halfPage = Math.floor(pageSize / 2);
  const start = Math.max(0, Math.min(clampedActive - halfPage, totalItems - pageSize));
  const end = Math.min(totalItems, start + pageSize);

  return {
    start,
    end,
    hasMoreAbove: start > 0,
    hasMoreBelow: end < totalItems,
  };
}

export function formatPaginationStatus(window: PaginationWindow, totalItems: number): string {
  if (totalItems <= 0 || window.end === 0) return "";
  if (!window.hasMoreAbove && !window.hasMoreBelow) return "";

  return dim(`Showing ${window.start + 1}-${window.end} of ${totalItems}`);
}
