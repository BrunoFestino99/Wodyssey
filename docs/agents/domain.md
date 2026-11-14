# Domain docs

## Layout and reading rules

This repository uses a single-context layout:

- `GLOSSARY.md`: domain vocabulary at the repository root.
- `docs/adr/`: architectural decision records.

Before exploring the codebase, read the glossary and any ADRs
relevant to the area being investigated.

If these files do not exist, proceed silently. Domain-modeling
creates them when terms or decisions are resolved.

## Vocabulary and decisions

Use the glossary's terms in issues, proposals, code, and tests.
If a needed concept is missing, identify the gap for domain-modeling.

Explicitly flag proposals that conflict with an existing ADR,
identifying the ADR and explaining why it should be reconsidered.
