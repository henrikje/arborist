import { styleText } from "node:util";
import { cursorHide } from "@inquirer/ansi";
import {
  type KeypressEvent,
  createPrompt,
  isDownKey,
  isEnterKey,
  isNumberKey,
  isSpaceKey,
  isUpKey,
  makeTheme,
  useKeypress,
  useMemo,
  usePrefix,
  useState,
} from "@inquirer/core";
import figures from "@inquirer/figures";
import { countLines } from "./output";
import { computePaginationWindow, formatPaginationStatus, resolvePromptPageSize } from "./pagination-status";

export interface CheckboxWithStatusChoice<T> {
  name: string;
  value: T;
  short?: string;
  checked?: boolean;
}

export interface CheckboxWithStatusConfig<T> {
  message: string;
  choices: CheckboxWithStatusChoice<T>[];
  pageSize?: number;
  loop?: boolean;
  validate?: (selected: readonly T[]) => true | string | Promise<true | string>;
  theme?: {
    prefix?: string | { idle: string; done: string };
    style?: {
      message?: (text: string, status: string) => string;
      renderSelectedChoices?: (selected: NormalizedChoice<unknown>[]) => string;
    };
  };
  shortcuts?: { all?: string | null; invert?: string | null };
  preview?: (selected: T[]) => string;
}

interface NormalizedChoice<T> {
  value: T;
  name: string;
  short: string;
  checked: boolean;
}

const defaultTheme = {
  icon: {
    checked: styleText("green", figures.circleFilled),
    unchecked: figures.circle,
    cursor: figures.pointer,
  },
  style: {
    renderSelectedChoices: (sel: NormalizedChoice<unknown>[], _all?: unknown) => sel.map((c) => c.short).join(", "),
    keysHelpTip: (keys: [string, string][]) =>
      keys
        .map(([key, action]) => `${styleText("bold", key)} ${styleText("dim", action)}`)
        .join(styleText("dim", " • ")),
  },
};

function isChecked<T>(item: NormalizedChoice<T>): boolean {
  return item.checked;
}

function toggleItem<T>(item: NormalizedChoice<T>): NormalizedChoice<T> {
  return { ...item, checked: !item.checked };
}

function setChecked<T>(checked: boolean): (item: NormalizedChoice<T>) => NormalizedChoice<T> {
  return (item) => ({ ...item, checked });
}

function normalizeChoices<T>(choices: CheckboxWithStatusChoice<T>[]): NormalizedChoice<T>[] {
  return choices.map((c) => ({
    value: c.value,
    name: c.name,
    short: c.short ?? c.name,
    checked: c.checked ?? false,
  }));
}

interface RenderTheme {
  icon: { checked: string; unchecked: string; cursor: string };
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
      const icon = item.checked ? theme.icon.checked : theme.icon.unchecked;
      const color = isActive ? theme.style.highlight : (x: string) => x;
      const cursor = isActive ? theme.icon.cursor : " ";
      return color(`${cursor}${icon} ${item.name}`);
    })
    .join("\n");
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

const checkboxWithStatusPrompt = createPrompt(<T>(config: CheckboxWithStatusConfig<T>, done: (value: T[]) => void) => {
  const shortcuts = { all: "a", invert: "i", ...config.shortcuts };
  const theme = makeTheme(defaultTheme, config.theme);
  const loop = config.loop ?? false;

  const [status, setStatus] = useState<"idle" | "done">("idle");
  const [errorMsg, setError] = useState<string | undefined>();
  const prefix = usePrefix({ status, theme });
  const [items, setItems] = useState(normalizeChoices(config.choices));

  const bounds = useMemo(() => ({ first: 0, last: items.length - 1 }), [items]);
  const [active, setActive] = useState(bounds.first);

  useKeypress(async (key: KeypressEvent) => {
    if (isEnterKey(key)) {
      const selected = items.filter(isChecked).map((c) => c.value);
      const isValid = (await config.validate?.(selected)) ?? true;
      if (isValid === true) {
        setStatus("done");
        done(selected);
      } else {
        setError(isValid);
      }
    } else if (isUpKey(key) || isDownKey(key)) {
      setError(undefined);
      if (loop || (isUpKey(key) && active !== bounds.first) || (isDownKey(key) && active !== bounds.last)) {
        const offset = isUpKey(key) ? -1 : 1;
        const next = (active + offset + items.length) % items.length;
        setActive(next);
      }
    } else if (isSpaceKey(key)) {
      setError(undefined);
      setItems(items.map((choice, i) => (i === active ? toggleItem(choice) : choice)));
    } else if (key.name === shortcuts.all) {
      setError(undefined);
      const selectAll = items.some((choice) => !choice.checked);
      setItems(items.map(setChecked(selectAll)));
    } else if (key.name === shortcuts.invert) {
      setError(undefined);
      setItems(items.map(toggleItem));
    } else if (isNumberKey(key)) {
      const idx = Number(key.name) - 1;
      if (idx >= 0 && idx < items.length) {
        setError(undefined);
        setActive(idx);
        setItems(items.map((choice, i) => (i === idx ? toggleItem(choice) : choice)));
      }
    }
  });

  const styledMessage = theme.style.message(config.message, status);

  if (status === "done") {
    const selection = items.filter(isChecked);
    const answer = theme.style.answer(theme.style.renderSelectedChoices(selection, items));
    return [prefix, styledMessage, answer].filter(Boolean).join(" ");
  }

  const keys: [string, string][] = [
    ["↑↓", "navigate"],
    ["space", "select"],
  ];
  if (shortcuts.all) keys.push([shortcuts.all, "all"]);
  if (shortcuts.invert) keys.push([shortcuts.invert, "invert"]);
  keys.push(["⏎", "submit"]);
  let helpLine = theme.style.keysHelpTip(keys);
  const terminalRows = process.stderr.rows ?? 24;
  const terminalWidth = process.stderr.columns ?? 80;
  const promptLine = [prefix, styledMessage].filter(Boolean).join(" ");
  const bottomContent = config.preview?.(items.filter(isChecked).map((c) => c.value)) ?? "";
  const baseReservedRows =
    countLines(ensureTrailingNewline(promptLine), terminalWidth) +
    countLines(ensureTrailingNewline(helpLine), terminalWidth) +
    (errorMsg ? countLines(ensureTrailingNewline(errorMsg), terminalWidth) : 0) +
    (bottomContent ? countLines(bottomContent, terminalWidth) : 0);

  let pageSize =
    config.pageSize ??
    resolvePromptPageSize(items.length, {
      terminalRows,
      reservedRows: baseReservedRows,
    });

  let window = computePaginationWindow(items.length, active, pageSize);
  let paginationStatus = formatPaginationStatus(window, items.length);
  if (paginationStatus) {
    pageSize =
      config.pageSize ??
      resolvePromptPageSize(items.length, {
        terminalRows,
        reservedRows: baseReservedRows + countLines(ensureTrailingNewline(paginationStatus), terminalWidth),
      });
    window = computePaginationWindow(items.length, active, pageSize);
    paginationStatus = formatPaginationStatus(window, items.length);
  }
  if (paginationStatus) {
    helpLine = `${paginationStatus} ${styleText("dim", "•")} ${helpLine}`;
  }

  const page = renderPage(items, active, window.start, window.end, theme);
  const renderedError = errorMsg ? theme.style.error(errorMsg) : "";

  const content = [promptLine, page, " ", renderedError, helpLine].filter(Boolean).join("\n").trimEnd();

  return [`${content}${cursorHide}`, bottomContent];
});

export const checkboxWithStatus: <T>(
  config: CheckboxWithStatusConfig<T>,
  context?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; clearPromptOnDone?: boolean },
) => Promise<T[]> = checkboxWithStatusPrompt;
