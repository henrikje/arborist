import { describe, expect, test } from "bun:test";
import { toJSONSchema, z } from "zod";
import {
  BranchJsonOutputSchema,
  ListJsonEntrySchema,
  LogJsonOutputSchema,
  RepoListJsonEntrySchema,
  StatusJsonOutputSchema,
} from "./json-types";

/** Assert that a generated JSON schema has the expected top-level shape. */
function expectSchema(schema: unknown, expected: { type: string; required?: string[]; itemsRequired?: string[] }) {
  const s = schema as Record<string, unknown>;
  expect(s.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  expect(s.type).toBe(expected.type);
  if (expected.required) {
    expect(s.required).toEqual(expected.required);
  }
  if (expected.itemsRequired) {
    const items = s.items as Record<string, unknown> | undefined;
    expect(items?.required).toEqual(expected.itemsRequired);
  }
}

describe("json-schema stability", () => {
  test("StatusJsonOutputSchema", () => {
    const schema = toJSONSchema(StatusJsonOutputSchema, { target: "draft-2020-12" });
    expectSchema(schema, {
      type: "object",
      required: [
        "workspace",
        "branch",
        "base",
        "repos",
        "total",
        "atRiskCount",
        "baseConflictCount",
        "pullConflictCount",
        "outdatedOnlyCount",
        "statusCounts",
        "lastCommit",
      ],
    });
  });

  test("LogJsonOutputSchema", () => {
    const schema = toJSONSchema(LogJsonOutputSchema, { target: "draft-2020-12" });
    expectSchema(schema, {
      type: "object",
      required: ["workspace", "branch", "base", "repos", "totalCommits"],
    });
  });

  test("BranchJsonOutputSchema", () => {
    const schema = toJSONSchema(BranchJsonOutputSchema, { target: "draft-2020-12" });
    expectSchema(schema, {
      type: "object",
      required: ["branch", "base", "repos"],
    });
  });

  test("ListJsonEntrySchema (array)", () => {
    const schema = toJSONSchema(z.array(ListJsonEntrySchema), { target: "draft-2020-12" });
    expectSchema(schema, {
      type: "array",
      itemsRequired: ["workspace", "active", "branch", "base", "repoCount", "status"],
    });
  });

  test("RepoListJsonEntrySchema (array)", () => {
    const schema = toJSONSchema(z.array(RepoListJsonEntrySchema), { target: "draft-2020-12" });
    expectSchema(schema, {
      type: "array",
      itemsRequired: ["name", "url", "share", "base"],
    });
  });
});
