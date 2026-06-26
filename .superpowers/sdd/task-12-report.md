# Task 12 Report — Documentation

## Files edited

- `docs/cross-file.md` — Added "Case-Only Path Mismatch Handling" section
  (before "Call Site Diagnostics") covering: forward vs backward behavior and
  message differences, the backward Raven invariant (no @lsp-cd / no
  workspace-root fallback), resolution rules (static-only, exact-before-case,
  unique-match-required, ASCII-fold, workspace-bounded, single-emission), and
  configuration pointer. Also added `crossFile.diagnostics.caseMismatch` row
  to the configuration table at the bottom of the file, with a note that
  `"auto"` is valid only for this key.

- `docs/configuration.md` — Added `caseMismatch = "auto"` to the TOML
  example block under `[crossFile.diagnostics]`. Added
  `crossFile.diagnostics.caseMismatch` row to the main settings reference
  table, with the `auto` regime explained inline. Added a note below the
  severity-options line that `"auto"` is specific to this key.

- `docs/diagnostics.md` — Added new "Cross-file diagnostics" section (before
  "Configuration") with: a summary table row for code 7001
  `PATH_CASE_MISMATCH`, a subsection explaining forward vs backward messages
  verbatim from the spec, the `auto` severity regime explanation, the
  non-suppressibility by `@lsp-ignore`, independence from `missingFile`, and
  an explicit out-of-scope list (data-file commands, macro-interpolated paths,
  paths outside workspace).

## Settings-reference generator

No generator found. `scripts/` contains build/cache/release tooling only.
`docs/configuration.md` is hand-maintained; edited directly and
consistently.

## Checks run

- `bun run typecheck` — 0 errors (docs do not affect TypeScript compilation).
- No markdown link checker or doc test script found in `package.json` or
  `scripts/`.

## Commit

`dabce12` — docs: document case-only path mismatch handling + caseMismatch
setting (#205)

---

## Addendum — CodeRabbit #216 fixes (2026-06-26)

### Changes

**MD040 missing fenced-code language specifiers (#1/#2)**

- `docs/cross-file.md`: Added `text` language tag to two bare fences:
  the forward diagnostic example ("Path 'helpers/clean' does not match...")
  and the backward directive example ("Directive path 'parent' does not
  match...").
- `docs/diagnostics.md`: Same two blocks fixed.

**Non-portable URI in `tests/unit/definition.test.ts` (#8)**

- Added `import { URI } from 'vscode-uri';`.
- Fixed `create_test_document` default URI from
  `` `file://${process.cwd()}/test.do` `` to
  `URI.file(\`${process.cwd()}/test.do\`).toString()`.
- Fixed all 20 hand-built template literal `file://${path.join(...)}` URIs
  throughout the file to use `URI.file(...).toString()`.

**`any` cast in `tests/unit/forward-call-context.test.ts`**

- In `get_file_cache_forward_calls`, replaced `(sr as any).file_cache` with
  `(sr as unknown as { file_cache: Map<string, { forward_calls: ForwardCall[] }> }).file_cache`.
- Removed `eslint-disable-next-line` comment.

**Unused `path` import in `src/document-store.ts`**

- Removed `import * as path from 'path';` — zero usages of `path.` found.

### Test results

- `bun test tests/unit/definition.test.ts tests/unit/forward-call-context.test.ts`:
  72 pass, 0 fail
- `bun run typecheck`: 0 errors
- `bun run test`: 6091 pass, 5 skip, 0 fail (6096 tests, 563 files)
