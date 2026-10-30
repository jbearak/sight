# Handoff: Phase 0 spike for `sight console` on Windows

Paste everything below the line into a new Codex (GPT-6.1 Terra) thread
on Cyllene, in a checkout of github.com/jbearak/sight on branch
`t3/windows-stata-com-console`.

---

You're running Phase 0 (the Windows spike) of the plan in
`docs/superpowers/plans/2026-10-30-windows-console-com.md`. Read the
whole plan first, then `CLAUDE.md`. The plan has been reviewed and
approved; Phase 0 exists because its design rests on behavior of
Stata's Automation (COM) interface that nobody has observed yet. Your
job is to observe it and record what you saw. Do not implement Phases
1-4 and do not change the design. Where a result contradicts the plan,
say so in your report; the plan's author revises it afterwards.

## Environment

- This Mac (Cyllene) runs Windows 11 in Parallels Desktop, with Stata
  installed in the VM. Find the VM with `prlctl list -a`.
- Run Windows commands with `prlctl exec "<vm>" --current-user ...`.
  `--current-user` matters: without it, commands run as SYSTEM in
  session 0, where COM can't reach a Stata GUI in the user's desktop
  session, and the results would be meaningless. Check with
  `prlctl exec "<vm>" --current-user whoami` and confirm a Stata window
  you start that way is visible in the VM.
- Screenshots: `prlctl capture "<vm>" --file <path>.png`. Use them to
  check window visibility (S2, S3, S7), not just process lists.
- Some checks need a person: closing the terminal window in Windows
  Terminal, conhost and the VS Code terminal (S3), opening a modal
  dialog or the Data Editor (S2, S13). Ask the user to do those steps
  and tell you when; don't fake them with process kills.

## Before you start

1. Find Stata in the VM (`C:\Program Files\Stata*\`,
   `C:\Program Files\StataNow*\`) and its version and edition.
2. Check registration: does `HKCR\stata.StataOLEApp\CLSID` exist, and
   what does `HKCR\CLSID\{that clsid}\LocalServer32` point to? If it
   isn't registered, stop and ask the user to run
   `<exe> /Register` as administrator; don't do it yourself.
3. Use only throwaway data (`sysuse auto`) in every Stata you start.
   Treat any Stata already open in the VM as the user's: ask before
   anything touches it.

## What to run

Write the spike as PowerShell scripts under
`scripts/spike/windows-com/` (Windows PowerShell 5.1, the same
`powershell.exe` the plan's bridge would use; run with `-Sta
-NoProfile -ExecutionPolicy Bypass -File`). They are throwaway, but
commit them so the results can be reproduced.

Answer every item in the plan's Phase 0 table, S1 through S13, in
order of what blocks most: S1, S2, S3 first (they are shipping gates),
then S5, S4/S12, S9, S6, S11, S10, S7, S8, S13. For each item, capture
the raw evidence: the script, the Stata log text (as bytes where
encoding or newlines matter: S11), `UtilIsStataFree` results with
timestamps, process lists before and after, and screenshots where
visibility is the question.

Pay particular attention to:

- **S1/S2/S8:** which Stata a `CreateObject` actually reaches. Mark each
  Stata with a distinct global (set in its own Command window, or via
  a startup do-file as in the plan) and read it back with
  `MacroValue`. Count Stata processes after every step, including any
  started by COM through `LocalServer32`.
- **S3:** what releasing the last reference does to (a) a Stata COM
  started and (b) one launched directly with `<exe> do file.do`. Also
  whether a helper started from a Bun process with `detached` and
  `windowsHide` (write a tiny Bun script for this) survives closing
  the terminal window it was started from, in all three hosts.
- **S4/S12:** whether the log grows while a command runs, and whether
  everything is on disk at the first "free" poll. Poll every 10 ms and
  log sizes with timestamps.
- **S5:** the exact log text for each case, including the prompt
  prefix Stata writes before each echoed line and how a line longer
  than `linesize` wraps.

## Recording results

Add a section `## Phase 0 results` at the end of the plan file, with
one subsection per item: what you ran, what happened (quote the raw
evidence or point to a file under `scripts/spike/windows-com/results/`),
and which branch of the plan it selects (the table's "Decides" column).
Flag anything that contradicts the plan or that the plan didn't
anticipate. Don't edit the rest of the plan.

Commit on `t3/windows-stata-com-console` and push. Finish with a short report: the
S1/S2/S3 outcomes first (do the shipping gates pass?), then the other
items, then contradictions and open questions.
