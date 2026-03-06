import { ArbError } from "../core/errors";
import { isTTY } from "../terminal/tty";
import type {
  Cell,
  GapNode,
  HintNode,
  MessageNode,
  OutputNode,
  RawTextNode,
  RepoHeaderNode,
  SectionNode,
  SummaryNode,
  TableColumnDef,
  TableNode,
  TableRow,
} from "./model";
import { cell } from "./model";

// ── Constants ──

/** Gap between top-level columns / column groups */
const GROUP_GAP = 4;
/** Default gap between sub-columns within a column group */
const DEFAULT_SUB_GAP = 2;

// ── ANSI Helpers ──

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[0;33m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

function ansi(code: string, text: string): string {
  return `${code}${text}${NC}`;
}

// ── Render Context ──

export interface RenderContext {
  tty: boolean;
  terminalWidth?: number;
}

// ── Cell Rendering ──

/** Render a Cell to a string, applying ANSI colors when tty is true */
export function renderCell(c: Cell, ctx: RenderContext): string {
  if (!ctx.tty) return c.plain;
  let out = "";
  for (const s of c.spans) {
    out += colorSpan(s.text, s.attention);
  }
  return out;
}

function colorSpan(text: string, attention: string): string {
  switch (attention) {
    case "muted":
      return ansi(DIM, text);
    case "attention":
      return ansi(YELLOW, text);
    case "danger":
      return ansi(RED, text);
    case "success":
      return ansi(GREEN, text);
    default:
      return text;
  }
}

// ── Main Render Function ──

/** Render an array of OutputNodes to a string */
export function render(nodes: OutputNode[], ctx: RenderContext): string {
  let out = "";
  for (const node of nodes) {
    switch (node.kind) {
      case "table":
        out += renderTableNode(node, ctx);
        break;
      case "message":
        out += renderMessageNode(node, ctx);
        break;
      case "section":
        out += renderSectionNode(node, ctx);
        break;
      case "summary":
        out += renderSummaryNode(node, ctx);
        break;
      case "hint":
        out += renderHintNode(node, ctx);
        break;
      case "repoHeader":
        out += renderRepoHeaderNode(node, ctx);
        break;
      case "gap":
        out += renderGapNode(node);
        break;
      case "rawText":
        out += renderRawTextNode(node);
        break;
    }
  }
  return out;
}

// ── Table Rendering ──

interface ResolvedColumn {
  def: TableColumnDef;
  width: number;
  isSubColumn: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  groupName: string | undefined;
}

function renderTableNode(node: TableNode, ctx: RenderContext): string {
  // Filter out hidden columns
  const visibleDefs = node.columns.filter((c) => c.show !== false);
  if (visibleDefs.length === 0 || node.rows.length === 0) return "";

  // Resolve column groups
  const resolved = resolveColumns(visibleDefs, node.rows);

  // Apply terminal truncation
  if (ctx.terminalWidth && ctx.terminalWidth > 0) {
    applyTruncation(resolved, node.rows, ctx.terminalWidth);
  }

  let out = "";

  // Header
  out += renderTableHeader(resolved, ctx);

  // Rows
  for (let i = 0; i < node.rows.length; i++) {
    const row = node.rows[i];
    if (!row) continue;
    out += renderTableRow(row, resolved, ctx);

    if (row.afterRow && row.afterRow.length > 0) {
      out += render(row.afterRow, ctx);
    }
  }

  return out;
}

function resolveColumns(defs: TableColumnDef[], rows: TableRow[]): ResolvedColumn[] {
  const resolved: ResolvedColumn[] = [];
  const groupSeen = new Map<string, number>();

  for (const def of defs) {
    // Compute max width (header is minimum for group headers, handled separately)
    let maxWidth = 0;
    for (const row of rows) {
      const c = row.cells[def.key];
      if (c) {
        const len = c.plain.length;
        if (len > maxWidth) maxWidth = len;
      }
    }

    const group = def.group;
    const isInGroup = group !== undefined;
    const firstOccurrence = !isInGroup || !groupSeen.has(group);
    if (isInGroup && firstOccurrence) groupSeen.set(group, resolved.length);

    resolved.push({
      def,
      width: maxWidth,
      isSubColumn: isInGroup,
      isFirstInGroup: isInGroup && firstOccurrence,
      isLastInGroup: false, // resolved below
      groupName: group,
    });
  }

  // Mark last columns in each group
  const groupLastIdx = new Map<string, number>();
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i] as ResolvedColumn;
    if (r.groupName !== undefined) {
      groupLastIdx.set(r.groupName, i);
    }
  }
  for (const idx of groupLastIdx.values()) {
    (resolved[idx] as ResolvedColumn).isLastInGroup = true;
  }

  // Ensure group headers fit: expand last sub-column if needed
  for (const [groupName, firstIdx] of groupSeen) {
    // Sum the widths of sub-columns in this group plus sub-gaps
    let groupContentWidth = 0;
    let subColCount = 0;
    let lastIdx = firstIdx;
    for (let i = firstIdx; i < resolved.length; i++) {
      const r = resolved[i] as ResolvedColumn;
      if (r.groupName !== groupName) continue;
      if (subColCount > 0) groupContentWidth += DEFAULT_SUB_GAP;
      groupContentWidth += r.width;
      subColCount++;
      lastIdx = i;
    }
    const headerLen = groupName.length;
    if (groupContentWidth < headerLen) {
      (resolved[lastIdx] as ResolvedColumn).width += headerLen - groupContentWidth;
    }
  }

  // Ensure ungrouped column headers fit
  for (const r of resolved) {
    if (!r.isSubColumn && r.def.header.length > r.width) {
      r.width = r.def.header.length;
    }
  }

  return resolved;
}

function renderTableHeader(resolved: ResolvedColumn[], ctx: RenderContext): string {
  let out = "  ";
  const groupsRendered = new Set<string>();
  let isFirst = true;

  for (let i = 0; i < resolved.length; i++) {
    const col = resolved[i] as ResolvedColumn;
    if (col.groupName !== undefined) {
      if (groupsRendered.has(col.groupName)) continue;
      groupsRendered.add(col.groupName);

      // Compute group total width
      let groupWidth = 0;
      let subCount = 0;
      for (const r of resolved) {
        if (r.groupName === col.groupName) {
          if (subCount > 0) groupWidth += DEFAULT_SUB_GAP;
          groupWidth += r.width;
          subCount++;
        }
      }

      if (!isFirst) out += " ".repeat(GROUP_GAP);
      const headerText = col.groupName;
      const dimHeader = ctx.tty ? ansi(DIM, headerText) : headerText;
      out += `${dimHeader}${" ".repeat(Math.max(0, groupWidth - headerText.length))}`;
      isFirst = false;
    } else {
      if (!isFirst) out += " ".repeat(GROUP_GAP);
      const headerText = col.def.header;
      const dimHeader = ctx.tty ? ansi(DIM, headerText) : headerText;
      out += `${dimHeader}${" ".repeat(Math.max(0, col.width - headerText.length))}`;
      isFirst = false;
    }
  }

  return `${out}\n`;
}

function renderTableRow(row: TableRow, resolved: ResolvedColumn[], ctx: RenderContext): string {
  const prefix = row.marked ? `${ctx.tty ? ansi(BOLD, "*") : "*"} ` : "  ";
  let out = prefix;
  let isFirst = true;

  for (const col of resolved) {
    const c = row.cells[col.def.key];
    const plainLen = c ? c.plain.length : 0;
    const rendered = c ? renderCell(c, ctx) : "";

    // Determine gap before this column
    if (!isFirst) {
      if (col.isSubColumn && !col.isFirstInGroup) {
        out += " ".repeat(DEFAULT_SUB_GAP);
      } else {
        out += " ".repeat(GROUP_GAP);
      }
    }

    // Handle truncation for this specific cell
    let displayText = rendered;
    let displayPlainLen = plainLen;
    if (col.def.truncate && c && plainLen > col.width) {
      displayText = truncateText(c, col.width, ctx);
      displayPlainLen = col.width;
    }

    // Alignment
    if (col.def.align === "right") {
      const pad = Math.max(0, col.width - displayPlainLen);
      out += `${" ".repeat(pad)}${displayText}`;
    } else {
      const pad = Math.max(0, col.width - displayPlainLen);
      out += `${displayText}${" ".repeat(pad)}`;
    }

    isFirst = false;
  }

  return `${out}\n`;
}

function truncateText(c: Cell, maxWidth: number, ctx: RenderContext): string {
  if (c.plain.length <= maxWidth) return renderCell(c, ctx);
  const truncated = `${c.plain.slice(0, maxWidth - 1)}…`;
  if (!ctx.tty) return truncated;

  // Re-render with truncated text, preserving span colors
  let out = "";
  let pos = 0;
  for (const s of c.spans) {
    if (pos >= maxWidth) break;
    const remaining = maxWidth - 1 - pos; // -1 for ellipsis
    if (remaining <= 0) break;
    const text = s.text.slice(0, remaining);
    out += colorSpan(text, s.attention);
    pos += text.length;
  }
  out += "…";
  return out;
}

function applyTruncation(resolved: ResolvedColumn[], rows: TableRow[], terminalWidth: number): void {
  // Calculate total width
  let totalWidth = 2; // prefix indent
  const groupsSeen = new Set<string>();
  let isFirst = true;

  for (const col of resolved) {
    if (col.groupName !== undefined) {
      if (!groupsSeen.has(col.groupName)) {
        groupsSeen.add(col.groupName);
        if (!isFirst) totalWidth += GROUP_GAP;
        isFirst = false;
      } else {
        totalWidth += DEFAULT_SUB_GAP;
      }
    } else {
      if (!isFirst) totalWidth += GROUP_GAP;
      isFirst = false;
    }
    totalWidth += col.width;
  }

  if (totalWidth <= terminalWidth) return;

  // Find truncatable columns and reduce their width
  const truncatable = resolved.filter((c) => c.def.truncate);
  if (truncatable.length === 0) return;

  let overflow = totalWidth - terminalWidth;
  for (const col of truncatable) {
    if (overflow <= 0) break;
    const minWidth = col.def.truncate?.min ?? 0;

    // Also ensure we preserve prefix patterns (e.g. "origin/" + 3 chars + ellipsis)
    let effectiveMin = minWidth;
    for (const row of rows) {
      const c = row.cells[col.def.key];
      if (c) {
        const slashIdx = c.plain.indexOf("/");
        if (slashIdx >= 0) {
          effectiveMin = Math.max(effectiveMin, slashIdx + 1 + 3 + 1);
        }
      }
    }

    const reduction = Math.min(overflow, col.width - effectiveMin);
    if (reduction > 0) {
      col.width -= reduction;
      overflow -= reduction;
    }
  }
}

// ── Other Node Renderers ──

function renderMessageNode(node: MessageNode, ctx: RenderContext): string {
  if (!ctx.tty) return `  ${node.text}\n`;
  return `  ${colorSpan(node.text, node.level)}\n`;
}

function renderSectionNode(node: SectionNode, ctx: RenderContext): string {
  let out = `      ${renderCell(node.header, ctx)}\n`;
  for (const item of node.items) {
    out += `          ${renderCell(item, ctx)}\n`;
  }
  return out;
}

function renderSummaryNode(node: SummaryNode, ctx: RenderContext): string {
  const parts = node.parts.map((p) => renderCell(p, ctx));
  const msg = parts.join(", ");
  if (!ctx.tty) return `${msg}\n`;
  if (node.hasErrors) {
    return `${ansi(YELLOW, msg)}\n`;
  }
  return `${ansi(GREEN, msg)}\n`;
}

function renderHintNode(node: HintNode, ctx: RenderContext): string {
  return `${renderCell(node.cell, ctx)}\n`;
}

function renderRepoHeaderNode(node: RepoHeaderNode, ctx: RenderContext): string {
  const header = ctx.tty ? ansi(BOLD, `==> ${node.name} <==`) : `==> ${node.name} <==`;
  if (node.note) {
    return `${header} ${renderCell(node.note, ctx)}\n`;
  }
  return `${header}\n`;
}

function renderGapNode(_node: GapNode): string {
  return "\n";
}

function renderRawTextNode(node: RawTextNode): string {
  return node.text;
}

// ── Convenience: render summary to stderr ──

export function finishSummary(parts: string[], hasErrors: boolean): void {
  const node: SummaryNode = {
    kind: "summary",
    parts: parts.map((p) => cell(p)),
    hasErrors,
  };
  process.stderr.write(render([node], { tty: isTTY() }));
  if (hasErrors) {
    throw new ArbError(parts.join(", "));
  }
}
