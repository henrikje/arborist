import { cursorHide } from "@inquirer/ansi";
import {
  type KeypressEvent,
  createPrompt,
  isDownKey,
  isEnterKey,
  isUpKey,
  makeTheme,
  useEffect,
  useKeypress,
  useMemo,
  usePrefix,
  useState,
} from "@inquirer/core";
import figures from "@inquirer/figures";
import { dim } from "./output";
import { computePaginationWindow, formatPaginationStatus, resolvePromptPageSize } from "./pagination-status";

export interface SplitPointSelectorConfig {
  repo: string;
  direction: "prefix" | "suffix";
  commits: { shortHash: string; fullHash: string; subject: string }[];
  currentBoundary: string | null;
}

const NONE_LABEL = "(none)";

const selectorTheme = {
  icon: { cursor: figures.pointer },
  style: {
    keysHelpTip: (keys: [string, string][]) =>
      keys.map(([key, action]) => `${key} ${dim(action)}`).join(dim(" \u2022 ")),
  },
};

interface Item {
  shortHash: string | null; // null for the "(none)" item
  subject: string;
  fullHash: string | null;
}

/**
 * Build items with direction-dependent "(none)" position.
 *
 * Prefix: commits newest-first, then "(none)" at the bottom.
 *   Moving up from "(none)" → oldest commit (extract 1) → smooth transition.
 * Suffix: "(none)" at the top, then commits newest-first.
 *   Moving down from "(none)" → newest commit (extract 1) → smooth transition.
 */
function buildItems(
  commits: SplitPointSelectorConfig["commits"],
  direction: "prefix" | "suffix",
): { items: Item[]; noneIndex: number } {
  const commitItems = commits.map((c) => ({ shortHash: c.shortHash, subject: c.subject, fullHash: c.fullHash }));
  const noneItem: Item = { shortHash: null, subject: NONE_LABEL, fullHash: null };

  if (direction === "prefix") {
    return { items: [...commitItems, noneItem], noneIndex: commitItems.length };
  }
  return { items: [noneItem, ...commitItems], noneIndex: 0 };
}

function findInitialIndex(items: Item[], noneIndex: number, currentBoundary: string | null): number {
  if (!currentBoundary) return noneIndex;
  const idx = items.findIndex((item) => item.fullHash === currentBoundary);
  return idx === -1 ? noneIndex : idx;
}

/**
 * Compute how many commits are extracted given the cursor position.
 *
 * Prefix — "(none)" at bottom, commits at indices 0..N-1 (newest first):
 *   Cursor at index i → extracted = N - i (cursor and everything older below it).
 *
 * Suffix — "(none)" at top (index 0), commits at indices 1..N (newest first):
 *   Cursor at index i → extracted = i (cursor and everything newer above it).
 */
function extractedCount(
  active: number,
  noneIndex: number,
  totalCommits: number,
  direction: "prefix" | "suffix",
): number {
  if (active === noneIndex) return 0;
  if (direction === "prefix") {
    return totalCommits - active;
  }
  return active; // suffix: 1-based commit indices match the count
}

function buildHeader(
  repo: string,
  active: number,
  noneIndex: number,
  items: Item[],
  totalCommits: number,
  direction: "prefix" | "suffix",
): string {
  if (active === noneIndex) {
    return `${repo} \u2014 no commits extracted:`;
  }
  const count = extractedCount(active, noneIndex, totalCommits, direction);
  const item = items[active];
  const shortHash = item?.fullHash?.slice(0, 7) ?? "";
  const allPrefix = count === totalCommits ? "all " : "";
  const dirLabel = direction === "prefix" ? `ending with ${shortHash}` : `starting with ${shortHash}`;
  const unit = totalCommits === 1 ? "commit" : "commits";
  return `${repo} \u2014 extracting ${allPrefix}${count} of ${totalCommits} ${unit} (${dirLabel}):`;
}

/**
 * Determine whether a commit item at the given index is in the "extracted" zone.
 * The "(none)" item is never extracted.
 */
function isExtracted(itemIndex: number, active: number, noneIndex: number, direction: "prefix" | "suffix"): boolean {
  if (active === noneIndex || itemIndex === noneIndex) return false;
  if (direction === "prefix") {
    // Prefix: cursor and below (higher indices, but not past "(none)" at the bottom)
    return itemIndex >= active;
  }
  // Suffix: cursor and above (lower indices, but not above "(none)" at the top)
  return itemIndex <= active;
}

function renderPage(
  items: Item[],
  active: number,
  noneIndex: number,
  start: number,
  end: number,
  direction: "prefix" | "suffix",
  cursorIcon: string,
  highlight: (text: string) => string,
): string {
  return items
    .slice(start, end)
    .map((item, offset) => {
      const idx = start + offset;
      const isActive = idx === active;
      const cursor = isActive ? cursorIcon : " ";
      const extracted = isExtracted(idx, active, noneIndex, direction);

      // Build raw text (no ANSI) for wrapping in a single style
      const raw = item.shortHash ? `${cursor} ${item.shortHash} ${item.subject}` : `${cursor} ${item.subject}`;

      if (isActive) {
        return highlight(raw);
      }
      if (!extracted) {
        return dim(raw);
      }
      // Extracted: hash dim, subject default — only case that needs nested ANSI
      return `${cursor} ${dim(item.shortHash ?? "")} ${item.subject}`;
    })
    .join("\n");
}

const splitPointSelectorPrompt = createPrompt(
  (config: SplitPointSelectorConfig, done: (value: string | null) => void) => {
    const theme = makeTheme(selectorTheme, {});
    const [status, setStatus] = useState<"idle" | "done">("idle");
    const prefix = usePrefix({ status, theme });

    // Re-render on terminal resize
    const [, setResizeTick] = useState(0);
    useEffect(() => {
      let tick = 0;
      const onResize = () => setResizeTick(++tick);
      process.on("SIGWINCH", onResize);
      return () => {
        process.removeListener("SIGWINCH", onResize);
      };
    }, []);

    const { items, noneIndex } = useMemo(
      () => buildItems(config.commits, config.direction),
      [config.commits, config.direction],
    );
    const totalCommits = config.commits.length;
    const initialIndex = useMemo(
      () => findInitialIndex(items, noneIndex, config.currentBoundary),
      [items, noneIndex, config.currentBoundary],
    );
    const [active, setActive] = useState(initialIndex);
    const pageSize = resolvePromptPageSize(items.length, { reservedRows: 6 });

    useKeypress((key: KeypressEvent) => {
      if (isEnterKey(key)) {
        setStatus("done");
        done(items[active]?.fullHash ?? null);
      } else if (isUpKey(key)) {
        if (active > 0) setActive(active - 1);
      } else if (isDownKey(key)) {
        if (active < items.length - 1) setActive(active + 1);
      }
    });

    const header = buildHeader(config.repo, active, noneIndex, items, totalCommits, config.direction);
    const styledMessage = theme.style.message(header, status);

    if (status === "done") {
      const selected = items[active];
      const answer = selected?.fullHash ? selected.fullHash.slice(0, 7) : NONE_LABEL;
      return [prefix, styledMessage, theme.style.answer(answer)].filter(Boolean).join(" ");
    }

    const window = computePaginationWindow(items.length, active, pageSize);
    const page = renderPage(
      items,
      active,
      noneIndex,
      window.start,
      window.end,
      config.direction,
      theme.icon.cursor,
      theme.style.highlight,
    );
    const paginationStatus = formatPaginationStatus(window, items.length);
    let helpLine = theme.style.keysHelpTip([
      ["\u2191\u2193", "move boundary"],
      ["\u23CE", "confirm"],
    ]);
    if (paginationStatus) {
      helpLine = `${paginationStatus} ${dim("\u2022")} ${helpLine}`;
    }

    return [[prefix, styledMessage].filter(Boolean).join(" "), page, " ", helpLine]
      .filter(Boolean)
      .join("\n")
      .trimEnd()
      .concat(cursorHide);
  },
);

export const splitPointSelector: (
  config: SplitPointSelectorConfig,
  context?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; clearPromptOnDone?: boolean },
) => Promise<string | null> = splitPointSelectorPrompt;
