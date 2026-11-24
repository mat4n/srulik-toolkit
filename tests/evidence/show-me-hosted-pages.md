# show-me hosted pages evidence

Status: authored and validated; exercised live on Claude Code (desktop app and
CLI). The no-hosted-page path on Codex was not exercised: the installed Codex
CLI could not start a run (see Gaps).

## Change

- `show-me/SKILL.md`: when the host offers a private, shareable hosted page,
  publish the HTML there, update the page already published on the same topic
  in this conversation, and give the link. Otherwise, or when publishing
  fails, the existing viewer / OS opener / path fallback applies unchanged.
- `show-me/references/claude-code.md` (new): maps the hosted page to the
  `Artifact` tool, `artifact-design`, update by same `file_path`, native
  Mermaid rendering (no script import), and privacy limits.
- `tour/SKILL.md`: uses show-me's hosted-page link when there is one; keeps
  its temporary-path rule otherwise.
- Version `1.31.1` -> `1.32.0`.

## Source and checks

- Base: `fe657b3` (`origin/main`).
- `./scripts/validate.sh` and `git diff --check`: passed on macOS.
- New contract lines in `scripts/validate/20_show_me.py` and
  `scripts/validate/5_stop_hook_files.py`. Before the skill edits, the new
  checks failed (red). Eleven deliberate mutations were each rejected:
  dropped the hosted-page rule, dropped the same-topic update rule, dropped
  the fallback phrase, put the `Artifact` tool name in the core, dropped the
  reference link, removed every `artifact-design` mention from the reference,
  dropped the same-`file_path` rule, dropped the observation line, dropped
  the Mermaid-import rule, dropped tour's hosted-page sentence, deleted the
  reference file.

## Live runs

| Run | Host | Prompt | Observed |
| --- | --- | --- | --- |
| A6 | Claude Code, desktop app (Code tab), macOS, 2026-11-24 | Follow show-me for "where show-me's HTML ends up"; focused HTML | Loaded `artifact-design`, wrote the page in the session scratchpad, published a private Artifact and returned its link (version 1). A follow-up edit republished the same `file_path`: same URL, version 2. |
| A7a | Claude Code CLI 2.1.323, headless `claude -p`, macOS, 2026-11-24 | "List whether a tool named Artifact is available; then follow show-me; compare the login screen before and after moving 'Forgot password' under the password field; focused HTML; state the delivery route" | Reported the `Artifact` tool as available, attempted to publish; the headless run had no approval for it, so it opened the local file and reported "the skill's local-open fallback (OS opener), because the Artifact publish wasn't approved". |

During A6 the `artifact-design` contract showed that Artifacts render
`<pre class="mermaid">` natively and must not load a Mermaid library; that
rule was added to the reference and its contract.

## Gaps

- Codex (no hosted page): `codex exec` 0.149.0 refused to run with the
  configured model ("requires a newer version of Codex") and with `gpt-5`
  ("not supported when using Codex with a ChatGPT account"). The core
  fallback sentence is unchanged apart from "or when publishing fails", and
  run A7a exercised that fallback, but a host with no hosted page at all is
  unverified live.
- Claude web app, Cursor, Oh My Pi, T3 Code: unverified.
- No graded baseline benchmark; the change is a delivery rule, not output
  quality.
