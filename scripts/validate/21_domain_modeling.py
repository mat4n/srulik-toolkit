# Domain modeling: shared vocabulary and ADR formats, the create-plan reference,
# its mandatory grill link, to-project consumers, attribution and portability.
import re

references = skill_root / "create-plan" / "references"
for name in ["GLOSSARY-FORMAT.md", "ADR-FORMAT.md"]:
    copies = sorted(path.relative_to(root).as_posix() for path in skill_root.rglob(name))
    if copies != [(references / name).relative_to(root).as_posix()]:
        raise SystemExit(f"{name} must ship exactly once at create-plan/references: {copies}")
for stale in ["to-project/GLOSSARY-FORMAT.md", "to-project/ADR-FORMAT.md", "to-project/CONTEXT-FORMAT.md"]:
    if (skill_root / stale).exists():
        raise SystemExit(f"stale format file must be removed: {stale}")
domain_path = references / "domain-modeling.md"
if not domain_path.is_file():
    raise SystemExit("missing create-plan reference: create-plan/references/domain-modeling.md")

for relative in ["to-project/SKILL.md", "to-project/templates.md", "to-project/EXTEND.md", "to-project/base-skills/capture-to-project/SKILL.md", "tdd/SKILL.md"]:
    text = (skill_root / relative).read_text(encoding="utf-8")
    if "GLOSSARY.md" not in text or "CONTEXT-FORMAT.md" in text:
        raise SystemExit(f"stale glossary routing: {relative}")
for relative in ["create-plan/references/GLOSSARY-FORMAT.md", "create-plan/references/domain-modeling.md", "to-project/EXTEND.md", "to-project/base-skills/capture-to-project/SKILL.md", "tdd/SKILL.md"]:
    if "CONTEXT.md" not in (skill_root / relative).read_text(encoding="utf-8"):
        raise SystemExit(f"missing legacy context compatibility: {relative}")

mandatory = "Apply [domain-modeling.md](domain-modeling.md) to every grill: check terms against the selected vocabulary file and turn resolved terms and accepted ADRs into plan tasks."
grilling_doc = (references / "grilling.md").read_text(encoding="utf-8")
invariant = grilling_doc.split("\n## Minimum grill invariant\n", 1)[-1].split("\n## ", 1)[0]
if grilling_doc.count("\n## Minimum grill invariant\n") != 1 or grilling_doc.count(mandatory) != 1 or invariant.splitlines().count(mandatory) != 1:
    raise SystemExit("create-plan/references/grilling.md: domain-modeling line must occur once in Minimum grill invariant")

for relative in ["to-project/SKILL.md", "to-project/EXTEND.md"]:
    text = (skill_root / relative).read_text(encoding="utf-8")
    for name in ["GLOSSARY-FORMAT.md", "ADR-FORMAT.md"]:
        shared = "../create-plan/references/" + name
        if text.count(name) < 1 or text.count(name) != text.count(shared):
            raise SystemExit(f"{relative}: every {name} mention must target {shared}")
        if f"]({shared}" not in text:
            raise SystemExit(f"{relative}: missing clickable link to {shared}")


def heading_slugs(text):
    return {re.sub(r"[^a-z0-9 -]", "", line.lstrip("#").strip().lower()).replace(" ", "-") for line in text.splitlines() if line.startswith("#")}


domain_text = domain_path.read_text(encoding="utf-8")
domain_links = re.findall(r"\]\(([^)\s#]+\.md)#([^)\s]+)\)", domain_text)
if sorted(domain_links) != [("ADR-FORMAT.md", "when-to-offer-an-adr"), ("GLOSSARY-FORMAT.md", "select-the-vocabulary-file")]:
    raise SystemExit(f"create-plan/references/domain-modeling.md: unexpected format links {domain_links}")
for target, fragment in domain_links:
    if fragment not in heading_slugs((references / target).read_text(encoding="utf-8")):
        raise SystemExit(f"create-plan/references/domain-modeling.md: broken fragment {target}#{fragment}")

glossary_prose = " ".join((references / "GLOSSARY-FORMAT.md").read_text(encoding="utf-8").split())
for phrase in ["created lazily when the first domain term is resolved", "a create-plan plan that changes a repository with no vocabulary file", "empty `## Language`"]:
    if phrase not in glossary_prose:
        raise SystemExit(f"create-plan/references/GLOSSARY-FORMAT.md is missing: {phrase}")
domain_prose = " ".join(domain_text.split())
for phrase in [
    "Domain language: <terms|none>",
    "empty `## Language`",
    "Quote the existing definition when someone uses a term differently",
    "Sharpen fuzzy or overloaded words",
    "put rejected synonyms under `_Avoid_`",
    "Stress-test each new term with one concrete boundary scenario",
    "cross-check stated behavior against it. If they disagree, cite `file:line`",
    "Keep the total at four questions or fewer and preserve the outcome and Definition of Done gate",
    "The grill writes no files.",
    "add one task to create a root `GLOSSARY.md`",
    "in the plan only",
    "hard to reverse, surprising without context, and the result of a real trade-off",
    "If the offer is accepted, add a plan task to write the ADR",
]:
    if phrase not in domain_prose:
        raise SystemExit(f"create-plan/references/domain-modeling.md is missing: {phrase}")
if "once per repository" not in domain_prose.lower():
    raise SystemExit("create-plan/references/domain-modeling.md is missing: once per repository")
for relative in ["domain-modeling.md", "grilling.md", "GLOSSARY-FORMAT.md", "ADR-FORMAT.md"]:
    if "update glossary.md inline" in (references / relative).read_text(encoding="utf-8").lower():
        raise SystemExit(f"create-plan/references/{relative}: upstream inline glossary writes are not allowed")
    if relative == "grilling.md":
        continue
    text = (references / relative).read_text(encoding="utf-8")
    for token in ["Codex", "Claude", "T3 Code", "delegate_task", "clientRequestId", "<proposed_plan>", "aa-models"]:
        if token in text:
            raise SystemExit(f"host-specific instruction in create-plan/references/{relative}: {token}")

pinned = "https://github.com/mattpocock/skills/tree/d80fa0f4ebe0c5714af0adf8670336065233ecc6/skills/engineering/domain-modeling"
credit = [paragraph for paragraph in (root / "NOTICE.md").read_text(encoding="utf-8").split("\n\n") if pinned in paragraph]
if len(credit) != 1 or not all(part in credit[0] for part in ["MIT", "GLOSSARY-FORMAT.md", "ADR-FORMAT.md", "Copyright (c) 2026 Matt Pocock"]):
    raise SystemExit("NOTICE.md must credit the pinned domain-modeling source, MIT, both formats and the copyright in one paragraph")
print("Domain modeling contract passed")
