# Plan: sight console in the Stata pane on macOS and Linux

Reviewed twice by Sonnet and GPT-6.1 Terra; this is revision 3, with
the changes testing on real Stata made (see "Changes during
implementation" at the end).

## Problem

`sight console` (#335) was built for macOS first, but only Windows got
it in VS Code (#337). On macOS and Linux the "Stata" terminal profile
and the `integrated` send target still launch bare `stata-mp` in a
terminal (`client/src/send-to-stata/stata-terminal-manager.ts`).

## Constraints from the user

- No separate install of `sight` (Homebrew, release binary, npm).
- Don't bundle or download the 59 MB native `sight` binary.
- Intel Macs and Linux get the console too.

## Why Windows needed no binary and macOS/Linux need a helper

The Windows console drives the Stata app over Automation (PowerShell
bridge, log tail: `src/console/automation/`), which Node does with
pipes, so it runs in the extension host
(`client/src/send-to-stata/console-pane.ts` loads
`client/console-runtime/console.js`, bundled from
`src/console/editor-console.ts`).

On macOS/Linux the console runs console Stata in a pseudo-terminal
(`src/console/pty.ts`, `Bun.Terminal`) and reads the child terminal's
`c_lflag` (ECHO, ICANON) in `pty-backend.ts`. Node can't create a PTY
or call `ioctl`.

Rejected: bundling or downloading the sight binary (user constraint);
VS Code's internal `node-pty` (private path, no termios); `script(1)`
(no resize or termios); Python `pty` (not on every Mac); AppleScript
to Stata.app (no Linux, opens the GUI).

## Design: a small PTY helper; the console runs in the extension host

### 1. `sight-pty` helper (C)

`client/pty-helper/sight-pty.c`, built for darwin-arm64, darwin-x64,
linux-x64, linux-arm64 (static musl), shipped in the one universal
VSIX as `client/pty-helper/bin/<platform>-<arch>/sight-pty`. The C
source is excluded from the VSIX.

Usage: `sight-pty COLS ROWS -- COMMAND [ARGS...]`. The helper's cwd and
environment are Stata's (Node sets them on spawn).

- `forkpty` with the window size and a `termios` whose ECHO is cleared
  (the console draws input itself, as `pty.ts` does today); otherwise
  default flags. The child closes every fd above 2 and `execvp`s
  Stata. Exec failure is reported as an error frame (below), exit 127.
- One ordered stream out (fd 1), framed: 1 type byte + 4-byte
  big-endian length + payload.
  - `O`: bytes Stata wrote.
  - `L`: the slave's `c_lflag` (`tcgetattr` on the master), sent at
    start, before any `O` frame whose read happened after a change,
    and after a change found on the poll timeout (20 ms while input is
    pending, else 100 ms). Ordered with output, so Node never sees
    output from after a mode change before the change itself.
  - `X`: exit (code, signal), the last frame.
  - `E`: a helper failure message (exec failed, `forkpty` failed).
- In on fd 0: raw bytes for Stata. In on fd 3: control lines.
  - `W COLS ROWS`: `TIOCSWINSZ` (the kernel sends SIGWINCH to the
    foreground group; the helper sends none itself).
  - `I`: SIGINT to the terminal's foreground group
    (`tcgetpgrp(master)`), falling back to Stata's pid.
  - `H`: SIGHUP to Stata, SIGKILL after 2 s.
  The helper owns the pid, so Node never signals a pid that may have
  been reused, and nothing is lost before a startup handshake.
- Non-blocking master and stdin, buffered writes with `POLLOUT`,
  `EINTR` retried, SIGPIPE ignored, SIGCHLD via a self-pipe. EOF on
  stdin or SIGHUP/SIGTERM to the helper acts as `H`.
- After `waitpid`, drain the master until EAGAIN, EIO or EOF, at most
  200 ms (a background child may hold the slave open), then send `X`.
- If Node SIGKILLs the helper, the master closes and the kernel hangs
  up Stata's session.

### 2. Node side of the PTY

`src/console/helper-pty.ts`: `spawn_helper_pty(...)` implements the
existing `StataPty` interface (`pty.ts`) over the helper, with a
streaming UTF-8 decoder for `O` payloads and a frame parser that copes
with splits across reads. Before the first `L`, flags default to echo
off, canonical on. `exit_status` comes from `X` (or the helper's own
exit if it dies without one). `create_pty_handle` (`pty-backend.ts`)
takes the spawn function as a parameter so both backends share its
SIGHUP-then-SIGKILL shutdown.

`PtyBackend.submit_line` drops C0 control bytes other than tab. With a
controlling terminal, a pasted `\x03`/`\x1a`/`\x1c` would otherwise
become SIGINT/SIGTSTP/SIGQUIT if Stata has ISIG on. Ctrl-C is
unaffected: the session calls `interrupt()`.

If `TERM` is unset (GUI-launched VS Code), set `xterm-256color`.

### 3. Editor console runtime

`start_editor_console` picks the backend by platform: Automation on
win32 (unchanged), the helper PTY elsewhere, bypassing
`open_automation_console`. New host fields `pty_helper_path`,
`stata_path`, `working_directory` (already there, now also Stata's
cwd); `EDITOR_CONSOLE_API_VERSION` becomes 2 (mirrored in
`console-pane.ts`).

Readiness: an `on_ready` option on `ConsoleSession`, fired once in
`on_quiet` right after `prompt_kind` is set to `'stata'` (not `more`,
`mata`, and so on), passed through `session-host.ts`. The PTY editor
console resolves `ready` there; Windows keeps resolving at backend
start. `ready` resolves false if the console ends or closes first.
No timeout: if Stata shows something else first (a license prompt),
sends keep waiting and the status bar says so, as on Windows.

### 4. Extension

- `uses_console_pane()` replaces `is_local_windows()` for pane
  routing: true on local Windows, and on macOS/Linux (local or remote)
  when `sight.sendToStata.console` is `auto` and a helper exists for
  `process.platform`/`process.arch`. Every branch moves: profile
  provider (returns a `pty` profile), `handle_terminal_opened`,
  `create_stata_terminal`, `get_or_create_stata_terminal`'s baking,
  `send_to_stata_terminal`.
- Before opening a Unix pane: `detect_stata_cli()`; if none, the same
  error as today and no pane. Resolve a PATH name to an absolute path
  with the extension host's PATH (the detector found it there).
- Offers for exit codes 80-85 (send to the Stata app) apply only to
  Automation panes. The pane reports its backend; Unix panes treat
  every non-zero exit as a plain drop with a notice.
- Helper fallback: if the helper isn't executable (after a `chmod`
  attempt) or dies without an `X` frame before `ready` (for example,
  killed at exec by code signing), latch the plain `stata-mp` terminal
  for the session, show a one-time notice with the reason, and hand
  the pane's pending sends to it exactly once (first command baked
  into the launch args, the rest typed after readiness, as today).
- Setting `sight.sendToStata.console`: `auto` (default) | `off`;
  macOS and Linux only. Changing it affects the next pane.
- Build: `scripts/build-pty-helper.ts` compiles the four targets with
  a pinned Zig (`zig cc`; checksum-verified download in CI). Run from
  `vscode:prepublish`. Missing targets fail the build when `CI` is set;
  locally without Zig it builds the host target with `cc` and warns.
  CI's `package` job installs Zig and checks the VSIX lists all four
  helpers with exec mode. A macOS CI job extracts the darwin helpers
  from the VSIX, runs `codesign -v`, and runs `sight-pty 80 24 --
  /bin/echo ok`.
- Docs: `docs/send-to-stata.md`, `docs/console.md`, setting text in
  `client/package.json`, and comments that call the pane Windows-only.

### 5. Tests

- Helper (compiled for the host; skipped without `cc`): relay; exit
  code, signal and 127 distinguishable; `L` frames on `stty` changes,
  ordered before later output; `W` seen by `stty size`; `I` reaches a
  foreground `sleep`; `H` and stdin EOF end the child, and SIGKILL
  escalation for a child ignoring SIGHUP; control bytes in input
  don't signal; 1 MB input to a non-reading child that writes output
  doesn't deadlock; a background child holding the slave doesn't hang
  exit; fds 3/4 aren't inherited.
- `helper-pty.ts`: frame splits, UTF-8 split across frames, flags
  before the first `L`.
- Session: `on_ready` fires once, only for the Stata prompt.
- Editor console with a stand-in Stata over the helper: ready at the
  first prompt; sends typed after it.
- Extension (mocked VS Code): Unix panes, profile `pty`, setting `off`
  and missing helper fall back, exit 80-85 on Unix makes no offer,
  helper death before ready hands sends to a plain terminal once.

### 6. Proof

- voyager (macOS arm64, StataMP 18, no Bun, no sight): the helper,
  `console.js`, and a Node driver playing the extension host (VS Code
  server's Node if present). Checks: ready at the first prompt; an
  instrumented do-file sent at launch runs exactly once; two queued
  sends while a long command runs; `--more--`; Ctrl-C during a loop;
  `shell`; resize; `exit`; an erroring do-file; a path with spaces;
  relative `do` from the working directory; no `TERM`/`LANG` in the
  environment; killing the driver leaves no Stata. Compare echo
  handling with `sight console` on the same transcript.
- The real extension in VS Code on this Mac (extension test harness,
  `client/test/`), with a stand-in Stata: the profile pane and
  `integrated` sends go through the helper.
- Linux: helper tests in CI on linux-x64; real Linux Stata stays
  untested, and the docs say so.

## Changes during implementation

- No controlling terminal. The first helper used `forkpty`, which makes
  the terminal Stata's controlling terminal. Testing showed job control
  then matters (bash, as a session leader, takes the terminal), so the
  helper now uses `openpty` and `fork` + `setsid` without `TIOCSCTTY`,
  matching Bun's PTY that `sight console` was tested with. Interrupt
  and resize signal Stata directly (`kill(pid, SIGINT|SIGWINCH)`), and
  a typed `^C` is just a byte, so `PtyBackend` doesn't strip control
  characters after all.
- `sight-pty` reports helper failures as 'E' frames on stdout; there is
  no separate status pipe (fd 4).
- Zig's macOS headers lack `<util.h>`; the helper declares `openpty`
  itself on macOS (it's in libSystem).
- Proof on voyager (StataMP 18) through the bundled runtime and the
  Zig-built helper passed: readiness at the first prompt, two queued
  sends running once each in order, errors, relative paths in a folder
  with a space, `--more--`, Ctrl-C, `shell`, resize (`c(linesize)`),
  one copy of each typed line, Tab completion, `exit`, Stata not found,
  and no Stata left after `kill -9` of the host. The VSIX installed by
  VS Code 1.123 keeps the helpers executable, and the extension's
  profile/queue path ran end to end there with a stand-in Stata.
- Untested: the darwin-x64 helper on an Intel Mac, and real Stata on
  Linux.
