# Domain modeling

Adapted from Matt Pocock's domain-modeling skill (MIT); see NOTICE.md.

## Before the first wave

For each relevant repository, [select the vocabulary file](GLOSSARY-FORMAT.md#select-the-vocabulary-file)
and read it if present. Follow repository instructions and the existing domain map.
Use project-specific terms. General programming concepts do not need glossary entries.

## During the grill

- Quote the existing definition when someone uses a term differently. Ask which meaning the project intends.
- Sharpen fuzzy or overloaded words. Agree on one term per concept, split distinct concepts, and put rejected synonyms under `_Avoid_`.
- Stress-test each new term with one concrete boundary scenario. Ask whether the term still applies and use the answer to refine its definition.
- When code is available, cross-check stated behavior against it. If they disagree, cite `file:line`, describe the discrepancy and ask which behavior the plan should target.
- Put unresolved term questions in the next eligible grill wave. Keep the total at four questions or fewer and preserve the outcome and Definition of Done gate.

## Carry decisions into the plan

The grill writes no files. For a repository change, turn resolved terms into a plan task
that updates the selected vocabulary file in its existing format.

Once per repository: when the plan changes a repository with no `GLOSSARY.md`,
no `CONTEXT.md` and no domain map named by its instructions, add one task to create
a root `GLOSSARY.md`. Include the resolved terms. If there are none, specify only
the title, a one-sentence context line and an empty `## Language` section.
Later plans add terms only when they resolve them.

For a plan that changes no repository, record `Domain language: <terms|none>`
in the plan only. Replace the placeholder with the resolved terms or `none`.

Offer an ADR only when the decision is hard to reverse, surprising without context,
and the result of a real trade-off. Apply [When to offer an ADR](ADR-FORMAT.md#when-to-offer-an-adr).
If the offer is accepted, add a plan task to write the ADR in the shared format.
