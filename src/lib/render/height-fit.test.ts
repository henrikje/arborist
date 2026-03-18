import { describe, expect, it } from "bun:test";
import { countNodeLines, fitToHeight } from "./height-fit";
import type { GapNode, OutputNode, SectionNode, TableNode } from "./model";
import { cell } from "./model";

// ── Helpers ──

function gap(): GapNode {
  return { kind: "gap" };
}

function section(header: string, itemCount: number): SectionNode {
  return {
    kind: "section",
    header: cell(header),
    items: Array.from({ length: itemCount }, (_, i) => cell(`item ${i + 1}`)),
  };
}

function table(rows: { afterRow?: OutputNode[] }[]): TableNode {
  return {
    kind: "table",
    columns: [{ header: "REPO", key: "repo" }],
    rows: rows.map((r) => ({
      cells: { repo: cell("my-repo") },
      ...r,
    })),
  };
}

// ── countNodeLines ──

describe("countNodeLines", () => {
  it("counts a gap as 1 line", () => {
    expect(countNodeLines([gap()])).toBe(1);
  });

  it("counts a message as 1 line", () => {
    expect(countNodeLines([{ kind: "message", level: "muted", text: "hello" }])).toBe(1);
  });

  it("counts a section as header + items", () => {
    expect(countNodeLines([section("Header:", 5)])).toBe(6); // 1 + 5
  });

  it("counts a section with zero items as 1 line", () => {
    expect(countNodeLines([section("Header:", 0)])).toBe(1);
  });

  it("counts a table with header + rows", () => {
    const t = table([{}, {}]);
    expect(countNodeLines([t])).toBe(3); // 1 header + 2 rows
  });

  it("counts table rows with afterRow sections", () => {
    const t = table([{ afterRow: [gap(), section("Ahead:", 3), gap()] }, {}]);
    // table: 1 header + 2 rows = 3
    // afterRow: 1 gap + (1 header + 3 items) + 1 gap = 6
    expect(countNodeLines([t])).toBe(9);
  });

  it("counts rawText by newlines", () => {
    expect(countNodeLines([{ kind: "rawText", text: "line1\nline2\nline3\n" }])).toBe(3);
  });

  it("counts multiple nodes", () => {
    expect(countNodeLines([gap(), gap(), section("H:", 2)])).toBe(5); // 1 + 1 + (1+2)
  });
});

// ── fitToHeight ──

describe("fitToHeight", () => {
  it("returns nodes unchanged when they fit", () => {
    const nodes: OutputNode[] = [gap(), section("H:", 3)];
    // 1 + 4 = 5 lines
    const result = fitToHeight(nodes, 10);
    expect(result).toBe(nodes); // same reference — no cloning needed
  });

  it("truncates a single section to fit", () => {
    const nodes: OutputNode[] = [section("Ahead:", 10)];
    // 11 lines, budget = 5
    // cap must yield: 1 (header) + cap + 1 ("...more") <= 5 → cap <= 3
    const result = fitToHeight(nodes, 5);
    const s = result[0] as SectionNode;
    expect(s.items).toHaveLength(4); // 3 items + "... and 7 more"
    expect(s.items[3]?.plain).toBe("... and 7 more");
  });

  it("truncates to minimum (1 item + more) when budget is very tight", () => {
    const nodes: OutputNode[] = [section("Ahead:", 10)];
    // budget = 3 → header(1) + 1 item + 1 "...more" = 3
    const result = fitToHeight(nodes, 3);
    const s = result[0] as SectionNode;
    expect(s.items).toHaveLength(2); // 1 item + "... and 9 more"
    expect(s.items[0]?.plain).toBe("item 1");
    expect(s.items[1]?.plain).toBe("... and 9 more");
  });

  it("applies uniform cap across multiple sections", () => {
    const nodes: OutputNode[] = [section("A:", 8), gap(), section("B:", 12)];
    // lines: (1+8) + 1 + (1+12) = 23, budget = 12
    // fixedLines = 23 - 8 - 12 = 3, available for items = 12 - 3 = 9
    // cap=4: 4 + 1("...more") + 4 + 1("...more") = 10 → 3+10=13 > 12
    // cap=3: 3 + 1 + 3 + 1 = 8 → 3+8=11 <= 12 ✓
    const result = fitToHeight(nodes, 12);
    const sA = result[0] as SectionNode;
    const sB = result[2] as SectionNode;
    expect(sA.items).toHaveLength(4); // 3 + "...more"
    expect(sA.items[3]?.plain).toBe("... and 5 more");
    expect(sB.items).toHaveLength(4); // 3 + "...more"
    expect(sB.items[3]?.plain).toBe("... and 9 more");
  });

  it("does not truncate sections with 2 or fewer items", () => {
    const nodes: OutputNode[] = [section("Small:", 2), gap(), section("Big:", 20)];
    // 25 lines total, budget = 10. Only Big is truncatable (>= 3 items).
    // cap=4: Small(2) + Big(4+1) = 7 → fixedLines(3)+7=10 ✓
    const result = fitToHeight(nodes, 10);
    const sSmall = result[0] as SectionNode;
    const sBig = result[2] as SectionNode;
    expect(sSmall.items).toHaveLength(2); // unchanged
    expect(sSmall.items[0]?.plain).toBe("item 1");
    expect(sBig.items).toHaveLength(5); // 4 + "...more"
    expect(sBig.items[4]?.plain).toBe("... and 16 more");
  });

  it("truncates sections inside table afterRow", () => {
    const t = table([{ afterRow: [gap(), section("Commits:", 10), gap()] }]);
    // table: 1 header + 1 row = 2
    // afterRow: 1 + (1+10) + 1 = 13
    // total: 15, budget = 8
    // fixedLines = 15 - 10 = 5
    // cap=2: 2+1=3 → 5+3=8 <= 8 ✓
    const result = fitToHeight([t], 8);
    const resultTable = result[0] as TableNode;
    const afterRow = resultTable.rows[0]?.afterRow ?? [];
    const s = afterRow[1] as SectionNode;
    expect(s.items).toHaveLength(3); // 2 + "...more"
    expect(s.items[2]?.plain).toBe("... and 8 more");
  });

  it("skips truncation when it would not save lines (cap+1 items)", () => {
    // Section with 4 items at cap=3: truncating to 3+"...more" = 4 lines, same as original.
    // Should leave items untouched since truncation loses info for zero benefit.
    const nodes: OutputNode[] = [section("A:", 4), gap(), section("B:", 20)];
    // totalLines = (1+4) + 1 + (1+20) = 27, fixedLines = 27-24 = 3
    // cap=3: A(4>3→4) + B(20>3→4) = 8 → 3+8=11
    // budget=11 gives cap=3
    // Apply: A has 4, 4 > cap+1=4 → false → untouched. B has 20 > 4 → truncated.
    const result = fitToHeight(nodes, 11);
    const sA = result[0] as SectionNode;
    const sB = result[2] as SectionNode;
    expect(sA.items).toHaveLength(4); // all 4 items preserved
    expect(sA.items[3]?.plain).toBe("item 4"); // real item, not "...more"
    expect(sB.items).toHaveLength(4); // 3 + "...more"
    expect(sB.items[3]?.plain).toBe("... and 17 more");
  });

  it("does not mutate the original nodes", () => {
    const original = section("H:", 10);
    const nodes: OutputNode[] = [original];
    fitToHeight(nodes, 5);
    expect(original.items).toHaveLength(10); // unchanged
  });

  it("handles budget smaller than minimum (cap=1 floor)", () => {
    const nodes: OutputNode[] = [section("H:", 10)];
    // budget = 1, minimum output = 1 header + 1 item + 1 "...more" = 3
    // cap=1 is the floor, output will be 3 lines (exceeds budget, but that's the floor)
    const result = fitToHeight(nodes, 1);
    const s = result[0] as SectionNode;
    expect(s.items).toHaveLength(2); // 1 item + "... and 9 more"
    expect(s.items[0]?.plain).toBe("item 1");
  });

  it("preserves section header when truncating", () => {
    const nodes: OutputNode[] = [section("Ahead of origin/main:", 5)];
    const result = fitToHeight(nodes, 4);
    const s = result[0] as SectionNode;
    expect(s.header.plain).toBe("Ahead of origin/main:");
  });

  it("handles multiple table rows with verbose sections", () => {
    const t = table([
      { afterRow: [gap(), section("Ahead:", 6), gap()] },
      { afterRow: [gap(), section("Behind:", 4), gap()] },
    ]);
    // table: 1 header + 2 rows = 3
    // row1 afterRow: 1 + (1+6) + 1 = 9
    // row2 afterRow: 1 + (1+4) + 1 = 7
    // total: 19, budget = 13
    // fixedLines = 19 - 6 - 4 = 9
    // cap=2: Ahead(2+1=3) + Behind(2+1=3) = 6 → 9+6=15 > 13
    //   Wait: cap=2: Ahead has 6>2 → 2+1=3, Behind has 4>2 → 2+1=3 → 6, total=9+6=15 > 13
    // cap=1: Ahead(1+1=2) + Behind(1+1=2) = 4 → 9+4=13 <= 13 ✓
    const result = fitToHeight([t], 13);
    const rt = result[0] as TableNode;
    const s1 = rt.rows[0]?.afterRow?.[1] as SectionNode;
    const s2 = rt.rows[1]?.afterRow?.[1] as SectionNode;
    expect(s1.items).toHaveLength(2); // 1 + "...more"
    expect(s2.items).toHaveLength(2); // 1 + "...more"
  });
});
