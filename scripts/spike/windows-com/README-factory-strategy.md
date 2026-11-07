# Count-free factory strategy: measured result

Tested 2026-11-07 on Cyllene, continuing the
[factory-only spike](README-factory-reservation.md). No production integration
or PR. Persistent blocking and the narrow manual-launch race during connection
are accepted requirements.

**Practical verdict: the measured count-free drain plus exact-factory creation
is a viable implementation basis under the tested registration/security
assumptions.** Existing available originals were blocked while retaining their
usable, unsaved GUI state, existing clients continued working, and successful
diagnostics obtained sessions without spare servers. The user accepts that a
manual Stata opened after initiating Sight, while Sight is still connecting,
can become its session. Arbitrary-concurrency ownership proof and CoDecodeProxy
availability are therefore not mandatory blockers for this policy. The stricter
identity policy remains optional; its permission failures and race evidence
are preserved below.

## Accepted requirements and protection scope

- Persistent COM blocking of originals is acceptable. Release need not restore
  their availability to later COM clients.
- Protect existing originals whose available factories are drained, preserving
  their data, macros, unsaved state and GUI usability. Existing Automation
  clients must remain usable; process count is not an available-factory count.
- Accept this sequence: Sight starts connecting and drains currently available
  original factories; the user manually opens another Stata before Sight
  finishes acquiring its session factory; COM supplies that new window.
  That window becomes Sight's session and follows its Automation-reference
  lifetime, including closing when that reference is released.
- Once Sight holds its actual session Automation object, later manually opened
  windows do not redirect that object. This acceptance concerns the connection
  interval, not arbitrary attachment to an established preexisting original.
- The successful fixtures were ready and registered before their protection
  phase. An already-starting original that registers only after the drain is a
  distinct readiness/registration assumption, not silently covered by the
  user's acceptance of a new manual launch after initiating Sight.
- Registration/security conditions must support the observed no-launch drain.
  Unsupported configurations and acquisition bounds still require explicit
  handling. No production integration is authorized by this report correction.

## Reproduce

Use only the disposable desktop session, with no unrelated Stata open. All
Stata probes inventory first, reject preexisting processes, and retain
PID/start-time identities for experiment cleanup. Run these serially:

```sh
prlctl set 'Windows 11' --pause-idle off
prlctl resume 'Windows 11'

# Expected red: one original, one excess acquisition leaves an unwanted server.
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/factory-probe.ps1 -Case excess -Originals 1 -Results '\\Mac\Home\.t3\worktrees\sight\t3-fdcafb27\scripts\spike\windows-com\results\factory-strategy'

# Complete strategy matrix, including expected refusals and negative controls.
bun scripts/spike/windows-com/strategy-suite.ts

# Optional stronger identity policy: expected probe exit 3, suite exit 0.
bun scripts/spike/windows-com/strategy-suite.ts 0 strict

# Successful adaptive/exact-factory evidence for the accepted policy.
# The historical mode name does not imply a proof of PID identity under races.
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/strategy-probe.ps1 -Case adaptive-mixed -Policy quiescent-diagnostic

# API controls, one at a time:
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/strategy-api.ps1 -Mode decode
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/strategy-api.ps1 -Mode noaaa-original
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/strategy-api.ps1 -Mode noaaa-empty
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/strategy-x64.ps1
bun scripts/spike/windows-com/factory-host.ts scripts/spike/windows-com/strategy-api.ps1 -Mode marshal

prlctl set 'Windows 11' --pause-idle on
prlctl pause 'Windows 11'
```

`factory-host.ts` uses `prlctl exec --current-user`, STA Windows PowerShell
and UTF-16LE EncodedCommand. It now explicitly propagates `$LASTEXITCODE`:
PowerShell's `-Command` path otherwise collapsed the new exit code 3 to 1.
Probe exits: **0** successful diagnostic, **1** failed assertion/harness,
**3** explicit safe refusal. The suite recognizes expected 1/3 outcomes;
its exit 0 means the expected outcomes were verified, not that all strategies
obtained sessions. `strategy_result: {ok:false,...}` distinguishes refusal
from successful session acquisition.

The first spike's excess case formerly recorded a spare server and passed
its measurement assertions. It now additionally asserts
`NO_UNWANTED_EXTRA_SERVERS`; the smallest repro is intentionally red. Previous
artifacts are unchanged.

## Ranked alternatives and observed contracts

Predictions were written before measurements in
[strategy-predictions.md](strategy-predictions.md).

| Alternative | Actual result |
| --- | --- |
| CoDecodeProxy on raw IClassFactory, before CreateInstance | `0x80070005` E_ACCESSDENIED on both ARM64 PowerShell and compiled x64 helper. No server PID returned. Helpers ran unelevated in desktop session 1. |
| LOCAL_SERVER + DISABLE_AAA, available original | S_OK, raw factory retained; no new Stata; original UI state intact. |
| Same flags after exhaustion, or initially empty | E_ACCESSDENIED, null factory, no new Stata. |
| Normal adaptive acquisition until a new server, CreateInstance on that exact last factory | Green in isolated one-original and mixed-client experiments: two acquisitions, one new `-Embedding` server, zero spare/orphan servers. |
| Drain without launch, explicitly launch owned candidate, create from exact acquired factory | Green in quiescent lifecycle cases, with independent object PID/start verification. |
| Competing registration/factory consumption before final lookup | Red under the stronger owned-candidate assertion: the exact returned factory belongs to the competing manual original. Its macro proves the mismatch. A new manual window selected during the accepted connection interval is allowed by the current policy. |
| Optional strict identity gating | Explicit failure, zero CreateInstance/fallback calls. Its last tested version checks identity capability before launching its owned candidate. This stronger guarantee did not pass and is not required by the accepted policy. |

Microsoft defines DISABLE_AAA as suppressing **activate-as-activator** launches,
not every possible server launch. Configured RunAs, AppID, LocalService, remote
activation, policy or registration changes can invalidate this installation's
observed no-launch behavior. E_ACCESSDENIED is not a universal class-table
exhaustion status. The supported-registration guard refuses other observed
configurations; it does not turn the flag into an existing-only API.
[CLSCTX](https://learn.microsoft.com/en-us/windows/win32/api/wtypesbase/ne-wtypesbase-clsctx),
[AppID](https://learn.microsoft.com/en-us/windows/win32/com/appid-key),
[LocalService](https://learn.microsoft.com/en-us/windows/win32/com/localservice).

The measured registration is HKLM's 64-bit Stata CLSID, LocalServer32
`"C:\Program Files\Stata18\StataMP-64.exe"`, an empty class AppID value,
no executable AppID key, and no observed RunAs/LocalService/remote mapping.
Both registry views and HKLM/HKCU were read without mutation; see
[`environment.json`](results/factory-strategy/environment.json). Windows,
Stata and helper versions match the preceding spike: Windows 11 Pro ARM64
10.0.26200, Stata/MP 18 born 13 Oct 2026, file 521,18,0,188, PowerShell
5.1.26100.9818 / CLR 4.0.30319.42000, Parallels 27.1.0 (58756).

CoDecodeProxy is a documented debugger API whose contract permits denial when
the developer license is unavailable. These measurements establish denial,
not which internal licensing check caused it. Developer/security settings
were not changed. Decoder availability is required only by the optional
stronger identity policy, not by the accepted implementation basis.
[CoDecodeProxy](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-codecodeproxy),
[ServerInformation](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/ns-combaseapi-serverinformation).

## Accepted implementation basis

Use the measured count-free acquisition behavior rather than acquiring
`process_count` factories. Under the tested configuration, the no-launch
drain can retain currently available original factories until its observed
stop condition, within an acquisition bound. A normal factory acquisition
then obtains the session factory, launching Stata if needed or selecting the
new manual window in the accepted race. Create the Automation object from
**that exact acquired factory**, without another global activation. Retain the
session object for the connection's lifetime; original raw factories can be
released without closing their GUI sessions in the measured cases.

This basis combines the measured no-launch drain with the successful normal
adaptive/exact-last-factory controls. The explicit-candidate diagnostics also
test exact-factory creation and lifecycle behavior. These are spike results,
not a claim that an integrated production connection flow has been built.
Avoid interpreting the optional explicitly launched candidate path as necessary
for the accepted policy, or leaving an unused candidate when a racing manual
window is selected.

Identity checks in the successful experiments establish what actually happened:
fixture macros and data identify the returned session; a unique title correlates
the object with PID/start evidence; independent UI checks establish original
state preservation. They do not prove the server PID of every raw factory
before CreateInstance. The accepted policy does not require that stronger
proof for a new manual window opened during the connection interval. Exact
factory reuse prevents a second global lookup from selecting a different
server; holding the resulting object keeps later windows from redirecting it.

The historical executable mode `quiescent-diagnostic` contains the successful
accepted-policy evidence. Its fixture markers and assertions remain diagnostic
instrumentation; no probe code or historical outcome has been reclassified as
a production implementation.

## Optional stronger identity policy and its gate

The executable implementation is [strategy-probe.ps1](strategy-probe.ps1):

1. Require the measured registration/security assumptions. Refuse changed
   registration before COM acquisition. A deliberately unsupported AppID
   snapshot tests this gate without modifying the real registry.
2. Acquire up to eight raw factories with `LOCAL_SERVER | DISABLE_AAA`.
   Retain successful pointers, never CreateInstance on them. Process count
   is an invariant to monitor for unexpected launches, not the loop target.
   Under the measured registration, denial stops the drain. An acquisition
   limit, unexpected HRESULT, or process change causes refusal/error.
3. Before launching our Stata candidate, calibrate the supported decoder on
   a real proxy to a disposable helper's factory. The helper publishes a
   random CLSID with CoRegisterClassObject and later revokes it. It creates
   no registry entry and no Automation object. Its successful acquisition,
   denied decoding, exit and subsequent class unavailability are measured.
   If identity is unavailable, return `IDENTITY_PREREQUISITE_UNAVAILABLE`
   and exit 3. Existing Statas remain usable; no owned Stata is launched.
4. Only with a working identity provider: explicitly launch the candidate,
   retaining its process handle/start identity. Request a factory without
   permitting implicit AAA launch. Decode the actual returned factory and
   require a match to the live owned candidate before CreateInstance. An
   unavailable/mismatched factory must be refused. **This successful strict
   branch cannot be validated on this machine because step 3 is denied.**
5. Call IClassFactory::CreateInstance on that exact pointer, rather than
   another global activation. The diagnostic verifies the returned object
   through its unique macro and title correlated to PID/start, initializes
   only the owned dataset, then releases it and checks for orphan servers.

The exact call uses the public IClassFactory ABI, not private proxy memory.
Its CreateInstance slot is invoked directly, avoiding a factory RCW and any
second global factory lookup.
[IClassFactory::CreateInstance](https://learn.microsoft.com/en-us/windows/win32/api/unknwn/nf-unknwn-iclassfactory-createinstance),
[CoRegisterClassObject](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-coregisterclassobject),
[CoRevokeClassObject](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-corevokeclassobject).

`quiescent-diagnostic` measures exact-factory behavior without imposing the
optional stronger identity gate. It is a separately requested diagnostic mode,
not a silent fallback from strict refusal. The two race negative controls also
use it to inspect the wrong factory's macro. They retain that Automation
reference until deliberate
experiment teardown; original data/signature checks run before teardown.
Those controls intentionally violate the stronger owned-candidate assertion;
their sacrificial inspection/teardown procedure is not an implementation path
for user Statas. The measured selection race remains evidence of the startup
behavior the user now accepts, not a newly passing strict ownership assertion.

The loop is bounded by acquisition count, with bounded readiness/response
waits and helper lifetime. Native COM calls themselves remain synchronous;
this spike does not establish a hard wall-clock cancellation guarantee.

## What the scenario matrix tests

- Zero, one, and three unclaimed originals.
- Three simultaneously alive processes with only one available factory:
  one unclaimed original, one factory-blocked original, one held by another
  Automation client. Both adaptive variants need only the available factory,
  rather than three process-count acquisitions.
- Three repeated owned sessions while originals remain alive and blocked;
  later drains acquire zero original factories.
- Reservation-helper orderly exit and forced termination, then another launch.
- An original exiting between drain acquisitions, while its raw factory is
  retained. Expected exits are separately identified; surviving originals
  must still pass state checks.
- Deterministic final-lookup interleavings: our candidate's factory has been
  consumed, then a manual original registers. A second control adds an
  external client/server after selection. The selected factory still returns
  the manual original, proving neither a fresh PID nor an explicit candidate
  launch proves factory identity.
- External activations after our exact factory is retained, with the external
  client's ongoing commands checked before/after our object release.
- A genuine manual startup in flight during an acquisition transaction,
  then during the final policy's identity preflight. Startup readiness is
  delayed with a do-file sleep; this does not assume it delays factory
  registration. Strict policy does not take an Automation reference on it.
- The eight-acquisition bound (a deliberately smaller limit in its control),
  unsupported-registration refusal, and identity-prerequisite refusal.

Original state uses the previously validated PID-specific UI channel: unique
nonce responses after Stata asserts the global marker, every dataset marker,
74 rows, changed price, known make, `c(changed)==1`, and full `datasignature
confirm`. The other client's helper independently performs commands and full
signature checks on its still-held object. Merely surviving PID checks do not
count as preservation.

Known facts are the recorded process identities, explicitly launched handles,
successful raw factory acquisitions, object markers/titles, and client
acknowledgements. A process list cannot expose whether an original is held,
blocked, not registered yet, or eligible for a future registration. Start times
prevent confusing reused PIDs; they do not make inventory and COM selection
atomic. A mutex serializes our probes only. Eliminating the accepted startup
race would require a stronger identity guarantee; a stable-process delay is
not such a guarantee. That stronger requirement is optional. Readiness of
preexisting, not-yet-registered originals and behavior under changed
registration/security configurations remain separate assumptions to handle.

## Optional endpoint-identity lead: bounded exploration

CoMarshalInterface succeeded for the raw Stata factory before CreateInstance.
MSHCTX_LOCAL produced a 68-byte OBJREF_STANDARD with zero resolver-array
entries. DIFFERENTMACHINE produced a 336-byte OBJREF_STANDARD with 134 array
entries and the same OXID. Marshaled references were released through
CoReleaseMarshalData; original UI state survived. No raw capability blob was
saved. The Stata TCP snapshot was empty at that point.

None of these fields is a PID. In particular, OBJREF's resolver address is
not the exporter endpoint. ResolveOxid2 was **not implemented or called**;
absence of a current TCP listener does not disprove that the resolver could
supply/create an eligible endpoint. A supported ResolveOxid2 client plus a
validated local exporter TCP endpoint/PID mapping remains an open alternative
for the optional stronger identity guarantee, not an inferred identity result
or a blocker for the accepted policy. This was kept outside the main strategy
scope rather than extending into an unbounded RPC-client implementation.
[CoMarshalInterface](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-comarshalinterface),
[ResolveOxid2](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-dcom/65292e10-ef0c-43ee-bce7-788e271cc794),
[OXID resolution](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-dcom/dfce8f13-1ae2-4cd3-aadd-03edf6290407),
[GetTcpTable2](https://learn.microsoft.com/en-us/windows/win32/api/iphlpapi/nf-iphlpapi-gettcptable2).

Other documented candidates do not supply this missing information:
IRpcOptions exposes timeout/locality, not server PID; the ROT is separate
from the class table; class monikers ultimately use the same activation
machinery. No private IPID layouts, process injection, global registry edits,
or user security-setting changes were used.
[IRpcOptions::Query](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-irpcoptions-query),
[Running EXE registration](https://learn.microsoft.com/en-us/windows/win32/com/registering-a-running-exe-server),
[Class monikers](https://learn.microsoft.com/en-us/windows/win32/com/class-monikers).

## Evidence and validation

Everything new is under [`results/factory-strategy/`](results/factory-strategy/).
`counting-red.txt` contains the explicit spare-server failure. API transcripts
and JSONL contain actual HRESULTs, architectures and identities. The scenario
index in `summary.json` identifies positive diagnostics, deliberate red race
controls, and final strict refusals separately. `strategy-suite.txt` retains
the earlier interleaving tests; `strict-preflight-final-suite.txt` records the
last tested optional strict policy. Run JSONL record initial/final inventories;
main scenario runs also record source hashes. Original Stata logs are compressed
after capture.

A Parallels `PrlJob_GetResult: Invalid argument` rejected the first attempt at
scenario index 1 before its script began. The empty
`transport-recovery-1.json` inventory was checked before resuming at index 1.
The first exit-3 replay exposed PowerShell's exit-code collapsing; its state
and cleanup assertions passed, and the host was fixed to propagate the exact
code. These development transcripts are preserved, not counted as successful
fresh-session results.

Scoped checks: TypeScript script typecheck and ESLint on the changed runners;
PowerShell parsing and the real compiled C#/Windows experiments. No production
source changed, so the repository's full test suite was not repeated for this
follow-up. Final independent inventory and restored VM state are captured
alongside the evidence.

The selected matrix contains **28 cases: 11 green diagnostics, two expected
red factory-identity controls, and 15 final strict refusals**. It records 13
owned diagnostic sessions, 975 assertions (two expected failures in the race
controls), 145 independent UI state checks and 10 ongoing-client command
acknowledgements. The separate counting repro has its own expected failure.
Selection uses the latest positive smoke for the one-original case and the
final preflight-based strict replay; earlier policy versions and transport
failures remain available in `development/` and their original transcripts.
`source-sha256.json` identifies the delivered source files, supplementing the
per-run hashes. These measurements are unchanged by the user's requirements
clarification; no new experiments or full-suite repeat were needed for this
report correction. The strict branch after a hypothetical successful identity
preflight is unvalidated, including capture/cleanup races if an external
client claims our candidate; it is not a tested deployable success path.
