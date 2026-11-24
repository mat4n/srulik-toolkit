# Manual exercise: create-plan domain modeling

Plugin under test: HEAD `8b0b9de4081d36ddfff17f517971bb6bdcacf14d` (1.31.0). The installed 1.30.0 plugin was disabled.

## Fixture

A fresh `mktemp -d` directory outside every worktree. It has one committed file and no vocabulary file, domain map or agent instructions:

```py
def can_invoice(account):
    return account.kind == "billing"
```

`git status --porcelain --untracked-files=all` was empty before the run.

## Command

```sh
W=<worktree>
prompt='Use srulik-toolkit:create-plan in autonomous mode. Plan a change that lets support staff put an account on hold. Our support team calls both the customer organization and the individual sign-in an "account." Every account can currently receive invoices. We need to decide which account the hold follows when someone belongs to two organizations. Return the plan without implementing it.'
claude -p --settings '{"enabledPlugins":{"srulik-toolkit@srulik-toolkit":false}}' \
  --plugin-dir "$W/plugins/srulik-toolkit" "$prompt" --add-dir "$W/plugins/srulik-toolkit" \
  --verbose --output-format stream-json > "$transcript"
```

**Invocation fix.** The first run used the plan's command as written, without `--add-dir`. Headless permissions refused to let it read the worktree's reference files (`Claude requested permissions to read from …/create-plan/references/autonomous.md`), so that run was invalid and was discarded. Adding `--add-dir` before the prompt also failed: the flag is variadic and consumed the prompt (`Input must be provided…`). The valid run, shown above, puts `--add-dir` after the prompt. Each attempt used a fresh fixture. No skill file was changed.

## Read proof

```json
"name":"Read","input":{"file_path":"<worktree>/plugins/srulik-toolkit/skills/create-plan/references/domain-modeling.md"}
```

The result starts `1\t# Domain modeling\n2\t\n3\tAdapted from Matt Pocock's domain-modeling skill (MIT); see NOTICE.md`. Before that, the run also read the file with `cat domain-modeling.md …`.

## Excerpts (autonomous grill and final plan)

**Organization vs. sign-in split.** Grill wave 2, question 3:

> **Vocabulary.** The plan adds a root GLOSSARY.md that splits the two meanings of "account". Which terms? (a) **Organization** (the customer entity that is invoiced and can be held) and **Sign-in** (the individual's login, which belongs to one or more Organizations); "account" goes under _Avoid_. …

**Hold scenario with two organizations.** Grill wave 1, question 3:

> Which account the hold attaches to. A person signs in once and belongs to two organizations, Org A and Org B. Support puts "the account" on hold for a matter concerning Org A. Options: (a) the hold attaches to the organization (Org A); it never follows the person, so Org B keeps invoicing normally; (b) the hold attaches to the sign-in (the person), so it follows them into both orgs; (c) both kinds can be held separately, and support picks which one.

**Citation of `accounts.py:2` and the invoicing question.** Grill wave 1, question 4:

> Code vs. request discrepancy. The request says "every account can currently receive invoices," but accounts.py:2 only allows invoicing when account.kind == "billing". Which should the plan target? (a) the code is correct … (b) the request is correct … (c) …

The final plan repeats it:

> **Mismatch:** your message says every account can currently receive invoices, but `accounts.py:2` only allows accounts whose kind is `"billing"`. The plan keeps the code's behavior, adds the hold as one more condition, and flags the mismatch in the glossary.

**One task creates the glossary.** The final plan has T1 for the test, T2 for the hold and T3:

> ### T3: add the glossary (R6, no dependency)
> - [ ] Create `GLOSSARY.md` in the repo's glossary format.
>   - `**Organization**: A customer company that one or more Sign-ins belong to.` Words to avoid: account, customer account.
>   - `**Sign-in**: One person's login.` Words to avoid: account, user, member.
>   - `**Hold**: A stop on invoicing one Organization or Sign-in, lasting until cleared.`

The scope section lists `GLOSSARY.md` as a new file. Tasks run from the repo root.

## After the run

`git status --porcelain --untracked-files=all` was empty, so the grill wrote no files. Answers marked autonomous came from a stand-in subagent. One reviewed session cannot measure comparative quality; that evaluation was waived.
