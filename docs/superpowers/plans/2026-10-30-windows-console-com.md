# Plan: `sight console` on Windows through Stata Automation (COM)

Status: draft, rev 6 (after five review rounds by Sonnet and Terra).

## Goal

`sight console` works on Windows with the same front end it has on
macOS and Linux: highlighting, Tab completion, history, colored output,
Ctrl+C. Stata for Windows has no console binary, so the console drives
a Stata GUI instance through Stata's Automation interface
(`stata.StataOLEApp`). The console launches its own Stata, drives that
instance and only that instance, and keeps its window visible, so
graphs, the Data Editor and the Variables window work alongside the
terminal. A Stata the user already has open is never sent a command,
hidden, or closed.

Non-goals for v1: sharing the user's already-open Stata
(`--instance attach`), options to choose what happens to Stata when the
console ends (v1 has one fixed behavior: Stata quits only on the user's
`exit`; otherwise its window stays open), answering input requests from
the terminal, piped input, the VS Code terminal profile on Windows.

Principles used throughout:

- **After startup, the console sends Stata only what the user
  entered.** No housekeeping commands (no `set linesize` on resize, no
  log recovery, no `exit` at shutdown). The only way the console's
  Stata quits is the user's own `exit` (typed, or Ctrl+D). This removes
  any chance of injecting a command into a block, Mata, Python, or a
  `#delimit ;` context the console misjudged, including one entered in
  the Stata window.
- **When the console isn't sure of Stata's state, it does less.** A
  wrong guess about Stata's mode affects the prompt drawn
  (highlighting, completion) and nothing the console sends on its own.
  One user-initiated case reads the guess: Ctrl+D becomes `exit` only
  at what the console believes is the top-level prompt
  (`session.ts:217`). If the guess is wrong, that `exit` lands where
  the user's typed `exit` would have; Stata decides, as for any line.

## What we know, and what is inferred

### Why stata_kernel "took over" and closed the user's Stata

1. **Attaching (inferred; spike S1).** Stata documents Automation as a
   *single-use* out-of-process server where each `CreateObject` starts
   a new Stata, and says nothing about attaching. The observed takeover
   suggests a user-started Stata also registers its class factory and
   the next `CreateObject` claims it. The design assumes `CreateObject`
   may return *any* Stata with an unclaimed factory and proves identity
   before sending anything.
2. **Closing the window (confirmed in stata_kernel's
   `stata_session.py`).** `init_windows()` calls `UtilShowStata(1)`
   (1 hides, 2 minimizes, other values show), and `shutdown()` sends
   `DoCommandAsync('exit, clear')`.

So the window closing is stata_kernel's doing, not COM's.

### Automation API facts (stata.com/automation)

- `DoCommandAsync(cmd)`: queued as if typed in the Command window;
  returns immediately.
- `DoCommand(cmd)`: synchronous, returns `rc`; ignores `exit`; 10001
  for `program define` (and possibly loops). Documented limit: under
  8192 characters, no NUL. `DoCommandAsync`'s limit is undocumented.
- `UtilIsStataFree()`: true when nothing is running *or queued*.
- `UtilSetStataBreak()`: the Break button.
- `UtilShowStata(n)`: 1 hides, 2 minimizes, other values show.
- `MacroValue(name)`: reads a global; no side effects.
- No output API; output must come from a log.
- Registration: `StataMP-64.exe /Register` as administrator, once.

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
- The VS Code Windows "app" target uses send-to-stata.exe, which sends
  code with the clipboard and keystrokes; it has no COM code (checked
  `SendToStata.cs` in github.com/jbearak/send-to-stata).
  `docs/send-to-stata.md:13` says "COM automation" and is wrong.

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
    /** End Stata as policy allows; resolves when done or given up. */
    shutdown(reason: 'user' | 'signal' | 'crash', timeout_ms: number): Promise<void>;
    /** Authoritative end: resolves once with the console's exit status. */
    readonly exit_status: Promise<number>;
}
```

Backends are constructed with `{ on_output, on_notice }` callbacks.
`interactive.ts` forwards them to the session, buffering until the
session exists, as `pending_output` does today. `exit_status` resolves
only after the final output has been delivered. `interactive.ts`
prints the closing message ("Stata exited", "Lost connection to Stata;
its window is still open") after restoring the terminal. PTY shutdown
is today's SIGHUP, 2 s grace, SIGKILL.

### AutomationBackend: producing the byte stream

**Echo and prompts.** Stata's log records each line it reads with the
prompt it read it at: `. cmd`, `  2. cmd`, `: cmd`, `>>> cmd`,
`> cmd` (spike S5 confirms the exact forms, including how a long line
wraps). The backend emits a synthesized prompt when a line finishes
(below). When the log shows the echo of the line it just submitted,
`<prefix><line>`, it strips the prefix from the first physical line
(already emitted as the prompt) and passes the rest through, including
Stata's `\r\n> ` wrap markers, which the session's echo matcher already
handles (`ECHO_WRAP_MARKER`, `session.ts:41`). The session then sees
what a PTY delivers for console Stata, and `echoes_input()` is true.
Typeahead works with no special case: the session leaves a line entered
without a prompt undrawn, the backend later submits it after a prompt,
and its echo appears as console Stata would show it.

**Synthetic echo.** The session draws a line itself when it has
recognized a prompt, and otherwise leaves it for Stata's echo
(`session.ts:299-303`). Prompt recognition waits for quiet output, so
a line can be entered while the backend is already idle but before the
session has recognized the prompt; the backend therefore never infers
this from its own state, and uses the `drawn` flag passed with each
line. Only undrawn lines get a synthetic echo: if one
finishes without its log echo having appeared (an echo form S5 didn't
reveal), the backend emits `<line>\r\n` at completion, after the
output, which is the honest order of what the console knows. In the
log-lost state (below) the synthetic echo for an undrawn line is
emitted at submission, before any output. A drawn line never gets one,
so it can't appear twice. Each submitted
line is shown on screen exactly once: the backend records, per submitted line,
whether it has been echoed (by the log or synthetically), and a log
echo that arrives later for a line already echoed (late flush, or the
log resuming) is dropped. Records are kept for the last 64 submitted
lines.

**Typeahead queue.** Lines entered while a line is in flight stay in
the backend's FIFO and are submitted one at a time, each after the
previous finishes. Ctrl+C clears the FIFO. Stata's own queue never
holds more than one of our lines.

**Blank lines** are sent like any other line, whatever the predicted
mode, so no input is ever dropped on the strength of a guess (a blank
line can end a compound statement in Mata or Python). Completion
doesn't need an echo, so a blank line that Stata doesn't log still
yields a fresh prompt (and, if it was undrawn, a synthetic echo).

**Completion (when a line is finished).** A line is finished after:

1. `UtilIsStataFree()` is true on two consecutive polls at least
   60 ms apart, and
2. the log size didn't change across those two polls, and
3. the log has been read to that size.

The echo is not required, so no line can hang the console. Polls run
every 30 ms while a line is in flight, every 500 ms when idle (to see
Stata exit, and output from commands typed in the Stata window). A
command that finishes between two polls is still caught, because the
rule looks at state, not a busy-to-free transition. Spike S9 checks
`UtilIsStataFree()` right after `DoCommandAsync`; spike S12 checks
that output is on disk by the first free poll, using large output
(`list` over 100,000 rows) and a burst after `sleep`. If S12 shows
late writes after "free", the settle window grows to the measured lag,
and Phase 2 adds a test with that lag.

**First prompt.** After connecting, the backend waits for completion
as defined above (start.do's tail end included), sets the tail start to
the log size at that moment, and emits `. `. A fresh Stata that just ran
start.do is at top level; S11 confirms that nothing more is written
after `ready`.

**Busy for a long time with no output.** After 5 s busy with a silent
log, the console shows a one-row note (under 70 characters): "Still
running; if Stata asks for input, answer in its window." That is the v1 path
for `_request()`, `input`, `pause` and `--more--`. `answer_more` shows
the same notice; with `set more off` from start.do it shouldn't occur.

**Interrupt.** If a line is in flight: clear the FIFO, call
`UtilIsStataFree()`, and only if Stata is busy call
`UtilSetStataBreak()`. At idle nothing is sent (spike S6 checks a
break at idle and during an input wait).

**Line limit.** `max_line_bytes()` is 8191 bytes until S10 measures
`DoCommandAsync`'s real limit and units; lines with NUL are refused.

**Width.** `linesize` is set once, in start.do, from the terminal
width (clamped to 40-255). Resizing the terminal later doesn't change
it in v1 (that would mean sending a command of our own); the docs say
so. A later version may resize at a proven-safe point if one exists.

### Mode tracking (cosmetic)

The synthesized prompt needs the mode (Stata, block `  N. `, Mata,
Python, continuation). The tracker predicts it from lines sent (Sight's
lexer for braces, `#delimit`, `mata`/`python` at top level, `end`) and
corrects it from log evidence: each echo's actual prefix, `r(N);` in a
block (block abandoned), `--Break--` (top level). Echo lines in the log
that appear while no console line is in flight (typed in the Stata
window) also update it; echoes from inside a running `do` file are not
evidence. After a line finishes, `UtilStataErrorCode()` (read-only;
returns `_rc`) supplements `r(N);` parsing, so an error is noticed even
with the log lost; it also feeds the session's error handling for
staged pastes (`on_stata_error`), which otherwise depends on log
text. Nothing the console sends on its own depends on the mode, so a
wrong mode means a wrong prompt glyph and wrong highlighting until the
next echo corrects it; the one user-initiated exception, Ctrl+D, is
described under the principles above.

### Getting our own Stata and proving it is ours

Identity is a random token only our instance knows, checked with the
read-only `MacroValue` before any command is sent.

1. Read the registered exe from `HKCR\CLSID\{clsid of
   stata.StataOLEApp}\LocalServer32`. If missing, print the
   `/Register` instructions and stop before launching anything.
2. Generate `token` (128 bits, hex). Create
   `%TEMP%\sight-console\<token>\` and use its 8.3 short path for every
   path Stata sees. If the short path still contains `"`, `` ` ``,
   `'`, `$` or non-ASCII (short names disabled), stop with a message
   naming `SIGHT_CONSOLE_TMPDIR` as the override. Write `start.do`:
   ```stata
   set more off
   set linesize <clamped terminal width>
   capture window manage maintitle "Stata - sight console <token8>"
   capture log using "<dir>\out.log", text replace name(_sc<token8>)
   global SIGHT_CONSOLE_LOG_RC = _rc
   global SIGHT_CONSOLE_TOKEN "<token>"
   file open _sc using "<dir>\ready", write replace
   file close _sc
   ```
   (Adjusted to what S11 shows. The `ready` file is written last, so
   its existence means the token is set, whether or not the log
   opened.)
3. Launch the exe directly with `do "<dir>\start.do"` (S11 confirms
   the GUI runs it), keeping the process handle (`Start-Process
   -PassThru`). Immediately, before waiting on `ready`, write the PID
   and the process start time to
   `<dir>\pid`; both are checked before anything acts on that PID
   (connect-timeout kill, stale-directory cleanup).
4. Wait for `ready` (30 s). Then, holding a named mutex
   (`Local\SightConsoleConnect`, which serializes Sight consoles only,
   not other Automation clients; waited for up to 65 s, longer than a
   blocked connect; an abandoned mutex is taken over, not treated as an
   error):
   - `CreateObject`, read `MacroValue("SIGHT_CONSOLE_TOKEN")`.
   - No match: send it nothing, keep the reference (so that factory
     stays claimed), and try again. At most N + 1 attempts, where N is
     the number of Stata processes running before our launch: enough to
     claim every foreign factory once, and no more, so a retry can't
     be what starts a stray.
   - Release every non-matching reference, *then* release the mutex.
     Non-matching references are never sent a command or killed.
5. No match after N + 1 attempts: release everything, release the
   mutex, and stop with a message. The only process the console may
   terminate is the one it launched, through the handle it holds, and
   only here, before any command has been sent to it. If S1/S8 show a
   non-matching `CreateObject` can start a new Stata through
   `LocalServer32` and S3 shows it survives release, that is an
   unowned licensed Stata left behind; if it can happen in normal use
   (not only in a contrived race), the design is revised and reviewed
   before Phase 3.
6. With the reference proven: if `SIGHT_CONSOLE_LOG_RC` isn't `0`,
   stop with the log error (and terminate our launched Stata as in 5).
   Otherwise `UtilShowStata(0)` and continue with the first prompt
   (see AutomationBackend).

**If S1 shows `CreateObject` never attaches to a running Stata:** step
3 is dropped and `CreateObject` returns a fresh Stata of its own; its
freshness is the proof. The backend then runs `start.do` through
`DoCommand("do ...")` before tailing starts, so its output is never
shown, and the token check stays as an assertion. In this branch there
is no launched process handle: a startup failure only releases the
reference (S3 says whether that closes the fresh Stata), and the PID
comes from the token title (`Get-Process | ? MainWindowTitle -like
'*<token8>'`), with RPC errors as the backstop for exit detection.

**The no-touch guarantee and its gate (S2).** Any program that calls
`CreateObject` may reach a user's Stata, so this design can't make the
user's Stata unreachable; it can only make the contact harmless (one
`MacroValue`, then release) or avoid it. Hence:

- If S1 shows `CreateObject` never attaches: there is no contact.
- Else if S2 shows the contact is harmless, including when the user's
  Stata is busy or showing a modal dialog (the `MacroValue` may then
  block until the 60 s connect timeout; S2 measures it): ship as
  designed.
- Else: a process check before launching can't close the race (a
  Stata started during connect can still be reached), so it isn't an
  acceptable fallback. The Windows backend isn't shipped unless a
  race-free way to keep foreign instances out of reach is found (for
  example, if S1 shows a Stata launched with some flag never offers
  its factory, or a way to address our instance directly); that would
  be a revised design with its own review.

### LogTail

- Polls size every 30 ms, reads new bytes (S11 checks the file can be
  opened for reading while Stata writes it), streaming UTF-8 decoder
  (characters split across reads are held), `\r?\n` normalized to
  `\r\n`. Echo matching works on complete lines; a trailing partial
  line is passed through after a quiet period, so prompt-like output
  (`_request` text) still shows.

### Log loss

The log is lost when the file shrinks or vanishes, or when two
consecutive non-blank lines finish with no echo seen, for example after
`log close _all` in a do-file. Blank and whitespace-only lines (by
`trim()`, as in `session.ts:325`) don't count, since Stata may not log
them. The console doesn't try to reopen it,
since that would mean sending a command of its own. Instead:

- one dim line in the output, emitted by the backend after the
  colorizer's input (it is Sight's text, not Stata's, so it bypasses
  output coloring), which stays on screen (a one-row editor
  note would be cut off and cleared at the next key): "Sight's log was
  closed (by `log close _all` or `log off`?); output now shows only in
  the Stata window. Restart sight console to get it back.";
- each undrawn line's synthetic echo is emitted at submission (drawn
  lines are already on screen), so the terminal still shows every line
  entered;
- prompts keep coming from completion, which doesn't need the log.

If the user reopens a log under the same name and path themselves,
growth resumes and the backend leaves the lost state at the next echo
it sees.

### Exit and lifetime

The instance belongs to the console, but the console never closes it
on its own. Stata is never sent `exit, clear` and never killed after
the first command.

- **User types `exit`, or presses Ctrl+D** (the session turns Ctrl+D
  at an empty top-level prompt into the line `exit`, as it does today,
  `session.ts:214-220`): sent like any line. If Stata quits, the bridge reports the process gone or an RPC
  error (codes under ComBridge); the backend drains the log
  and resolves `exit_status` with 0. If Stata refuses (`r(4)`, data
  changed), the console keeps running.
- **User closes the Stata window**: the idle poll sees the process
  gone (or an RPC error); `exit_status` resolves with 0 and "Stata
  exited" is printed.
- **Console ends any other way** (terminal closed: `SIGHUP`;
  `SIGBREAK`, `SIGTERM`; internal crash): `shutdown()` does the same
  thing for every reason: stop polling, close the bridge's stdin, and
  print, if the terminal is still there, "Stata is still open in its
  own window." Stata keeps its data and window; the user closes it as
  usual. (`shutdown`'s `reason` only selects the message.)
- **Bridge dies or a COM call fails**: `exit_status` resolves with 1;
  "Lost connection to Stata; its window is still open."

**What the bridge does on stdin EOF (shipping gate, S3).** The bridge
runs detached from the console window (spawned with `detached` and
`windowsHide`), so closing the terminal doesn't deliver
`CTRL_CLOSE_EVENT` to it. On EOF:

- If S3 shows releasing the last reference leaves the console's Stata
  (directly launched or, in the S1 branch, COM-created) running: release
  and exit.
- If release would close it: don't release. Stay alive holding the
  reference until the Stata process exits on its own, then exit.

Phase 3 does not start until S3 shows one of these keeps Stata and its
data on real Windows, for the instance kind S1 makes us use, and with
the terminal window closed (not only the console process killed). If
neither works, the Windows backend isn't shipped.

**Temporary files.** Stata keeps writing `out.log` while it runs,
including after the console ends with Stata left open, so the file can
hold everything that session prints (data listings included) until
Stata exits; the docs say so. A console deletes its directory after
Stata has exited. At startup, a directory under `%TEMP%\sight-console\` is
removed only if no process matches both the PID and the start time in
its `pid` file (or the file is missing) and it is older than a day.

### ComBridge

A long-lived helper holding the COM reference, speaking JSON lines,
one request at a time, each with an `id` and a timeout:

```text
-> {"id":1,"op":"connect","dir":"...","exe":"...","token":"..."}
<- {"id":1,"event":"phase","phase":"mutex_wait"}
<- {"id":1,"event":"phase","phase":"attempting"}
<- {"id":1,"ok":true,"pid":1234,"version":"18.0"}
-> {"id":2,"op":"do_async","cmd":"regress y x"}
-> {"id":3,"op":"is_free"}
<- {"id":3,"ok":true,"free":false}
-> {"id":4,"op":"break"}
<- {"id":4,"ok":false,"error":"rpc_disconnected","hresult":"0x80010108"}
```

Request timeouts (in the backend): 2 s for `is_free`, `do_async`,
`break`. `connect` has a deadline per phase rather than one total:
30 s for `ready`; up to 65 s waiting for the mutex (a queued second
console is not a failure; it shows "Waiting for another sight console
to connect"); then 60 s for the COM attempts (and, in the S1 branch,
the start.do `DoCommand`), counted from when the mutex is held. The
bridge reports phase changes as interim `event` lines (above) so the
backend can show the waiting message and start each clock. Running out
the mutex wait is a connect failure ("another sight console is still
connecting"); that bridge isn't stuck in COM, so the normal kill and
terminate path applies. S8 measures how three or more simultaneous
consoles fare. Replies arriving after their timeout are discarded by
`id`. A timeout is not by itself a failure: Stata may be showing a
modal dialog or the Data Editor. After five consecutive timeouts the
console shows a notice ("Stata isn't responding") and keeps waiting.
The console ends only when Stata's process has exited or COM reports
the server gone (`RPC_S_SERVER_UNAVAILABLE` 0x800706BA,
`RPC_S_CALL_FAILED` 0x800706BE, `RPC_E_DISCONNECTED` 0x80010108), or
the bridge process dies.

A `connect` timeout is different, because a bridge stuck inside a COM
call to a foreign Stata never reads stdin and keeps that reference. On
a connect timeout, before any command has been sent, the backend kills
the bridge process (dropping its references) and terminates the Stata
it launched, using the PID in `<dir>\pid` after checking that the
process's start time matches. In the S1 branch nothing was launched
and our Stata isn't proven yet, so nothing is terminated: killing the
bridge drops the reference, and the message names the Stata window
with the token title if one appeared, for the user to close.

`break` is one bridge op that checks `UtilIsStataFree()` and calls
`UtilSetStataBreak()` only if busy, so the check and the break are as
close together as the bridge can make them. After connect, the bridge makes no synchronous call
that waits on Stata's command queue.

**First implementation: Windows PowerShell 5.1** (`powershell.exe` is
present on every supported Windows; out-of-process COM works from x64
and Arm64).

- Script written to `<dir>\bridge.ps1` and run with `-Sta -NoProfile
  -NonInteractive -ExecutionPolicy Bypass -File` (not
  `-EncodedCommand`: command-line cap and common EDR rules).
- Reads and writes through `[Console]::OpenStandardInput()` and
  `OpenStandardOutput()` wrapped in UTF-8 (no BOM) reader and writer,
  without touching console code-page settings.
- Spawned detached and hidden (see Exit and lifetime). Exits on stdin
  EOF per the S3 gate; errors go to stderr, which the backend shows.
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
  is ignored there.
- Signals: add `SIGBREAK` to the shutdown signals on Windows, and
  check that registering `SIGQUIT` doesn't throw under Bun there.
- Terminal: Bun/libuv raw mode yields VT key sequences and `\x03`;
  `stdout` emits `resize`. Check Windows Terminal and conhost.
- History at `%APPDATA%\sight\console_history`; no 0600 mode.
- Path completion accepts `\`.
- Documented limits: input requests are answered in the Stata window
  (a line typed in the terminal meanwhile is queued and later runs as a
  command); a do-file with `log close _all` (a common header) ends
  terminal output for the session;
  resizing the terminal doesn't change `linesize`; closing the
  terminal leaves Stata open; after `log close _all` output appears
  only in the Stata window;
  `help`, `browse`, `edit`, `db`, `doedit` open windows and print
  little; `shell`/`!` output isn't logged; commands typed into the
  console's own Stata window show in the terminal but can make the
  prompt wrong until the next line.

## Phases

### Phase 0: spike on Windows with Stata (decides the design)

A throwaway PowerShell script; raw logs and results recorded in this
file. Each item names what its result decides.

| Item | Question | Decides |
|---|---|---|
| S1 | Does `CreateObject` attach to a user-started Stata? To one started with `<exe> do file`? Does the next one start a new Stata? When every running Stata's factory is claimed, does it start one through `LocalServer32`? | Launch-then-connect vs `CreateObject` alone; stray-process handling |
| S2 | After `CreateObject`, one `MacroValue`, release: is the user's Stata running, visible, data intact, usable? Also while it is busy and while a modal dialog is open: how long does `MacroValue` block? | No-touch gate (above) |
| S3 | Does releasing the last reference close a COM-started Stata? A directly launched one? Does a bridge spawned with Bun's `detached` and `windowsHide` leave the console's process tree and job object, and survive closing the terminal in Windows Terminal, conhost and the VS Code terminal? Can it hold the reference until Stata exits? | Shipping gate (above) |
| S4 | During `forvalues i=1/20 { display `i' ; sleep 500 }`, does the log grow per line? | If only at end: ship only with that documented, after looking for a flush setting |
| S5 | Line by line via `DoCommandAsync`: blank line at top level (accepted? logged?); `foreach ... {` / body / `}`; error inside a block; nested braces; `#delimit ;`; `include` of a file with `#delimit ;`; `mata`/`end`; error in Mata; blank lines in Mata and Python compound statements; `python`/`end`; `program define` ... `end`; a line longer than `linesize` (wrapped echo); `_request`, `input`, `pause`, `set more on`. Log text and `UtilIsStataFree` at each step. | Echo prefixes, mode evidence. If blocks or `program define` don't work line by line: **stop and re-plan with review**, rather than switching to gathering blocks into a do-file |
| S6 | Break during `sleep 10000`; at idle (does the next command break?); during an input wait; with a line queued behind a running one | Interrupt rule |
| S7 | `window manage maintitle` on Stata 17, 18, StataNow | Drop the title step if unsupported |
| S8 | Two consoles started together, plus a user Stata; count Stata processes left afterwards | Mutex, attempt cap, strays |
| S9 | `UtilIsStataFree` right after `DoCommandAsync`, fast command | Settle window |
| S10 | Longest line `DoCommandAsync` accepts, in bytes or UTF-16 units; NUL | `max_line_bytes()` |
| S11 | `<exe> do "<short path>"` at startup; anything written to the log after `ready`; `c(more)`; reading the log while Stata writes it; log encoding and newline bytes; `exit` via `DoCommandAsync` with and without changed data | `start.do`, first prompt, LogTail, exit handling |
| S12 | Log fully written at first "free"? Large `list`; burst after `sleep` | Settle window |
| S13 | Own Stata with a modal dialog or the Data Editor open: do `UtilIsStataFree` calls block or fail? | Timeout tolerance |

Phase 2 and 3 code uses the spike's numbers and forms. Where a result
contradicts this plan in a way not covered by the table, the plan is
revised and reviewed again before implementation continues.

### Phase 1: backend seam (no behavior change; can land before Phase 0)

- `StataBackend`, `BackendLifecycle`, `PtyBackend`, `show_notice`.
- Unit and PTY integration tests pass with only the `setup()` change.

### Phase 2: AutomationBackend against a fake bridge

- Backend, LogTail, completion, mode tracker, typeahead FIFO, echo
  stripping and synthetic echo, interrupt, log loss, exit paths,
  connect and identity loop.
- Fake bridge (TS) that replays the spike's transcripts, with
  randomized poll jitter and configurable flush lag. Cases: a command
  finished before the first poll; output arriving after the first
  "free" (within the settle window); a line with no echo (synthetic
  echo), then its log echo arriving late (dropped); `log close _all`
  mid-command, then several queued typeahead lines (each shown once),
  then the log resuming; wrapped echoes; blank lines at every
  predicted mode, including with the prediction wrong (always sent); break at idle (nothing sent); break with queued
  typeahead; an input wait (busy notice); an error inside a block and
  inside Mata (mode resync); `#delimit ;`; an echo the console didn't
  submit (typed in the Stata window); resize (nothing sent); a foreign
  instance answering `CreateObject` first; three non-matching answers
  (stop, references released before the mutex); two consoles, the second waiting on
  the mutex past 60 s (no false failure); an abandoned mutex; two blank
  lines in a row (no log-loss); log failure reported via `ready`; Stata exiting; bridge dying; request
  timeouts and late replies; `exit` refused with changed data; signal
  shutdown in every state (nothing sent, Stata left open); partial
  UTF-8 and CRLF split across reads; a log path with compound-quote
  delimiters rejected; repeated poll timeouts (notice, no exit).
- End-to-end tests drive a real `ConsoleSession` with an
  `AutomationBackend` over the fake bridge and assert the screen
  transcript (prompt, highlighted line, output, typeahead echo,
  synthetic echo), since that interplay is where echo and prompt bugs
  would live. They include a line entered after the backend went idle
  but before the session recognized the prompt, with the log echo
  absent (shown exactly once, via synthetic echo).
  These run on every OS.

### Phase 3: PowerShell bridge and Windows wiring (after the S3 gate)

- Bridge script: framing, UTF-8 streams, `-Sta`, CLM, registration,
  mutex, launch with handle, detached spawn, EOF behavior per S3.
- `index.ts` and `setup.test.ts:154`, history path, `SIGBREAK`, path
  completion.
- A Windows CI job tests the bridge's framing, Unicode, stderr, and
  EOF handling against a stub object injected by a test hook, without
  Stata.

### Phase 4: manual verification and docs

- Windows 11 x64 (Arm64 if available), Stata 18 MP and StataNow,
  Windows Terminal and conhost: what "Tested with real Stata" in
  docs/console.md lists that v1 supports, plus a user Stata already
  open (left untouched), two consoles, closing the terminal, closing
  the Stata window, killing Sight, `exit` with changed data, Ctrl+D,
  graphs, non-ASCII text, a profile path with spaces.
- Update `docs/console.md` (Windows section, registration, limits),
  `docs/cli.md`, README; correct `docs/send-to-stata.md:13`.

## Risks

- S4 or S12 show buffered logs: output arrives late or in bursts;
  documented, or the backend isn't shipped if it makes completion
  unreliable.
- S2 fails (and S1 shows attaching): not shipped unless a race-free
  isolation mechanism turns up; revised design, reviewed.
- S3 fails both ways: no Windows backend (shipping gate).
- S5 fails for blocks: re-plan, reviewed.
- Managed machines block PowerShell: the C#/FFI fallback.
