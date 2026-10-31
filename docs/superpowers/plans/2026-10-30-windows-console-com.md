# Plan: `sight console` on Windows through Stata Automation (COM)

Status: draft, rev 8. Rev 6 was approved by Sonnet and Terra; the
Phase 0 spike (results at the end) then disproved its central
assumption, and the user set new requirements. Rev 7 redesigned the
plan around those; rev 8 answers the first review of rev 7.

## What changed after the spike

- **Releasing the last COM reference quits that Stata** (S1, S2, S3,
  S8): a Stata launched directly or by COM, one running `sleep`, one
  with data loaded. So a client can't touch a Stata and let it go, and
  the console can't leave its Stata open after it ends without a
  process that keeps the reference.
- **`UtilIsStataFree()` stays false while Stata waits for more
  interactive input**: inside a `foreach` or `program define` until it
  closes, and for the whole of a `mata` session (S5,
  `results/s5-polls.txt`). Completion can't wait for "free" there.
- Confirmed: output streams into a text log during a command and was
  complete at the first free poll (S4, S12); the first poll after a
  fast command can already be free (S9); `DoCommandAsync` takes up to
  8192 bytes (S10); the log is UTF-8 with CRLF and must be read with
  read/write sharing (S11); `window manage maintitle` works on Stata 18
  (S7); a break at idle is harmless (S6); `exit` with changed data is
  refused (S11).

The user's decisions (2026-10-30):

1. **The console's Stata ends with the console**, as console Stata
   does on macOS and Linux when the terminal closes.
2. **If exactly one Stata is already open, the console shares it**
   rather than starting another.
3. **A shared Stata also ends with the console**: the console takes it
   over, says so first, and asks.

## Goal

`sight console` works on Windows with the same front end it has on
macOS and Linux: highlighting, Tab completion, history, colored output,
Ctrl+C. Stata for Windows has no console binary, so the console drives
one Stata GUI instance through Stata's Automation interface
(`stata.StataOLEApp`), with its window visible, so graphs, the Data
Editor and the Variables window work alongside the terminal. That
instance is either a new Stata or the one the user already had open;
either way it belongs to the console from the moment the console
connects, and it quits when the console ends.

Non-goals for v1: keeping Stata open after the console ends; choosing
among several open Stata windows; answering input requests
(`_request()`, `input`, `pause`) from the terminal; piped input.

When the console can't or shouldn't drive Stata (two or more open, the
open one held by another program, the user declining the take-over,
Automation not registered or blocked), the VS Code extension offers to
fall back to send-to-stata, which sends code to the open Stata window
without owning it, for the session or permanently (Phase 5).

Principles used throughout:

- **Ownership is explicit.** The console holds one COM reference for
  its whole life and never takes a reference it doesn't keep, because
  releasing one quits that Stata. Before it connects to a Stata the
  user has open, it says that Stata will close when the console ends
  and asks.
- **After setup, the console sends Stata only what the user entered.**
  No housekeeping commands (no `set linesize` on resize, no log
  recovery, no `exit` at shutdown). This removes any chance of
  injecting a command into a block, Mata, Python, or a context the
  console misjudged, including one entered in the Stata window.
- **When the console isn't sure of Stata's state, it does less.** A
  wrong guess about Stata's mode affects the prompt drawn
  (highlighting, completion) and when a typed-ahead line is released,
  never what is sent. One user-initiated case reads the guess: Ctrl+D
  becomes `exit` only at what the console believes is the top-level
  prompt (`session.ts:217`); Stata decides what to do with it, as for
  any line.

## Background

### Why stata_kernel closed the user's Stata

A Stata the user starts registers its Automation class factory, and
`CreateObject` hands it to the first client that asks (S1, S8; the
docs only say each object starts a new Stata). stata_kernel then hid
it with `UtilShowStata(1)`, and when the kernel let go of its
reference, Stata quit (S2). Hiding explained the vanished window;
releasing explains the closed application.

### Automation API facts (stata.com/automation, plus the spike)

- `DoCommandAsync(cmd)`: queued as if typed in the Command window;
  returns immediately. Up to 8192 bytes; NUL refused (S10).
- `DoCommand(cmd)`: synchronous, returns `rc`; ignores `exit`; 10001
  for `program define` (and possibly loops).
- `UtilIsStataFree()`: true when nothing is running or queued; false
  while Stata waits for block, program or Mata input (S5).
- `UtilSetStataBreak()`: the Break button; harmless at idle (S6).
- `UtilShowStata(n)`: 1 hides, 2 minimizes, other values show.
- `UtilStataErrorCode()`: returns `_rc`; read-only.
- No output API; output comes from a log.
- Registration: `StataMP-64.exe /Register` as administrator, once.
- Releasing the last reference quits Stata (S2, S3).

### Existing Sight pieces

- `src/console/session.ts` (`ConsoleSession`) owns editing, prompt
  detection, echo removal, typeahead display, colors and staged pastes.
  It reaches Stata only through `StataPty` (`write`, `interrupt`,
  `echo_enabled`, `canonical_mode`; `session.ts:251,279-297,337`) and
  receives bytes through `handle_output(text)`.
- `src/console/interactive.ts` wires terminal, PTY and shutdown,
  buffering early output in `pending_output` (`interactive.ts:45`).
- `src/console/index.ts` refuses `win32`; `tests/unit/console/
  setup.test.ts:154` asserts that.
- The VS Code Windows "app" target uses send-to-stata.exe, which pastes
  code into Stata's Command window with the clipboard and keystrokes;
  it has no COM code (`SendToStata.cs`). `docs/send-to-stata.md` said
  "COM automation"; corrected on this branch.

## Design

### Shape

```text
terminal <-> ConsoleSession <-> StataBackend
                                  |-- PtyBackend (macOS/Linux, today's code)
                                  `-- AutomationBackend (Windows)
                                        |-- ComBridge (helper process, JSON lines)
                                        `-- LogTail   (reads Stata's log)
```

### The seam: a backend produces a console-Stata byte stream

The session keeps everything it does today, including echo removal
and the typeahead display decision. A backend's job is to make Stata
look like console Stata in a terminal: it delivers the bytes a PTY
would deliver (prompts, the echo of each line as Stata reads it,
output), and it says whether Stata echoes input.

```ts
export interface StataBackend {
    /**
     * Send one entered line (no newline). `drawn` is the session's
     * own decision: true when it drew the highlighted line itself,
     * false when it left the line for Stata's echo (typeahead).
     */
    submit_line(line: string, drawn: boolean): void;
    /** Answer `--more--` with one key ('' for Enter). */
    answer_more(key: string): void;
    /** Ctrl+C. The backend decides whether Stata needs a break. */
    interrupt(): void;
    resize(columns: number, rows: number): void;
    /** Whether Stata prints its own copy of each line it reads. */
    echoes_input(): boolean;
    /** Longest line in bytes the backend can send, or null. */
    max_line_bytes(): number | null;
}
```

Session changes are mechanical:

- `submit()` uses `backend.echoes_input()` where it now computes
  `stata_echoes || pty.echo_enabled() || !pty.canonical_mode()`, and
  `backend.max_line_bytes()` for the length check and its message.
  Everything else in `submit()` (drawing, `expected_echo`, typeahead
  left for Stata's echo when no prompt) is unchanged. It passes the
  draw decision it already makes (`!(stata_echoes && kind === null)`,
  `session.ts:299`) as `drawn`; `PtyBackend` ignores it.
- `answer_more()` calls `backend.answer_more(reply)`; the `\r` vs no
  `\r` decision moves into `PtyBackend`.
- `interrupt()` calls `backend.interrupt()`; the `^C` redraw stays in
  the session.
- New public `show_notice(text)`: sets the existing one-off `message`
  and redraws the editor, the same path the length-limit message uses.
  For short, transient notes.
- New public `write_sight_text(text)`: for Sight's own lasting lines
  (the log-lost line). Hides the editor, writes the text dimmed without
  the colorizer or echo matching, drops any pending `expected_echo`,
  resets `partial`, and redraws the editor.

**PtyBackend** wraps `StataPty`: `submit_line` writes `line + '\r'`;
`echoes_input()` is today's expression (and `--stata-echoes` becomes
its option); `max_line_bytes()` is 1000 in canonical mode, else null.
`MAX_CANONICAL_LINE_BYTES` moves to the PTY backend module and is
re-exported from `session.ts`.

**Tests.** `session.test.ts` builds sessions around a `FakePty` and
feeds `handle_output()` directly; that stays valid because echo removal
stays in the session. `setup()` wraps the fake as `new PtyBackend(fake,
{ stata_echoes })`; byte assertions (`'display 1\r'`) are unchanged.
The echo tests (`:277-318`) and typeahead test (`:320`) run unchanged
against the PTY backend. `setup.test.ts:154` changes in Phase 3.

**Lifecycle** for `interactive.ts`:

```ts
export interface BackendLifecycle {
    /** End the session; resolves when done or given up. */
    shutdown(reason: 'user' | 'signal' | 'crash', timeout_ms: number): Promise<void>;
    /** Authoritative end: resolves once with the console's exit status. */
    readonly exit_status: Promise<number>;
}
```

Backends are constructed with `{ on_output, on_notice }` callbacks.
`interactive.ts` forwards them to the session, buffering until the
session exists, as `pending_output` does today. `exit_status` resolves
only after the final output has been delivered. `interactive.ts`
prints the closing message ("Stata exited", "Lost the connection to
Stata") after restoring the terminal. PTY shutdown
is today's SIGHUP, 2 s grace, SIGKILL.

### Which Stata the console drives, and connecting

One rule governs this section: **once the console may hold a
reference, no timeout or internal error ends it on its own**, because
ending releases the reference and quits that Stata (S2: even
mid-`sleep`). Until then, failing is free; after, the console waits
and explains, and only the user (Ctrl+C, `exit`), Stata exiting, or the
bridge dying ends it.

**Before any COM call** (failures here touch nothing): read the
registered exe from `HKCR\CLSID\{clsid of
stata.StataOLEApp}\LocalServer32` (missing: print the `/Register`
instructions); create `%TEMP%\sight-console\<token>\` and validate its
8.3 short path (if it still contains `"`, `` ` ``, `'`, `$` or
non-ASCII, stop, naming `SIGHT_CONSOLE_TMPDIR`); start the bridge and
run its self-test (protocol round trip, Language Mode check).

**Connecting**, with Sight's consoles serialized by a named mutex
(`Local\SightConsoleConnect`, held from the first listing until the
title is set in step 6, so a second console sees the first one's
Stata as taken):

1. The bridge lists candidate Stata processes: `Stata*.exe` from a
   Stata install, in the current session, with a main window (so batch
   `/b` jobs and other users' Statas don't count), excluding any owned
   by a running console: one whose PID and start time appear in a `pid`
   file under `%TEMP%\sight-console\*\` whose directory's `owner` (the
   console's own PID and start time) is still running. The `pid` file is
   written in step 4, before the mutex is released, so ownership
   doesn't depend on the title; a crashed console's stale file doesn't
   hide a live Stata.
   - **Two or more:** stop. COM would choose among them, not the user.
     Message: close all but the one to share, or all for a new Stata.
   - **One:** show its window title and ask: "sight console will take
     over the open Stata (<title>). It closes when the console ends, so
     unsaved work in it would be lost then. Continue? [y/N]". `--yes`
     answers yes. No: stop.
   - **None:** COM will start a new Stata.
2. Immediately before `CreateObject`, the bridge lists again (the same
   filter). If the set changed, go back to step 1's decision with the
   new set (asking again if needed). This leaves only the milliseconds
   between this listing and `CreateObject` for an outside change.
3. `CreateObject`. If it hasn't returned after 5 s (a busy shared
   Stata may be slow to answer), show "Waiting for Stata to answer.
   Ctrl+C cancels; if Stata has already answered, that closes it." and
   keep waiting.
4. Work out which Stata answered. The bridge lists twice with the same
   relaxed filter (Stata processes in the session, main window or not,
   minus those in other consoles' `pid` files): once right before
   `CreateObject` (inside `connect`) and once after, and compares the
   two. Steps 1-2's stricter listing only decides what to ask; the
   before/after pair decides what answered. Three results count as
   identified:
   - exactly one new process, carrying COM's launch flag (Phase 0b R2
     records which flag), when none was open: a new Stata, as expected;
   - no new process when exactly the consented one was open: the
     consented Stata, as expected;
   - exactly one new process carrying COM's flag when the consented one
     was open: COM started a new Stata because the open one is held
     elsewhere (outcome below).
   Everything else (a new process without the flag, several new
   processes, no new process when none was open, which means a Stata
   the listing excluded answered) is a Stata nobody consented to,
   never the consented one. When a PID is identified, write
   `<dir>\pid` (PID and start time) now, so other consoles exclude this
   Stata from here on; otherwise step 6 establishes it. Outcomes:
   - **As expected** (the consented Stata, or a COM-started one when
     none was open): continue.
   - **Shared Stata expected, COM started a new one:** the open Stata
     is held by another program (Jupyter's stata_kernel, another
     Automation client). Requirement 2 rules out using a second Stata,
     so the console ends at once, which closes only the new, empty
     Stata: "The open Stata is in use by another program; close that
     program, or that Stata, and try again." (If R1 shows a Start-menu
     Stata can't be claimed at all, this message changes with the
     fallback the user picks.)
   - **A Stata nobody consented to** (one opened in the milliseconds
     after step 2's listing, or one the listing didn't show, claimed
     instead): the console says so and asks, once: here if step 4 has
     its PID, otherwise after step 6's title lookup. It names the
     window and asks: "sight console is now connected to the
     Stata you just opened (<title>). Keep using it here? It closes
     when the console ends. [y/N]". No ends the console, which closes
     that Stata, and the message says to save first if needed; the
     question waits as long as the user likes. This is the one case
     where requirement 3's consent comes after the fact; it needs a
     Stata to be opened within milliseconds of the console's
     `CreateObject`, and the plan accepts it as the residual risk.
5. Wait until Stata is free, by polling `UtilIsStataFree()` (read-only)
   with no timeout. A shared Stata may be running a command, or waiting
   for input in a block or Mata from its own Command window (busy,
   per S5). After 2 s: "Waiting for Stata to finish what it's doing (in
   its window). Ctrl+C ends the console and closes Stata, including
   anything running." Nothing is sent until free.
6. Mark and confirm: `DoCommand(window manage maintitle "Stata - sight
   console <token8>")` (no `capture`, so its `rc` is real), then find
   the PID by that title and check it against step 4. If they differ,
   the title's PID is the truth: the `pid` file is rewritten, and the
   after-the-fact question in step 4 is asked if that Stata wasn't the
   consented one and the question hasn't already been answered for this
   PID (it is asked again only when the identified PID changes). If the title command fails, step 4's PID stands
   (the `pid` file already marks ownership) and exit detection also
   uses RPC errors. Release the mutex.

   If neither step 4 nor the title established a PID, the console has
   no reliable ownership marker, so it **keeps the mutex for its whole
   life**: other consoles then wait ("Another sight console is
   connecting; waiting") instead of risking a Stata this one holds.
   The after-the-fact question in that case can't name a window, so it
   says: "sight console is connected to a Stata it couldn't identify.
   Keep using it here? It closes when the console ends. [y/N]", and
   exit detection relies on RPC errors alone. The docs describe this
   state; Phase 0b R2 shows how often identification fails.
7. Setup, each `DoCommand` checked:
   ```stata
   set more off
   set linesize <terminal width, clamped to 40-255>
   log using "<dir>\out.log", text replace name(_sc<token8>)
   ```
   A failure is reported and the console stays up without terminal
   output (as in Log loss), rather than ending and closing Stata; the
   user can save and `exit`. In a shared Stata these settings change
   the session the user had, which is part of taking it over.
8. `UtilShowStata(0)`; start tailing at the log's size once setup has
   settled (so the log header isn't shown); emit `. `.

Timeouts in steps 3-7 only produce notices. Ctrl+C in steps 3-7 ends
the console (and so closes the Stata if a reference exists), as the
notices say. A console waiting for the mutex says "Another sight
console is connecting; waiting. Ctrl+C cancels." (nothing touched
yet). The wait happens inside the bridge, which can't read stdin
meanwhile, so Ctrl+C there kills the bridge (harmless: it holds no
reference). An abandoned mutex (its holder's bridge died) is taken
over, not treated as an error. The mutex is acquired and released on
the bridge's one thread (a Windows mutex belongs to the thread that
took it). A console that keeps the mutex (no PID, step 6) or waits on
the after-the-fact question holds the mutex meanwhile; other consoles
show the waiting notice until it ends or answers; the docs say so.
If `CreateObject` never returns, the bridge can't read stdin; when the
console ends, it kills the bridge process (a reference obtained by a
call that never returned is released by COM's own cleanup, closing
that Stata later; Phase 0b R4 measures how much later).

### AutomationBackend: producing the byte stream

**Echo and prompts.** Stata's log records each line it reads with the
prompt it read it at (S5 and S5-edge): `. cmd` at top level; `  N. cmd`
inside a block (the opening line is 1, so the body starts at `  2. `)
or a program definition (numbered from `  1. `); `: cmd` in Mata, with
`> ` on Mata continuation rows; `>>> cmd` and `... cmd` in Python; and
`> ` on continuation rows of a wrapped line. Blank lines inside Python
and Mata compound statements are echoed with their prefix; a top-level
blank line is not. The backend emits a synthesized prompt when a line
finishes (below). When the log shows the echo of the line it just
submitted, `<prefix><line>`, it replaces the whole echo (the prefix
was already emitted as the prompt). Lines are matched with leading and
trailing whitespace trimmed on both sides and wrap markers removed, because Stata drops leading whitespace
from what it echoes (S5: `    print(123)` was logged as `print(123)`).
When a log echo matches, the backend emits the *submitted* line
exactly, `<line>\r\n`, in its place (after the prompt), not Stata's
version. The session's echo removal (`consume_echo`, `session.ts:381`)
then sees exactly what it expects for a drawn line, and a typeahead
line is shown as the user typed it.
The session then sees what a PTY delivers for console Stata, and
`echoes_input()` is true. Typeahead works with no special case: the
session leaves a line entered without a prompt undrawn, the backend
later submits it after a prompt, and its echo appears as console Stata
would show it.

**Synthetic echo.** The session draws a line itself when it has
recognized a prompt, and otherwise leaves it for Stata's echo
(`session.ts:299-303`). Prompt recognition waits for quiet output, so
a line can be entered while the backend is already idle but before the
session has recognized the prompt; the backend therefore never infers
this from its own state, and uses the `drawn` flag passed with each
line. Only undrawn lines get a synthetic echo: if one finishes without
its log echo having appeared, the backend emits `<line>\r\n` at
completion, after the output. In the log-lost state (below) the
synthetic echo for an undrawn line is emitted at submission. A drawn
line never gets one. Each submitted line is shown on screen exactly
once: the backend records, per submitted line, whether it has been
echoed (by the log or synthetically), and a log echo that arrives later
for a line already echoed is dropped. Records are kept for the last 64
submitted lines.

**Typeahead queue.** Lines entered while a line is in flight stay in
the backend's FIFO and are submitted one at a time, each after the
previous finishes. Ctrl+C clears the FIFO. (After a Ctrl+C that
finishes a line locally while Stata is still running it, the next line
can sit in Stata's queue behind it; that is the one exception to:)
Stata's own queue never
holds more than one of our lines.

**Blank lines** are sent like any other line, whatever the predicted
mode (a blank line can end a compound statement in Mata or Python).
A top-level blank line isn't echoed (S5); completion doesn't need an
echo, so it still yields a fresh prompt. Inside Mata and Python
compound statements a blank line is echoed with its prefix. A blank
line's record is retired when the line finishes (so a top-level blank,
never echoed, can't absorb a later one), and a blank echo is matched to
the oldest blank record still live. If it
arrives while that line is still in flight it is replaced by `\r\n`
like any echo (for `consume_echo`); if the line has already finished,
the echo is dropped, so it never lands after the next prompt.

**Completion (when a line is finished).** Stata reports busy both
while it runs a command and while it waits for more interactive input
(S5), so there are two rules, chosen by the mode the tracker (below)
predicts *after* the line:

- **Top level predicted:** the line is finished when
  `UtilIsStataFree()` is true on two consecutive polls at least 60 ms
  apart, the log size didn't change across them, and the log has been
  read to that size. S9 and S12 support this: a fast command can be
  free at the first poll, and large output was on disk by then.
- **Awaiting input predicted** (inside a block or `program define`,
  in Mata or Python): the line is finished when its echo has appeared
  (or, for a blank line, immediately) and the log has then been quiet
  for 150 ms, whatever `UtilIsStataFree()` says. In S5 the echo was in
  the log within a few milliseconds of `DoCommandAsync`, so if no echo
  has appeared after 1 s (5 s for a line that enters Mata or Python,
  whose first start was slower in S5-edge: the `python` echo appeared
  more than 360 ms after the `python` submit, and the cold Python
  start made the next `DoCommandAsync` take about 0.5 s, so roughly
  1.5 s in all; R5 measures a cold start) and the log is
  quiet, the line is finished
  without one (synthetic echo if undrawn) and counts toward log loss.
  If two settled polls show Stata free, the prediction was wrong (free
  only happens at top level, S5): the tracker switches to top level and
  the top-level rule finishes the line. If Stata is instead
  still running a silent statement (a long Mata loop), the next line
  is released into Stata's queue early, which is how console Stata
  handles typeahead; the prompt is drawn early. Accepted and
  documented.

Neither rule waits for an echo indefinitely, so a lost or unmatched
echo can't hang the console; the top-level rule does wait for Stata to
be free, which a long command legitimately delays. Polls run every 30 ms while a line is in flight and
every 500 ms when idle (to see Stata exit, and output from commands
typed in the Stata window).

If the tracker predicts top level but Stata is really awaiting input
(a mode entered without a visible echo), the line never completes on
its own. The busy note covers it, and Ctrl+C gets out (below).

**Activity typed in the Stata window.** When the log grows with no
console line in flight, the output is shown, and once the log is quiet
and Stata settled free, the backend emits a fresh prompt (the session
clears its prompt on output, `handle_output`).

**Busy for a long time with no output.** After 5 s busy at top level
with a silent log, a one-row note: "Still running; if Stata asks for
input, answer in its window." That is the v1 path for `_request()`,
`input`, `pause` and `--more--` (`set more off` from setup makes the
last unlikely). Phase 0b checks whether a line sent while Stata waits
in `input` reaches it as the answer (S6 suggests so); if it does,
input requests may move out of the non-goals in a later version.

**Interrupt.** If a line is in flight: clear the FIFO, call the
bridge's `break` op (checks `UtilIsStataFree()` and breaks only if
busy), and finish the in-flight line locally, so Ctrl+C always returns
a prompt even when a break doesn't end the wait (S6: breaks left
`input x` waiting). After a break the tracker assumes top level until
the log says otherwise. At idle nothing is sent; in an awaiting-input
mode with nothing in flight, the backend sends a break (Phase 0b R7
says whether that abandons a block) and redraws the prompt. A break while a block is open is
checked in Phase 0b; until then the tracker treats `--Break--` as
returning to top level. While "Stata isn't responding" is shown
(ComBridge), a second Ctrl+C ends the console (closing Stata), since
the first only queues a `break` behind the stuck call; the note clears
when a poll succeeds.

**Line limit.** `max_line_bytes()` is 8191 (S10 accepted 8192 bytes);
lines with NUL are refused.

**Width.** `linesize` is set once at setup. Resizing the terminal
later doesn't change it (that would mean sending a command of our
own); the docs say so.

### Mode tracking

The tracker predicts the mode after each line from the lines sent
(Sight's lexer for unbalanced braces; `program define` and its
abbreviations, matched exactly by case through the command database,
and its `end`; `mata`/`python` at top level without a `:` one-line
form, and `end`) and corrects it
from log evidence: each echo's actual prefix (`. `, `  N. `, `: `),
the Mata banner and its closing rule, `r(N);` while a block is open
(block abandoned, as in S5's `r(111)` case), and `--Break--` (top
level). Interactive `#delimit` is rejected by Stata ("Unknown
#command", S5), so the tracker ignores it. Echo lines that appear
while no console line is in flight (typed in the Stata window) also
update it; echoes from inside a running `do` file are not evidence.
After a line finishes at top level (Stata free), `UtilStataErrorCode()`
supplements `r(N);` parsing, so an error is noticed with the log lost
(not on the awaiting-input path, where Stata is busy and calls can be
slow, S2); it also feeds the
session's error handling for staged pastes (`on_stata_error`).

The mode decides the prompt glyph (and so highlighting and
completion) and which completion rule applies, which only changes
*when* the next typed-ahead line is released, not whether or what is
sent.

### LogTail

- Polls size every 30 ms and reads new bytes through a handle opened
  with read/write sharing (S11: a plain read fails with a sharing
  violation; Node/Bun on Windows open with full sharing, which Phase 3
  confirms). Streaming UTF-8 decoder (characters split across reads are
  held), `\r\n` normalized (S11: Stata writes CRLF). Echo matching
  works on complete lines; a trailing partial line is passed through
  after a quiet period, so prompt-like output (`_request` text) still
  shows.

### Log loss

The log is lost when the file shrinks or vanishes, or when two
consecutive non-blank lines finish with no echo seen, for example after
`log close _all` in a do-file. Blank and whitespace-only lines (by
`trim()`, as in `session.ts:325`) don't count. The console doesn't try
to reopen it, since that would mean sending a command of its own.
Instead:

- one dim line in the output through `write_sight_text` (it is Sight's
  text, not Stata's, so it bypasses coloring and echo matching):
  "Sight's log was closed (by `log close _all` or `log off`?); output
  now shows only in the Stata window. Restart sight console to get it
  back.";
- each undrawn line's synthetic echo is emitted at submission;
- prompts keep coming from completion. On the awaiting-input path,
  which needs echoes, completion falls back to the log being quiet
  (trivially true) after a 150 ms pause.

If the user reopens a log under the same name and path, growth resumes
and the backend leaves the lost state at the next echo it sees.

### Exit and lifetime

The console holds its reference until it ends. Ending the console
releases it, and Stata quits (S2, S3), with any unsaved data, as when
the terminal running console Stata closes on macOS or Linux.

- **User types `exit`, or presses Ctrl+D** (the session turns Ctrl+D at
  an empty top-level prompt into `exit`, `session.ts:214-220`): sent
  like any line. If Stata quits, the bridge reports the process gone or
  an RPC error; the backend drains the log and resolves `exit_status`
  with 0. If Stata refuses (data changed), the console keeps running;
  `exit, clear` quits anyway, as in Stata.
- **User closes the Stata window**: the idle poll sees the process gone
  or an RPC error; the console prints "Stata exited" and ends. (Phase
  0b checks that Stata lets the user close it while a reference is
  held.)
- **Console ends any other way** (terminal closed: `SIGHUP`;
  `SIGBREAK`, `SIGTERM`; internal crash): `shutdown()` closes the
  bridge's stdin; the bridge releases its reference and exits; Stata
  quits. The console prints nothing more if the terminal is gone. An
  internal error in Sight after connecting is shown, and the console
  stays up when it can (the user decides when to end and close Stata);
  only a crash that kills the process ends it.
- **Bridge dies** (killed, crashed): the console prints "Lost the
  connection to Stata" and ends. COM releases the dead client's
  reference after its own timeout, and Stata then quits; Phase 0b
  measures how long that takes, and the message says so.

The bridge is an ordinary child process (not detached). A child doesn't
die with its parent on Windows; what ends it is EOF on its stdin pipe,
which happens when the console exits for any reason, as long as no
other process inherits the pipe's write end (spawned with only the
three stdio pipes). Its stdin closing is its signal to release. It is
started in its own process group so that a Ctrl+C or Ctrl+Break in the
shared console reaches Sight, not the bridge. The mechanism is
unproven under Bun (in `s3-spawn-probe.ts` a `detached` child never
wrote its marker), so Phase 3 picks one that works (Bun's options,
`Start-Process` from a shim, or `CREATE_NEW_PROCESS_GROUP` through FFI)
and keeps a fallback: a bridge that ignores console control events.
Phase 0b R4 is a shipping check: closing the terminal must make Stata
quit promptly, and killing the bridge must make it quit eventually.

**Temporary files.** Stata writes `out.log` until it quits with the
console. On exit the console deletes its directory if Stata has
already gone; if Stata still holds `out.log` (it quits a moment after
release), deletion is left to the sweep. Each directory also holds
`owner`, Sight's own PID and start time, written when the directory is
created. At startup, a directory under `%TEMP%\sight-console\` older
than a day is removed only if neither its `owner` nor its `pid` file
names a running process (by PID and start time).

### ComBridge

A long-lived helper holding the one COM reference, speaking JSON
lines, one request at a time, each with an `id` and a timeout. The
first `list_stata` acquires the connect mutex (waiting as long as
needed, with interim `{"event":"mutex_wait"}` lines so the backend
shows the waiting notice rather than counting a timeout); a
`release_mutex` op releases it after step 6, and is never sent in the
no-PID case. Ending the bridge releases it in every case:

```text
-> {"id":1,"op":"self_test"}
<- {"id":1,"ok":true,"language_mode":"FullLanguage"}
-> {"id":2,"op":"list_stata"}
<- {"id":2,"ok":true,"processes":[{"pid":4312,"title":"Stata/MP 18.0","com_started":false}]}
-> {"id":3,"op":"connect","expect":[4312]}
<- {"id":3,"event":"listing_changed","processes":[...]}
<- {"id":3,"ok":true,"processes_after":[...]}
-> {"id":4,"op":"title_pid","token8":"..."}
<- {"id":4,"ok":true,"pid":4312}
-> {"id":9,"op":"release_mutex"}
-> {"id":5,"op":"do_sync","cmd":"set more off"}
<- {"id":5,"ok":true,"rc":0}
-> {"id":6,"op":"do_async","cmd":"regress y x"}
-> {"id":7,"op":"is_free"}
<- {"id":7,"ok":true,"free":false}
-> {"id":8,"op":"break"}
<- {"id":8,"ok":false,"error":"rpc_disconnected","hresult":"0x80010108"}
```

`connect` re-lists inside the bridge right before `CreateObject` and
answers `listing_changed` (without calling `CreateObject`) if the set
differs from `expect`; it also takes step 4's relaxed before-listing
there and the after-listing once `CreateObject` returns. `do_sync` is used only during setup. Request
timeouts (in the backend) are notice thresholds, per the rule above:
5 s for `connect`; 10 s for each setup `do_sync`; 2 s for `is_free`,
`do_async`, `break`, `error_code`. The bridge handles one request at a
time, so later requests wait behind a slow one. Replies to `connect`,
`do_sync`, `title_pid` and `do_async` are always consumed, however
late (a late `do_async` acknowledgement changes nothing; a late
`do_async` error is handled like any other, ending the session only for
the server-gone codes below); only replies to the polling ops
(`is_free`, `break`, `error_code`) are discarded by `id` once timed
out. During the session a timeout is not
by itself a failure (Stata may be showing a modal dialog; S13 found the
Data Editor didn't block calls): after five in a row the console shows
"Stata isn't responding. Ctrl+C twice ends the console and closes
Stata." and keeps waiting; a second Ctrl+C while that note shows ends
the console (a first Ctrl+C would only queue a `break` behind the
stuck call). The console ends only when
Stata's process is gone, COM reports the server gone
(`RPC_S_SERVER_UNAVAILABLE` 0x800706BA, `RPC_S_CALL_FAILED`
0x800706BE, `RPC_E_DISCONNECTED` 0x80010108), or the bridge dies. Timeouts
never end the console once a reference may exist.

**First implementation: Windows PowerShell 5.1** (`powershell.exe`,
present on every supported Windows; the spike ran it on Arm64).

- Script written to `<dir>\bridge.ps1` and run with `-Sta -NoProfile
  -NonInteractive -ExecutionPolicy Bypass -File` (not
  `-EncodedCommand`: command-line cap and common EDR rules).
- Reads and writes through `[Console]::OpenStandardInput()` and
  `OpenStandardOutput()` wrapped in UTF-8 (no BOM) reader and writer,
  without touching console code-page settings.
- On stdin EOF: `FinalReleaseComObject`, then exit. Errors go to
  stderr, which the backend shows.
- Checks `$ExecutionContext.SessionState.LanguageMode`; Constrained
  Language Mode gets a clear message.

**Fallback.** Managed machines may block the script (CLM, AppLocker,
EDR). The JSON protocol is the seam: a `-Serve` mode in send-to-stata
(C#, x64/Arm64 releases with checksums; the CLI would download and
verify it like `client/src/send-to-stata/exe-downloader.ts`) or Bun FFI
to `ole32`/`oleaut32`. Built only if users hit this.

### Windows edges

- `index.ts`: on `win32`, require a TTY; piped input exits with a
  message pointing to batch mode (`StataMP-64.exe /e do file.do`).
  `--stata PATH` is rejected on Windows (Automation uses the
  registered Stata; run `<exe> /Register` to switch). `--stata-echoes`
  is ignored there. New `--yes` (Windows only) answers the take-over
  question. On the Automation backend `answer_more` shows the busy note
  and `resize` does nothing.
- Signals: add `SIGBREAK` to the shutdown signals on Windows, and
  check that registering `SIGQUIT` doesn't throw under Bun there.
- Terminal: Bun/libuv raw mode yields VT key sequences and `\x03`;
  `stdout` emits `resize`. Check Windows Terminal and conhost.
- History at `%APPDATA%\sight\console_history`; no 0600 mode.
- Path completion accepts `\`.
- Commands such as `python script ...` or `mata describe` can make the
  tracker predict a mode Stata didn't enter; free polls correct it
  within a poll or two, and the prompt glyph is briefly wrong.
- Documented behavior and limits: Stata (new or shared) closes when the
  console ends, with unsaved data; a Stata opened in the second the
  console connects may be taken; with two or more Stata windows open
  the console won't start; input requests are answered in the Stata
  window; a do-file with `log close _all` (a common header) ends
  terminal output for the session; resizing the terminal doesn't change
  `linesize`; `help`, `browse`, `edit`, `db`, `doedit` open windows and
  print little; `shell`/`!` output isn't logged; Python compound
  statements entered line by line may fail because Stata drops leading
  whitespace (S5; R5 decides whether they are supported); commands typed in the
  Stata window show in the terminal but can make the prompt wrong until
  the next line; a long silent Mata statement shows the next prompt
  early.

## Phases

### Phase 0b: follow-up checks on Windows (before Phase 3)

Phase 0 settled the design questions above. These remaining checks
refine details; none can reverse a user decision. Same VM, same
conventions as Phase 0 (`--current-user`, throwaway data, results
appended below).

| Item | Question | Affects |
|---|---|---|
| R1 | A Stata started from the Start menu (no arguments): does `CreateObject` claim it? While held: window, data and Command window usable? Can the user close it (File > Exit, window close) while held, and does the bridge see it go? | Shared case, exit detection. If a Start-menu Stata can't be claimed, requirement 2 can't be met as stated; the user decides the fallback before Phase 3 |
| R2 | Same Stata already held by another client: does `CreateObject` start a new one, as S1 showed for a do-file launch? What command line does a COM-started Stata have (`/Automation`, `-Embedding`)? A user Stata launched at the same moment as `CreateObject` (scripted, repeated): is the result always identifiable? | Step 4 identification |
| R3 | Release with changed data: does Stata quit without prompting? | Docs wording |
| R4 | Kill the bridge process while it holds the reference: how long until Stata quits? Close the terminal (Windows Terminal, conhost, VS Code) running a console-like parent with a non-detached PowerShell child holding the reference: does Stata quit, and when? | Bridge-death message, terminal-close behavior |
| R5 | Python: prompt prefix in the log, `UtilIsStataFree()` at `>>> `, `end`. S5 sent real indentation and Stata dropped it (`IndentationError`): is there any way to enter a compound statement line by line (tabs, a different submit path)? | Python mode; whether compound statements are a documented limit |
| R6 | Mata compound statement ended by a blank line; `UtilIsStataFree()` after `end` | Mata completion |
| R7 | `UtilSetStataBreak()` with a `foreach` block open (before `}`), in Mata, and in `program define`: does Stata return to top level, what does the log show? | Interrupt and tracker |
| R8 | `input x`, then lines sent with `DoCommandAsync`: do they become values, and does `end` finish it? `display _request(name)` then a line: is it the answer? | Possible later input support |
| R9 | `CreateObject` against a shared Stata that is busy, and one with a `foreach` open from its Command window: how long does it take to return? `UtilIsStataFree()` there. A break with a block prompt showing and nothing in flight | Connect waiting, interrupt at a block prompt |

### Phase 1: backend seam (no behavior change; can land now)

- `StataBackend`, `BackendLifecycle`, `PtyBackend`, `show_notice`,
  `write_sight_text`.
- Unit and PTY integration tests pass with only the `setup()` change.

### Phase 2: AutomationBackend against a fake bridge

- Backend, LogTail, both completion rules, mode tracker, typeahead
  FIFO, echo stripping and synthetic echo, interrupt, log loss, connect
  and setup, exit paths.
- Fake bridge (TS) that replays the Phase 0 transcripts, with
  randomized poll jitter and configurable flush lag. Cases: a command
  finished before the first poll; output arriving after the first
  "free" (within the settle window); a `foreach` block and a `program
  define` sent line by line with Stata busy throughout (S5 transcript;
  each line completes on echo plus quiet); a Mata session (busy
  throughout); a block error (`r(111)`, back to top level); a line with
  no echo (synthetic echo), then its log echo arriving late (dropped);
  `log close _all` mid-command, then queued typeahead lines (each shown
  once), then the log resuming; wrapped echoes; blank lines in every
  mode (always sent; top-level blank not echoed); break at idle (nothing
  sent); break with queued typeahead; a silent long command (busy
  note); an echo the console didn't submit (typed in the Stata window);
  resize (nothing sent); connect with none, one (asked; yes and no) and
  two open (refused, no COM call); `--yes`; a Stata owned by another
  console excluded from the count; the listing changing before
  `CreateObject` (asked again); COM starting a new Stata in the shared
  case (ends at once); an unconsented Stata answering (asked; no ends);
  a slow `CreateObject` and a busy shared Stata (notices, no timeout
  ends the console; Ctrl+C does); a failed title command (PID from the
  listing); a failed `log using` (console stays up without output); two
  consoles connecting at once (mutex); a second console starting while
  the first one's title command failed (excluded by its `pid` file);
  an unidentifiable result (treated as unconsented); COM starting a
  flagged new Stata while the consented one was open (identified, ends
  at once); a window-less Stata present in both relaxed listings (not
  "new"); a stale `pid` file from a crashed console (not excluded);
  the after-the-fact question answered yes, then the title naming a
  different Stata (asked again once) and the same one (not asked);
  Ctrl+C during the mutex wait; an abandoned mutex; a top-level blank
  followed by a Mata blank echo (matched to the Mata line); no PID from the
  listing and a failed title command (mutex kept for the console's
  life; a second console waits); a late `do_async` acknowledgement and
  a late `do_async` RPC error; log loss inside a block, in Mata
  and in Python (echo-miss bound, no hang); indented lines matched
  despite dropped whitespace; Ctrl+C with a line in flight in each mode
  (always a prompt); a mispredicted awaiting-input mode corrected by
  free polls; output from the Stata window at idle (fresh prompt); Stata exiting;
  bridge dying; request timeouts and late replies; `exit` refused with
  changed data; signal shutdown (bridge stdin closed); partial UTF-8
  and CRLF split across reads; a log path with compound-quote
  delimiters rejected; repeated poll timeouts (notice, no exit).
- End-to-end tests drive a real `ConsoleSession` with an
  `AutomationBackend` over the fake bridge and assert the screen
  transcript (prompt, highlighted line, output, typeahead echo,
  synthetic echo, block prompts `  2. `, an indented drawn line whose
  log echo lost its indentation, shown once), including a line entered
  after the backend went idle but before the session recognized the
  prompt, with the log echo absent (shown exactly once).
  These run on every OS.

### Phase 3: PowerShell bridge and Windows wiring (after Phase 0b)

- Bridge script: framing, UTF-8 streams, `-Sta`, CLM, registration,
  process listing, title lookup, release on EOF.
- `index.ts` and `setup.test.ts:154`, history path, `SIGBREAK`, path
  completion, the take-over prompt and `--yes`.
- A Windows CI job tests the bridge's framing, Unicode, stderr, and
  EOF handling against a stub object injected by a test hook, without
  Stata.

### Phase 4: manual verification and docs

- Windows 11 (x64 and the Arm64 VM), Stata 18 MP (StataNow if
  available), Windows Terminal and conhost: what "Tested with real
  Stata" in docs/console.md lists that v1 supports, plus: no Stata
  open; one open (asked, shared, closes at the end); two open
  (refused); two consoles; closing the terminal; closing the Stata
  window; killing Sight; `exit` with changed data; Ctrl+D; blocks,
  `program define`, Mata, Python; graphs; non-ASCII text; a profile
  path with spaces.
- Update `docs/console.md` (Windows section, registration, take-over,
  lifetime, limits), `docs/cli.md`, README.

### Phase 5: VS Code on Windows, with fallback to send-to-stata

Today `sight.sendToStata.target: "integrated"` on local Windows falls
back to the Stata app with a one-time warning (`commands.ts:147-164`),
and the Stata terminal profile isn't offered there
(`stata-terminal-manager.ts:82`). Phase 5 makes the integrated target
run `sight console` on local Windows, and turns each case where the
console doesn't take Stata into an offer to use send-to-stata instead:
the existing `external` target. Remote Windows hosts keep today's
behavior.

send-to-stata has no COM code (checked: `SendToStata.cs` finds Stata
by process name and pastes with the clipboard and keystrokes), so it
never holds a reference and can't close a Stata. It works without
Automation registration; `windows-sender.ts:73-78`'s
registration-error check is a leftover and doesn't apply to it. It
picks the first Stata process with a main window, in a fixed order of
process names, so with several open it chooses one itself, and it
needs its helper downloaded (`exe-downloader.ts`, asked on first use).

**Packaging.** The extension ships only `dist/extension.js` and
`server/server.js` today. A new `copy-cli` step in `vscode:prepublish`
bundles `src/cli.ts` with esbuild as CommonJS (`--format=cjs`, like the
server, per CLAUDE.md) into `client/cli/cli.js`, with a nested
`package.json` `{"type":"commonjs"}` and the command-database caches
the completer needs (`.vscodeignore` doesn't exclude it). A build test
runs the bundle (`cli.js console --help` with `ELECTRON_RUN_AS_NODE`)
rather than only checking that the file exists, since `main()` runs
only when `is_cli_entry_point(process.argv[1])` holds (`cli.ts:279`,
defined at `:255`),
which a Windows path-case difference could break; it also checks a
size budget.

**Launching.** On local Windows the profile and the integrated target
create the terminal with `shellPath: process.execPath`, `shellArgs:
[<extension>/cli/cli.js, "console"]`, and `env: {
ELECTRON_RUN_AS_NODE: "1", SIGHT_CONSOLE_FROM_EDITOR: "1",
SIGHT_CONSOLE_READY_FILE: <path> }`. Without `ELECTRON_RUN_AS_NODE`,
`Code.exe` would open another editor window; a test asserts the env.
The Windows backend needs no PTY, so `run_console` skips
`is_pty_supported` for it only. It does need a TTY with raw mode: if
`process.stdin.isTTY` is false or `setRawMode` throws under VS Code's
runtime, the console exits with the "terminal unsupported" code below
instead of running broken. Phase 3 confirms raw mode, `resize`, and
that the exit code passes through `Code.exe` unchanged; and, for each
of codes 80-86, that VS Code fires `onDidCloseTerminal` with reason
`Process` and that code even when the process exits quickly, and how
its own "terminated with exit code" alert (`showExitAlert`) interacts
with the offer.

**Exit codes.** `sight console` exits with a distinct code for each
case where it didn't take Stata, avoiding 0, 1, 2 (`EXIT_USAGE`) and
128 and up (signal statuses):

| Code | Case | When known |
|---|---|---|
| 80 | Two or more Stata windows open | Step 1, no COM call |
| 81 | Take-over declined (N) | Step 1, no COM call |
| 82 | Send from the editor instead (`s`) | Step 1, no COM call |
| 83 | Open Stata held by another program | Step 4, after consent; the console has already ended its connection to the new, empty Stata COM started |
| 84 | Automation not registered | Before any COM call |
| 85 | Bridge blocked (Language Mode, policy) | Before any COM call |
| 86 | Terminal unsupported (no raw mode) | Before any COM call |

The take-over question stays before any COM call, so it can't know
about case 83; that is found only after consent, as in step 4. The
codes are documented in docs/cli.md for other editors.

**The `s` answer.** Only when `SIGHT_CONSOLE_FROM_EDITOR` is set, the
take-over question reads "Continue? [y/N/s]", with "s: leave this
Stata alone and send code to it from the editor instead". `--yes`
takes precedence and skips the question. The answer letters are
Sight's own prompt, not Stata syntax, so matching them without regard
to case is allowed (noted in the code, per CLAUDE.md).

**Readiness and pending sends.** The extension can't read terminal
output, and today it treats a process ID plus a delay as ready and
bakes the first send into the CLI's arguments
(`stata-terminal-manager.ts:266-276`). For the console terminal:

- The console creates `SIGHT_CONSOLE_READY_FILE` when it shows its
  first prompt (after setup). That file, not the process ID, is
  readiness. Each terminal gets its own path (a random name under the
  extension's temp directory), watched by polling for that terminal
  only. Each terminal's state goes `starting` to `ready` to `closed`,
  and `closed` is final: a ready file seen after the close is ignored,
  so sends are never released into a closed terminal. On close the
  watch stops and the file is deleted.
- Each console terminal has a queue in the extension. A send made
  before readiness (including the one that created the terminal, and
  sends into a terminal the user opened from the profile list) is
  queued with its prepared temp file instead of being typed, so
  nothing is typed into the take-over question or lost during
  startup. The first send is no longer passed as an argument.
- On readiness, queued sends are typed in order with `sendText`, once
  each, and their temp files get the normal cleanup delay from then.
  Later sends are typed directly.
- If the terminal closes before readiness, queued sends are handled by
  the offer below: dispatched once each to the app, or dropped (temp
  files deleted). A terminal that closes after readiness has nothing
  queued.
- Queued temp files are kept until dispatched or dropped. The
  unconditional cleanup in `commands.ts:290-295` (30 s after
  `send_to_stata_terminal` returns) is skipped for a queued send; the
  queue owns that file and schedules its cleanup when it is typed,
  dispatched or dropped.
- `send_to_stata_terminal` returns whether it queued the send; when it
  did, the `finally` in `commands.ts` skips cleanup (cleanup still runs
  if terminal creation throws). Profile-opened console terminals are
  matched to their ready-file paths through a FIFO of pending paths,
  not the current count and name (`stata-terminal-manager.ts:70-77`).
- `TERMINAL_READY_TIMEOUT_MS` (5 s), and the `await ready_promise` in
  `send_to_stata_terminal` (`:367-370`), don't apply to console
  terminals: readiness can take minutes (the take-over question, step
  5's wait, the after-the-fact question).
- A console terminal is shown with focus when it is created and when a
  send queues behind its question, so the y/N/s question is seen.
  While sends are queued, the status bar shows how many.
- Cursor advance has already happened at send time and isn't repeated.

**When to offer.** On `onDidCloseTerminal` for a console terminal, an
offer is made only if `exitStatus.reason` is `Process` (not `User`,
`Shutdown` or `Extension`) and `exitStatus.code` is in the table.
Exit code 0, a missing code, other codes and user-closed terminals
make no offer, and that terminal's pending sends are dropped and their
temp files deleted. A one-line notice then says how many sends were
dropped and why, for every such close except a user close (which
shows nothing). The message comes from a table in the extension,
keyed by code; the console's own text is gone with the terminal.

Only one offer shows at a time. If another console terminal closes
with an offer code while one is showing, its pending sends join the
showing offer's, in close order, and the offer's answer applies to all
of them (dispatched once each, or dropped); the notification can't be
updated in place, so the second terminal's reason isn't shown, but the
dispatch result reports how many sends went to the app. Code 82 never
waits on a showing offer: its own pending sends are dispatched to the
app at once and the session override is set; the showing offer stays
for the sends it already holds, so sends from different terminals may
reach the app out of order (order is kept within a terminal). An
offer-code close while the session override or `external` is already
in effect asks nothing: its sends are dispatched at once. Dismissing
the notification (or letting it go to the notification center) counts
as Cancel after 60 s, so held sends and their temp files don't wait
indefinitely; the status bar count includes sends held by an offer. Every pending send ends exactly once:
typed into its ready terminal, dispatched to the app, or dropped.

**The offer.** "sight console can't use Stata here: <reason>. Send
code to the open Stata window instead?", with **This session**,
**Always**, **Cancel**. Reasons are worded for what send-to-stata will
do:

- 80: "several Stata windows are open. send-to-stata will send to one
  of them; to choose, close the others."
- 81: "you chose to keep your open Stata to yourself. send-to-stata
  sends to it without taking it over."
- 83: "the open Stata is in use by another program (such as Jupyter).
  send-to-stata would type into that same window."
- 84: "Stata's Automation isn't registered (run `<exe> /Register` as
  administrator to use the console). send-to-stata doesn't need it."
- 85, 86: the specific cause, and that send-to-stata doesn't depend
  on it.

Choices:

- **This session:** an in-memory override makes `integrated` resolve
  to the app until VS Code reloads or the target setting changes
  (cleared on `onDidChangeConfiguration` for it).
- **Always:** writes `sight.sendToStata.target: "external"` at the
  global scope, then reads the effective value back; if a workspace or
  folder setting still wins, it says so and applies the session
  override too.
- Either way, the pending sends are dispatched once each to the app,
  in order, through `send_to_stata_windows`. If the helper download is
  declined or a send fails, the existing error shows and the remaining
  pending sends are dropped with a note.
- **Cancel:** pending sends are dropped. Repeat offers aren't
  suppressed: the next send tries the console again, since the cause
  (for example two windows open) may have changed.
- Code 82 (`s`) skips the notification and acts as This session.

**Target resolution.** The `integrated`-on-Windows branch in
`resolve_effective_target` (`commands.ts:147-164`) is replaced, not
kept: on local Windows `integrated` resolves to the console terminal,
or to the app when the session override is set, with no warning. No
existing test asserts the old warning. `auto` keeps resolving to the
app on local Windows, so nothing changes for users who haven't chosen
`integrated`; making `auto` prefer the console is a later decision.
The `integrated` and `auto` descriptions in `package.json` (around
line 414, which says "Not available on native Windows") change to say
that `integrated` runs sight console on Windows and offers
send-to-stata if it can't use Stata, and that `auto` still uses the
Stata app there.

**Tests** (extending the `onDidCloseTerminal` mocks in
`tests/integration/send-to-stata-integrated-terminal.test.ts` with
`exitStatus`): target resolution with and without the override, and
the override cleared by a setting change; each code mapping to its
message; reasons `User`/`Shutdown`, code 0, a missing code and an
unknown code (no offer); This session, Always (global write, a
workspace value still winning), Cancel (dropped, next send retries);
sends queued before readiness and typed in order on readiness; several
rapid sends, then a close before readiness (each dispatched once, temp
files intact until then); a close after readiness (no dispatch); a
profile-opened terminal (queued the same way); a second close while an
offer is showing (its sends join that offer; each send resolved once
for each answer); code 82 arriving while an offer shows (dispatched at
once, the other offer unaffected), including both dispatching at the
same time with a helper failure in one (each queue keeps its own
sends and results); a ready file appearing after the
close (ignored); pending temp files deleted on a user close and on an
unknown code; a
user taking longer than 30 s at the take-over question (the queued temp
file survives); readiness after more than 5 s (no timeout); the terminal closing while the
notification is open; helper failure during dispatch; the profile's
`shellPath`, `shellArgs` and `env` (including `ELECTRON_RUN_AS_NODE`);
on the console side, `s` and `N` making no COM call, `--yes` winning
over `SIGHT_CONSOLE_FROM_EDITOR`, the ready file written at the first
prompt, and code 83 only after the new Stata's connection has ended.

**Docs.** docs/send-to-stata.md (targets on Windows, the fallback, the
helper choosing among windows), docs/console.md (exit codes, the `s`
answer).

## Risks

- Taking over a shared Stata closes it with the console: mitigated by
  the explicit question, the docs, and the title change that marks the
  window as the console's.
- The narrow race in step 4 can take a Stata the user opened during
  connect; it can't hold work yet, and the console says so.
- A mispredicted mode can delay typed-ahead lines (top-level rule
  waiting on a Stata that awaits input) or release them early (silent
  Mata); Ctrl+C clears the queue.
- Managed machines block PowerShell: the C#/FFI fallback.

## Phase 0 results

(The "gates" and "requires revision" remarks below refer to rev 6's
design; rev 7 onward is the response.)

These results are incomplete; the remaining manual and automated tests have not
been run. The VM is Windows 11, Stata/MP 18.0, and Windows PowerShell 5.1.
`stata.StataOLEApp` resolves to CLSID `{D3D9A260-CA12-48EE-A6B8-492AD0E71E70}`
and `LocalServer32` is `C:\Program Files\Stata18\StataMP-64.exe`.
All VM commands used `--current-user` (`win-vm\jmb`).

### S1 — partial

`scripts/spike/windows-com/s1.ps1` launched Stata with a do-file that loaded
`sysuse auto` and set `SIGHT_SPIKE_MARK` to `direct_s1`. The first
`CreateObject` returned that marker from PID 4312; the second returned an empty
marker and a second Stata process, PID 11272, appeared. See
`scripts/spike/windows-com/results/s1.txt` for timestamps and process lists.
This selects the launch-then-connect branch for a direct do-file launch and
shows that a claimed factory can cause a new server to start. A separately
user-started instance and other ordering cases remain to be tested.

### S2 — partial, no-touch gate fails in this run

In the same run, releasing both references left neither Stata process running
three seconds later, including the directly launched instance holding the auto
data. Therefore the proposed one-`MacroValue`-then-release contact is not
harmless in this case, contrary to the plan's inference that COM itself does
not close such a window. Separate idle, busy and modal measurements remain to
be made. Under the plan's gate, this observed failure prevents shipping the
proposed foreign-instance contact design.

### S3 — partial

Both the directly launched and COM-created Stata processes were absent after
release in the S1 run. Isolated tests confirmed both cases: S2 idle for the
direct process and `s3-release-com.ps1` for the COM-created process
(`results/s3-release-com.txt`). The hold-reference alternative and actual
terminal-window closure tests remain untested. The S3 gate is unresolved.

Paths beginning `results/` below refer to `scripts/spike/windows-com/results/`.
Stata log files are gzip-compressed without changing their bytes.

Additional observations below were collected on Windows 11 Arm64 with
PowerShell 5.1 and Bun 1.4.4 x64 under emulation. Screenshots containing license
information were not retained. These results remain incomplete.

S2 follow-up: an isolated idle contact again closed the direct-launch process
(`results/s2-idle.txt`). During `sleep 10000`, `MacroValue` took about 1.93 s,
returned the marker with `free=0`, and release closed the process before sleep
finished (`results/s2-busy.txt`). A visible regression dialog was opened from
a startup do-file (`results/s2-before-modal.png`); the marker call took about
226 ms and release closed Stata (`results/s2-dialog.txt`). Whether that dialog
was modal was not established.

S3 follow-up: a directly executed helper held a reference and logged free
polls (`results/s3-debug-direct.txt`), but this was not a terminal-close test.
A Bun child spawned with `detached` and `windowsHide` exited with code 0 before
writing its first evidence record. In `s3-spawn-probe.ts`, a non-detached
PowerShell child wrote its marker while a detached child did not, although both
reported exit code 0 (`results/s3-probe-*`). This is a setup/runtime finding,
not proof of the bridge lifetime. Closing real Windows Terminal, conhost, and
VS Code terminal windows and the hold-reference shipping gate remain untested.

### S4 — log grows during execution

`s4-s9-s12.ps1` ran a 20-iteration display/sleep do-file. The log grew from 501
to 593 bytes through 21 observed sizes while busy. See
`results/s4-s9-s12-polls.txt` and `results/s4-s9-s12.log.gz`. Polling requested
10 ms; actual intervals commonly reached 15–32 ms. This supports streaming
output for this run, rather than the documented-only-at-end branch.

### S5 — block continuation conflicts with completion rule

`s5.ps1` sent blocks and a program definition line by line, forcing each next
line after three seconds even if free remained false. In the first `foreach`,
free stayed false after the opening line and body, then became true after `}`;
the log shows numbered echoes and outputs 1 and 2. `program define` likewise
stayed busy until `end`. The proposed queue waits for free before sending the
next line, so it would stall on these blocks. This unanticipated contradiction
requires the plan author's revision.

`results/s5.log.gz` records the exact prompts, block error `r(111)`, nested blocks,
Mata error `r(3499)`, long-line `> ` wraps, and program execution. Interactive
`#delimit ;` returned `Unknown #command`; an included do-file accepted it
(`results/s5-edge.log.gz`). A top-level blank was not echoed. The Mata compound
probe ended in a syntax error; the Python probe lost indentation and ended in
`IndentationError`, so successful blank-line compound behavior is unresolved.
`_request(foo)` by itself was unrecognized. The input-wait experiment
contaminated subsequent pause/more probes, so those cases remain unmeasured.

### S6 — busy break and input wait

`s6.ps1` sent a break at idle, then `display 111`, which ran. A break during
`sleep 10000` produced `--Break--` and `r(1)`; `display 222` already queued in
Stata then ran. See `results/s6.log.gz` and `results/s6-polls.txt`. In the S5 edge
probe, repeated breaks during `input x` left free false and subsequent commands
were interpreted as input values. This informs the interrupt rule but does not
establish that a break ends every kind of input wait.

### S7 — title works on Stata 18

`s7.ps1` returned rc 0 for `window manage maintitle` and PID 14400 reported
title `Stata - sight spike s7`; the title is visible in `results/s7-title.png`.
Stata 17 and StataNow were not installed. Retaining the title step is supported
only for the tested edition/version.

### S8 — concurrent connect exercise

`s8.ps1` launched three marked instances standing in for a user and two
consoles, then started workers with the named mutex. Worker A claimed `user`
and then `console_a`; releasing both closed both processes. Worker B then
claimed `console_b`; after both workers released, no Stata processes remained.
See `results/s8-parent.txt` and `results/s8-console_*.txt`. This confirms
serialization in this exercise and exposes the no-touch failure. Workers
released their matching references immediately, so this is not a full test of
two concurrently operating consoles or their stray-process outcomes.

### S9 — fast command first poll was free

The `display 12345` first poll in `results/s4-s9-s12-polls.txt` was `free=1`
with size 353, about 34 ms after the submission timestamp. A busy-to-free
transition is not required for a fast command; this single run does not
determine the settle-window duration.

### S10 — observed command byte boundary and NUL

`s10.ps1` set a global with differing command lengths, resetting it to a
sentinel before each. An ASCII command of 8192 bytes succeeded; 8193 bytes
left the sentinel unchanged without a COM exception. With repeated `é`, a
command of 8192 UTF-8 bytes succeeded while 8194 bytes left the sentinel.
An embedded NUL likewise left the sentinel. See `results/s10*.txt`. This
supports a byte-based boundary for these inputs, not a general proof for every
Unicode sequence. `MacroValue` returned twice as many UTF-16 code units as
`é` characters in the successful non-ASCII probe; COM string encoding needs
further investigation. The plan's 8191-byte limit is within this boundary.

### S11 — startup, bytes, sharing and exit

`s11.ps1` launched the registered exe with a short-path do-file, read the
marker and log rc, and observed `c(more)=off`. Twenty sampled sizes after ready
were all 384 bytes, although the first sample already included the end of the
do-file. `results/s11-startup.log.gz` is the original byte stream: all 19 line
feeds are CRLF and `uchar(233) + uchar(26481) + uchar(20140)` produced UTF-8
bytes `c3 a9 e6 9d b1 e4 ba ac`. `ReadAllBytes` failed with a sharing violation
(`results/s11-default-read.txt`); an explicitly shared read/write FileStream
succeeded. A clean-data async `exit` ended Stata; after modifying `price`, async
`exit` left the process present with `free=1` and `UtilStataErrorCode=0` at the
sample (`results/s11.txt`). The changed-data case needs a Stata log to establish
its exact refusal text. Nothing here proves no writes can ever follow ready.

### S12 — no late growth observed in these runs

The burst-after-sleep and 100,000-row listing in `s4-s9-s12.ps1` had sizes
12501 and 2412657 bytes respectively at the first free poll, unchanged through
the next 19 free polls (`results/s4-s9-s12-polls.txt`). This supports the
proposed settle approach for these runs, but does not establish a maximum lag.

### S13 — Data Editor calls returned

The startup do-file in `s7-s13-start.ps1` opened the Data Editor with auto data
(`results/s7-s13-editor.png`). `s13.ps1` confirmed the marker; five
`UtilIsStataFree` calls returned 1, in at most about 9 ms each by the logged
timestamps (`results/s13.txt`). A true modal-dialog free-call test was not
completed, so timeout tolerance for that case is unresolved.

## Windows debug results

Tested 2026-10-31 on the Windows 11 Arm64 Parallels VM, Stata/MP 18,
Windows PowerShell 5.1, and Bun 1.4.4 x64 under emulation. All Stata
instances used for these checks were started for the test; the only data
loaded was `sysuse auto`. Scripts and evidence are under
`scripts/spike/windows-com/`; `README-debug.md` explains how to rerun them.

### Core console and fixes

- The production bridge started, passed `self_test`, found the registered
  executable, connected to a new Stata and displayed a first prompt. A real
  backend run executed `display`, `foreach`, `program define`, Mata, and
  Python one line at a time and exited Stata. See `results/debug-backend.txt`.
- A real CLI driven through ConPTY loaded the auto data, displayed a value,
  executed a `foreach`, rendered an `r(111)` error in red, interrupted
  `sleep 10000`, and exited via Ctrl+D. History Up repeated a command. Tab
  was sent, but the resulting abbreviated command also works without
  completion, so this does not establish a successful Tab completion.
  The byte-exact terminal traces are `results/debug-conpty-*.bin.gz`.
- On initial log opening, Stata emitted the first command without a prompt
  prefix; the backend showed it twice. It now recognizes an unprefixed first
  echo, including wrapped echoes. It also matches an echo that arrives after
  Ctrl+C; the real typeahead test interrupted `sleep`, cleared a queued line,
  and showed the sleep command once. Regression tests cover both cases.
- The CLI failed silently when run from the Parallels shared drive because
  Bun's argv and file URL used different case for the UNC server name. Entry
  detection now compares UNC server names case-insensitively, while retaining
  exact case for the path. The mapped-drive `--version` invocation works.
- The ConPTY take-over tests observed exit 81 for `n`, exit 80 with two open
  Stata processes, a successful `y` share, and successful `--yes` sharing
  without a question. The user instances in those tests were throwaways.
- Windows Terminal displayed the first prompt with the titled Stata window
  (`results/debug-wt.png`). WM_CLOSE of the dedicated terminal closed Stata
  within approximately 0.53 s; closing Stata ended the console in about
  0.8 s (`results/debug-terminal-close.txt`, `debug-stata-close.txt`).
- Both the real backend and ConPTY showed the lost-log message and continued
  to provide prompts after `log close _all`. Output in the Stata window
  was not independently checked in that test.

### Unresolved design contradictions

- **Ctrl+C at an open block is unsafe.** In the ConPTY block-break test,
  Sight redrew a top-level prompt, but Stata remained in the `foreach` block.
  Its own log shows the subsequent `display 56789` and `exit` entered as
  block lines, and the console timed out. See
  `results/debug-conpty-basic.bin.gz` and `results/debug-block.log.gz`.
  Do not infer that a break at a block prompt restored top-level mode.
- **The prescribed VS Code launcher is not a usable terminal here.** The
  extension launches `Code.exe` with `ELECTRON_RUN_AS_NODE`; in the real
  extension host both `process.stdin.isTTY` and `process.stdout.isTTY` were
  absent (`results/debug-tty.json`). The console exited before Stata started.
  This contradicts the plan's launcher assumption; no alternative runtime or
  ownership design was substituted. The integrated send/readiness flow is
  therefore not verified on Windows.
- Missing TTY previously returned generic exit 2, so VS Code did not offer
  its documented fallback. It now returns the planned code 86, with a
  regression test. The real extension displayed the fallback offer and its
  pending-send count (`results/debug-extension-fallback.png`). The test
  harness could not intercept the notification across the extension API
  boundary, so the This session and Always dispatch paths remain unverified
  in the Windows extension host.
- Killing a reference-holding PowerShell helper left its Stata process alive
  for the entire roughly 63-second observation; it was then closed through its
  window (`results/debug-r4.txt`, `debug-r4-helper.txt`). This differs from
  orderly reference release and leaves crash cleanup timing unestablished.
  The real Windows Terminal close above followed the orderly path.

The extension's Windows build also failed on an unquoted `node:*` shell
argument and `cp -r`. Quoting the argument and using Bun's recursive file copy
made `bun run vscode:prepublish` succeed on Windows. The scripts continue to
produce CommonJS extension and server bundles.

### Phase 0b follow-up

- **R1:** A no-argument Stata was claimed by `CreateObject`, accepted commands,
  and could be closed by WM_CLOSE while held; the next COM call reported
  `0x800706BA` (`results/debug-r1.txt`). Direct Command-window interaction
  while held was not tested.
- **R2:** When that no-argument Stata was already held, a second
  `CreateObject` started a second process with `-Embedding`
  (`results/debug-r2-r3.txt`). Simultaneous-launch race identification was
  not tested.
- **R3:** Releasing the first reference after modifying auto data closed that
  Stata within two seconds (`results/debug-r2-r3.txt`). The test did not
  independently capture whether a transient prompt appeared.
- **R4:** Orderly Windows Terminal close and helper-crash observations are
  above. Conhost and VS Code terminal closure were not tested.
- **R5:** Simple Python entry, `>>>`, and `end` worked in the real backend.
  Python compound entry and a cold-start timing measurement remain open.
- **R6:** Mata entry, an expression, and `end` worked. A compound statement
  ended by a blank line was not verified.
- **R7:** Break at a `foreach` prompt failed as described above. Separate Mata
  and program-definition break tests were not run.
- **R8:** The earlier S5 probe showed lines sent during `input` being consumed
  as values; completing input with `end` and `_request` remain unverified.
- **R9:** The earlier busy-Stata probe measured a fast `CreateObject` and a
  roughly 1.93 s `MacroValue` call while Stata remained busy. Connecting to a
  block already open in the GUI was not tested.

The normal standalone CLI path is promising, but the block-break failure and
VS Code launcher failure make this branch unsuitable to call experimentally
usable until the plan author resolves those behaviors. Other unverified cases
include conhost, real extension dispatch choices, and the R-item cases listed
above.

## Rev 9: the VS Code side runs the console in an extension terminal

Debugging on Windows showed that Phase 5's launcher can't work: VS
Code's `Code.exe` is a GUI-subsystem program, so run with
`ELECTRON_RUN_AS_NODE` it gets no OS console, and `sight console` exits
before Stata starts (`results/debug-tty.json`).

The extension now runs the console inside its own process and shows
it in an extension terminal (VS Code's `Pseudoterminal`), a pane in the
terminal panel with no program behind it. The console only needs to
write bytes and read keystrokes, which the pane carries; its Windows
work (PowerShell bridge, log polling) needs no terminal.

- `src/console/session-host.ts` runs a session for any display;
  `run_interactive` wraps it for the real terminal.
- `src/console/automation/open.ts` opens the Automation connection for
  both the CLI and the editor. Connect questions are structured, so the
  CLI asks `[y/N]` and the extension shows modal dialogs ("Take over",
  "Send code to it instead", "Keep using it").
- `src/console/editor-console.ts` is the editor entry point, bundled as
  `client/console-runtime/console.js` (`copy-console`) and loaded on
  first use. `client/src/send-to-stata/console-pane.ts` is the pane.
- Gone: the CLI bundle in the extension, the ready file,
  `SIGHT_CONSOLE_FROM_EDITOR`, exit-status parsing, and code 86 in the
  extension (it can't happen there). Readiness and the end of the
  console are reported to the queue directly; the queue, the offer and
  the session override are unchanged.
- The pane closes after a normal end and waits for a key after an
  error, so the reason stays readable. Closing the pane ends the
  console, which closes its Stata.

Also fixed after debugging: Ctrl+C at a block prompt no longer claims
to leave the block (Stata's Automation break doesn't), and console
history on Windows lives under `%APPDATA%`, as documented.

## Windows pane results

Tested 2026-10-31 in the Windows 11 Parallels VM as `win-vm\jmb`,
with Stata/MP 18 and the Windows Bun 1.4.4 build. The VS Code runs used
an isolated Windows checkout and user profile, and all Stata processes
were started by the tests with `sysuse auto`. Evidence and reproducible
harnesses are under `scripts/spike/windows-com/`; the `pane-cli-*.bin.gz`
files decompress to unmodified ConPTY byte streams. The harness instruments the
isolated extension build to observe pane writes and stub choices; it does
not change the shipped extension.

- **CLI:** `pane-cli-suite.ps1` passed basic output and error coloring,
  break during `sleep`, Ctrl+D, takeover declined (`81`), takeover
  accepted, `--yes`, two open Statas (`80`), and the closed-log notice.
  The `rev9` ConPTY transcript shows Ctrl+C at `foreach`, `program
  define`, and Mata prompts leaves the input context open and displays
  the instruction to finish it. The loop produced `90801` and `90802`,
  the program produced `343434`, and Mata produced `7`; the console
  returned to the top-level prompt. See `results/pane-cli-*.bin.gz` and
  `results/pane-cli-suite.txt`.
- **Pane and packaging:** Windows `bun run vscode:prepublish` succeeded,
  including `console-runtime/console.js`. The actual VS Code extension
  host loaded that bundle and passed its API-version check. With no
  Stata open, a queued send ran exactly once and its output appeared in
  the pane; `terminal.sendText` also ran a command and displayed its
  output. Both `exit` and `terminal.dispose()` closed the pane and the
  test-owned Stata. See `results/pane-basic.png` and the corresponding
  `pane-basic-*` and `pane-dispose-*` traces.
- **Takeover and cancellation:** With one test-owned Stata, stubbed
  **Take over** shared it and executed the queued and typed commands;
  closing the pane closed it. Stubbed Cancel offered the external
  fallback and left the Stata running. The VS Code extension test host
  refuses to display modal dialogs, so a separate normal development
  window was used to display the real modal; `results/pane-dialog.png`
  shows its three choices. `pane-takeover-*`, `pane-cancel-*`, and
  `pane-dialog-writes.jsonl` contain the observations.
- **Two windows:** The fallback offer appeared. Stubbed **This session**
  and **Always** each executed the waiting command exactly once in one
  of the two Stata logs; **Always** also persisted the `external`
  setting. See `results/pane-two_session-*` and `pane-two_always-*`.
- **Unresolved one-window fallback:** In two attempts, stubbed **Send
  code to it instead** launched the downloaded `send-to-stata` helper
  with the waiting do-file and the helper returned exit code 0, but the
  command did not appear in the Stata log, even after closing that
  test-owned Stata. This contradicts the intended dispatch behavior;
  the cause has not been established. A later two-window fallback did
  execute successfully, so helper success alone is not sufficient
  evidence that code ran. See `results/pane-send-first-*` and
  `pane-send-*`. No production fix or design change was made without a
  confirmed cause; this one-window choice remains unverified/failed.

The CLI and the ordinary pane workflow worked in these tests. The
one-window fallback failure prevents calling every path end-to-end
reliable; the feature is experimental, and users should verify execution
when choosing that fallback. The test-only harness was corrected to
re-read VS Code configuration after an update; no production behavior was
changed in this round. Repository gates: line endings, typecheck and
lint passed; `bun test ./tests` passed 8,083 tests with nine skipped.
