# Zod as single source of truth for JSON output contracts

Date: 2026-02-28

## Context

Arborist has six commands with `--json` output: `status`, `list`, `log`, `diff`, `repo list`, and `branch`. TypeScript interfaces in `src/lib/json-types.ts` define the contract for five of them (`branch` used an inline literal). A compile-time assignability test exists but there is no runtime validation, no formal JSON Schema, and no way for users to inspect the schema from the CLI.

As the number of JSON-outputting commands grows, the gap between "what the types say" and "what the output actually is" becomes harder to verify. Users integrating with `--json` output have to reverse-engineer the shape from examples.

## Options

### Zod as source of truth

Replace manual TypeScript interfaces with zod schemas. Derive TS types via `z.infer<>`. Use zod v4's built-in `toJSONSchema()` to generate JSON Schema. Add a `--schema` flag to each command.

- **Pros:** Single definition drives types, validation, and schema generation. Runtime validation catches drift. JSON Schema can be inspected from the CLI.
- **Cons:** Adds `zod` as a dependency.

### Manual JSON Schema files

Write JSON Schema files by hand in a `schemas/` directory. Keep TypeScript interfaces as-is.

- **Pros:** No new dependencies. JSON Schema files are version-controllable.
- **Cons:** Three separate artifacts to sync (TS interfaces, JSON Schema, actual output). No runtime validation. Schemas will drift.

### Build-time generation from TypeScript

Use `ts-json-schema-generator` to auto-generate JSON Schema from existing interfaces.

- **Pros:** No manual schema authoring.
- **Cons:** Generator tools are fragile with complex TS types (unions, discriminated unions). No runtime validation. Build step complexity.

## Decision

Use zod as the single source of truth. The `zod` dependency (v4) provides schema definition, type inference, runtime validation in tests, and JSON Schema generation via its built-in `toJSONSchema()` — no additional dependencies needed.

## Reasoning

The "visibility and control" principle requires that the JSON contract be inspectable. A `--schema` flag lets users and tools discover the exact shape without trial and error. Zod v4's built-in JSON Schema support eliminates the need for a second dependency (`zod-to-json-schema`). The migration from manual interfaces is mechanical since the shapes are already well-defined and the inferred types are structurally identical. Runtime validation in tests catches any drift between the schema definition and actual output.

## Consequences

- `zod` is added as a runtime dependency. It is lightweight and widely used.
- All JSON output types are now defined once in `src/lib/json-types.ts` as zod schemas. TypeScript types are derived, not manually maintained.
- Every command with `--json` also supports `--schema` for introspection. `--schema` works without a workspace context.
- Tests use `.parse()` for runtime conformance checks instead of compile-time-only assignability.
- Future commands with `--json` output must define a zod schema in `json-types.ts` and wire up `--schema`.
