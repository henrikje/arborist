import { styleText } from "node:util";
import { cursorHide } from "@inquirer/ansi";
import {
  type KeypressEvent,
  createPrompt,
  isBackspaceKey,
  isDownKey,
  isEnterKey,
  isNumberKey,
  isUpKey,
  makeTheme,
  useEffect,
  useKeypress,
  useMemo,
  usePrefix,
  useRef,
  useState,
} from "@inquirer/core";
import figures from "@inquirer/figures";
import { computePaginationWindow, formatPaginationStatus, resolvePromptPageSize } from "./pagination-status";

export interface SelectWithStatusChoice<T> {
  name: string;
  value: T;
  short?: string;
}

export interface SelectWithStatusConfig<T> {
  message: string;
  choices: SelectWithStatusChoice<T>[];
  pageSize?: number;
  loop?: boolean;
  theme?: {
    prefix?: string | { idle: string; done: string };
  };
}

interface NormalizedChoice<T> {
  value: T;
  name: string;
  short: string;
}

const selectTheme = {
  icon: { cursor: figures.pointer },
  style: {
    keysHelpTip: (keys: [string, string][]) =>
      keys
        .map(([key, action]) => `${styleText("bold", key)} ${styleText("dim", action)}`)
        .join(styleText("dim", " • ")),
  },
};

function normalizeChoices<T>(choices: SelectWithStatusChoice<T>[]): NormalizedChoice<T>[] {
  return choices.map((choice) => ({
    value: choice.value,
    name: choice.name,
    short: choice.short ?? choice.name,
  }));
}

interface RenderTheme {
  icon: { cursor: string };
  style: { highlight: (text: string) => string };
}

function renderPage<T>(
  items: NormalizedChoice<T>[],
  active: number,
  start: number,
  end: number,
  theme: RenderTheme,
): string {
  return items
    .slice(start, end)
    .map((item, offset) => {
      const isActive = start + offset === active;
      const color = isActive ? theme.style.highlight : (x: string) => x;
      const cursor = isActive ? theme.icon.cursor : " ";
      return color(`${cursor} ${item.name}`);
    })
    .join("\n");
}

const selectWithStatusPrompt = createPrompt(<T>(config: SelectWithStatusConfig<T>, done: (value: T) => void) => {
  const theme = makeTheme(selectTheme, config.theme);
  const [status, setStatus] = useState<"idle" | "done">("idle");
  const prefix = usePrefix({ status, theme });
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const items = useMemo(() => normalizeChoices(config.choices), [config.choices]);
  const bounds = useMemo(() => ({ first: 0, last: items.length - 1 }), [items]);
  const [active, setActive] = useState(bounds.first);
  const loop = config.loop ?? false;
  const pageSize = config.pageSize ?? resolvePromptPageSize(items.length, { reservedRows: 6 });

  useKeypress((key: KeypressEvent, rl) => {
    clearTimeout(searchTimeoutRef.current);
    if (isEnterKey(key)) {
      const selected = items[active];
      if (!selected) return;
      setStatus("done");
      done(selected.value);
    } else if (isUpKey(key) || isDownKey(key)) {
      rl.clearLine(0);
      if (loop || (isUpKey(key) && active !== bounds.first) || (isDownKey(key) && active !== bounds.last)) {
        const offset = isUpKey(key) ? -1 : 1;
        const next = (active + offset + items.length) % items.length;
        setActive(next);
      }
    } else if (isNumberKey(key)) {
      const idx = Number(rl.line) - 1;
      if (!Number.isNaN(idx) && idx >= 0 && idx < items.length) {
        setActive(idx);
      }
      searchTimeoutRef.current = setTimeout(() => {
        rl.clearLine(0);
      }, 700);
    } else if (isBackspaceKey(key)) {
      rl.clearLine(0);
    } else {
      const searchTerm = rl.line.toLowerCase();
      const matchIndex = items.findIndex((item) => item.name.toLowerCase().startsWith(searchTerm));
      if (matchIndex !== -1) {
        setActive(matchIndex);
      }
      searchTimeoutRef.current = setTimeout(() => {
        rl.clearLine(0);
      }, 700);
    }
  });

  useEffect(() => () => clearTimeout(searchTimeoutRef.current), []);

  const styledMessage = theme.style.message(config.message, status);

  if (status === "done") {
    return [prefix, styledMessage, theme.style.answer(items[active]?.short ?? "")].filter(Boolean).join(" ");
  }

  const window = computePaginationWindow(items.length, active, pageSize);
  const page = renderPage(items, active, window.start, window.end, theme);
  const paginationStatus = formatPaginationStatus(window, items.length);
  let helpLine = theme.style.keysHelpTip([
    ["↑↓", "navigate"],
    ["⏎", "select"],
  ]);
  if (paginationStatus) {
    helpLine = `${paginationStatus} ${styleText("dim", "•")} ${helpLine}`;
  }

  return [[prefix, styledMessage].filter(Boolean).join(" "), page, " ", helpLine]
    .filter(Boolean)
    .join("\n")
    .trimEnd()
    .concat(cursorHide);
});

export const selectWithStatus: <T>(
  config: SelectWithStatusConfig<T>,
  context?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; clearPromptOnDone?: boolean },
) => Promise<T> = selectWithStatusPrompt;
