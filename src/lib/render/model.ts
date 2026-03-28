// ── Core Primitives ──

/** Attention levels map to color semantics from GUIDELINES.md */
export type Attention = "default" | "muted" | "attention" | "danger" | "success";

/** A single text span with attention level */
export interface Span {
  text: string;
  attention: Attention;
}

/** Annotated cell: one or more spans + plain text for width measurement */
export interface Cell {
  plain: string;
  spans: Span[];
}

/** Create a cell from text with a single attention level (default: "default") */
export function cell(text: string, attention: Attention = "default"): Cell {
  return { plain: text, spans: [{ text, attention }] };
}

/** Create a cell from multiple spans */
export function spans(...parts: Span[]): Cell {
  let plain = "";
  for (const s of parts) plain += s.text;
  return { plain, spans: parts };
}

/** Join multiple cells with a separator (default: ", ") into a single cell */
export function join(cells: Cell[], separator = ", "): Cell {
  if (cells.length === 0) return cell("");
  if (cells.length === 1) return cells[0] as Cell;
  const allSpans: Span[] = [];
  let plain = "";
  for (let i = 0; i < cells.length; i++) {
    if (i > 0) {
      allSpans.push({ text: separator, attention: "default" });
      plain += separator;
    }
    const c = cells[i] as Cell;
    allSpans.push(...c.spans);
    plain += c.plain;
  }
  return { plain, spans: allSpans };
}

/** Append a span to an existing cell */
export function suffix(base: Cell, text: string, attention: Attention = "default"): Cell {
  return {
    plain: base.plain + text,
    spans: [...base.spans, { text, attention }],
  };
}

/** Empty cell (no text, no spans) */
export const EMPTY_CELL: Cell = { plain: "", spans: [] };

// ── Output Nodes ──

export type OutputNode =
  | TableNode
  | MessageNode
  | SectionNode
  | SummaryNode
  | HintNode
  | RepoHeaderNode
  | GapNode
  | RawTextNode;

export interface TableNode {
  kind: "table";
  columns: TableColumnDef[];
  rows: TableRow[];
}

export interface TableColumnDef {
  header: string;
  key: string;
  /** undefined/true = always show, false = always hide, "auto" = hide if all row cells are empty */
  show?: boolean | "auto";
  group?: string;
  align?: "left" | "right";
  truncate?: { min: number };
  /** Gap before this sub-column when inside a group (overrides DEFAULT_SUB_GAP) */
  subGap?: number;
}

export interface TableRow {
  cells: Record<string, Cell>;
  marked?: boolean;
  afterRow?: OutputNode[];
}

export interface MessageNode {
  kind: "message";
  level: Attention;
  text: string;
}

export interface SectionNode {
  kind: "section";
  header: Cell;
  items: Cell[];
}

export interface SummaryNode {
  kind: "summary";
  parts: Cell[];
  hasErrors: boolean;
}

export interface HintNode {
  kind: "hint";
  cell: Cell;
}

export interface RepoHeaderNode {
  kind: "repoHeader";
  name: string;
  note?: Cell;
}

export interface GapNode {
  kind: "gap";
}

/** Pre-rendered text passed through without modification (temporary bridge for graph output) */
export interface RawTextNode {
  kind: "rawText";
  text: string;
}
