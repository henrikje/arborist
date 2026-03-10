/**
 * A checkbox prompt with a live-updating preview panel below the list.
 *
 * Built on @inquirer/core's createPrompt, returning [content, bottomContent]
 * so ScreenManager renders the checkbox above and the preview below, with the
 * cursor staying in the checkbox area. The preview recomputes on each toggle.
 *
 * Adapted from @inquirer/checkbox — same hooks, same key bindings, same theme
 * support — with the addition of a `preview` callback.
 */

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
  usePagination,
  usePrefix,
  useState,
} from "@inquirer/core";
import figures from "@inquirer/figures";

// ── Types ──

export interface CheckboxWithPreviewChoice<T> {
  name: string;
  value: T;
  short?: string;
  checked?: boolean;
}

export interface CheckboxWithPreviewConfig<T> {
  message: string;
  choices: CheckboxWithPreviewChoice<T>[];
  /** Returns an ANSI string rendered below the checkbox list. Called on each state change. */
  preview: (selected: T[]) => string;
  pageSize?: number;
  loop?: boolean;
  theme?: {
    prefix?: string | { idle: string; done: string };
    style?: {
      message?: (text: string, status: string) => string;
      renderSelectedChoices?: (selected: NormalizedChoice<unknown>[]) => string;
    };
  };
  shortcuts?: { all?: string | null; invert?: string | null };
}

interface NormalizedChoice<T> {
  value: T;
  name: string;
  short: string;
  checked: boolean;
}

// ── Default theme ──

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

// ── Helpers ──

function isChecked<T>(item: NormalizedChoice<T>): boolean {
  return item.checked;
}

function toggleItem<T>(item: NormalizedChoice<T>): NormalizedChoice<T> {
  return { ...item, checked: !item.checked };
}

function setChecked<T>(checked: boolean): (item: NormalizedChoice<T>) => NormalizedChoice<T> {
  return (item) => ({ ...item, checked });
}

function normalizeChoices<T>(choices: CheckboxWithPreviewChoice<T>[]): NormalizedChoice<T>[] {
  return choices.map((c) => ({
    value: c.value,
    name: c.name,
    short: c.short ?? c.name,
    checked: c.checked ?? false,
  }));
}

// ── Prompt ──

const checkboxWithPreviewPrompt = createPrompt(
  <T>(config: CheckboxWithPreviewConfig<T>, done: (value: T[]) => void) => {
    const { pageSize = 20, loop = false } = config;
    const shortcuts = { all: "a", invert: "i", ...config.shortcuts };
    const theme = makeTheme(defaultTheme, config.theme);

    const [status, setStatus] = useState<"idle" | "done">("idle");
    const prefix = usePrefix({ status, theme });
    const [items, setItems] = useState(normalizeChoices(config.choices));

    const bounds = useMemo(() => {
      const first = items.findIndex(() => true);
      const last = items.length - 1;
      return { first, last };
    }, [items]);

    const [active, setActive] = useState(bounds.first);

    useKeypress((key: KeypressEvent) => {
      if (isEnterKey(key)) {
        setStatus("done");
        done(items.filter(isChecked).map((c) => c.value));
      } else if (isUpKey(key) || isDownKey(key)) {
        if (loop || (isUpKey(key) && active !== bounds.first) || (isDownKey(key) && active !== bounds.last)) {
          const offset = isUpKey(key) ? -1 : 1;
          let next = active;
          do {
            next = (next + offset + items.length) % items.length;
          } while (next < 0);
          setActive(next);
        }
      } else if (isSpaceKey(key)) {
        setItems(items.map((choice, i) => (i === active ? toggleItem(choice) : choice)));
      } else if (key.name === shortcuts.all) {
        const selectAll = items.some((choice) => !choice.checked);
        setItems(items.map(setChecked(selectAll)));
      } else if (key.name === shortcuts.invert) {
        setItems(items.map(toggleItem));
      } else if (isNumberKey(key)) {
        const idx = Number(key.name) - 1;
        if (idx >= 0 && idx < items.length) {
          setActive(idx);
          setItems(items.map((choice, i) => (i === idx ? toggleItem(choice) : choice)));
        }
      }
    });

    const styledMessage = theme.style.message(config.message, status);

    // Done state — single summary line, no bottomContent
    if (status === "done") {
      const selection = items.filter(isChecked);
      const answer = theme.style.answer(theme.style.renderSelectedChoices(selection, items));
      return [prefix, styledMessage, answer].filter(Boolean).join(" ");
    }

    // Active state — checkbox list + preview
    const page = usePagination({
      items,
      active,
      renderItem({ item, isActive }: { item: NormalizedChoice<T>; isActive: boolean }) {
        const icon = item.checked ? theme.icon.checked : theme.icon.unchecked;
        const color = isActive ? theme.style.highlight : (x: string) => x;
        const cursor = isActive ? theme.icon.cursor : " ";
        return color(`${cursor}${icon} ${item.name}`);
      },
      pageSize,
      loop,
    });

    const keys: [string, string][] = [
      ["↑↓", "navigate"],
      ["space", "select"],
    ];
    if (shortcuts.all) keys.push([shortcuts.all, "all"]);
    if (shortcuts.invert) keys.push([shortcuts.invert, "invert"]);
    keys.push(["⏎", "submit"]);
    const helpLine = theme.style.keysHelpTip(keys);

    const content = [[prefix, styledMessage].filter(Boolean).join(" "), page, " ", helpLine]
      .filter(Boolean)
      .join("\n")
      .trimEnd();

    // Preview panel — computed from current selection
    const selectedValues = items.filter(isChecked).map((c) => c.value);
    const bottomContent = config.preview(selectedValues);

    return [`${content}${cursorHide}`, bottomContent];
  },
);

export const checkboxWithPreview: <T>(
  config: CheckboxWithPreviewConfig<T>,
  context?: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; clearPromptOnDone?: boolean },
) => Promise<T[]> = checkboxWithPreviewPrompt;
