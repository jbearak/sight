# `browse` abbreviations (`brows`/`brow`/`bro`/`br`) as CLI aliases for `vview`

**Date:** 2026-06-26
**Status:** Approved (follow-up to the browse CLI alias feature)

## Problem

PR #211 added `browse` as a CLI alias for `vview` in console Stata. Stata
users habitually abbreviate `browse` to `brows`, `brow`, `bro`, or `br`. The
original design
([2026-06-26-browse-cli-alias-design.md](2026-06-26-browse-cli-alias-design.md))
placed these abbreviations **out of scope** (finding 2), reasoning that Stata
does not auto-abbreviate ado-file command names and that claiming additional
built-in-abbreviation names was "riskier and broader than the request."

This follow-up reverses that decision after empirical verification.

## Empirical findings (StataMP 18, 2026-06-26)

Probe ado files (`br.ado`, `bro.ado`, `brow.ado`, `brows.ado`) were placed in
`~/ado` and `which` was run in both modes:

- **GUI** (`c(console)` is empty): `which br`, `which bro`, `which brow`,
  `which brows`, and `which browse` all report **`built-in command: browse`**.
  The built-in command resolution — including the built-in's abbreviations —
  shadows the same-named ado files on the path. The native Data Editor is
  unaffected.
- **Console** (`c(console)` is `"console"`): `which br`, `which bro`,
  `which brow`, `which brows` each resolve to the corresponding `~/ado/*.ado`.
  There is no built-in `browse` in the CLI, so each abbreviation ado is found
  on the ado-path and forwards to `vview`.

Conclusion: the same GUI/CLI split that makes `browse.ado` safe applies to its
abbreviation ados. The risk cited in the original "out of scope" note does not
materialize: the GUI built-in always wins.

## Mechanism

Ship four additional ados — `br.ado`, `bro.ado`, `brow.ado`, `brows.ado` —
each a clone of `browse.ado`:

- `version 16.0`,
- the `c(console)` guard (defense-in-depth; in the GUI `c(console)` is empty,
  so a hypothetical GUI mis-resolution errors loudly instead of hijacking),
- a pure `vview \`0'` forwarder (forwards directly to `vview`, independent of
  `browse.ado`),
- a guard error message naming the **typed** command (e.g. `"br: the Sight
  alias runs only in console Stata; …"`),
- a stable first-line ownership marker
  `*! <name>.ado — CLI alias for vview (Sight Data Browser)`.

## Installation

The install machinery in `client/src/data-browser/vview-install-core.ts` is
already data-driven over `ADO_ASSET_DEFS`. Append four entries, all
`protect_foreign: true` — `br`/`bro`/`brow`/`brows` are generic abbreviation
names a user or community command might own, so a non-Sight same-named file is
classified `foreign` and never overwritten. Uninstall removes only Sight-owned
copies (ownership-marker match), as before.

`vview`[0] and `browse`[1] stay first in the array so the index-based install
tests remain valid; abbreviations occupy indices [2]–[5]. No install/uninstall/
aggregate-state logic changes — only the asset list grows.

## Bundling

`stata/<name>.ado` are the canonical sources; `client/stata/<name>.ado` are
generated copies. Generalize the `copy-vview-ado` script in
`client/package.json` to copy `../stata/*.ado` (glob) rather than listing each
file, so the set never drifts as files are added.

## Tests

- `tests/unit/data-browser/vview-bundled-asset.test.ts`: for each abbreviation
  ado, assert it is bundled (the `client/stata` copy matches the canonical
  source), is a pure `vview \`0'` forwarder, carries the `c(console)` guard,
  and has its stable first-line marker. The existing "ado ownership markers"
  loop already iterates `ADO_ASSET_DEFS`, so it covers the new markers.
- `tests/unit/data-browser/vview-install.test.ts`: generalize the "writes both
  files" test to assert every bundled file is written under one granted
  permission.

## Docs

- `docs/data-browser.md`: replace the paragraph stating abbreviations are *not*
  aliased with the new behavior — the standard abbreviations `brows`/`brow`/
  `bro`/`br` alias `vview` in console Stata, while the GUI built-in (and its
  abbreviations) opens the native Data Editor unchanged.
- `README.md`: minor mention alongside the existing `browse` CLI alias line.

## Out of scope / noted

- **Install location.** Sight installs to `~/ado`, which Stata 18 lists as
  `OLDPLACE` (not `PERSONAL` = `~/Documents/Stata/ado/personal/`). It is on the
  ado-path and works; this is pre-existing and unchanged here.
- No change to `vview.ado` or to `browse.ado`.
- Native-`browse`-only options (e.g. `nolabel`) still surface as `vview`
  syntax errors, as documented for the `browse` alias.
