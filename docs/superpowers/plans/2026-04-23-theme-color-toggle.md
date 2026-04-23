# Depth Colors Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `sight.depthColors.enabled` setting (default `true`) so users can fall back to their VS Code theme's native string and variable colors. Flipping it off removes Sight-owned depth rules from the user's `editor.tokenColorCustomizations` via a palette-match guard that preserves hand-edited colors.

**Architecture:** Two new pure helpers in `depth-colors-core.ts` (`isSightOwnedDepthRule`, `removeSightOwnedDepthRules`) plus `PALETTE_HEX_VALUES`. Three new functions in `depth-colors.ts` (`isDepthColorsEnabled`, `disableDepthColors`, `registerDepthColorsConfigHandler`). Existing `configureDepthColors` and `updateUniversalFallbackColors` gain early-return guards. `extension.ts` registers the new config listener alongside the theme handler and gates the `sight.resetDepthColors` command on the setting. Spec: `docs/superpowers/specs/2026-04-23-theme-color-toggle-design.md`.

**Tech Stack:** TypeScript, Bun test runner, fast-check (used in the existing depth-colors property test). VS Code extension API for the integration layer. No VS Code integration tests are added (the project has only a single client smoke test); new logic lives in `depth-colors-core.ts` so it is exercised by VS Code-free unit tests.

---

## File map

**Production (edit):**
- `client/src/depth-colors-core.ts` — add `PALETTE_HEX_VALUES`, `isSightOwnedDepthRule`, `removeSightOwnedDepthRules`.
- `client/src/depth-colors.ts` — add `isDepthColorsEnabled`, `disableDepthColors`, `registerDepthColorsConfigHandler`; add early-return guards to `configureDepthColors` and `updateUniversalFallbackColors`; export the new helpers.
- `client/src/extension.ts` — register `registerDepthColorsConfigHandler`; gate the `sight.resetDepthColors` command body on `isDepthColorsEnabled`.
- `client/package.json` — add the `sight.depthColors.enabled` configuration contribution.

**Tests (create):**
- `tests/unit/depth-colors-toggle.test.ts` — unit tests for `isSightOwnedDepthRule` and `removeSightOwnedDepthRules`.

**Docs (edit):**
- `docs/syntax-highlighting.md` — one-paragraph note about the toggle under the "Automatic Color Configuration" section.

**No changes needed:** `CLAUDE.md`, TextMate grammar, server code, command database.

---

### Task 1: Add `PALETTE_HEX_VALUES` and `isSightOwnedDepthRule` (test-first)

**Files:**
- Create: `tests/unit/depth-colors-toggle.test.ts`
- Modify: `client/src/depth-colors-core.ts` (end of file, after existing exports)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/depth-colors-toggle.test.ts` with this content (we'll extend the file in later tasks):

```typescript
import { describe, it, expect } from 'bun:test';
import {
    DARK_STRING_COLORS,
    DARK_MACRO_COLORS,
    LIGHT_STRING_COLORS,
    LIGHT_MACRO_COLORS,
    STRING_SCOPE_PREFIX,
    MACRO_SCOPE_PREFIX,
    SCOPE_SUFFIX,
    PALETTE_HEX_VALUES,
    isSightOwnedDepthRule,
    TextMateRule
} from '../../client/src/depth-colors-core';

describe('PALETTE_HEX_VALUES', () => {
    it('contains every hex from all four palettes, uppercased', () => {
        const the_expected = [
            ...DARK_STRING_COLORS,
            ...DARK_MACRO_COLORS,
            ...LIGHT_STRING_COLORS,
            ...LIGHT_MACRO_COLORS,
        ].map(h => h.toUpperCase());
        for (const my_hex of the_expected) {
            expect(PALETTE_HEX_VALUES.has(my_hex)).toBe(true);
        }
        expect(PALETTE_HEX_VALUES.size).toBe(new Set(the_expected).size);
    });
});

describe('isSightOwnedDepthRule', () => {
    const make_rule = (scope: string, foreground: string): TextMateRule => ({
        scope,
        settings: { foreground },
    });

    it('returns true for every palette hex on a depth-1 string scope', () => {
        const the_scope = `${STRING_SCOPE_PREFIX}1${SCOPE_SUFFIX}`;
        for (const my_hex of DARK_STRING_COLORS) {
            expect(isSightOwnedDepthRule(make_rule(the_scope, my_hex))).toBe(true);
        }
        for (const my_hex of LIGHT_STRING_COLORS) {
            expect(isSightOwnedDepthRule(make_rule(the_scope, my_hex))).toBe(true);
        }
    });

    it('returns true for every palette hex on a depth-1 macro scope', () => {
        const the_scope = `${MACRO_SCOPE_PREFIX}1${SCOPE_SUFFIX}`;
        for (const my_hex of DARK_MACRO_COLORS) {
            expect(isSightOwnedDepthRule(make_rule(the_scope, my_hex))).toBe(true);
        }
        for (const my_hex of LIGHT_MACRO_COLORS) {
            expect(isSightOwnedDepthRule(make_rule(the_scope, my_hex))).toBe(true);
        }
    });

    it('matches hex values case-insensitively', () => {
        const the_rule = make_rule(
            `${STRING_SCOPE_PREFIX}1${SCOPE_SUFFIX}`,
            DARK_STRING_COLORS[0].toLowerCase()
        );
        expect(isSightOwnedDepthRule(the_rule)).toBe(true);
    });

    it('returns false for a depth scope with a non-palette hex', () => {
        const the_rule = make_rule(
            `${STRING_SCOPE_PREFIX}3${SCOPE_SUFFIX}`,
            '#FF00FF'
        );
        expect(isSightOwnedDepthRule(the_rule)).toBe(false);
    });

    it('returns false for a non-depth scope even with a palette hex', () => {
        const the_rule = make_rule('comment.line.stata', DARK_STRING_COLORS[0]);
        expect(isSightOwnedDepthRule(the_rule)).toBe(false);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/depth-colors-toggle.test.ts`
Expected: FAIL with import errors on `PALETTE_HEX_VALUES` and `isSightOwnedDepthRule` (not yet exported).

- [ ] **Step 3: Add the minimal implementation**

Append to `client/src/depth-colors-core.ts` (keep existing content unchanged):

```typescript
/**
 * Hex values (uppercased) from the four hard-coded palettes.
 * Used to identify rules Sight wrote on activation so we can remove them
 * cleanly when the user disables depth coloring, without touching
 * rules a user may have hand-edited on the same scopes.
 */
export const PALETTE_HEX_VALUES: Set<string> = new Set([
    ...DARK_STRING_COLORS,
    ...DARK_MACRO_COLORS,
    ...LIGHT_STRING_COLORS,
    ...LIGHT_MACRO_COLORS,
].map(my_hex => my_hex.toUpperCase()));

/**
 * True iff a rule targets a Sight depth scope AND its foreground hex
 * belongs to one of the four hard-coded palettes. Hex comparison is
 * case-insensitive. A user-customized color on a depth scope is NOT
 * Sight-owned.
 */
export function isSightOwnedDepthRule(rule: TextMateRule): boolean {
    if (!isDepthColorRule(rule)) {
        return false;
    }
    const the_hex = rule.settings.foreground;
    if (!the_hex) {
        return false;
    }
    return PALETTE_HEX_VALUES.has(the_hex.toUpperCase());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/unit/depth-colors-toggle.test.ts`
Expected: PASS (all five cases in this task).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/depth-colors-toggle.test.ts client/src/depth-colors-core.ts
git commit -m "Add palette-match guard for depth color rules

Introduces PALETTE_HEX_VALUES and isSightOwnedDepthRule in depth-colors-core.
A rule is Sight-owned only if it targets a depth scope AND its foreground
matches one of the four hard-coded palettes — case-insensitively. This lets
the upcoming disable path distinguish Sight's rules from user-customized
colors on the same scopes."
```

---

### Task 2: Add `removeSightOwnedDepthRules` (test-first)

**Files:**
- Modify: `tests/unit/depth-colors-toggle.test.ts` (append new `describe` block)
- Modify: `client/src/depth-colors-core.ts` (append after `isSightOwnedDepthRule`)

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/depth-colors-toggle.test.ts` (add the new symbol to the import list at the top too — update the existing import block to include `removeSightOwnedDepthRules`, `TokenColorCustomizations`, `ThemeTokenColorCustomizations`):

```typescript
import {
    DARK_STRING_COLORS,
    DARK_MACRO_COLORS,
    LIGHT_STRING_COLORS,
    LIGHT_MACRO_COLORS,
    STRING_SCOPE_PREFIX,
    MACRO_SCOPE_PREFIX,
    SCOPE_SUFFIX,
    PALETTE_HEX_VALUES,
    isSightOwnedDepthRule,
    removeSightOwnedDepthRules,
    TextMateRule,
    TokenColorCustomizations
} from '../../client/src/depth-colors-core';
```

Append this `describe` block at the end of the file:

```typescript
describe('removeSightOwnedDepthRules', () => {
    const depth_rule = (prefix: string, depth: number, foreground: string): TextMateRule => ({
        scope: `${prefix}${depth}${SCOPE_SUFFIX}`,
        settings: { foreground },
    });

    const non_depth_rule: TextMateRule = {
        scope: 'comment.line.stata',
        settings: { foreground: '#808080' },
    };

    it('returns an empty object for undefined input', () => {
        expect(removeSightOwnedDepthRules(undefined)).toEqual({});
    });

    it('removes Sight-owned rules from [*Dark*], [*Light*], and top-level', () => {
        const the_input: TokenColorCustomizations = {
            '[*Dark*]': {
                textMateRules: [
                    depth_rule(STRING_SCOPE_PREFIX, 1, DARK_STRING_COLORS[0]),
                    depth_rule(MACRO_SCOPE_PREFIX, 2, DARK_MACRO_COLORS[1]),
                ],
            },
            '[*Light*]': {
                textMateRules: [
                    depth_rule(STRING_SCOPE_PREFIX, 1, LIGHT_STRING_COLORS[0]),
                ],
            },
            textMateRules: [
                depth_rule(MACRO_SCOPE_PREFIX, 1, DARK_MACRO_COLORS[0]),
            ],
        };

        const the_result = removeSightOwnedDepthRules(the_input);

        expect(the_result['[*Dark*]']?.textMateRules).toEqual([]);
        expect(the_result['[*Light*]']?.textMateRules).toEqual([]);
        expect(the_result.textMateRules).toEqual([]);
    });

    it('preserves hand-edited rules on depth scopes', () => {
        const the_custom_rule = depth_rule(STRING_SCOPE_PREFIX, 1, '#FF00FF');
        const the_input: TokenColorCustomizations = {
            textMateRules: [
                depth_rule(STRING_SCOPE_PREFIX, 1, DARK_STRING_COLORS[0]),
                the_custom_rule,
            ],
        };

        const the_result = removeSightOwnedDepthRules(the_input);

        expect(the_result.textMateRules).toEqual([the_custom_rule]);
    });

    it('preserves all non-depth rules', () => {
        const the_input: TokenColorCustomizations = {
            '[*Dark*]': {
                textMateRules: [
                    non_depth_rule,
                    depth_rule(STRING_SCOPE_PREFIX, 1, DARK_STRING_COLORS[0]),
                ],
            },
            textMateRules: [non_depth_rule],
        };

        const the_result = removeSightOwnedDepthRules(the_input);

        expect(the_result['[*Dark*]']?.textMateRules).toEqual([non_depth_rule]);
        expect(the_result.textMateRules).toEqual([non_depth_rule]);
    });

    it('is idempotent', () => {
        const the_input: TokenColorCustomizations = {
            '[*Dark*]': {
                textMateRules: [
                    depth_rule(STRING_SCOPE_PREFIX, 1, DARK_STRING_COLORS[0]),
                    non_depth_rule,
                ],
            },
            textMateRules: [
                depth_rule(MACRO_SCOPE_PREFIX, 1, DARK_MACRO_COLORS[0]),
            ],
        };

        const the_once = removeSightOwnedDepthRules(the_input);
        const the_twice = removeSightOwnedDepthRules(the_once);
        expect(the_twice).toEqual(the_once);
    });

    it('does not mutate the input object', () => {
        const the_input: TokenColorCustomizations = {
            '[*Dark*]': {
                textMateRules: [
                    depth_rule(STRING_SCOPE_PREFIX, 1, DARK_STRING_COLORS[0]),
                ],
            },
        };
        const the_snapshot = JSON.parse(JSON.stringify(the_input));

        removeSightOwnedDepthRules(the_input);

        expect(the_input).toEqual(the_snapshot);
    });

    it('preserves sections that have no textMateRules array', () => {
        const the_input: TokenColorCustomizations = {
            '[*Dark*]': {},
        };

        const the_result = removeSightOwnedDepthRules(the_input);

        expect(the_result['[*Dark*]']).toEqual({});
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/unit/depth-colors-toggle.test.ts`
Expected: FAIL with import error on `removeSightOwnedDepthRules` (not yet exported).

- [ ] **Step 3: Add the implementation**

Append to `client/src/depth-colors-core.ts` (after `isSightOwnedDepthRule`):

```typescript
/**
 * Returns a shallow copy of the input with Sight-owned depth rules removed
 * from [*Dark*], [*Light*], and top-level textMateRules. Hand-edited rules
 * on depth scopes (i.e., rules whose foreground is not in PALETTE_HEX_VALUES)
 * are preserved. Does not mutate the input.
 */
export function removeSightOwnedDepthRules(
    customizations: TokenColorCustomizations | undefined
): TokenColorCustomizations {
    if (!customizations) {
        return {};
    }

    const result: TokenColorCustomizations = { ...customizations };

    const filter_section = (
        section: ThemeTokenColorCustomizations | undefined
    ): ThemeTokenColorCustomizations | undefined => {
        if (!section) return section;
        if (!section.textMateRules) return { ...section };
        return {
            ...section,
            textMateRules: section.textMateRules.filter(
                my_rule => !isSightOwnedDepthRule(my_rule)
            ),
        };
    };

    const existing_dark = result['[*Dark*]'] as ThemeTokenColorCustomizations | undefined;
    if (existing_dark !== undefined) {
        result['[*Dark*]'] = filter_section(existing_dark);
    }

    const existing_light = result['[*Light*]'] as ThemeTokenColorCustomizations | undefined;
    if (existing_light !== undefined) {
        result['[*Light*]'] = filter_section(existing_light);
    }

    if (result.textMateRules) {
        result.textMateRules = result.textMateRules.filter(
            my_rule => !isSightOwnedDepthRule(my_rule)
        );
    }

    return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/unit/depth-colors-toggle.test.ts`
Expected: PASS (all cases from Task 1 and Task 2).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/depth-colors-toggle.test.ts client/src/depth-colors-core.ts
git commit -m "Add removeSightOwnedDepthRules filter

Pure helper that strips Sight-written depth rules from the three sections
of editor.tokenColorCustomizations while preserving hand-edited rules on
the same scopes and all non-depth rules. Shallow-copies the input; the
caller is responsible for serializing the result back to settings."
```

---

### Task 3: Register the `sight.depthColors.enabled` setting

**Files:**
- Modify: `client/package.json` (add property after `sight.dataBrowser.missingValueStyle`, before the closing `}` of `properties`)

- [ ] **Step 1: Add the property**

Open `client/package.json`. Find the end of the `sight.dataBrowser.missingValueStyle` entry (around line 388). Insert a new property after its closing `}` (so it becomes the last entry in `properties`):

Change this region:

```json
        "sight.dataBrowser.missingValueStyle": {
          ...
          "enumDescriptions": [
            "Colorize the text (like Stata's default)",
            "Tint the cell background",
            "No special highlighting"
          ]
        }
      }
    },
```

to:

```json
        "sight.dataBrowser.missingValueStyle": {
          ...
          "enumDescriptions": [
            "Colorize the text (like Stata's default)",
            "Tint the cell background",
            "No special highlighting"
          ]
        },
        "sight.depthColors.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Color nested compound strings and local macros by depth. When disabled, removes Sight's depth color rules from editor.tokenColorCustomizations so your theme's default string and variable colors apply."
        }
      }
    },
```

- [ ] **Step 2: Validate JSON**

Run: `bun -e "JSON.parse(require('fs').readFileSync('client/package.json', 'utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/package.json
git commit -m "Declare sight.depthColors.enabled setting

Boolean, default true. When disabled, the depth color feature removes its
rules from editor.tokenColorCustomizations so the theme's native string and
variable colors apply. Wiring lands in subsequent commits."
```

---

### Task 4: Gate `configureDepthColors` and `updateUniversalFallbackColors` on the setting

**Files:**
- Modify: `client/src/depth-colors.ts`

- [ ] **Step 1: Add the `isDepthColorsEnabled` helper**

Open `client/src/depth-colors.ts`. Just before the `configureDepthColors` function (currently around line 95), add:

```typescript
/**
 * True iff the user has enabled Sight's depth coloring of nested strings
 * and local macros. Default: true (preserves historical behavior on
 * upgrade). Read synchronously from the workspace configuration.
 */
export function isDepthColorsEnabled(): boolean {
    return vscode.workspace
        .getConfiguration('sight')
        .get<boolean>('depthColors.enabled', true);
}
```

- [ ] **Step 2: Add the early-return to `configureDepthColors`**

Inside the existing `configureDepthColors` function, at the top of the `try { ... }` block (immediately after `try {`), insert:

```typescript
        if (!isDepthColorsEnabled()) {
            log('Depth colors disabled via sight.depthColors.enabled, skipping');
            return;
        }
```

So the function begins:

```typescript
    try {
        if (!isDepthColorsEnabled()) {
            log('Depth colors disabled via sight.depthColors.enabled, skipping');
            return;
        }
        const config = vscode.workspace.getConfiguration('editor');
        const current_customizations = config.get<TokenColorCustomizations>('tokenColorCustomizations');
        ...
```

- [ ] **Step 3: Add the early-return to `updateUniversalFallbackColors`**

Inside `updateUniversalFallbackColors`, at the top of the `try { ... }` block, insert:

```typescript
        if (!isDepthColorsEnabled()) {
            log('Depth colors disabled via sight.depthColors.enabled, skipping fallback update');
            return;
        }
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Build the client extension to confirm it bundles**

Run: `cd client && bun install && cd ..` (only needed if never run before in this worktree; otherwise skip) then:

Run: `cd client && tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/depth-colors.ts
git commit -m "Gate depth color writes on sight.depthColors.enabled

Adds isDepthColorsEnabled() and early-returns from configureDepthColors
and updateUniversalFallbackColors when the setting is false. The theme-
change handler continues to fire but its call into
updateUniversalFallbackColors now no-ops. Cleanup of existing rules is
added in the next commit."
```

---

### Task 5: Add `disableDepthColors`

**Files:**
- Modify: `client/src/depth-colors.ts`

- [ ] **Step 1: Update the imports from `depth-colors-core`**

At the top of `client/src/depth-colors.ts`, extend the existing `import { ... } from './depth-colors-core'` block to include `removeSightOwnedDepthRules`. The full import block should read:

```typescript
import {
    hasDepthColorRules,
    mergeDepthColors,
    buildDepthColorRules,
    isDepthColorRule,
    removeSightOwnedDepthRules,
    TokenColorCustomizations,
    ThemeTokenColorCustomizations,
    TextMateRule,
    DARK_STRING_COLORS,
    DARK_MACRO_COLORS,
    LIGHT_STRING_COLORS,
    LIGHT_MACRO_COLORS
} from './depth-colors-core';
```

Also add `removeSightOwnedDepthRules` to the `export { ... }` re-export block that lives immediately after the import:

```typescript
export {
    DARK_STRING_COLORS,
    DARK_MACRO_COLORS,
    LIGHT_STRING_COLORS,
    LIGHT_MACRO_COLORS,
    hasDepthColorRules,
    buildDepthColorRules,
    mergeDepthColors,
    isDepthColorRule,
    removeSightOwnedDepthRules
} from './depth-colors-core';
```

- [ ] **Step 2: Add the `disableDepthColors` function**

Append the new function at the end of `client/src/depth-colors.ts` (after `updateUniversalFallbackColors`, which is currently the last function in the file):

```typescript
/**
 * Remove Sight-owned depth color rules from the user's
 * editor.tokenColorCustomizations. Hand-edited rules on depth scopes
 * (non-palette colors) are preserved. Called when the user flips
 * sight.depthColors.enabled to false.
 *
 * Errors are logged to the output channel; the function does not throw,
 * so it is safe to call during activation or configuration-change handlers.
 */
export async function disableDepthColors(
    _context: vscode.ExtensionContext,
    output_channel?: vscode.OutputChannel
): Promise<void> {
    const log = (msg: string) => {
        if (output_channel) {
            output_channel.appendLine(`[DepthColors] ${msg}`);
        }
    };

    try {
        const config = vscode.workspace.getConfiguration('editor');
        const current = config.get<TokenColorCustomizations>('tokenColorCustomizations');
        if (!current) {
            log('No editor.tokenColorCustomizations to clean up');
            return;
        }
        const cleaned = removeSightOwnedDepthRules(current);
        await config.update(
            'tokenColorCustomizations',
            cleaned,
            vscode.ConfigurationTarget.Global
        );
        log('Removed Sight-owned depth color rules');
    } catch (error) {
        log(`Error disabling depth colors: ${error}`);
        console.error('Failed to disable depth colors:', error);
    }
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/depth-colors.ts
git commit -m "Add disableDepthColors cleanup path

Reads editor.tokenColorCustomizations, filters Sight-owned rules via the
palette-match guard, and writes the result back to global settings. Errors
are logged to the output channel rather than thrown, matching the pattern
used by configureDepthColors and updateUniversalFallbackColors."
```

---

### Task 6: Wire up the config-change listener

**Files:**
- Modify: `client/src/depth-colors.ts`
- Modify: `client/src/extension.ts`

- [ ] **Step 1: Add `registerDepthColorsConfigHandler` to `depth-colors.ts`**

Append to `client/src/depth-colors.ts` (after `disableDepthColors`):

```typescript
/**
 * Register a configuration-change listener for sight.depthColors.enabled.
 * - false → true: writes default depth color rules.
 * - true → false: removes Sight-owned depth color rules.
 *
 * Returns the Disposable so the caller can push it into
 * context.subscriptions.
 */
export function registerDepthColorsConfigHandler(
    context: vscode.ExtensionContext,
    output_channel?: vscode.OutputChannel
): vscode.Disposable {
    const log = (msg: string) => {
        if (output_channel) {
            output_channel.appendLine(`[DepthColors] ${msg}`);
        }
    };

    return vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (!event.affectsConfiguration('sight.depthColors.enabled')) {
            return;
        }
        const now_enabled = isDepthColorsEnabled();
        log(`sight.depthColors.enabled changed: now ${now_enabled}`);
        if (now_enabled) {
            await configureDepthColors(context, output_channel);
        } else {
            await disableDepthColors(context, output_channel);
        }
    });
}
```

- [ ] **Step 2: Register the handler in `extension.ts`**

Open `client/src/extension.ts`. Update the import on line 15 from:

```typescript
import { configureDepthColors, resetDepthColors, registerThemeChangeHandler } from './depth-colors';
```

to:

```typescript
import {
    configureDepthColors,
    resetDepthColors,
    registerThemeChangeHandler,
    registerDepthColorsConfigHandler,
    isDepthColorsEnabled
} from './depth-colors';
```

Then, in the `activate` function, immediately after the block that registers the theme-change handler (after `context.subscriptions.push(theme_change_handler); output_channel.appendLine('Registered theme change handler');`), add:

```typescript
    // React to users flipping sight.depthColors.enabled at runtime
    const depth_colors_config_handler = registerDepthColorsConfigHandler(
        context,
        output_channel ?? undefined
    );
    context.subscriptions.push(depth_colors_config_handler);
    output_channel.appendLine('Registered depth colors config handler');
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/depth-colors.ts client/src/extension.ts
git commit -m "React to runtime flips of sight.depthColors.enabled

Registers an onDidChangeConfiguration listener that calls configureDepthColors
when the setting turns on and disableDepthColors when it turns off. No window
reload is required. The handler is pushed into context.subscriptions so VS
Code disposes it on deactivation."
```

---

### Task 7: Gate `sight.resetDepthColors` command on the setting

**Files:**
- Modify: `client/src/extension.ts`

- [ ] **Step 1: Add the guard in the command handler**

Find the `sight.resetDepthColors` command registration in `client/src/extension.ts`:

```typescript
    const reset_command = commands.registerCommand('sight.resetDepthColors', async () => {
        output_channel?.appendLine('Reset depth colors command triggered');
        await resetDepthColors(context, output_channel ?? undefined);
        window.showInformationMessage('Sight depth colors have been reset and reapplied.');
    });
```

Replace it with:

```typescript
    const reset_command = commands.registerCommand('sight.resetDepthColors', async () => {
        output_channel?.appendLine('Reset depth colors command triggered');
        if (!isDepthColorsEnabled()) {
            output_channel?.appendLine('Depth colors disabled; reset command is a no-op');
            window.showInformationMessage(
                'Sight depth colors are disabled in sight.depthColors.enabled. Enable the setting to reset and reapply colors.'
            );
            return;
        }
        await resetDepthColors(context, output_channel ?? undefined);
        window.showInformationMessage('Sight depth colors have been reset and reapplied.');
    });
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/extension.ts
git commit -m "Make sight.resetDepthColors a no-op when feature is disabled

If sight.depthColors.enabled is false, running the reset command would
re-add rules the user explicitly asked us not to write. Instead, show an
info message pointing them at the setting."
```

---

### Task 8: Document the toggle

**Files:**
- Modify: `docs/syntax-highlighting.md`

- [ ] **Step 1: Add a short paragraph**

Open `docs/syntax-highlighting.md`. Find the line that ends the "Automatic Color Configuration" section (the sentence "To reset depth colors to defaults, use the command palette: **Sight: Reset Depth Colors**", around line 87). Insert this paragraph immediately after it, before the `### Default Nesting Colors` heading:

```markdown

To use your VS Code theme's default string and variable colors instead of
Sight's depth-specific palette, set `sight.depthColors.enabled` to `false`
in your VS Code settings. Sight will remove the depth color rules it had
written, leaving any colors you hand-edited on those scopes in place.
Toggle it back on to restore the defaults; no window reload is needed.
```

- [ ] **Step 2: Commit**

```bash
git add docs/syntax-highlighting.md
git commit -m "Document sight.depthColors.enabled toggle

One-paragraph note under the Automatic Color Configuration section
describing how to fall back to theme colors and how the cleanup
preserves hand-edited rules."
```

---

### Task 9: Run the full test and typecheck suite

**Files:** (none edited in this task)

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `bun run test`
Expected: no regressions. All existing tests pass plus the new cases in `tests/unit/depth-colors-toggle.test.ts`.

- [ ] **Step 3: Build the client bundle (sanity-check bundling)**

Run: `cd client && tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 4: No commit needed** (verification only). If any step fails, fix the root cause before moving on — do not commit the plan as complete with a failing step.

---

### Task 10: Manual smoke test in VS Code

**Files:** (none edited; manual verification)

This task is a manual walk-through. It's the only check we have that the VS Code integration wires up correctly end-to-end, since the project does not have an extension-host integration test harness for depth colors.

- [ ] **Step 1: Build the extension**

Run: `bun run build:client`
Expected: successful bundle in `client/dist/` and `client/server/`.

- [ ] **Step 2: Open the extension in VS Code Extension Development Host**

In VS Code, open the `client/` folder and run "Run Extension" (F5). A new Extension Development Host window opens.

- [ ] **Step 3: Verify default behavior (enabled=true)**

In the dev-host window, open any `.do` file with nested compound strings and local macros. Confirm the depth colors apply. Open Settings → search for "Sight Depth Colors Enabled" → confirm the checkbox is present, checked, with the description text from `package.json`.

- [ ] **Step 4: Verify disable**

Uncheck `sight.depthColors.enabled`. Immediately, the depth coloring should revert to your theme's default string and variable colors — without a window reload. Open your user `settings.json` and confirm that Sight's depth rules have been removed from `[*Dark*]`, `[*Light*]`, and the top-level `textMateRules`.

- [ ] **Step 5: Verify hand-edit preservation**

Re-enable `sight.depthColors.enabled` (check it back on). In your user `settings.json`, manually change the foreground of `string.quoted.compound.depth1.stata` under the top-level `textMateRules` to `"#FF00FF"`. Disable `sight.depthColors.enabled` again. Confirm the `#FF00FF` rule is still present in `settings.json` while the palette-colored rules are gone.

- [ ] **Step 6: Verify the reset command is gated**

With `sight.depthColors.enabled` still `false`, run "Sight: Reset Depth Colors" from the command palette. Confirm the info message "Sight depth colors are disabled in sight.depthColors.enabled…" appears and that `editor.tokenColorCustomizations` did not change.

- [ ] **Step 7: Verify theme switch is a no-op when disabled**

With `sight.depthColors.enabled` still `false`, switch your VS Code color theme between a dark and a light theme. Confirm that `editor.tokenColorCustomizations` does not change. Re-enable the setting and switch themes again; the universal top-level rules should be rewritten to the matching palette.

- [ ] **Step 8: Report results**

If any step fails, open a follow-up task describing the specific failure; do not mark the plan complete.

---

## Post-implementation

- Open a PR with title "Add sight.depthColors.enabled toggle" linking to the spec and this plan.
- No version bump is required by the plan itself; bundle the change into the next release along with any other client-side work.

## Summary of expected diffs

| File | Net effect |
| --- | --- |
| `client/src/depth-colors-core.ts` | +~40 lines (`PALETTE_HEX_VALUES`, `isSightOwnedDepthRule`, `removeSightOwnedDepthRules`) |
| `client/src/depth-colors.ts` | +~45 lines (`isDepthColorsEnabled`, `disableDepthColors`, `registerDepthColorsConfigHandler`; 2 early-return guards; import/export updates) |
| `client/src/extension.ts` | +~10 lines (import additions, config handler registration, reset-command guard) |
| `client/package.json` | +5 lines (one property) |
| `tests/unit/depth-colors-toggle.test.ts` | +~150 lines (new file) |
| `docs/syntax-highlighting.md` | +6 lines (one paragraph) |
