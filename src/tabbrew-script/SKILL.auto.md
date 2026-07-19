---
name: tabbrew-auto
description: Watch a user's Chrome tabs through the tabbrew CLI bridge and propose TabBrew Scripts continuously — a background loop of `tabbrew tabs watch` → decide → `tabbrew tabs suggest --note`, where each proposal carries a one-line plain-language note and the user accepts or denies it in the TabBrew sidepanel. Use when the user asks to auto-organize / keep watching / babysit their tabs, or says "auto mode". For a single one-off request, use the tabbrew-tabs skill instead.
---

# TabBrew auto mode — watch, propose, listen

You are running a **long-lived loop** that watches someone's browser and offers to
tidy it. You never touch their tabs directly: you put a proposal on their screen and
they press **Accept** or **Deny**.

That shape is the whole point, and it sets the tone for everything below:

- **You are a guest in their browser.** Suggesting nothing is a perfectly good tick.
  A loop that proposes something every minute gets muted within ten minutes.
- **Every proposal must explain itself in one sentence** (`--note`), in the user's own
  language. That sentence is the only thing most people read before deciding.
- **Deny is information, not failure.** When they say no — especially with a reason —
  that is the most valuable thing you will get all session. Never re-propose it.

## Before the loop

Two things must be true. Check them once, up front:

1. **The bridge is running.** `tabbrew tabs serve` binds 127.0.0.1 and blocks, so it
   needs its own shell — start it in the background, never in the foreground of the
   turn you still have work to do in.
2. **Auto mode is on in the extension.** The user opens the TabBrew sidepanel →
   **Manage Tabs** → **Send to Claude Code**, and flips the **Auto mode** switch. That
   is what makes the extension stream tab changes to the bridge.

If `tabbrew tabs watch` errors with "nothing is listening", it's (1). If it keeps
timing out while the user says they're browsing, it's (2) — the panel may also simply
be closed, which pauses everything. Say which one is missing; don't guess in silence.

Catch up on what happened before you started with:

```
tabbrew tabs history --limit 20
```

## The loop

### 1. Wait for something to happen

```
tabbrew tabs watch --timeout 60
```

Blocks until the tabs actually change, then prints what moved plus the full snapshot
(`# Goal / # Cross-window / # Windows / # Groups / # Tabs` — the format under
§Snapshot input). **No output means nothing changed** — loop again, don't fill the
silence with a suggestion.

Once you already hold the full state in context, `--changes-only` is the cheap tick:
it prints just the diff. Re-read the full snapshot when the diff gets large or you've
lost track of ids.

### 2. Decide whether anything is worth doing

**The default is to do nothing.** Propose only when you can name a concrete, obvious
win — and when you'd be comfortable saying it out loud to the user:

- exact-duplicate tabs (same URL, more than one)
- ≥3 loose tabs that clearly belong to one topic or site, with no group
- a tab sitting in a group it plainly doesn't belong to
- tabs that have been open and untouched for days while the user is clearly working
  on something else
- `about:blank` / `chrome://newtab` clutter

**Do not** propose because a tick was quiet, because the tab count is high, or
because you can technically construct a script. Tab count is not a problem — 200 open
tabs may be exactly how this person works.

### 3. Write and check the script

Write the ops to a file, then validate before anyone sees it:

```
tabbrew tabs check plan.txt --snapshot ~/.config/tabbrew/tabs.json
```

That reparses the DSL (line-numbered errors, exit 1) and simulates a before/after
against the tab state on disk. Read the preview — if it doesn't say what you meant,
the script is wrong, not the preview.

### 4. Propose it

```
tabbrew tabs suggest plan.txt --note "<one sentence>" --wait 300 --json
```

`--note` is required, and it is the part of this job that needs care:

- **In the user's language.** If they've been writing Thai, write Thai.
- **Lead with anything destructive.** "ปิดแท็บ YouTube 6 อัน แล้วรวม github เป็นกลุ่ม Code",
  not "จัดระเบียบแท็บให้เรียบร้อย".
- **Concrete nouns and numbers**, from their actual tabs: "6 YouTube tabs", "the 4
  Figma files", not "some tabs" or "clutter".
- **No tab ids, no DSL verbs, no jargon.** They are reading a sentence, not a diff.
- **One or two sentences.** If it needs three, the proposal is doing too much — split it.

### 5. Listen to the answer

`--wait` returns the verdict as JSON:

- `accepted` — it ran. Say what changed, briefly, and go back to step 1.
- `denied` — **nothing changed.** Record what you proposed and never propose it again
  this session. If they gave a `reason`, treat it as a standing rule ("อย่าปิด youtube" means
  YouTube tabs are off the table from now on, not just this once).
- `stale` — the tabs moved before it could run. Re-read the state and re-plan; don't
  re-send the same script.
- `null` (no answer) — the user isn't looking at the panel. Leave it alone. Do **not**
  queue another suggestion on top; the bridge holds one at a time and a second push
  silently replaces the first.

**Stop conditions.** Three denials in a row means your read of what they want is
wrong — stop looping and ask them directly what they'd like you to watch for. Also
stop when the user says so, when the bridge goes away, or when you've been told the
session is over.

### 6. Never overstate what happened

The CLI cannot change a single tab. Nothing has moved until a verdict comes back
`accepted`. Don't say "closed 6 tabs" for anything less.

## What this skill does differently from `tabbrew-tabs`

The interactive skill requires you to list every `DEL` target in chat and get an
explicit "yes" before emitting a destructive script. **In auto mode, do not do that.**
The Accept/Deny card *is* the confirmation: the note names what gets closed, the panel
shows the simulated preview, and nothing runs until they press the button. Asking in
chat as well just makes them approve the same thing twice — and they may not even be
looking at the chat.

Everything else about the DSL is the same. `tabbrew tabs prompt --variant full` prints
the complete interactive reference (worked examples, 24 goal→script patterns) if you
need more than the summary below.

## Snapshot input

`tabs watch` prints the sections the extension rendered:

- `# Cross-window: yes|no` — when `no`, never emit `@win=`.
- `# Windows` — JSONL. Keys: `id`, `focused?`, `tabCount`.
- `# Groups` — JSONL or `_(none)_`. Keys: `id` (GROUP_ID), `winId`, `title`, `color?`, `tabCount`.
- `# Tabs` — JSONL. Keys: `id` (TAB_ID), `idx` (window-relative; pinned first), `pinned?`,
  `winId`, `groupId?`, `title`, `url`, `active?`.

Optional fields are **omitted** when false/null — treat absence as no/false.

`tabs watch` also prints a `## Changed since vN` block: `+` opened, `-` closed, `~`
changed (pinned/grouped/moved/navigated).

## Grammar

| Verb      | Shape                                            | Notes                                                              |
| --------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `DEL`     | `DEL <id>+`                                      | Close tabs. Destructive — the note must say so.                    |
| `PIN`     | `PIN <id>+`                                      | Pin tabs.                                                          |
| `UNPIN`   | `UNPIN <id>+`                                    | Unpin tabs.                                                        |
| `UNGROUP` | `UNGROUP <id>+`                                  | Remove tabs from any group they're in.                             |
| `GROUP`   | `GROUP <id>+ "<name>"` _or_ `GROUP <id>+ @<gid>` | Quoted name = create new group; `@<gid>` = add to existing group.  |
| `MOVE`    | `MOVE <id> <index> [@win=<wid>]`                 | One tab per line. `-1` appends. `@win=` only when cross-window=yes.|

One verb per line. `#` lines are comments. Group names use straight ASCII quotes.

## Critical rules

1. **Only emit ids that exist in the current snapshot.** In a loop, ids go stale fast —
   a tab you saw two minutes ago may be gone. Always plan against the newest state
   `tabs watch` gave you, and re-read rather than trusting memory.

2. **Phase order.** The executor runs `DEL → UNPIN → UNGROUP → GROUP → PIN → MOVE`
   regardless of the order in your script. `MOVE <id> <index>` indices must reflect the
   strip *after* the earlier phases have applied.

3. **Reuse existing groups.** If a row in `# Groups` already has the title and `winId`
   you want, emit `GROUP <ids>+ @<gid>`. Only use a quoted name when nothing matches —
   otherwise you create a second group with the same title.

4. **`GROUP @<gid>` requires same-window tabs.** A Chrome group lives in one window, and
   GROUP runs before MOVE, so you cannot pre-move tabs into another window's group in
   one script. Create a new group in their current window instead.

5. **Cross-window honored strictly.** When `Cross-window: no`, never emit `@win=`.

6. **Same-name `GROUP` lines coalesce** at execution time, so keep distinct buckets on
   separate lines for readability.

7. **Be conservative.** Do the minimum. The user did not ask for this — every op you add
   beyond the obvious win is a reason to press Deny.

8. **One proposal at a time.** The bridge holds a single pending suggestion. Wait for
   the verdict before sending another.

## Worked example

`tabbrew tabs watch --timeout 60` prints:

```
version 47 · 34 tabs · just now

## Changed since v44 · +3 opened
  + Slow Loris - Wikipedia  en.wikipedia.org/wiki/Slow_loris
  + Slow Loris - Wikipedia  en.wikipedia.org/wiki/Slow_loris
  + colevels/tabbrew PR #412  github.com/colevels/tabbrew/pull/412
```

Two identical Wikipedia tabs — a real, boring, obvious win. The third tab is new work;
leave it alone.

```
$ cat > /tmp/plan.txt <<'EOF'
DEL 8821
EOF
$ tabbrew tabs check /tmp/plan.txt --snapshot ~/.config/tabbrew/tabs.json
$ tabbrew tabs suggest /tmp/plan.txt \
    --note "เปิดหน้า Wikipedia 'Slow Loris' ซ้ำกัน 2 แท็บ — ปิดอันที่ซ้ำให้ 1 แท็บ" \
    --wait 300 --json
```

```json
{ "ok": true, "id": "s_4f3a", "decision": "denied",
  "reason": "อันนึงเปิดไว้เทียบกับอีกแท็บ" }
```

Good outcome. You learned that duplicate-looking tabs may be deliberate for this user,
so duplicates alone stop being a trigger — and you go back to waiting without saying a
word about having "tried" to help.
