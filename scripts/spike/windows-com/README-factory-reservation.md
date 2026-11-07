# Factory-only Stata COM reservation experiment

Tested on Cyllene's Windows 11 Parallels VM on 2026-11-07. This is an
exploratory spike, with no production changes or PR.

Follow-up: [count-free strategy experiments](README-factory-strategy.md)
replace process-count assumptions with a measured drain, test exact-factory
creation and races, and record optional stronger identity-prerequisite refusals.
With persistent blocking and the narrow connection-time manual-launch race
accepted, that measured strategy is a viable implementation basis under the
tested registration/security assumptions.

**Verdict: PASS for blocking an existing Stata's COM availability while
preserving its usable, unsaved GUI session on this build.** Factory-only
acquisition diverted subsequent activations to new processes without closing
or corrupting disposable originals. Blocking persisted after factory release
and helper termination in the measured windows. The user clarified that
restoring COM availability is not required, so non-restoration is an acceptable
outcome. This first spike exposed a spare server from acquiring too many
factories. The follow-up avoids process-count assumptions; its remaining narrow
manual-launch race is accepted. Broader identity guarantees remain optional.

## Reproduce

Run only in the disposable Windows desktop session, with no other Stata open.
The probe refuses any preexisting Stata process, including other sessions, and
checks PID/start identities before its COM calls. Do not remove these guards.
Do not run another COM client or launch unrelated Stata during the experiment.
The named probe mutex serializes this harness only, not arbitrary clients.

From this checkout on Cyllene:

```sh
prlctl set 'Windows 11' --pause-idle off
prlctl resume 'Windows 11'
bun scripts/spike/windows-com/factory-suite.ts

# Individual cases (do not run in parallel):
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/factory-probe.ps1 -Case release
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/factory-probe.ps1 -Case activate
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/factory-probe.ps1 -Case kill
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/factory-probe.ps1 -Case multi -Originals 3
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/factory-probe.ps1 -Case client-reserved -Client vbnet
prlctl set 'Windows 11' --pause-idle on
```

`factory-host.ts` sends an encoded PowerShell command through:

```text
prlctl exec 'Windows 11' --current-user powershell.exe -Sta -NoProfile
    -ExecutionPolicy Bypass -EncodedCommand <UTF-16LE base64>
```

It maps this worktree through `\\Mac\Home`, avoiding changes to the existing
`Y:\sight` mapping or console worktree. `factory-extra.ts` runs the additional
client, concurrency and excess-count cases as a smaller serial subset.

The complete suite contains 17 scenarios. A nonzero exit means a harness,
identity, state, or cleanup assertion failed. `verdict: PASS` means the
scenario's measurements and preservation assertions completed. Historical
`availability_verdict: FAIL` records concern the separate restoration
hypothesis, not the user's blocking criterion. Their accompanying
`original_available: false` observations support the desired continued block.
Raw measurements and historical hypothesis labels have been preserved.

Final replay: **17 completed measurement scenarios, 583 passing assertions,
93 independent UI state checks, 22 disposable originals** (two intentionally
closed by the unreserved client controls). All per-scenario initial and final
Stata inventories were empty. See
[`summary.json`](results/factory-reservation/summary.json) and the final
[`inventory.json`](results/factory-reservation/inventory.json).
The final inventory also contains no experiment helper processes. Parallels'
original `pause-idle on` setting and paused VM state were restored; see
[`vm-restored.txt`](results/factory-reservation/vm-restored.txt).

## Environment and provenance

- Mac: Cyllene, Apple Silicon arm64, Darwin 27.0.0; host Bun 1.4.4.
- Parallels Desktop / tools: 27.1.0 (58756).
- Guest: Microsoft Windows 11 Pro, ARM64, version 10.0.26200, build 26200.
- Desktop account `win-vm\jmb`, session 1; helpers explicitly reject session 0.
- Stata/MP 18.0, born 13 Oct 2026, executable file version `521,18,0,188`,
  PE machine `0x8664` (x64 under Windows ARM emulation).
- Windows PowerShell 5.1.26100.9818, CLR 4.0.30319.42000, STA, ARM64.
- ProgID `stata.StataOLEApp`, CLSID
  `{D3D9A260-CA12-48EE-A6B8-492AD0E71E70}`; LocalServer32
  `"C:\Program Files\Stata18\StataMP-64.exe"`.
- VB.NET uses the installed Stata type library 1.1, LIBID
  `{76656110-CB0F-44B4-90D2-D584B6768509}`, imported into namespace `stata`
  with .NET Framework `TypeLibConverter`, without registering anything.
  `vbc.exe` compiles the exact documented `New stata.StataOLEApp()`;
  the resulting helper reports X64 and CLR 4.0.30319.42000.
- VBScript uses the exact `CreateObject("stata.StataOLEApp")`; cscript's
  version and process architecture are recorded in its scenario JSONL.

This checkout starts at `40814551` and predates the Windows console branch.
The requested plan, probes/results and relevant `src/console/automation/`
files were read from the existing sibling checkout `t3-20e4f9cb`, branch
`t3/fix-console-pty-support`, at `d2f1d370`. No files there were changed.
This includes S1/S2/S8, debug R1/R2-R3 and their result sections. Their log
label `CreateObject` actually denotes PowerShell `New-Object -ComObject`.

## What the probe asserts

1. Inventory all existing Stata PIDs, start times, command lines and sessions
   before any Stata COM acquisition; require an empty inventory. Launch each
   original directly with `StataMP-64.exe do <unique startup.do>`, without COM.
2. Startup loads built-in `auto`, sets a unique global macro and dataset string
   marker, changes `price[1]` to 918273, stores a full `datasignature`, and
   signals readiness. The dataset is unsaved (`c(changed)==1`).
3. At every preservation checkpoint, send a new, nonce-bearing do-file to
   that original's PID-specific Command Scintilla control via value-only
   `WM_CHAR` and Enter messages. Stata asserts 74 rows, the changed price,
   known make, global marker, every row's data marker, `c(changed)==1`, and
   `datasignature confirm`, then writes a unique response. This proves command
   execution and dataset preservation; PID survival alone is insufficient.
   It acquires no Stata Automation object on the original.
4. P/Invoke `CoGetClassObject(CLSCTX_LOCAL_SERVER=4, IID_IClassFactory)` into a
   raw `IntPtr`. Retain only that pointer. The code never calls its
   `CreateInstance`, `LockServer`, or `IDispatch`; no factory RCW is created.
5. Normal activation is a separate PowerShell Automation request. Require an
   empty original marker, an initially empty dataset, then create independent
   three-row data with value 314159 and a unique new marker. Set the returned
   object's title, correlate it to a distinct PID/start identity and
   `-Embedding` command line, and check that exactly one new server appeared.
6. Release the new Automation object and factory in both orders, with fresh
   original state checks between stages and after release. The new Automation
   server must exit. Only experiment-owned PID/start identities are cleaned up.
7. In availability endpoint tests, deliberately make a separate normal
   activation **after** preservation has been checked. Its returned marker and
   PID determine whether the original became available. If it ever returns
   an original, that disposable instance is intentionally taken over by this
   endpoint; this is not used merely to inspect preservation.

Responses are read only after the writer closes the ready file. The JSONL
includes timestamps, assertions, identities, script SHA-256 hashes and cleanup
inventories. Stata logs begin inside the startup do-file, after the license
banner; no license/serial screenshot or credentials are retained. Account and
experiment paths are retained because they establish session and command-line
provenance. Raw JSONL line endings are normalized to LF; Stata logs are gzip
compressed after collection.

## Measured outcomes

| Scenario | Observation |
| --- | --- |
| Factory acquire/release only | No extra process; original executes state checks while held and after release. |
| Reserved normal activation, four bounded repeats | Exactly one new `-Embedding` PID each time, distinct marker/data; original intact after new-object release and factory release. |
| Factory released before new Automation object | Original intact while the new object is still held and after both releases. |
| Availability after factory release | Next activation starts a new server, blank original marker. Original remains usable through its GUI, but was not available to that COM client. |
| Orderly factory helper exit | Original intact; next client still gets a new server. |
| Forced factory helper termination | No explicit Release/CoUninitialize; original intact at approximately 3 and 30 seconds. Next activation after the 30-second checkpoint still gets a new server. This is forced process termination, not an access-violation or power-loss test. |
| Two and three originals | N factory acquisitions start no extra servers; next activation gets one new PID. Every original passes state checks through staged releases. Factory-to-PID correspondence remains unknown. |
| VBScript and VB.NET unreserved controls | Both claim the original marker and original PID. Releasing the returned Automation object closes that disposable original with unsaved data. |
| VBScript and VB.NET after reservation | Both get a new PID and distinct marker; original state survives release. |
| Two concurrent clients after reserving two originals | Overlapping activation intervals yield two distinct new servers; both originals remain intact after both clients and factories release. |
| N+1 factory acquisitions for N=2 originals | Third call starts a spare `-Embedding` server, without CreateInstance. It is still alive three seconds after all factory releases; the harness explicitly cleans it up. |

The aggregate replay and exact run IDs are in
[`results/factory-reservation/final-suite.txt`](results/factory-reservation/final-suite.txt).
Each referenced `<run>.jsonl` contains complete assertions and process
evidence; `<run>-original<N>.log.gz` contains the actual Stata checks.
Earlier development runs are retained separately from the final replay.
The final replay was resumed at scenario index 6 after Parallels returned
`PrlJob_Wait: Invalid argument` before starting that scenario. A fresh
[`transport-recovery-inventory.json`](results/factory-reservation/transport-recovery-inventory.json)
confirmed no Stata or experiment helpers remained; no scenario JSONL was
created by the rejected transport call. The resume command was
`bun scripts/spike/windows-com/factory-suite.ts 6`.

## Contract interpretation and practical limits

Microsoft documents that `REGCLS_SINGLEUSE` removes a class object from public
availability after a `CoGetClassObject` connection. That is conditional on the
server's registration flags; we did not instrument Stata's
`CoRegisterClassObject`. The observed behavior is consistent with SINGLEUSE,
not direct proof of the flag used by Stata.
[REGCLS](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/ne-combaseapi-regcls)

`CoGetClassObject` may launch the executable when necessary. It returns a
class interface; creating an instance is a separate step. Its contract provides
no PID selection or enumeration of available registrations. This explains why
blind factory counting can start an unwanted server.
[CoGetClassObject](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-cogetclassobject)

Releasing a pointer decrements that interface's reference count. It does not
promise re-registration or continued application lifetime; returned reference
counts are test diagnostics, not a server-ownership API.
[IUnknown::Release](https://learn.microsoft.com/en-us/windows/win32/api/unknwn/nf-unknwn-iunknown-release)

Stata documents the two construction expressions used in the controls and
requires object release. It does not establish the factory-only lifetime or
PID-selection behavior measured here.
[Stata Automation](https://www.stata.com/automation/)

There is no justified general exclusion guarantee:

- A process count is not an available-factory count. Some processes may already
  be claimed, still starting, exiting, or not yet registered. Factory pointers
  cannot be matched to PIDs by the tested API; pointer identity/reference
  counts do not solve identification.
- Inventory and global COM acquisition are not atomic. An unrelated client
  can activate between them; a newly launched Stata can register between the
  last reservation and the intended activation. Reserving existing originals
  first does not protect future originals. The measured concurrency test
  starts clients only **after** all reservations finish; it does not eliminate
  these races.
- Blocking survived factory release and helper death in the measured windows,
  which meets the user's criterion. Its indefinite duration is unproven:
  we did not establish whether an application-specific action could
  re-register that running original, or whether availability could recover
  after longer delays.
- Results cover this Stata/MP 18 build, Windows ARM64 and idle GUI originals.
  Other editions/builds, modal/busy states, cross-session COM/security policy,
  access-violation crashes, and external activation during reservation remain
  unmeasured.

The experiment is a positive result for the requested blocking mechanism.
Factory counting, ordering and races need further work before claiming that
an implementation will always exclude every existing user Stata. No
production implementation or console ownership change is part of this spike.

## Harness development notes

Early failed runs are not counted as successful experiments: a startup
`file write` expression needed parentheses; a new-window title needed quotes;
and a VBScript ready-file read raced its writer. Their JSONL and logs are
retained to explain the failures. Before any COM tests, a disposable UI probe
using an unsupported cross-process Scintilla string pointer crashed its own
Stata. The retained probe uses only value-bearing characters; two subsequent
UI setup attempts failed to submit a command, then the value-only path passed.
No unrelated Stata was present or touched in these setup attempts.

Repository checks: `bun run check:line-endings`, `bun run typecheck`, and
`bun run lint` passed. `bun test ./tests`: 8,020 passed, 12 skipped, 0 failed.
Typecheck/lint initially could not find their binaries in this fresh worktree;
`bun install --frozen-lockfile` installed dependencies and both checks then
passed. Lockfiles and production source were not changed.
