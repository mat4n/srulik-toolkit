# show-me: Mermaid is the default for relationships, with one example per taught diagram type.
show_me = (skill_root / "show-me" / "SKILL.md").read_text(encoding="utf-8")
for token in [
    "Use Mermaid by default for relationships",
    "Keep text trees, pseudocode, and diffs for code shape and changes",
    "about 12 nodes",
    "```mermaid\nflowchart",
    "```mermaid\nstateDiagram-v2",
    "```mermaid\nsequenceDiagram",
    "```mermaid\ntimeline",
    "```mermaid\ngitGraph",
    "```mermaid\nerDiagram",
    '<pre class="mermaid">',
    "mermaid@12.3.0/dist/mermaid.esm.min.mjs",
]:
    if token not in show_me:
        raise SystemExit(f"show-me is missing: {token}")
for token in [
    "escape `<` as `&lt;`",
    "forbids remote resources, draw the diagram as inline SVG",
    "the host's viewer or the OS opener",
]:
    if token not in show_me:
        raise SystemExit(f"show-me is missing: {token}")
# Generic core: no harness tool calls or host names.
for token in ["Bash(", "Claude", "Codex", "Cursor", "T3"]:
    if token in show_me:
        raise SystemExit(f"show-me core must stay host-neutral: {token}")
