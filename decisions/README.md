# Decision Records

This directory contains records of significant design and product decisions made during Arborist's development. Each file captures the context, options considered, chosen approach, and reasoning — preserving the "why" that would otherwise be lost after implementation.

## Template

```markdown
# [Short Descriptive Title]

Date: YYYY-MM-DD

## Context

[The situation, problem, or question. 3-8 sentences. Enough background
that someone unfamiliar with the feature can understand the forces.]

## Options

### [Option Name]
[What this entails. 1-3 sentences.]
- **Pros:** ...
- **Cons:** ...

### [Option Name]
...

## Decision

[Which option was chosen. 1-2 clear sentences.]

## Reasoning

[Why this option over the others. Reference GUIDELINES.md principles
where relevant. 1-3 paragraphs.]

## Consequences

[What follows. What becomes easier, harder, or ruled out.
What assumptions could trigger revisiting. 2-5 sentences.]
```

## When to write a decision record

- Multiple meaningful options were considered (not just "implement this feature")
- The decision could plausibly be questioned or revisited later
- A feature was rejected (no code to find later — the reasoning exists only in the record)
- A GUIDELINES.md principle was applied in a non-obvious way

## When not to write one

- Straightforward implementation with no contested alternatives
- Reasoning is obvious from the commit message
- It's a high-level principle (put it in GUIDELINES.md instead)
- It's an operational task (docs cleanup, README edits)

## Workflow

1. Create a Claude plan as usual (implementation-focused)
2. Implement the feature
3. If the plan involved a significant decision, distill a `decisions/NNNN-slug.md` from the plan — stripping implementation details, keeping only context, options, decision, reasoning, consequences
4. If the decision reveals a new enduring principle, add it to GUIDELINES.md and reference it from the decision record
