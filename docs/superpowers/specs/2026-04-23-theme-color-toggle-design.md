# Depth colors: toggle to fall back to theme colors

## Problem

Sight ships with depth-differentiated colors for nested compound strings and
local macros. On activation, the client extension writes six string-depth rules
and six local-macro-depth rules into the user's `editor.tokenColorCustomizations`
setting (under `[*Dark*]`, `[*Light*]`, and top-level universal sections).

There is currently no way for a user to opt out. A user who prefers their VS
Code theme's native string and variable colors has no clean way to disable the
feature — they can delete the rules by hand, but Sight re-adds them on the next
activation.

## Goal

Add a single user setting that turns the feature off. When off:

- Sight does not write depth color rules on activation.
- The theme-change handler does not update depth rules.
- Sight removes its previously written rules from the user's settings so the
  theme's native string/variable colors take effect without a manual cleanup.
- A hand-edited rule on a Sight depth scope (i.e., a rule whose foreground does
  not match one of Sight's four hard-coded palettes) is preserved.

## Non-goals

- Exposing the four palettes (`DARK_STRING_COLORS`, `DARK_MACRO_COLORS`,
  `LIGHT_STRING_COLORS`, `LIGHT_MACRO_COLORS`) as configurable arrays.
- Separate toggles for string depth colors vs. local-macro depth colors.
- Changing the default — the feature remains enabled out of the box.
- Altering the TextMate grammar or any server-side tokenization.

## User-facing surface

One new boolean VS Code setting:

```json
"sight.depthColors.enabled": {
    "type": "boolean",
    "default": true,
    "description": "Color nested strings and local macros by depth. When disabled, removes Sight's depth color rules from editor.tokenColorCustomizations so your theme's default string and variable colors apply."
}
```

Default: `true` — preserves current behavior for existing users on upgrade.

The existing `sight.resetDepthColors` command:

- When `enabled=true`: unchanged (strip all depth rules, re-apply defaults).
- When `enabled=false`: shows an info message
  ("Depth colors are disabled in sight.depthColors.enabled.") and no-ops.

## Behavior

Four entry points coordinate on the setting:

| Event | `enabled=true` | `enabled=false` |
| --- | --- | --- |
| Extension activation | `configureDepthColors` runs (writes rules if missing). | `configureDepthColors` logs "disabled, skipping" and returns. |
| Config change `true → false` | n/a | Remove Sight-owned depth rules from `[*Dark*]`, `[*Light*]`, and top-level `textMateRules`. |
| Config change `false → true` | Run `configureDepthColors`. | n/a |
| Theme kind change (dark ↔ light) | `updateUniversalFallbackColors` runs. | Handler consults the setting first and no-ops. |
| `sight.resetDepthColors` command | Strip all depth rules, re-apply defaults. | Show info message, no-op. |

Cleanup is scoped by the **palette-match guard**: a rule qualifies as
"Sight-owned" only if both conditions hold:

1. Its scope contains one of the two depth prefixes
   (`string.quoted.compound.depth` or `variable.other.macro.local.depth`).
2. Its foreground hex value (compared case-insensitively) is a member of one
   of the four hard-coded palettes.

A user who has customized a depth-scope color to an arbitrary hex value keeps
that customization across a disable.

## Architecture

### New code

**`client/src/depth-colors-core.ts`** (pure, VS Code-free)

- `PALETTE_HEX_VALUES: Set<string>` — built once at module load from the four
  exported palette arrays, uppercased for case-insensitive comparison.
- `isSightOwnedDepthRule(rule: TextMateRule): boolean` — returns true iff the
  rule is a depth rule AND its foreground hex is in `PALETTE_HEX_VALUES`.
- `removeSightOwnedDepthRules(customizations: TokenColorCustomizations | undefined): TokenColorCustomizations`
  — returns a shallow copy with Sight-owned rules filtered out of `[*Dark*]`,
  `[*Light*]`, and top-level `textMateRules`. Preserves section structure
  (empty arrays remain empty arrays; non-depth rules pass through unchanged).

**`client/src/depth-colors.ts`** (VS Code integration)

- `isDepthColorsEnabled(): boolean` — reads
  `workspace.getConfiguration('sight').get('depthColors.enabled', true)`.
- `disableDepthColors(context, output_channel?)`: reads current
  `editor.tokenColorCustomizations`, runs `removeSightOwnedDepthRules`, writes
  back with `ConfigurationTarget.Global`. Wrapped in `try/catch`, logs to the
  output channel on error, never throws.
- `registerDepthColorsConfigHandler(output_channel?)`: returns a
  `vscode.Disposable` wrapping `workspace.onDidChangeConfiguration`. When
  `sight.depthColors.enabled` changes, dispatches to `configureDepthColors`
  (true) or `disableDepthColors` (false).

### Modified code

**`client/src/depth-colors.ts`**

- `configureDepthColors`: early-return when `!isDepthColorsEnabled()`.
- `updateUniversalFallbackColors`: early-return when `!isDepthColorsEnabled()`.
- `registerThemeChangeHandler`: unchanged externally; its existing
  `updateUniversalFallbackColors` call already no-ops via the early return.

**`client/src/extension.ts`**

- Register `registerDepthColorsConfigHandler` alongside the existing
  `registerThemeChangeHandler`; push disposable into `context.subscriptions`.
- In the `sight.resetDepthColors` command handler, check
  `isDepthColorsEnabled()`. If false: show info message and return.

**`client/package.json`**

- Add the `sight.depthColors.enabled` contribution under
  `contributes.configuration.properties`.

**`README.md`** (brief — one or two sentences where depth colors are
described): note that the feature can be turned off via
`sight.depthColors.enabled`.

### Data flow

```
activate() ─┬─► configureDepthColors  ──► isDepthColorsEnabled?
            │                             ├─ yes → write defaults
            │                             └─ no  → skip
            ├─► registerThemeChangeHandler ──► updateUniversalFallbackColors
            │                                  ├─ yes → refresh
            │                                  └─ no  → skip
            └─► registerDepthColorsConfigHandler
                     └─ onDidChangeConfiguration('sight.depthColors.enabled')
                          ├─ new=true  → configureDepthColors (writes defaults)
                          └─ new=false → disableDepthColors    (palette-match cleanup)
```

## Error handling

Mirror the existing pattern: every function that calls
`config.update` wraps in `try/catch`, logs `[DepthColors] Error: ${error}`
to the output channel, and does not re-throw. The palette-match filter is
a pure transform on in-memory objects; it has no failure modes of its own.

Concurrent `config.update` calls (e.g., a user rapidly flipping the setting)
rely on VS Code's built-in serialization of configuration writes. No custom
locking or debounce is needed.

## Testing

### Unit tests — `client/test/depth-colors-core.test.ts`

New cases for the pure helpers (no VS Code):

1. `isSightOwnedDepthRule`:
   - Returns true for each hex × depth-scope combination in all four palettes.
   - Returns true when the rule's foreground uses a different hex case
     (e.g., `'#ce9178'` vs. the canonical `'#CE9178'`).
   - Returns false for a depth-scope rule with a non-palette foreground
     (hand-edited color).
   - Returns false for a non-depth scope even with a palette-colored
     foreground.
2. `removeSightOwnedDepthRules`:
   - Removes Sight-owned rules from `[*Dark*]`, `[*Light*]`, and top-level
     `textMateRules`.
   - Leaves hand-edited depth-scope rules in place.
   - Leaves all non-depth rules in place.
   - Handles `undefined` input (returns an empty object).
   - Is idempotent: applying twice equals applying once.
   - Does not mutate the input object.

### Integration tests — `client/test/depth-colors.integration.test.ts` (or equivalent)

Use the existing integration test harness:

1. Activation with `enabled=false` does not write depth rules.
2. Flipping `true → false` at runtime removes Sight-owned rules from all
   three sections.
3. Flipping `true → false` preserves a hand-edited depth-scope rule
   (e.g., one with foreground `'#FF00FF'`).
4. Flipping `false → true` at runtime rewrites the defaults.
5. With `enabled=false`, a simulated theme-kind change does not touch the
   top-level `textMateRules`.
6. With `enabled=false`, the `sight.resetDepthColors` command does not
   modify configuration (we can assert by checking `config.update` is not
   called, or by comparing before/after snapshots).

### Documentation

- Update the depth-colors section of `README.md` with a one-line note about
  the toggle.
- No `CLAUDE.md` update required — the architecture rules haven't changed.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Palette-match guard removes a rule the user intended to keep because they happened to pick one of Sight's hex values. | Low impact: user can restore by setting a slightly different hex, or by re-enabling + running `sight.resetDepthColors`. Documented in the setting description. |
| Future palette changes (e.g., adding depth 7 or tweaking a hex) leave "orphaned" rules in user settings that are no longer removed by the palette-match guard. | Any future palette change should bump the palette arrays and ship a one-shot migration (out of scope for this change; noted here for future work). |
| The setting is client-side (VS Code only); users on other LSP clients won't see it. | Depth colors are already a VS Code client feature (driven by `editor.tokenColorCustomizations`). Parity is already limited — no regression. |

## Rollout

Single PR containing: setting contribution, core helpers + tests, client
wiring, integration tests, README one-liner. No migration needed — existing
users keep their current behavior (default `true`).
