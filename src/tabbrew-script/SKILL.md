---
name: tabbrew-tabs
description: Read someone's open Chrome tabs through the tabbrew CLI and propose a TabBrew Script they accept or deny in the TabBrew sidepanel — `tabbrew tabs list` → decide → `tabbrew tabs suggest --note`. Use for a one-off request ("tidy my tabs", "close the duplicates", "จัดแท็บให้หน่อย") and for a standing watch (`/loop`, "keep an eye on my tabs", "เฝ้าแท็บให้หน่อย"), which is the same three steps repeated.
---

# TabBrew — read the tabs, propose a change

You cannot touch anyone's tabs. You put a proposal on their screen with a
one-sentence explanation, and they press **Accept** or **Deny**. Everything below
follows from that:

- **You are a guest in their browser.** Proposing nothing is a perfectly good
  outcome. Something every few minutes gets you muted within the hour.
- **The note is the product.** One plain sentence, in their language, is all most
  people read before deciding.
- **Deny is information, not failure.** A "no" — especially with a reason — is the
  most valuable thing you will get all session. Never re-propose it.

## One turn is one pass

Read → decide → maybe suggest → say what you did in a line or two, then **stop**.

Do not write a `while` loop, do not `sleep`, do not poll in the background, and do
not re-invoke yourself. When this runs under `/loop`, the loop owns the pacing and
will call you again; a loop inside a loop just burns tokens and makes the user's
terminal unreadable.

## Preconditions

Two things have to be true, and `tabs list` tells you which one is missing:

1. **The bridge is running.** `tabbrew tabs serve` binds 127.0.0.1 and blocks, so
   it needs its own shell — start it in the background, never in the foreground of
   a turn you still have work to finish.
2. **The extension is sending.** The user opens the TabBrew sidepanel, clicks
   **Connect to TabBrew CLI**, and leaves that screen up. There is no toggle: the
   screen itself is the switch, streaming while it shows and stopping when they
   navigate away.

`tabs list` saying *"No tabs exported yet"* is (1), or a panel that was never
opened. A **stale** warning means the extension has stopped sending — the panel is
probably closed, or they moved off that screen. Say which one it is; don't guess
in silence.

## 1. Read the tabs

```
tabbrew tabs list
```

It prints a header (tab count, windows, version `v<n>`, how long ago), then any
recent suggestions and what became of them, then the snapshot:

```
# Cross-window: no
# Windows
{"id":1,"focused":true,"tabCount":187}
# Groups
{"id":42,"winId":1,"title":"Code","color":"blue","tabCount":9}
# Tabs
{"id":901,"idx":0,"pinned":true,"winId":1,"title":"Gmail","url":"https://mail.google.com/"}
```

- `# Tabs` — one JSON object per line. `id` is the TAB_ID you write ops against,
  `idx` is the window-relative index (pinned tabs first), `groupId`
  cross-references `# Groups`.
- **Absent means false.** `pinned`, `active`, `focused` and `groupId` are omitted
  rather than set to `false`/`null`. No `groupId` means the tab is ungrouped.
- `# Cross-window: no` means every id belongs to one window and you must not emit
  `@win=`.

**Stop here if any of these are true:**

- The version `v<n>` hasn't moved since your last pass and you already decided
  there was nothing to do.
- The newest entry under *recent suggestions* is `PENDING` — they haven't answered
  yet. Piling a second proposal on the first is how you get switched off.
- The snapshot is stale. Say so once; don't propose against tab ids that have
  probably changed.

`UNANSWERED` is **not** `PENDING`. It means the suggestion has been sitting there
long enough that they are plainly not looking at the panel — so it is not a reason
to keep waiting, and you may propose again when there's a reason to. Read it as a
hint about them rather than about the idea: someone who never saw the card hasn't
rejected anything, but they also aren't at their desk, so keep the next proposal
worth interrupting for.

## 2. Decide whether anything is worth doing

**The default is to do nothing.** Propose only when you can name a concrete,
obvious win that you'd be comfortable saying out loud:

- exact-duplicate tabs (same URL, more than one)
- ≥3 loose tabs that clearly belong to one topic or site, with no group
- a tab sitting in a group it plainly doesn't belong to
- `about:blank` / `chrome://newtab` clutter

**Do not** propose because a pass was quiet, because the tab count is high, or
because you can technically construct a script. **Tab count is not a problem** —
200 open tabs may be exactly how this person works.

Check the recent-suggestions list before committing to an idea. If they denied
something like it, that denial is a standing rule.

## 3. Write the script

One verb per line. `#` starts a comment; blank lines are ignored.

| Verb | Shape | Notes |
| --- | --- | --- |
| `DEL` | `DEL <id>+` | Close tabs. Destructive — the note must lead with it. |
| `PIN` | `PIN <id>+` | Pin tabs. |
| `UNPIN` | `UNPIN <id>+` | Unpin tabs. |
| `UNGROUP` | `UNGROUP <id>+` | Remove tabs from whatever group they're in. |
| `GROUP` | `GROUP <id>+ "<name>"` or `GROUP <id>+ @<gid>` | A quoted name creates a **new** group; `@<gid>` adds to an **existing** one from `# Groups`. |
| `MOVE` | `MOVE <id> <index> [@win=<wid>]` | Move one tab to `<index>`; `-1` appends. One line per tab. `@win=` only when `Cross-window: yes`. |

Group names use straight ASCII quotes. Names containing `"` aren't supported.

Two rules that are easy to get wrong:

1. **Only use ids from the snapshot.** Ids that aren't there can't be mapped, and
   the user gets an error instead of a result. If the goal names something the
   snapshot doesn't contain, say so in your reply instead of guessing.
2. **Compute `MOVE` indices against the post-non-`MOVE` state.** The executor
   batches by phase and always runs
   `DEL → UNPIN → UNGROUP → GROUP → PIN → MOVE`, whatever order you wrote.
   Indices computed against the original snapshot land in the wrong place.

Write the ops to a file:

```
cat > /tmp/plan.txt <<'EOF'
DEL 4471 4472
GROUP 4310 4311 4312 "Code"
EOF
```

## 4. Propose it

```
tabbrew tabs suggest /tmp/plan.txt --note "ปิดแท็บ YouTube 6 อัน แล้วรวม github เป็นกลุ่ม Code"
```

`--note` is required, and it is the whole interface. Four rules:

- **Their language, not yours.** Match the language they've been writing in.
- **Lead with anything destructive.** If tabs get closed, that goes first — never
  buried behind the tidying.
- **Concrete nouns and numbers.** "ปิดแท็บ YouTube 6 อัน", not "clean up some tabs".
- **No tab ids, no DSL, no jargon.** They're looking at their browser, not at your
  script.

If the script doesn't parse, `suggest` prints line-numbered errors and exits 1 —
fix them and run it again. It refuses an empty script for the same reason.

The command returns as soon as the suggestion is queued. **It has not run.** The
extension shows it in the panel with a preview, and nothing changes until the user
presses Accept — so never report tabs as closed, grouped, or moved. The furthest
you may go is "I've put it in the panel."

Do **not** also ask for confirmation in chat before a `DEL`. The Accept/Deny card
*is* the confirmation: the note names what gets closed and the panel shows the
preview. Asking twice makes them approve the same thing twice, and they may not
even be looking at the chat.

## 5. Report, in one or two lines

Then end the turn. A quiet pass is one short sentence — "187 tabs, nothing worth
changing." A proposal is what you proposed and that it's waiting. Long summaries
of a browser the user is looking at are noise.

You won't see their answer this pass. It shows up under *recent suggestions* the
next time you run `tabs list`:

- **ACCEPTED** — it ran. Their tabs have actually moved; re-read before planning
  anything else.
- **DENIED** — with a reason, if they gave one. Treat it as a standing rule and
  never propose that thing again. ("อย่าปิด youtube" means YouTube tabs are off the
  table from now on, not just this once.)
- **STALE** — the tabs changed before it could run, so it never applied. The idea
  may still be good; rebuild it against the current ids.
- **FAILED** — they said yes and Chrome refused. They *wanted* this, so fix the
  script rather than dropping the idea. The tabs are unchanged.
- **UNANSWERED** — nobody ever looked. Not a rejection, not a reason to keep
  waiting. The tabs are unchanged.

Three denials in a row means your read of what they want is wrong. Stop proposing
and ask them directly what they'd like you to watch for.

## Never overstate what happened

The CLI cannot change a single tab. Execution happens in the browser, after a
human presses a button. "I closed 6 tabs" is false, and it destroys the trust the
whole Accept/Deny design exists to protect.
