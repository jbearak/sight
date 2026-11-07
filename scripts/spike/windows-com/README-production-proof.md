# Production fresh-Stata proof on Cyllene

Tested **2548950b8abb9d6f7f6c74727111a6ae6a58b04a** from
`t3/target-stata-window`, 2026-11-07. No production files were changed.
The proof branch is `t3/target-stata-window-proof`; no PR was requested.

**Verdict:** the production implementation passed the requested normal,
overlapping-console, existing-client, registration-rejection, and graceful
cancellation cases on this VM. Original windows remained usable with their
unsaved data intact. Forced second cancellation can leave the newly started
Stata running; its observed exit codes and notices are recorded below.
No production change was necessary to obtain these results.

## Environment and scope

Windows 11 Pro 10.0.26200, ARM64 Parallels guest; desktop user
`WIN-VM\jmb`, session 1; Windows PowerShell 5.1.26100.9818, native ARM64;
Bun 1.4.4 x64; Stata/MP 18 x64,
`C:\Program Files\Stata18\StataMP-64.exe`, file version `521,18,0,188`.
CLSID `{D3D9A260-CA12-48EE-A6B8-492AD0E71E70}` resolves to that executable.
Normal HKLM registration has no AppID configuration; the HKCU class is absent.
See [verified-environment.json](results/production-proof/verified-environment.json).

All Stata/COM work ran through `prlctl exec 'Windows 11' --current-user`.
Only HKLM registry backup/mutation/restore ran in the privileged session.
Every scenario first refused any preexisting Stata. All fixtures were directly
launched disposable desktop Statas, without Automation acquisition, using
startup do-files. Inventories retain PID, UTC start time, command line, session,
and title before/after each case. Cleanup checked PID **and** start time.

The Windows source copy was `C:\sight-target-proof`, separate from the earlier
`C:\sight-debug`. SHA-256 checks of all **172** copied source files match this
checkout; production `src/` and `client/` have no diff from the tested commit.
See [source-verification.json](results/production-proof/source-verification.json)
and [windows-source-hashes.json](results/production-proof/windows-source-hashes.json).

## What ran and what was asserted

`proof-driver.ts` calls the real `open_automation_console`, PowerShell bridge,
connection identification, and backend. Its transport wrapper only records
traffic/timing and, in cancellation cases, invokes the public cancellation
handle at specified request boundaries. It does not substitute COM behavior.
`proof-pty.ps1` runs the actual `bun src/cli.ts console --no-history` through
ConPTY, including literal Ctrl+C input. No production code was instrumented.

Original-state verification uses the independent PID-targeted UI Command
control, **never an Automation reference to an original**. The generated do-file
asserts all of: `_N == 74`, `price[1] == 918273`, the expected first make,
unique global and dataset markers, `c(changed) == 1`, and
`datasignature confirm`; a fresh nonce response proves successful execution.
The fixtures start with `sysuse auto`, modify price, add a marker variable and
global, and set the expected signature without saving the dataset.

Evidence below is under `results/production-proof/`. Each named run has a
`.jsonl` inventory/assertion transcript and, for driver runs, sibling
`-consoleA/` and `-consoleB/` traces, output, and result files.

| Requested case | Result and key measured evidence | Run |
| --- | --- | --- |
| 1. Two unsaved originals | PASS. Originals 3472/6172; new owned PID 5884, title `Stata - sight console b902e507`, `notices: []`; output `771011`; both UI state checks pass during/after console; own exit 0, no spare. Actual CLI additionally prints `887077` and exits 0. | `proof-originals-031fb281`; `proof-pty-basic-1-60983451` |
| 2. Start B while A is running | PASS. A 8400 and B 12640 are distinct new Statas. A retains `own_proof=314159` and global `PROOF_CONSOLE_A=kept` (`882233`), and answers after B exits. Both `exit, clear` results 0; originals survive; no spare. | `proof-sequential-c8c4ff1d` |
| 3. Start two together | PASS. Driver launches 11.8 ms apart; both connect attempts overlap. A 9336, B 13384. B reports `Another sight console is connecting; waiting. Ctrl+C cancels.` Neither has a not-own notice. Both own exits 0; originals intact. | `proof-simultaneous-4548d89f` |
| 4. Original held by another client | PASS. Two originals, one already held by a full Automation client. Production drains only 1 available factory, gets new PID 10776. Existing client progresses from 1 to 44 successful commands, remains alive, and originals pass UI state checks. | `proof-held-6690dcf1` |
| 5. No Stata open | PASS. Exactly one new session, PID 2864, title `sight console d4f562cb`; drained 0; commands succeed; exit 0; empty inventory afterwards. | `proof-empty-b0fe7bce` |
| 6. Concurrent manual launch | PASS for four attempts: one beside driver start, three triggered by the actual outbound connect request. All obtained a distinct new owned session with no notice; each manual original passed UI checks and survived. No silent attachment observed. | `proof-race-same-ea04a80e`; `proof-race-connect-55ef83b6`, `-a2e234c8`, `-f9e96f7f` |
| 7. Manual launch about 1 s earlier | PASS. Manual fixture predates console process by about 1 s. Console obtains new PID 7252; manual state survives; no notice/spare. | `proof-race-before-3d222dee` |
| 8a. Unsupported HKLM RunAs | PASS. `driver_exit: 87`, `exit_code: 87`, message identifies HKLM AppID RunAs. No connect request or new Stata; originals unchanged. Exported class backup and whole-tree comparison verify restore; temporary AppID absent. | `proof-registration-HKLM-9e847b15` |
| 8b. Unsupported HKCU RunAs | PASS. Same assertions and exit 87, with HKCU error path. Class was originally absent, so backup records absence; created class removed and temporary AppID absent, verified. | `proof-registration-HKCU-a7f1d5fc` |
| 9. One cancellation during connect | PASS at all four boundaries, detailed below. Exit 130; originals remain responsive and unchanged; no extra server. | Cancellation table below |

The four racing manual launches all landed on the fresh-session outcome.
These runs do **not** prove that the manual-capture/not-own-notice branch was
exercised, nor establish an arbitrary-concurrency ownership guarantee. The
accepted policy permits that narrow startup race; identity is confirmed after
creation through the unique title and PID/start evidence. Later manual windows
do not redirect an already held Automation object.

## Cancellation, including what remains after a second cancellation

| Boundary and mechanism | One cancellation | Two cancellations |
| --- | --- | --- |
| Readiness: actual CLI Ctrl+C, fixture process created suspended, then resumed | PASS, exit 130; only both originals remain. `proof-pty-readiness-1-60aef259` | Recorded, exit 130; only originals remain. `proof-pty-readiness-2-8818bd9e` |
| After drain/during activation: actual CLI Ctrl+C triggered by new session process birth | PASS, exit 130; no spare. `proof-pty-after-drain-1-ab336b68` | Recorded, exit 130; newly created `-Embedding` PID 7508 remained, initially windowless. `proof-pty-after-drain-2-77486abe` |
| Free-wait: real production `is_free` request, `OpenHandle.cancel()` | PASS, exit 130; no spare. `proof-cancel-free-1-88b2f72c` | Recorded, exit 130; newly created PID 6480 remained. `proof-cancel-free-2-f734cea9` |
| Title: real production title-setting `do_sync` request, `OpenHandle.cancel()` | PASS, exit 130; no spare. `proof-cancel-title-1-9ce35de7` | Recorded, exit **1**; newly created titled `-Embedding` PID 1404 remained; unknown-identity notices and lost connection. `proof-cancel-title-2-8cfd0eb6` |

All completed cancellation cases independently rechecked original state.
The CLI after-drain trigger observes process birth rather than an internal
instruction boundary. Free/title cases use the exact public cancellation path
at traced requests; they are not represented as literal ConPTY keypresses.

Representative actual CLI output:

```text
Waiting for Stata to start. Ctrl+C stops once Stata answers.
Stopping after Stata answers; press Ctrl+C again to stop at once (a Stata being started may then stay running without a window).
```

Double-title trace excerpt (same behavior in two attempts):

```text
request do_sync: window manage maintitle "Stata - sight console 9754b60d"
cancel: outcome=graceful, own_pid=null
cancel: outcome=killed, own_pid=null
notice: sight console couldn't confirm which Stata window it is connected to. That Stata closes when the console ends, so save any work in it first if needed.
notice: Ctrl+C came while connecting, but this Stata wasn't started by the console, so it was kept; type exit to end the console.
backend_exit: status=1, Lost the connection to Stata; its window may still be open.
```

The second notice describes the conservative unknown-ownership path; the
isolated inventory proves that this particular leftover was actually created
by the console. The user requested recording forced-cancel leftovers, not a
graceful-exit guarantee for a killed bridge. This is a measured limitation,
including misleading wording after identity determination is interrupted.
All such leftovers were captured before targeted experiment cleanup. They are
not counted as passing the single-cancel no-spare assertion.

The extra Task Manager recovery check **did not pass automated UI validation**.
`proof-task-manager.ps1` opened Task Manager for a known leftover, but its UI
Automation tree exposed XAML host windows and no Details navigation, even after
15 s. See `proof-pty-after-drain-2-86ebff72.jsonl` and
`task-manager-leftover-retry3.txt`. Thus the executable/PID described by the
documentation was confirmed by process inventory, but finding that row in the
Task Manager UI was not verified. This is a harness/accessibility limitation,
not evidence that Task Manager cannot show it. No settings were changed to
work around it. All four recovery-check attempts still verified the original
Statas and cleaned their own leftover. The first attempt's launcher-stub
handling was corrected; its Task Manager PID 7708 was explicitly cleaned
after checking its start timestamp (Unix ms `1794082231551`).

## Registration and strategy assumptions

The actual implementation uses `CoGetClassObject` for `IID_IClassFactory`
`00000001-0000-0000-C000-000000000046`, with `CLSCTX_LOCAL_SERVER |
CLSCTX_DISABLE_AAA` = **0x8004**, retaining raw factory pointers without
`CreateInstance`. Drain exhaustion is **E_ACCESSDENIED, 0x80070005,
-2147024891** under the tested ordinary registration. It then requests a
factory with **0x4** and calls `IClassFactory::CreateInstance` on that exact
pointer (vtable slot 3), `pUnkOuter=NULL`, `IID_IDispatch`
`00020400-0000-0000-C000-000000000046`. C# uses
`Marshal.GetObjectForIUnknown`, releases the temporary dispatch pointer, and
returns the RCW for PowerShell 5.1 Stata Automation calls. Factory pointers are
released in `finally`; the resulting Automation object is retained.

This is count-free, with a production drain bound of 16 factories. Already held
objects are skipped naturally. The bridge readiness wait is bounded at 10 s;
title-marker identification then compares the returned session with PID/start
and `com_started` evidence. It does not map a raw factory to a PID beforehand.

`DISABLE_AAA` suppresses activate-as-activator activation; it is **not a universal
existing-only switch**. Configured RunAs/AppID/LocalService behavior may differ.
The tested production guard refuses the two RunAs registrations before COM
acquisition and detects unexpected process creation during the drain. This
proof covers this installation and the two tested unsupported configurations;
it does not establish every possible registration/security/architecture
configuration. Persistent blocking of originals and the narrow manual-launch
startup race remain explicitly accepted policy.

## Reproduction commands and harness changes

Start from the tested commit on Cyllene, with Parallels running and the guest
desktop signed in. The initial guard must find no unrelated Stata. The scripts
contain this test machine's VM name, executable path, and Home-share mapping.

```sh
git fetch origin t3/target-stata-window
bun install --frozen-lockfile
prlctl set 'Windows 11' --pause-idle off
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/proof-setup.ps1
bun scripts/spike/windows-com/proof-suite.ts
bun scripts/spike/windows-com/proof-suite.ts race-same race-connect race-connect race-connect race-before
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/proof-pty.ps1 -Case basic
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/proof-pty.ps1 -Case readiness -Count 1
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/proof-cancel.ps1 -Stage free -Count 1
bun scripts/spike/windows-com/proof-cancel-suite.ts
# Optional recovery UI check; UIA Details was unavailable in this environment:
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/proof-pty.ps1 -Case after-drain -Count 2 -VerifyTaskManager
bun scripts/spike/windows-com/proof-registration.ts HKLM
bun scripts/spike/windows-com/proof-registration.ts HKCU
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/proof-verify.ps1
prlctl set 'Windows 11' --pause-idle on
prlctl pause 'Windows 11'
```

`proof-registration.ts` exports/snapshots before modification, restores in
`finally`, and verifies full class-tree equality plus temporary AppID absence.
Its `restore` argument resumes restoration after a helper failure; do not
overwrite its backup. No COM acquisition runs in the privileged session.

New harness files provide: isolated Windows staging; traced production driver
and file-based command control; shared fixtures and independent UI checks;
existing-client heartbeat; suspended-start and ConPTY helpers; lifecycle/race
and cancellation runners; registry backup/restore/rejection orchestration;
and final inventory/source/PowerShell-parser checks. `factory-host.ts`,
`factory-native.cs`, and `strategy-common.ps1` reuse the earlier spike's
desktop transport and UI channel. Existing production and debug harness files
were left unchanged.

## Timing, harness corrections, and final state

`prepare` request/reply time, including actual Add-Type: **19** samples from
successful driver-run traces, **217.760 ms minimum, 225.516 ms median,
242.021 ms maximum**. This excludes PowerShell process startup and self-test.
See [prepare-timing.json](results/production-proof/prepare-timing.json).

Earlier failed attempts are retained and distinguished from production bugs:

- `proof-originals-e0a613e3`: PowerShell's process ExitCode was null because
  the harness had not retained the process handle; backend result was 0.
- `proof-empty-f0d206cf`: a harness reader's default file-sharing mode blocked
  the driver's output write (EBUSY); fixed with shared reads.
- Initial HKLM orchestration had an escaped-path typo; the subsequent actual
  mutation/test passed. Restore initially hit PowerShell 5.1's inability to
  parse JSON with empty property names (registry default values). The fixed
  serializer restored/verified the backup before continuing.
- First double-free cleanup compared UTC to a locally parsed time and left
  owned PID 9400. The next case correctly refused to proceed. Exact-identity
  cleanup is in `explicit-owned-cleanup-9400.json`; UTC normalization fixed.
- `proof-cancel-title-2-4aea216e`: the harness incorrectly required exit 130
  after forced cancellation. The corrected recording-only double-cancel
  assertion reran as `proof-cancel-title-2-8cfd0eb6`, with original state
  verified and the actual exit 1 retained.

No production implementation bug was established against the requested
accepted policy. Forced cancellation's leftover and wording are reported
above rather than hidden by the harness corrections.

Validation: `bun run typecheck:scripts`; scoped ESLint for the added TypeScript
harnesses; Windows PowerShell parser checks of proof scripts and reused UI
helper; `bun run check:line-endings`. C# helpers compiled and executed in the VM.
No full production suite was repeated for this harness/evidence-only change.

Raw ConPTY bytes are preserved as `.bin.gz`, with searchable `.terminal.txt`
views. Text evidence is LF-normalized and UTF-8 BOMs removed. Irrelevant
serialized Process/module metadata from the first HKLM setup was omitted;
identity, markers, assertions, inventories, and registry backups remain.

[Final inventory](results/production-proof/final-inventory.json): **zero Statas,
zero experiment helpers**, session 1. Both registry trees restored and
verified. [VM settings](results/production-proof/vm-restored.json): **paused,
pause-idle on**, matching its initial state. Only experiment-owned processes
were terminated; unrelated user instances were absent throughout testing.
