# `browse` as a CLI alias for `vview`

**Date:** 2026-06-26
**Status:** Approved (design, revised after adversarial review)

## Problem

Sight adds a `vview` command to Stata that opens the active dataset in the
Sight Data Browser. In the Stata GUI, users have the built-in `browse`
command and reach for it by habit. In **console Stata** (the CLI), `browse`
does not exist — typing it returns `command browse is unrecognized r(199)`,
because the Data Editor is a GUI-only feature (confirmed by the user).

We want `browse` to act as an alias for `vview` **only in the CLI**, where
no native `browse` exists, while leaving the GUI's built-in `browse`
completely untouched.

## Mechanism

Ship a `browse.ado` on the user's ado-path that forwards to `vview`. The
GUI/CLI split is enforced by **two independent layers**:

1. **Stata command resolution (primary).** Built-in commands resolve before
   ado-files. In the GUI, the built-in `browse` is found first, so
   `browse.ado` never runs and the native Data Editor is unaffected. In the
   CLI there is no built-in `browse` (`r(199)`), so Stata finds `browse.ado`
   on the ado-path and runs it.
2. **`c(console)` runtime guard (defensive).** The ado refuses to run unless
   `c(console) == "console"`. This makes the "console-only" intent explicit
   and self-documenting, and converts a hypothetical resolution failure (the
   ado somehow reached in the GUI) from a *silent* hijack of `browse` into a
   *loud, debuggable* error rather than silently opening the Sight browser.
   In normal CLI operation `c(console)` is `"console"`, so the guard never
   blocks the feature.

### `browse.ado`

```stata
*! browse.ado — CLI alias for vview (Sight Data Browser)
*! Version 0.1.0
*!
*! In the Stata GUI, the built-in `browse` command shadows this ado, so the
*! native Data Editor is unaffected. In console Stata, `browse` is
*! unrecognized, so this ado is found on the ado-path and forwards to vview.
*! The c(console) guard makes the console-only intent explicit and ensures
*! that, should the GUI ever reach this ado, it errors clearly rather than
*! silently replacing native browse.

program define browse
    version 16.0
    if (`"`c(console)'"' != "console") {
        di as err "browse: the Sight alias runs only in console Stata; " ///
            "use the built-in Data Editor in the GUI"
        exit 199
    }
    vview `0'
end
```

A pure forwarder via `` `0' `` (the full argument string). In the CLI,
`vview`'s own syntax applies: `[varlist] [if] [in] [, Rows() Name()
Replace]`. The common habitual forms work: `browse`, `browse varlist`,
`browse if exp`, `browse in range`. Native-`browse`-only options (e.g.
`nolabel`) are not supported and surface as `vview`'s syntax error — accepted,
because in the CLI `browse` *is* `vview` (see Out of scope).

The first banner line `*! browse.ado — CLI alias for vview (Sight Data
Browser)` is the **ownership marker** and MUST remain stable across releases;
the installer uses it to recognize a Sight-shipped `browse.ado` (see
Installation → Ownership).

`version 16.0` matches `vview.ado` for version-control consistency.

## Bundling

`stata/vview.ado` is the canonical source; `client/stata/vview.ado` is a
generated copy produced before bundling, and the bundled asset resolves via a
two-candidate lookup (`<extension>/stata/<name>` then `../stata/<name>`).

Changes:

- Add canonical `stata/browse.ado`.
- Extend the copy step so both ados land in `client/stata/` (the
  `copy-vview-ado` script — keep the name or rename to a clear umbrella —
  copies `vview.ado` **and** `browse.ado`; invoked from `vscode:prepublish`
  and `compile`).
- Generalize `get_bundled_vview_path` into a shared resolver
  `get_bundled_ado_path(context, name)` that preserves the existing
  two-candidate fallback **per ado file** (finding 12).

## Installation

Both files install as one bundle under a **single, freshly-versioned
permission prompt**. Generalize the install core
(`client/src/data-browser/vview-install-core.ts`) from one tracked file to a
small list of bundled ado assets.

### Per-file install policy (finding 7 — Critical)

`browse` is a generic command name; a user may already have an unrelated
personal/community `browse.ado`. The installer MUST NOT clobber it.

For each bundled asset, classify the on-disk target:

- **missing** — no file at target → safe to write.
- **sight-owned** — file exists and its leading banner matches the Sight
  ownership marker for that file (`*! vview.ado — …` / `*! browse.ado — …`).
  If content differs from bundled → write (update); if equal → up to date.
- **foreign** — file exists but the banner does not match the Sight marker →
  **never overwrite**. Skip it, log a one-time warning naming the path, and
  treat it as "satisfied/blocked" for aggregate-state purposes so it does not
  re-prompt forever.

`vview.ado` retains its established behavior in practice (its banner is the
Sight marker, and the name does not collide), but it flows through the same
ownership check for consistency.

### Aggregate state

Per-file state feeds an aggregate used to drive prompting:

- `error` if reading any **bundled** asset fails,
- `missing` if any target is missing,
- `outdated` if all present targets exist but any sight-owned target differs
  from its bundled content,
- `up_to_date` if every target is either content-matched or a foreign file we
  intentionally leave alone.

A change to **either** ado in a future release re-triggers install.

### Permission (findings 5, 6)

The bundle adds a command named after a Stata built-in, which is a broader
action than the original "add vview.ado." Reusing the old permission key
would silently expand a `vview`-only grant and would never re-prompt users
who previously declined. Therefore:

- Use a **new, versioned permission state key** (e.g.
  `sightStataCommandsInstallPermission`) distinct from the old vview key.
  Existing granted/declined users get exactly one fresh prompt describing the
  bundle.
- The prompt copy generalizes from "vview.ado" to "Sight's Stata commands
  (`vview`, `browse`)", still naming the install directory.

### Flow and atomicity (finding 9)

- `ensure_*` (auto, prompt-on-first-use) and `install_*_manually` (the
  command-palette install) operate on the bundle: when permission is granted
  (or already granted), write every asset whose policy says "write".
- Writes are per-file best-effort: on a write failure, log the specific file
  and continue with the rest; report an aggregate failure. Already-written
  files are left in place (no rollback; partial state is re-converged on the
  next install check).

### Uninstall (finding 8)

Because the alias takes over a built-in command name in the CLI, provide a
supported removal path. Add a command **"Sight: Uninstall Stata commands
(vview, browse)"** that:

- deletes each target **only if it is sight-owned** (ownership marker match);
  never deletes a foreign file;
- clears the install permission key.

### Command IDs (finding 13)

Keep existing command IDs (`sight.installVviewAdo`,
`sight.resetVviewInstallPermission`, etc.) stable to avoid breaking
keybindings/docs; update only display titles and message copy. The new
uninstall command gets a new ID.

## Verification (findings 1, 4)

Tests do not run Stata, so the GUI-safety guarantee is verified out-of-band.
Record a manual verification checklist (in PR description / docs):

- **GUI:** `which browse` reports the built-in; `browse` opens the native
  Data Editor (not Sight) with `browse.ado` installed on the ado-path.
- **CLI:** `which browse` reports the installed ado; `browse` opens the Sight
  Data Browser; `c(console)` is `"console"`.
- Confirmed CLI baseline: bare `browse` is `r(199)` before install.

Supported range matches `vview.ado`: Stata 16+ (uses `frames`).

## Tests

- `tests/unit/data-browser/vview-bundled-asset.test.ts`: assert `browse.ado`
  is bundled and matches canonical `stata/browse.ado`; assert it is a pure
  `vview` forwarder carrying the `c(console)` guard and the ownership marker.
- `tests/unit/data-browser/vview-install.test.ts`: aggregate-state logic
  (any-missing → `missing`, any-sight-owned-differs → `outdated`, all-match →
  `up_to_date`, any-bundled-read-error → `error`); install writes both files
  under one granted permission; **foreign `browse.ado` is never overwritten**
  and is reported as blocked, not perpetually outdated; uninstall removes only
  sight-owned files and leaves foreign files intact; new permission key is
  independent of the old one.

## Docs

- `docs/data-browser.md`: document that in console Stata, `browse` aliases
  `vview`; the GUI built-in `browse` is unaffected; only the exact `browse`
  command is aliased (not `br`/`bro`); the new uninstall command.
- `README.md`: update the Data Browser feature line to mention the CLI
  `browse` alias.

## Out of scope (with rationale)

- **`c(console)` is the only runtime detection.** No attempt to delegate to
  native `browse` from the ado (a same-named program would recurse, not reach
  the built-in).
- **Abbreviations `br`/`bro` (finding 2).** Stata does not auto-abbreviate
  ado-file command names, and claiming additional built-in-abbreviation names
  is riskier and broader than the request. Documented as a limitation; only
  exact `browse` is aliased.
- **Native-`browse`-only options (finding 10).** `nolabel` etc. surface as
  `vview` syntax errors; the common varlist/`if`/`in` forms work.
- **"Opened…" printed when no extension is listening (finding 11).** This is
  pre-existing `vview` behavior, not specific to the alias; out of scope here.
- No change to `vview.ado`'s data-export behavior.
