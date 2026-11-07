# Windows console: always start its own Stata

Status: plan, revision 9 (Sonnet approved revision 7; Terra review 4 folded in).

## Problem

On Windows, `sight console` gets Stata through COM
(`New-Object -ComObject stata.StataOLEApp` in the PowerShell bridge).
When a Stata window is already open and nobody holds its Automation
object, COM hands out that window instead of starting a new Stata. Sight
can't choose which window it gets, so the console today asks before
"taking over" an open Stata, refuses with `--yes` when several are open,
and names the one it got afterwards. A taken-over Stata closes when the
console ends, so unsaved work in it is lost then.

Users want the console to start its own Stata and leave open windows
alone.

## What the experiments showed

Spike: branch `t3/test-stata-com-factory-reservation` (commit
`b927e1a`), `scripts/spike/windows-com/README-factory-reservation.md`
and `README-factory-strategy.md`. Windows 11 ARM64, Stata/MP 18,
Windows PowerShell 5.1. 28 strategy cases, 145 independent UI checks of
the original windows.

1. `CoGetClassObject(clsid, CLSCTX_LOCAL_SERVER, IID_IClassFactory)`
   *without* `CreateInstance` takes an open Stata's single-use class
   factory. COM then no longer hands that Stata out. The Stata keeps
   running with its data, macros, and unsaved changes intact, also after
   the raw factory is released or the helper is killed.
2. The block is permanent for that Stata's process lifetime: releasing
   the factory doesn't make it available to COM again. The user accepts
   this.
3. With `CLSCTX_LOCAL_SERVER | CLSCTX_DISABLE_AAA` (`0x8004`) the call
   returns an available open Stata's factory, and once none is left it
   fails with `E_ACCESSDENIED` (`0x80070005`) **without launching a new
   Stata**. Statas held by another Automation client and Statas blocked
   earlier are skipped. So no counting is needed: drain until that
   failure.
4. Then a normal `CoGetClassObject(clsid, CLSCTX_LOCAL_SERVER, ...)`
   starts a new Stata (`-Embedding`). Calling `IClassFactory::CreateInstance`
   (vtable slot 3) on **that exact factory**, asking for `IDispatch`, and
   wrapping it with `Marshal.GetObjectForIUnknown` gives a late-bound
   object PowerShell can call (`$stata.DoCommand(...)`), with no second
   global activation.
5. Over-counting (calling plain `CoGetClassObject` more times than there
   are available factories) launches a spare Stata that survives the
   factory's release. The drain in (3) avoids that.
6. Remaining race, accepted by the user: a Stata the user opens
   manually *while the console is connecting* (after the drain, before
   the final factory call) can be the one COM returns. Once Sight holds
   its Automation object, later windows don't affect it.
7. `DISABLE_AAA` suppresses activate-as-activator launches only. A
   registration with a configured RunAs/AppID/LocalService could launch
   a server during the drain. The tested registration had none.
   `CoDecodeProxy` (identity of a raw factory's server) was denied, so
   factory identity can't be checked before `CreateInstance`.

## New behavior

The console starts its own Stata instead of taking over an open window.
It never asks to take over a window and asks no questions while
connecting. Limits, stated in the docs too:

- The accepted race: a Stata the user opens by hand while the console
  connects can become the console's Stata (it then closes when the
  console ends; see the notice below).
- A Stata that was started just before the console but hasn't registered
  with COM yet can likewise be handed out. A short readiness wait
  (below) narrows this; it isn't a guarantee.
- If Stata's COM registration has a configuration the experiments
  didn't cover, the console doesn't start and touches no Stata. If the
  drain fails in an unexpected way, the console doesn't start either;
  open Statas it drained before the failure stay open with their data
  but are already unavailable to other Automation programs.

Open Stata windows whose factories the console takes stay open with
their data. They become unavailable to other Automation programs
(Jupyter's stata_kernel in Automation mode, scripts using
`CreateObject`) until they close; those programs get a new Stata
instead, which is what Stata's documentation says Automation does
anyway. Windows already held by another Automation program are skipped
and keep working.
- If the console's Stata isn't confirmed as one COM launched for it (the
  accepted race: the user opened a Stata by hand while the console
  connected; or identification failed), the console keeps it and prints
  a notice naming it: it closes when the console ends, so save work in
  it. There is no "close it now?" question: once Sight holds the
  reference, the only alternative to keeping it is closing it, and a
  dismissed or defaulted question must never close a user's window.
- `--yes` remains accepted for older scripts and has no effect.
- Sight's own consoles still take turns through the
  `Local\SightConsoleConnect` mutex, held from before the drain until
  the console has identified its Stata and written its pid file (as
  today), then released whatever identification found.

Capability removed on purpose: attaching the console to a Stata the user
already has open (for example one with data loaded). In VS Code,
send-to-stata still sends code to an open window without Automation. In
a plain terminal (CLI `sight console`) there is no replacement: start
the console and load the data there. The docs say this.

Exit codes 80 (several open with `--yes`), 81 (take-over declined), 82
(send from editor instead) and 83 (open Stata held by another program)
can no longer happen; they are retired, not reused. New code 87: Stata's
Automation registration has a configuration sight console doesn't
support (see the guard below); the extension offers send-to-stata for
it, as for 84/85.

## Code changes

### `src/console/automation/bridge-script.ts` (PowerShell)

- Add a C# type via `Add-Type -TypeDefinition` in a single-quoted
  here-string (no backticks, no `${`, ASCII only, C# 5 syntax: PS 5.1
  compiles with the .NET Framework compiler). New op `prepare` compiles
  it; `open.ts` calls it right after `self_test`, before any COM call.
  Members:
  - `[DllImport("ole32.dll", PreserveSig = true)] CoGetClassObject`;
    `int GetFactory(string clsid, uint context, out IntPtr factory)`
    with `IID_IClassFactory`; `factory` is `IntPtr.Zero` on failure.
  - `int CreateExact(IntPtr factory, out object stata)`: vtable slot 3
    `CreateInstance(IntPtr.Zero, ref IID_IDispatch, out IntPtr)` via
    `Marshal.GetDelegateForFunctionPointer` (non-generic delegate type,
    `CallingConvention.StdCall`); returns the HRESULT on failure.
    On success `Marshal.GetObjectForIUnknown`, then `Marshal.Release`
    the raw pointer (as `strategy-native.cs`). If wrapping throws, it
    releases the raw pointer and returns a distinct code
    (`WRAP_FAILED`). The C# never throws to PowerShell for expected
    failures; it returns HRESULTs (`int`).
  - `void Release(IntPtr)` → `Marshal.Release` when non-zero.
- `src/console/automation/bridge.ts`: `BridgeFailure` gains
  `detail?: Record<string, unknown>`; the client copies every reply
  field other than `id`, `ok`, `error`, `message`, `hresult` into it
  (today they're dropped), so `stray_pid` and the registration
  key/value reach `connect.ts`/`open.ts`. Transport-level test in
  `tests/unit/console/automation-io.test.ts`: an error reply with
  `stray_pid` and `key`/`value` arrives in `failure.detail`.
- Errors: PowerShell throws plain names (`throw 'drain_failed'`), so
  `$_.Exception.Message` is exactly the name (a .NET exception from a
  method call would be wrapped as `Exception calling "X" ...`).
  Details go in `$script:error_detail` (a hashtable reset at the start
  of each request): `hresult` (`0x{0:X8}` of the returned code),
  `stray_pid`. The catch maps a message in the set `not_registered`,
  `native_unavailable`, `drain_failed`, `drain_limit`, `drain_launched`,
  `session_failed`, `unsupported_registration` to `error = <name>`
  (today only `not_registered`) and merges `error_detail` into the
  reply. HRESULT checks compare `int`s in PowerShell
  (`E_ACCESSDENIED` is `-2147024891`; constant named in the script).
- Factor `Get-Clsid` out of `Get-RegisteredExe`.
- Registration guard, new op `check_registration` (read-only registry
  reads; `open.ts` calls it after `registered`, before `list_stata`).
  The drain's no-launch behavior was measured with no AppID settings.
  The merged `HKCR` view can hide a machine key behind a per-user one,
  and COM reads some values (`RunAs`) from HKLM only, so the guard reads
  each location separately: `HKLM\SOFTWARE\Classes` and
  `HKCU\Software\Classes`, in the bridge's native (64-bit) view, which
  is the one 64-bit COM activation uses. Refuse (error
  `unsupported_registration`, naming the key and value) if, in either
  hive, the `CLSID\{clsid}` key itself has `RunAs`, `LocalService` or
  `ServiceParameters` (legacy placement), or if any AppID collected
  from either hive's `CLSID\{clsid}` value `AppID` and
  `AppID\<exe file name>` value `AppID` has, under either hive's
  `AppID\{appid}`, `RunAs`, `LocalService`, `RemoteServerName` or
  `ActivateAtStorage`. Other AppID values (for example
  `AccessPermission`) don't change who launches the server and are
  allowed. A registry read that throws (other than "not found") also
  refuses: fail closed. `open.ts` maps it to exit 87.
- Replace the `connect` op. The mutex is already held (`list_stata` with
  `acquire`). All raw pointers live in a list released in a `finally`:
  1. Readiness wait: up to 10 s, while some Stata process in the session
     has no main window, wasn't started by COM (`com_started` false) and
     isn't a batch run (command line without `/b`, `-b`, `/e`, `-e`,
     `/s`, `-s`), wait 250 ms and re-list. This is a heuristic: a window
     can appear before the factory registers, and the wait gives up
     after 10 s. A Stata the user launched just before the
     console is likely to register its factory by then. (COM-started
     servers held hidden by other clients are excluded, so they can't
     stall it.)
  2. `before = Get-StataProcesses $false $root` (baseline taken before
     the drain, so a server launched during the drain counts as new).
  3. Drain, at most `DRAIN_LIMIT = 16` acquisitions:
     `hr = GetFactory(clsid, 0x8004)`.
     - `0x80070005` (`E_ACCESSDENIED`): stop; this is the measured
       "nothing left" result.
     - Any other failure: throw `drain_failed` (with the HRESULT). No
       `CreateInstance`, no plain activation: an original may still be
       available and would be handed out.
     - Success: keep the pointer. Backstop for registrations the guard
       missed: re-list with a light `Get-Process` check (names `Stata*`,
       same session; CIM only for new pids, to read the command line).
       If a new pid+start with `-Embedding` or `/Automation` appeared,
       throw `drain_launched` naming that pid (it may be a spare Stata
       the user should close; it may also be another program's). Never
       guess that the factory belongs to it.
     - 16 successes: throw `drain_limit`.
  4. `hr = GetFactory(clsid, 0x4)`; failure throws `session_failed`.
  5. `$script:stata = CreateExact(factory)`. If `CreateInstance` fails,
     throw `session_failed`, adding the pid of any new `-Embedding`
     Stata so the message can name a stray window. If it succeeded but
     wrapping fails (`GetObjectForIUnknown`; not seen in practice),
     `CreateExact` releases the raw pointer, which may close that
     Stata, and throws `session_failed`; the message says so.
  6. `finally` (around steps 3-5): release every raw factory pointer
     (drained and session). Blocking persists after release (measured).
     `Marshal.Release` doesn't throw.
  7. `after`: `Get-StataProcesses` inside `try/catch`; on failure reply
     `after: []` (identification then reports unknown). Nothing after
     step 5 may throw, so a held session never comes back as an error
     reply (which would make `open.ts` end the bridge and close Stata).
  Reply `{ before, after, drained: n }`.
  Once step 5 succeeds the RCW stays held until stdin closes, as today.
- Drop the `expect`/`listing_changed` check (no consent to re-check).
  `list_stata` stays (it takes the mutex).
- `write_pid`, `sweep`, `owner`, `title_pid`, `Get-OwnedPids` unchanged
  (sweep and listing use them).

### `src/console/automation/connect.ts`

- Remove the take-over question, the `--yes` several-open refusal, the
  `listing_changed` loop, the "held elsewhere" result, and all `ask`
  calls. `ConnectDeps` loses `ask`, `yes`, `from_editor`.
  `ConnectQuestion`/`ConnectAnswer` are deleted.
- Step 1: `list_stata` with `acquire: true` (mutex and its "Another
  sight console is connecting" notice). Its list isn't used otherwise.
- Step 2: `connect`. The slow notice changes: today's "if Stata has
  already answered, that closes it" is wrong while nothing is held.
  New text: "Waiting for Stata to start. Ctrl+C cancels (and closes
  the console's Stata if it has started)." Every error reply means no
  session object exists. Errors: `drain_failed` → exit 1,
  "Error: sight console couldn't make sure an open Stata isn't handed to
  it (HRESULT ...); close open Stata windows and try again";
  `drain_limit` → exit 1 with the count; `drain_launched` and
  `session_failed` → exit 1 naming a stray window if any; other errors
  as today.
- Steps 3-4 (wait until free, title marker) as today, except failures
  before identification: today an `is_free` failure ends the console
  (`give_up`, which would close a possibly hand-opened Stata). New: if
  the failure is server-gone (`is_server_gone`), Stata is already gone:
  exit 1 as today. Any other failure in the free-wait or title marker
  means ownership is unknown: skip to the unknown outcome below (keep
  the Stata, notice), never close it.
- Step 5, identify, by pid **and** start time, using only the
  title-correlated pid for ownership. `title_pid` returns the pid and
  its start time; a title pid that isn't in `after` with the same start
  time counts as unknown.
  - own: `title_pid` is in `after − before` and that process is
    `com_started`. Write the pid file. No message.
    Why no stronger evidence is needed: the notice exists to protect
    user work. A Stata started by COM (`-Embedding`) during this connect
    registers one single-use factory, and its window stays hidden until
    an Automation client shows it. The console holds that one factory's
    object, so no other client ever had an object for this Stata, and
    nobody could see its window to type into it. Even if another
    client's activation triggered the launch (COM then gives that client
    a different server), this Stata can't hold anyone's work. (An
    `-Embedding` Stata that existed before the drain is in `before`, so
    it isn't classified here.)
  - not own: `title_pid` is found otherwise (it was in `before`, or is a
    fresh window started by hand). Write the pid file. Notice: "sight
    console is connected to a Stata it didn't start (title, from
    before); it closes when the console ends, so save your work in it."
  - unknown: no `title_pid` (marker failed or the window wasn't
    found). No pid file (a guessed pid could be another program's
    Stata). Notice: "sight console couldn't confirm which Stata window
    it is connected to; that Stata closes when the console ends."
  - Then `release_mutex` in every case. (Today the mutex is kept for the
    whole session when identity is unknown, so another console can't
    take that Stata over; without take-over that's unnecessary: the
    session factory is consumed.) Until release, other consoles wait,
    so their `before`/`after` can't include this Stata unexplained.
- Steps 6–7 (setup, show) unchanged.

### `src/console/automation/open.ts`, `run.ts`, `src/console/args.ts`

- `open.ts` cancellation: today `cancel()` kills the bridge at once.
  Killed during the final factory call, COM can finish launching a
  Stata nobody holds: a hidden `-Embedding` Stata that stays running.
  And releasing whatever `connect` acquired could close a hand-opened
  window (the accepted race) without a warning. New policy, while a
  `connect` request is in flight: the first `cancel()` only marks the
  console cancelled and says "Stopping after Stata answers; press
  Ctrl+C again to stop at once (a Stata being started may then stay
  running hidden)." When the `connect` reply arrives, `connect_to_stata`
  runs the free-wait, title marker and identification as usual, then:
  - own (fresh, COM-started): returns cancelled; `give_up` closes stdin
    and the bridge releases it, closing only the console's new Stata.
  - not own or unknown: doesn't close it. In the CLI the console starts
    as usual with the notice plus "Ctrl+C came while connecting, but
    this Stata wasn't started by the console, so it was kept; type exit
    to end." In the editor path the pane is already gone, so the
    session ends at once and that Stata closes; the docs state this
    narrow case (closing the pane in the moment a hand-opened Stata is
    being connected).
  A second `cancel()` kills the bridge, as today.
  Stage boundaries: `connect_to_stata` takes `on_stage('graceful' |
  'done')` and calls `on_stage('graceful')` synchronously right before
  sending `connect`; the graceful stage lasts until `connect_to_stata`
  returns (through identification, `release_mutex`, setup and show).
  Outside it, a first `cancel()` kills at once (before `connect`, no
  Stata can exist). Inside it, `connect_to_stata` alone decides: it
  checks `is_cancelled()` after identification and again at the end of
  setup, applying the own/not-own rule above, and returns
  `{ ok: false, cancelled: true }` only for the console's own Stata.
  `open()` drops its unconditional post-`connect_to_stata`
  `is_cancelled()` check (it would close a kept Stata and hide an error
  such as `session_failed`); it gives up with 130 only on that
  `cancelled` result. An error reply while cancelled surfaces its
  message. Update the `OpenHandle.cancel` docstring, the run.ts SIGINT
  comment, and the slow notice text to match.
  `connect_to_stata` gets an `is_cancelled()` dep, checked after
  `list_stata` (before sending `connect`) and right after the `connect`
  reply. The graceful first stage applies only while a `connect`
  request is in flight; before it is sent no Stata can exist, so
  `cancel()` kills at once as today (no second press needed during the
  mutex wait, `self_test`, `prepare` or registration checks). The
  "press Ctrl+C again" notice is CLI-only. In the editor path
  (`editor-console.ts` `close()`, called once), a graceful cancel is
  followed by a kill if the bridge hasn't exited within 15 s. Docs: how to find and end a
  hidden Stata (Task Manager, `StataMP-64.exe` with no window), only
  after a forced stop.
- `open.ts`: `prepare` gets a slow notice ("Preparing sight console's
  COM helper.") since `Add-Type` runs the C# compiler (1-3 s).
  Call `check_registration` after `registered`;
  `unsupported_registration` → `EXIT_AUTOMATION_UNSUPPORTED` (87),
  "Stata's Automation registration sets <value> for its AppID, which
  sight console doesn't support; it can't make sure an open Stata isn't
  handed to it." Call `prepare` after `self_test`; failure →
  `EXIT_BRIDGE_BLOCKED`, "PowerShell couldn't compile sight console's
  COM helper (a security policy may block it)." Drop `ask`, `yes`,
  `from_editor` from `OpenOptions`.
- `run.ts`: delete `ask_on_terminal` and the `readline` import.
- `args.ts`: keep parsing `-y/--yes`; help text "accepted for older
  scripts; no effect". `index.ts` stops passing it.

### Editor console and VS Code extension

- `src/console/editor-console.ts`, `editor-console-tty.ts`: drop `ask`
  from `EditorConsoleHost` and its terminal prompt; update the
  `EditorConsoleEnd.code` comment (84/85/87 now). Keep
  `EDITOR_CONSOLE_API_VERSION = 2`: removing a host member is
  compatible (an older host that still passes `ask` is ignored at
  runtime), and the extension and its bundled console ship together.
- `client/src/send-to-stata/console-pane.ts`: delete `ConsoleQuestion`,
  `ConsoleAnswer`, `ask_with_dialog`, and their wiring.
- `client/src/send-to-stata/stata-terminal-manager.ts`: drop the imports
  of those, `console_ask_override`, the `ask:` console option, and the
  test hook's `options.ask`.
- `client/src/send-to-stata/console-terminal-core.ts`: delete the 80–83
  constants and offer reasons, and the `exit.code ===
  CONSOLE_EXIT_SEND_FROM_EDITOR` branch. `set_session_override` and
  `is_fallback_in_effect` stay (used by the offer's "This session" and
  "Always" choices).
- `src/console/automation/exit-codes.ts`: delete the four constants;
  comment that 80–83 are retired and must not be reused; add
  `EXIT_AUTOMATION_UNSUPPORTED = 87`. Client mirror
  `CONSOLE_EXIT_AUTOMATION_UNSUPPORTED = 87` with an offer reason
  ("Stata's Automation registration has a setting the console doesn't
  support. send-to-stata doesn't use Automation.").

## Docs

- `docs/console.md`: rewrite "Which Stata it uses" (always its own
  Stata; open windows untouched but unavailable to other Automation
  programs until they close; the connect-time race and its notice; no
  way to attach to an open window, with send-to-stata as the editor
  alternative); `--yes` row; the "When the console ends" sentence about
  a taken-over Stata; the exit code table (remove 80–83, add 87; note
  80–83 are retired) and the "80-85" sentence below it; "Limits on
  Windows" checked for take-over wording; note that an unidentified
  Stata gets no pid file, so if the console crashes it can stay open.
- `docs/send-to-stata.md`, Windows sight console section: remove the
  take-over dialog paragraph, the "you decline the take-over" and "in
  use by another program" bullets, and the "Choosing Send code to it
  instead" paragraph; keep the offers for 84/85.
- `docs/cli.md`: console section links still hold; adjust wording if it
  mentions take-over.
- Module comments in `connect.ts`, `open.ts`, `run.ts`,
  `bridge-script.ts`, `console-terminal-core.ts`, `exit-codes.ts`.
- `scripts/spike/windows-com/debug-backend.ts`, `debug-conpty.ts`:
  outside tsconfig; update `from_editor`/take-over expectations so they
  don't mislead (or delete the stale lines).

## Tests

- `tests/unit/console/automation-connect.test.ts`, rewritten on the fake
  bridge:
  - no open Stata, fresh `com_started` title pid → no notice; pid file;
    order: `list_stata` (acquire), `connect`, `is_free`, `do_sync`
    (title), `title_pid`, `write_pid`, `release_mutex`.
  - title pid with a different start time than in `after`, or absent
    from `after` → unknown: notice, no pid file.
  - cancelled during `connect`, own result → after identification,
    returns cancelled (130); no setup requests.
  - cancelled during `connect`, title pid in `before` → not cancelled:
    session continues with the notice and the kept-after-Ctrl+C line.
  - cancelled before `connect` is sent → `connect` never sent.
  - error reply to `connect` while cancelled → its message, not 130.
  - cancel arriving after the `connect` reply while `is_free` is
    pending: no kill; own → 130 after identification; title pid in
    `before` → kept with notice.
  - `is_free` non-server-gone failure → unknown outcome (kept, notice,
    no pid file); server-gone failure → exit 1.
- `open.ts` cancellation tests (fake transport): `cancel()` with no
  `connect` in flight kills at once; during the graceful stage the first
  `cancel()` doesn't kill and the second does.
  - originals in `before`, fresh title pid → no notice.
  - title pid in `before` → notice naming it; console continues.
  - title pid fresh but not `com_started` (hand-opened) → notice.
  - title marker fails (one or two fresh `com_started`) → no pid file,
    unidentified notice.
  - mutex: `release_mutex` comes after identification (and `write_pid`
    when there is one) in all three outcomes.
  - `drain_failed`, `drain_limit`, `drain_launched`, `session_failed`
    → exit 1 with their messages; no `do_sync` afterwards.
  - `connect` reply with `after` empty → unknown outcome, not an error.
  - pid reuse: a `before` entry with the same pid but different start
    is fresh.
- `open.ts` tests (new file if none exists, fake transport):
  `prepare` failure → `EXIT_BRIDGE_BLOCKED`; `unsupported_registration`
  → 87; neither reaches `list_stata`/`connect`.
- Bridge error mapping: a static test that every name thrown with
  `throw '<name>'` in the script is in the catch's mapped set, and that
  C# members return `int` (no `ThrowExceptionForHR`).
- Static bridge-script test: no backtick or `${`; ASCII only; contains
  `PreserveSig = true`, `0x8004`, `-2147024891`, `3 * IntPtr.Size`, a
  `finally` releasing pointers, the four AppID value names; no
  `New-Object -ComObject stata.StataOLEApp`.
- `tests/unit/send-to-stata/console-terminal-core.test.ts`: drop 80–83
  expectations, add 87; rewrite the queue/offer tests that used 80 or 82 as
  fixtures to use 84/85; delete the send-from-editor tests.
- `tests/integration/send-to-stata-integrated-terminal.test.ts`: drop
  the `take_over`/`allow_send_instead` host-ask tests, types and the
  `ask` test-hook option; switch the generic 80/81/82 exit fixtures to
  84/85.
- `tests/integration/client-console-bundle.test.ts`,
  `tests/integration/console/helper-pty.test.ts`: drop the `ask` host
  fixtures.
- `tests/unit/console/automation-io.test.ts`: drop the
  `listing_changed` fixture.
- Gates, each separately: `bun run check:line-endings`,
  `bun run typecheck`, `bun test ./tests`, `bun run lint`.

## Proof on real Windows

Unit tests can't exercise COM. On Cyllene's Windows 11 VM (Stata/MP 18,
Windows PowerShell 5.1), with the branch's console code run via the
existing spike harness (`scripts/spike/windows-com/README-debug.md`).
Inventory (pid, start, command line) before and after every case; no
spare `-Embedding` Stata may remain.

1. Two hand-opened Statas, each with `sysuse auto`, a changed value and
   a global marker (unsaved). Start console A: no question; a new
   `sight console <code>` window; commands run there; both originals
   still answer from their own Command windows with marker, data and
   `c(changed)==1`.
2. With A still running, start console B: another new Stata; originals
   and A untouched. Then end both with `exit, clear`: only their own
   Statas close.
3. Two consoles started at the same moment: two new Statas, each
   identified (no notice); originals untouched.
4. An original held by another Automation client (a PowerShell holding
   `New-Object -ComObject stata.StataOLEApp`, running commands in a
   loop): the console skips it; the client keeps working.
5. No Stata open: the console starts one.
6. Accepted race: open a Stata by hand while the console is connecting
   (start a hand-opened Stata right as the console starts, a few
   times): either the console gets a new Stata, or it gets the hand-opened
   one and prints the notice. Never silent.
7. A Stata launched by hand ~1 s before the console: not taken, or the
   notice appears.
8. Unsupported registration, VM only, with an exported backup and a
   verified restore: (a) HKLM: set the class's `AppID` value under
   `HKLM\SOFTWARE\Classes\CLSID\{clsid}` and create
   `HKLM\SOFTWARE\Classes\AppID\{appid}` with `RunAs` =
   `Interactive User` (elevated, via `prlctl exec` without
   `--current-user`); (b) the same under HKCU only. Each: exit 87, no
   Stata started or touched.
9. Ctrl+C once during connect (during the readiness wait, right after
   the drain, and during the free-wait/title marker): the console stops after the request in
   flight; inventory shows no stray Stata. Ctrl+C twice: record what
   remains (and that the docs' instructions find it).

Drain failures other than `E_ACCESSDENIED`, the 16-acquisition limit and
a blocked `Add-Type` can't be staged safely; they are covered by unit
tests of their error mapping and the static script checks.

## Out of scope

- Proving factory identity under arbitrary concurrent launches
  (`CoDecodeProxy` denied; accepted race).
- Restoring originals' COM availability.
