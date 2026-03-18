import type { OutputNode, TableNode } from "./model";
import { cell } from "./model";

/** Minimum items a truncated section must display */
const MIN_ITEMS_PER_SECTION = 1;

// ── Line counting ──

/** Count lines a node array will occupy when rendered. */
export function countNodeLines(nodes: OutputNode[]): number {
  let lines = 0;
  for (const node of nodes) {
    lines += countSingleNodeLines(node);
  }
  return lines;
}

function countSingleNodeLines(node: OutputNode): number {
  switch (node.kind) {
    case "table":
      return countTableLines(node);
    case "section":
      return 1 + node.items.length; // header + items
    case "rawText":
      return countNewlines(node.text);
    case "gap":
    case "message":
    case "summary":
    case "hint":
    case "repoHeader":
      return 1;
  }
}

function countTableLines(table: TableNode): number {
  if (table.rows.length === 0) return 0;
  let lines = 1; // header row
  for (const row of table.rows) {
    lines += 1; // the row itself
    if (row.afterRow) {
      lines += countNodeLines(row.afterRow);
    }
  }
  return lines;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++;
  }
  return count;
}

// ── Height fitting ──

interface SectionRef {
  originalItemCount: number;
}

/**
 * Truncate section items so the node tree fits within maxLines.
 * Only SectionNode items are truncated — other nodes are preserved as-is.
 * Returns a new node array (does not mutate the input).
 */
export function fitToHeight(nodes: OutputNode[], maxLines: number): OutputNode[] {
  const totalLines = countNodeLines(nodes);
  if (totalLines <= maxLines) return nodes;

  // Collect all sections with items
  const sections: SectionRef[] = [];
  collectSections(nodes, sections);

  // Only sections with >= 3 items can yield a net saving (replacing N items with 1 + "...more" saves N-2)
  const truncatable = sections.filter((s) => s.originalItemCount >= 3);
  if (truncatable.length === 0) return nodes;

  // Fixed lines = everything except section items
  const totalItemLines = sections.reduce((sum, s) => sum + s.originalItemCount, 0);
  const fixedLines = totalLines - totalItemLines;

  // Find the highest cap where the output fits
  const maxItemCount = Math.max(...truncatable.map((s) => s.originalItemCount));
  let bestCap = maxItemCount;

  for (let cap = maxItemCount; cap >= MIN_ITEMS_PER_SECTION; cap--) {
    let itemLines = 0;
    for (const s of sections) {
      if (s.originalItemCount <= cap) {
        itemLines += s.originalItemCount;
      } else {
        itemLines += cap + 1; // capped items + "... and N more"
      }
    }
    if (fixedLines + itemLines <= maxLines) {
      bestCap = cap;
      break;
    }
    bestCap = cap;
  }

  // Apply the cap by cloning the node tree with truncated sections
  return applyCapToNodes(nodes, bestCap);
}

function collectSections(nodes: OutputNode[], out: SectionRef[]): void {
  for (const node of nodes) {
    if (node.kind === "section" && node.items.length > 0) {
      out.push({ originalItemCount: node.items.length });
    } else if (node.kind === "table") {
      for (const row of node.rows) {
        if (row.afterRow) {
          collectSections(row.afterRow, out);
        }
      }
    }
  }
}

function applyCapToNodes(nodes: OutputNode[], cap: number): OutputNode[] {
  return nodes.map((node) => applyCapToNode(node, cap));
}

function applyCapToNode(node: OutputNode, cap: number): OutputNode {
  // Only truncate when it saves lines: cap + "...more" (cap+1 lines) < original (items.length lines)
  if (node.kind === "section" && node.items.length > cap + 1) {
    const hidden = node.items.length - cap;
    return {
      ...node,
      items: [...node.items.slice(0, cap), cell(`... and ${hidden} more`, "muted")],
    };
  }
  if (node.kind === "table") {
    return {
      ...node,
      rows: node.rows.map((row) => {
        if (!row.afterRow) return row;
        return { ...row, afterRow: applyCapToNodes(row.afterRow, cap) };
      }),
    };
  }
  return node;
}
