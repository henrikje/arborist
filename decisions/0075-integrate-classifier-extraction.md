# Integrate Classifier Extraction

Date: 2026-03-13

## Context

`sync/integrate.ts` had grown into a mixed file containing orchestration, plan rendering, conflict enrichment, config updates, and the full classification tree for integrate/retarget behavior. The classification portion had several distinct phases: baseline repo classification, merged-new-work recovery, explicit retarget handling, and auto-retarget handling. The architectural review recommended separating that decision tree so the orchestration file could stay focused and the classification logic could be tested directly.

## Options

### Keep all integrate logic in one file
Continue treating `integrate.ts` as the single home for orchestration, classification, and rendering.
- **Pros:** Everything remains in one place.
- **Cons:** The file stays broad and harder to reason about. Classification tests remain coupled to orchestration concerns.

### Extract only tiny helper functions but keep the main classifier local
Split off a few branches into helpers while leaving the main assessment function inside `integrate.ts`.
- **Pros:** Smaller diff than a full extraction.
- **Cons:** The orchestration file still owns the core decision tree and remains the default dumping ground for future classification branches.

### Move classification into a dedicated module
Extract the integrate classifier into `classify-integrate.ts`, keeping orchestration/reporting in `integrate.ts` and splitting the decision tree into named phases.
- **Pros:** Cleaner separation of concerns. Direct classifier tests become possible. Future retarget logic has a clear home.
- **Cons:** Introduces one more sync module and an explicit dependency boundary.

## Decision

Move integrate classification into `sync/classify-integrate.ts`. The extracted module owns baseline classification plus the merged-new-work, explicit-retarget, and auto-retarget phases, while `integrate.ts` keeps orchestration, execution, config updates, and rendering.

## Reasoning

This separation matches Arborist's "do one thing and do it well" guideline. The orchestration path should answer "how does this command run?", while the classifier should answer "what kind of repo state is this?" Keeping those questions in one file made both harder to follow.

The extraction also improves testability in a way that matters for safety. Retarget and merged-base logic are easy to break accidentally because they combine git facts, heuristics, and policy. Testing the classifier directly gives a narrower, more reliable way to validate those branches than exercising them only through the orchestration layer.

## Consequences

New integrate classification rules should be added in `classify-integrate.ts`, not back in `integrate.ts`. Tests that validate classification behavior can target the extracted module directly, while orchestration tests can stay focused on rendering, summaries, and config side effects. If another sync command develops a similarly deep decision tree, the same split pattern should be considered.
