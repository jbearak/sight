# Windows debug harness

These probes are for a throwaway Windows VM with registered Stata/MP 18.
They close Stata they start. Do not run them with another Stata open.
Run PowerShell probes in the desktop user's session, for example:

```sh
prlctl exec 'Windows 11' --current-user powershell.exe -Sta -NoProfile \
  -ExecutionPolicy Bypass -File 'Y:\sight\scripts\spike\windows-com\debug-r1.ps1'
```

The TypeScript headless harness runs the production bridge, connect sequence,
backend and log tail. Invoke `debug-backend.ts` with Windows Bun. It exercises
Stata, program, Mata, Python, log loss and exit, and refuses to run if Stata is
already open. `debug-entry.ts` prints Bun's entry-point paths.

`debug-conpty.ps1` runs the real CLI in a Windows pseudoconsole. It expects a
Windows-local source copy at `C:\sight-debug`, with `bun install` run there,
and the test Bun at `%TEMP%\sight-bun\bun-windows-x64\bun.exe`. Copy the
current source changes into that copy first. Its `-Scenario` values are
`basic`, `editing`, `lostlog`, `blockbreak`, `decline`, `share`, `yes`, and
`two`. It drives the console without a person, writes the raw terminal bytes,
and asserts expected output and exit status. The blockbreak case is expected
to time out on the tested build: inspect the raw trace and Stata log rather
than treating that case as a pass.

`debug-terminal-start.ps1`, `debug-terminal-close.ps1` and
`debug-stata-close.ps1` exercise the dedicated Windows Terminal window. The
close script identifies the dedicated window by title and sends WM_CLOSE;
start it before the close script and allow time for Stata to start. The R1,
R2/R3 and R4 scripts check no-argument sharing, changed-data release, and a
helper crash. The R4 script cleans up its own Stata after its observation.

`debug-build.ps1` builds the extension in the Windows-local copy. The
`debug-extension-runner.cjs` and `debug-extension.cjs` files run a VS Code
extension-host integration test using the installed VS Code executable and a
separate user-data directory. Copy them into the same paths in the local copy.
`debug-extension-tty.ps1` adds a temporary diagnostic to a *local build copy*
(the original is saved by `debug-copy-cli.ps1`), then reruns the harness.
The current integrated-terminal test fails before Stata starts, as recorded in
the plan. These diagnostics do not modify the user's VS Code profile.

Raw ConPTY output and Stata logs in `results/` are gzip-compressed, preserving
their bytes. Text transcripts have Windows line endings normalized to LF.
