# `browse` as a CLI alias for `vview`

**Date:** 2026-06-26
**Status:** Approved (design)

## Problem

Sight adds a `vview` command to Stata that opens the active dataset in the
Sight Data Browser. In the Stata GUI, users have the built-in `browse`
command and tend to reach for it by habit. In **console Stata** (the CLI),
`browse` does not exist — typing it returns `command browse is unrecognized
r(199)`, because the Data Editor is a GUI-only feature.

We want `browse` to act as an alias for `vview` **only in the CLI**, where
no native `browse` exists, while leaving the GUI's built-in `browse`
completely untouched.

## Mechanism

Ship a `browse.ado` on the user's ado-path that forwards to `vview`. The
GUI/CLI split falls out of Stata's command resolution with no runtime check:

- **GUI:** the built-in `browse` is resolved before any ado-file, so
  `browse.ado` never runs. Native Data Editor behavior is unchanged.
- **CLI:** there is no built-in `browse` (confirmed: `r(199)` unrecognized),
  so Stata finds `browse.ado` on the ado-path and runs it, which calls
  `vview`.

Because the GUI never executes the ado, no `c(console)` guard is needed (and
a guard could not usefully "fall through" to the built-in anyway — a
same-named program would recurse rather than reach the built-in).

### `browse.ado`

```stata
*! browse.ado — CLI alias for vview (Sight Data Browser)
*! Version 0.1.0
*!
*! In the Stata GUI, the built-in `browse` command shadows this ado, so the
*! native Data Editor is unaffected. In console Stata, `browse` is
*! unrecognized, so this ado is found on the ado-path and forwards to vview.

program define browse
    version 16.0
    vview `0'
end
```

A pure forwarder via `` `0' `` (the full argument string). In the CLI,
`vview`'s own syntax applies: `[varlist] [if] [in] [, Rows() Name()
Replace]`. Native-`browse`-only options (e.g. `nolabel`) are not supported in
the CLI — acceptable, because in the CLI `browse` *is* `vview`.

`version 16.0` matches `vview.ado` for version-control consistency.

## Bundling

`stata/vview.ado` is the canonical source; `client/stata/vview.ado` is a
generated copy produced by the `copy-vview-ado` npm script before bundling,
and the bundled asset resolves to `<extension>/stata/vview.ado`.

Changes:

- Add canonical `stata/browse.ado`.
- Extend the copy step so both ados land in `client/stata/`. Rename/extend
  `copy-vview-ado` to copy `vview.ado` **and** `browse.ado` (keep the script
  name or introduce a clearly-named umbrella script invoked from
  `vscode:prepublish` and `compile`).

## Installation

Selected model: **treat the two files as one bundle under a single permission
prompt.** Generalize the install core (`client/src/data-browser/vview-install-core.ts`)
from one tracked file to a small list of bundled ado assets.

### Aggregate state

Per-file state is still `missing` / `up_to_date` / `outdated` / `error`
(comparing on-disk content to bundled content). The bundle's aggregate state:

- `error` if reading any bundled asset fails,
- `missing` if any target file is absent,
- `outdated` if every target exists but any differs from its bundled content,
- `up_to_date` only if all target files match their bundled content.

This ensures a change to **either** ado (including a browse-only change in a
future release) re-triggers install.

### Permission and flow

- One permission gate in `globalState` (reuse the existing state key) covers
  the whole bundle. The prompt copy generalizes from "vview.ado" to Sight's
  Stata commands (still naming the install directory).
- `ensure_*` (auto, prompt-on-first-use) and `install_*_manually` (the
  "Sight: Install vview.ado" command) both operate on the bundle: when
  permission is granted (or already granted), write every file whose on-disk
  content differs from its bundled content.
- The "Sight: Install vview.ado" / reset-permission commands and their
  titles are updated to reflect that they manage Sight's Stata commands
  (vview + browse), not vview alone.

### Scope of refactor

`VviewInstallStatus` becomes a per-file or bundle-level structure carrying a
list of `{ name, target_path, bundled_path, bundled_content, state }` plus the
shared `target_dir` and an aggregate `state`. Functions
(`get_vview_install_state`, `install_vview_ado`, `ensure_vview_ado_installed`,
`install_vview_ado_manually`, `reset_vview_install_permission`) are updated to
iterate the list. The public hook shape (`inspect_installation`,
`prompt_for_vview_install`, `install_vview_ado`, permission get/set) is
preserved where practical so `index.ts` wiring stays thin.

## Tests

- `tests/unit/data-browser/vview-bundled-asset.test.ts`: extend to assert
  `browse.ado` is bundled and its content matches the canonical
  `stata/browse.ado`.
- `tests/unit/data-browser/vview-install.test.ts`: extend / mirror for the
  bundle — aggregate state logic (any-missing → `missing`, any-differs →
  `outdated`, all-match → `up_to_date`, any-read-error → `error`), and that
  install writes both files under a single granted permission.
- Add a focused assertion that `browse.ado` is a pure `vview` forwarder
  (content check is sufficient; we do not run Stata in tests).

## Docs

- `docs/data-browser.md`: document that in console Stata, `browse` is an alias
  for `vview`, and that the GUI's built-in `browse` is unaffected.
- `README.md`: update the Data Browser feature line to mention the CLI
  `browse` alias.

## Out of scope

- No `c(console)` runtime detection in the ado (unnecessary by design).
- No support for native-`browse`-only options in the CLI.
- No change to `vview.ado` behavior.
