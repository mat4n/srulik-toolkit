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

# show-me: HTML goes to the host's hosted page when one exists; the Claude Code mapping lives in a reference.
for token in [
    "When a host reference documents a host-native private, shareable hosted page",
    "when you revise a visual you already published in this conversation, update that page",
    "Do not publish when the user asked for the file itself",
    "say it is untested, and publish only after the user confirms",
    "Otherwise, or when publishing fails, open the file",
    "Host references: [references/claude-code.md](references/claude-code.md)",
]:
    if token not in show_me:
        raise SystemExit(f"show-me is missing: {token}")
if "`Artifact`" in show_me or "artifact-design" in show_me:
    raise SystemExit("show-me core must stay host-neutral: name the hosted page, not the tool")
show_me_claude = skill_root / "show-me" / "references" / "claude-code.md"
if not show_me_claude.is_file():
    raise SystemExit("show-me is missing references/claude-code.md")
show_me_claude_text = show_me_claude.read_text(encoding="utf-8")
for token in [
    "`Artifact`",
    "`artifact-design`",
    "same `file_path`",
    "leave out the Mermaid script import",
    "Without that tool, or when a publish is refused, use the core fallback",
    "When the system prompt lists no scratchpad, use the core fallback",
    "skip `quickstart` and the Artifact types",
    "When the caller forbids remote resources, also skip web fonts and CDN scripts",
    "do not also open the local file",
    "Never publish a page that imitates",
    "Observed with Claude Code",
]:
    if token not in show_me_claude_text:
        raise SystemExit(f"show-me Claude Code reference is missing: {token}")
