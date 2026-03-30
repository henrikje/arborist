import { describe, expect, test } from "bun:test";
import { buildConflictReport, buildStashPopFailureReport, type ConflictEntry } from "./conflict-report";
import type { MessageNode, SectionNode } from "./model";

describe("buildConflictReport", () => {
  test("returns empty array for no entries", () => {
    expect(buildConflictReport([])).toEqual([]);
  });

  test("produces gap + message + gap + section + trailing guidance for a single entry", () => {
    const entries: ConflictEntry[] = [
      { repo: "api", stdout: "CONFLICT (content): Merge conflict in index.ts\n", stderr: "", mode: "rebase" },
    ];
    const nodes = buildConflictReport(entries);

    expect(nodes[0]).toEqual({ kind: "gap" });
    const msg = nodes[1] as MessageNode;
    expect(msg.kind).toBe("message");
    expect(msg.text).toBe("1 repo has conflicts:");

    expect(nodes[2]).toEqual({ kind: "gap" });
    const section = nodes[3] as SectionNode;
    expect(section.kind).toBe("section");
    expect(section.header.plain).toBe("api");
    expect(section.items).toHaveLength(1);
    expect(section.items[0]?.spans[0]?.attention).toBe("muted");
    expect(section.items[0]?.plain).toBe("CONFLICT (content): Merge conflict in index.ts");

    // Trailing guidance
    expect(nodes[4]).toEqual({ kind: "gap" });
    const cont = nodes[5] as MessageNode;
    expect(cont.text).toBe("Fix conflicts, then: arb rebase --continue");
    const abort = nodes[6] as MessageNode;
    expect(abort.text).toBe("Or to abort:         arb rebase --abort");
    const git = nodes[7] as MessageNode;
    expect(git.level).toBe("muted");
    expect(git.text).toContain("git rebase --continue/--abort per repo");
  });

  test("filters only CONFLICT lines from combined stdout/stderr", () => {
    const entries: ConflictEntry[] = [
      {
        repo: "web",
        stdout: "Applying: abc\nCONFLICT (content): file.ts\nFailed to merge\n",
        stderr: "error: could not apply\nCONFLICT (modify/delete): old.ts\n",
        mode: "merge",
      },
    ];
    const nodes = buildConflictReport(entries);
    const section = nodes[3] as SectionNode;
    const mutedItems = section.items.filter((i) => i.spans[0]?.attention === "muted");
    expect(mutedItems).toHaveLength(2);
    expect(mutedItems[0]?.plain).toBe("CONFLICT (content): file.ts");
    expect(mutedItems[1]?.plain).toBe("CONFLICT (modify/delete): old.ts");
  });

  test("uses mode for arb command and derives git subcommand", () => {
    const mergeEntries: ConflictEntry[] = [{ repo: "lib", stdout: "", stderr: "", mode: "merge" }];
    const mergeNodes = buildConflictReport(mergeEntries);
    const cont = mergeNodes[5] as MessageNode;
    expect(cont.text).toContain("arb merge --continue");
    const abort = mergeNodes[6] as MessageNode;
    expect(abort.text).toContain("arb merge --abort");
    const git = mergeNodes[7] as MessageNode;
    expect(git.text).toContain("git merge --continue/--abort");

    // pull and retarget use git rebase under the hood
    const pullEntries: ConflictEntry[] = [{ repo: "lib", stdout: "", stderr: "", mode: "pull" }];
    const pullNodes = buildConflictReport(pullEntries);
    const pullCont = pullNodes[5] as MessageNode;
    expect(pullCont.text).toContain("arb pull --continue");
    const pullGit = pullNodes[7] as MessageNode;
    expect(pullGit.text).toContain("git rebase --continue/--abort");

    const retargetEntries: ConflictEntry[] = [{ repo: "lib", stdout: "", stderr: "", mode: "retarget" }];
    const retargetNodes = buildConflictReport(retargetEntries);
    const retargetCont = retargetNodes[5] as MessageNode;
    expect(retargetCont.text).toContain("arb retarget --continue");
    const retargetGit = retargetNodes[7] as MessageNode;
    expect(retargetGit.text).toContain("git rebase --continue/--abort");
  });

  test("produces gap between multiple repo sections", () => {
    const entries: ConflictEntry[] = [
      { repo: "api", stdout: "", stderr: "", mode: "rebase" },
      { repo: "web", stdout: "", stderr: "", mode: "rebase" },
    ];
    const nodes = buildConflictReport(entries);

    const msg = nodes[1] as MessageNode;
    expect(msg.text).toBe("2 repos have conflicts:");

    // Structure: gap, message, gap, section(api), gap, section(web), gap, message, message, message
    const kinds = nodes.map((n) => n.kind);
    expect(kinds).toEqual([
      "gap",
      "message",
      "gap",
      "section",
      "gap",
      "section",
      "gap",
      "message",
      "message",
      "message",
    ]);
  });
});

describe("buildStashPopFailureReport", () => {
  test("returns empty array for no repos", () => {
    expect(buildStashPopFailureReport([], "Rebase")).toEqual([]);
  });

  test("produces gap + message + gap + section for a single repo", () => {
    const nodes = buildStashPopFailureReport([{ repo: "api" }], "Rebase");

    expect(nodes[0]).toEqual({ kind: "gap" });
    const msg = nodes[1] as MessageNode;
    expect(msg.text).toBe("1 repo needs manual stash resolution:");

    expect(nodes[2]).toEqual({ kind: "gap" });
    const section = nodes[3] as SectionNode;
    expect(section.header.plain).toBe("api");
    expect(section.items[0]?.plain).toBe("Rebase succeeded, but stash pop conflicted.");
    expect(section.items[1]?.plain).toBe("Resolve the conflict markers, then:");
    expect(section.items[2]?.plain).toBe("  cd api");
    expect(section.items[3]?.plain).toBe("  git add <resolved files>");
    expect(section.items[4]?.plain).toBe("  git stash drop         # remove the preserved stash entry");
  });

  test("uses provided verb in description", () => {
    const nodes = buildStashPopFailureReport([{ repo: "web" }], "Pull");
    const section = nodes[3] as SectionNode;
    expect(section.items[0]?.plain).toBe("Pull succeeded, but stash pop conflicted.");
  });

  test("produces gap between multiple repo sections", () => {
    const nodes = buildStashPopFailureReport([{ repo: "api" }, { repo: "web" }], "Merge");
    const kinds = nodes.map((n) => n.kind);
    expect(kinds).toEqual(["gap", "message", "gap", "section", "gap", "section"]);
  });
});
