# Handoff: get `sight console` working on Windows (debug session)

Paste everything below the line into a new Codex (GPT-6.1 Terra) thread
on Cyllene, in a checkout of github.com/jbearak/sight on branch
`t3/windows-stata-com-console`.

---

`sight console` on Windows is fully implemented on this branch but has
never run on Windows. Your job is to make it work, by driving the
Windows VM yourself, end to end. **The user won't do any steps:** don't
ask them to type, click, or close anything. Automate every check. If
something truly can't be automated, record it as unverified in your
report instead of asking.

Read first: `CLAUDE.md`; the plan
`docs/superpowers/plans/2026-10-30-windows-console-com.md` (the design,
plus "Phase 0 results" from the earlier spike you ran); `docs/console.md`
("Windows" section); `docs/send-to-stata.md` ("Windows: sight console").
Code: `src/console/automation/` (bridge script, connect sequence,
backend, log tail, run), `src/console/index.ts`, and on the extension
side `client/src/send-to-stata/console-terminal-core.ts`,
`stata-terminal-manager.ts`, `commands.ts`.

This is a time-boxed trial. The user's decision afterwards: merge as
experimental if the core works, or close it as too convoluted. So
prioritize getting the core flow working and report honestly how close
it is. Fix bugs; don't redesign. If a finding contradicts the design
itself, stop that thread of work and report it.

## Environment

- Windows 11 Arm64 in Parallels on this Mac, Stata/MP 18 registered for
  Automation (`C:\Program Files\Stata18\StataMP-64.exe`). Find the VM with
  `prlctl list -a`.
- Run Windows commands with `prlctl exec "<vm>" --current-user ...`
  (without `--current-user` they run as SYSTEM in session 0, where COM
  can't reach a desktop Stata). Screenshots: `prlctl capture "<vm>"
  --file x.png`.
- The repo is reachable from the VM as before (the spike used `Y:\sight`);
  install Bun in the VM if it isn't there, and `bun install`.
- Use only throwaway data (`sysuse auto`). Close any Stata you start.
  If a Stata is open that you didn't start, treat it as the user's and
  leave it alone.

## How to drive it without a person

1. **Headless first.** Write a small harness script (commit it under
   `scripts/spike/windows-com/`) that runs the real bridge, connect
   sequence and `AutomationBackend` with events printed to stdout and
   lines submitted from a script. This isolates PowerShell/COM/log bugs
   from terminal bugs. Expect the bridge script
   (`src/console/automation/bridge-script.ts`) to need fixes: it has
   never been parsed by PowerShell.
2. **The real CLI in a pseudo-console.** Write a driver that runs
   `bun src/cli.ts console` inside a Windows pseudo-console
   (`CreatePseudoConsole`; for example C# via PowerShell `Add-Type`, or
   whatever works), types keys including Ctrl+C, Ctrl+D, arrows and Tab,
   answers the take-over question, and captures the screen bytes. Assert
   on transcripts. Also run it once in a real Windows Terminal window
   started with `prlctl exec`, and check it with screenshots.
3. **Closing things.** Close terminal windows and Stata windows
   programmatically (send `WM_CLOSE`, or `CloseMainWindow()`), and kill
   processes where a test calls for a crash.
4. **The VS Code side.** Build the extension (`cd client && bun run
   vscode:prepublish`) and drive it with VS Code's extension test
   harness (`client/test/runTest.js`, `@vscode/test-electron`) on
   Windows: run the send commands with `sight.sendToStata.target` set to
   `integrated`, observe the console terminal, its exit codes, the
   offer, and dispatch to send-to-stata. Stub or auto-answer the
   notification in test code where needed.

## What to check, in order

1. The bridge starts, passes `self_test`, finds the registration.
2. No Stata open: a new one starts, its window is visible with the
   `sight console` title, the first prompt appears, `display 1` works,
   the echo shows once, errors are red, `exit` quits Stata and the
   console.
3. Blocks and modes line by line: `foreach`, `program define`, `mata` /
   `end`, `python` / `end`; prompts `  2. `, `  1. `, `: `, `>>> `.
4. Ctrl+C during `sleep 10000`; typeahead while busy; Ctrl+C at a block
   prompt.
5. One Stata open (one you start): the question appears; `n` exits 81
   with no COM call; `y` shares it; `--yes` skips the question. Two open:
   exit 80.
6. Closing the terminal closes the console's Stata (the user accepted
   that); closing Stata's window ends the console; killing the bridge
   ends the console and Stata closes afterwards (measure how long).
7. A do-file with `log close _all`: the lost-log line appears, prompts
   continue.
8. VS Code: integrated target on Windows runs the console; sends before
   readiness are queued and typed once it's ready; exit codes 80, 81, 82
   produce the right offer or dispatch; This session and Always work.
9. The remaining Phase 0b items (R1-R9 in the plan), where they affect
   the above. R1 matters most: can a Stata started from the Start menu
   (no arguments) be shared?

## Working rules

- Fix bugs with a regression test where one can run on any OS (the fake
  bridge tests in `tests/unit/console/` and
  `tests/unit/send-to-stata/`); Windows-only checks live in your
  harness scripts.
- Run the gates separately before each push: `bun run
  check:line-endings`, `bun run typecheck`, `bun test ./tests` (two
  help-topic tests already fail without a local Stata install on the
  Mac; that's known), `bun run lint`.
- Commit in small steps on `t3/windows-stata-com-console` and push.
- Append a section `## Windows debug results` to the plan: what works,
  what you fixed, what still fails, what remains unverified, and the
  R-item findings.

Finish with a short report: does the core flow (items 1-6) work now?
What's broken or unverified? Your honest view on whether this is close
to "experimental but usable" or not.
