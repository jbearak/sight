# Design Document

## Overview

This design document describes the implementation approach for enabling visual differentiation of nested string and macro depths in Stata syntax highlighting. The TextMate grammar already assigns depth-based scope names, but VS Code themes don't automatically colorize these custom scopes differently.

**Important:** VS Code does not support `editor.tokenColorCustomizations` in extension `configurationDefaults`. The extension must programmatically add these settings to user configuration on activation using the VS Code API.

This feature:
1. Programmatically configures `editor.tokenColorCustomizations` on first activation
2. Provides separate color palettes for dark and light themes
3. Respects existing user customizations

### Background: Why Not Use configurationDefaults?

VS Code explicitly does not support `editor.tokenColorCustomizations` in extension `configurationDefaults`. When attempted, VS Code warns "Unknown editor configuration setting". This is a known limitation documented in multiple Stack Overflow discussions.

The solution is to use the VS Code API (`vscode.workspace.getConfiguration()` and `configuration.update()`) to programmatically add the settings to user configuration on extension activation.

### Background: Why Not Use Bracket Pair Colorization?

VS Code's native bracket pair colorization is a completely separate system from TextMate grammars:

1. **It only colors bracket characters** - The system colors the `{`, `}`, `(`, `)` characters themselves, NOT the content between them
2. **It's disabled inside strings** - By design, bracket colorization ignores brackets inside strings and comments to avoid false matches
3. **It uses its own internal AST** - The bracket system builds a separate data structure, independent of TextMate scopes

Therefore, the TextMate grammar approach with `editor.tokenColorCustomizations` is the correct solution for colorizing nested string content.

## Architecture

### Current State

The TextMate grammar (`client/syntaxes/stata.tmLanguage.json`) already implements:
- Six depth levels for compound strings: `string.quoted.compound.depth1.stata` through `depth6`
- Six depth levels for local macros: `variable.other.macro.local.depth1.stata` through `depth6`
- Cycling back to depth1 after depth6

The grammar correctly assigns these scopes, but VS Code themes only have rules for generic scopes like `string` or `variable.other.macro`, causing all depths to appear the same color.

### Solution

On extension activation:
1. Check if depth color settings already exist in user configuration
2. Check if this is the first activation (using global state)
3. If settings don't exist and it's first activation, add them programmatically
4. Use theme selectors (`[*Dark*]` and `[*Light*]`) to provide theme-appropriate colors

## Components and Interfaces

### 1. Extension Activation Logic

Add to `client/src/extension.ts`:

```typescript
async function configureDepthColors(context: vscode.ExtensionContext): Promise<void> {
    const CONFIGURED_KEY = 'depthColorsConfigured';
    
    // Check if we've already configured colors
    const already_configured = context.globalState.get<boolean>(CONFIGURED_KEY, false);
    if (already_configured) {
        return;
    }
    
    const config = vscode.workspace.getConfiguration('editor');
    const current_customizations = config.get<any>('tokenColorCustomizations') || {};
    
    // Check if user already has depth color rules
    if (hasDepthColorRules(current_customizations)) {
        // Mark as configured so we don't check again
        await context.globalState.update(CONFIGURED_KEY, true);
        return;
    }
    
    // Add our default colors
    const new_customizations = mergeDepthColors(current_customizations);
    await config.update('tokenColorCustomizations', new_customizations, vscode.ConfigurationTarget.Global);
    await context.globalState.update(CONFIGURED_KEY, true);
}
```

### 2. Color Scheme Design

#### Dark Theme String Depth Colors (Warm Progression)

Using a warm color progression from orange to teal, optimized for dark backgrounds:

| Depth | Color | Hex Code | Description |
|-------|-------|----------|-------------|
| 1 | Orange | `#CE9178` | Base string color (matches VS Code Dark+ default) |
| 2 | Light Orange | `#D4A373` | Slightly lighter/warmer |
| 3 | Gold | `#DCDCAA` | Yellow-gold tone |
| 4 | Yellow-Green | `#B5CEA8` | Transitioning to green |
| 5 | Light Green | `#A8D4A8` | Soft green |
| 6 | Teal | `#8ECDC8` | Blue-green |

#### Light Theme String Depth Colors (Warm Progression)

Using a warm color progression optimized for light backgrounds:

| Depth | Color | Hex Code | Description |
|-------|-------|----------|-------------|
| 1 | Dark Red | `#A31515` | Base string color (matches VS Code Light+ default) |
| 2 | Brown | `#986801` | Warm brown |
| 3 | Olive | `#6B8E23` | Olive green |
| 4 | Forest Green | `#2E8B57` | Medium green |
| 5 | Teal | `#008B8B` | Dark cyan |
| 6 | Steel Blue | `#4682B4` | Blue tone |

#### Dark Theme Macro Depth Colors (Cool Progression)

Using a cool color progression from blue to purple, optimized for dark backgrounds:

| Depth | Color | Hex Code | Description |
|-------|-------|----------|-------------|
| 1 | Light Blue | `#9CDCFE` | Base macro color (matches VS Code Dark+ default) |
| 2 | Sky Blue | `#7DCFEA` | Slightly different blue |
| 3 | Cyan | `#6DD4D4` | Cyan tone |
| 4 | Teal | `#5DC9B0` | Blue-green |
| 5 | Light Purple | `#B4A7D6` | Transitioning to purple |
| 6 | Lavender | `#C9A7DE` | Soft purple |

#### Light Theme Macro Depth Colors (Cool Progression)

Using a cool color progression optimized for light backgrounds:

| Depth | Color | Hex Code | Description |
|-------|-------|----------|-------------|
| 1 | Dark Blue | `#001080` | Base macro color (matches VS Code Light+ default) |
| 2 | Navy | `#0000CD` | Medium blue |
| 3 | Royal Blue | `#4169E1` | Brighter blue |
| 4 | Purple | `#6A5ACD` | Slate blue |
| 5 | Violet | `#8A2BE2` | Blue violet |
| 6 | Magenta | `#9932CC` | Dark orchid |

### 3. Settings Structure

The extension will create this structure in user settings:

```json
{
  "editor.tokenColorCustomizations": {
    "[*Dark*]": {
      "textMateRules": [
        { "scope": "string.quoted.compound.depth1.stata", "settings": { "foreground": "#CE9178" } },
        { "scope": "string.quoted.compound.depth2.stata", "settings": { "foreground": "#D4A373" } },
        { "scope": "string.quoted.compound.depth3.stata", "settings": { "foreground": "#DCDCAA" } },
        { "scope": "string.quoted.compound.depth4.stata", "settings": { "foreground": "#B5CEA8" } },
        { "scope": "string.quoted.compound.depth5.stata", "settings": { "foreground": "#A8D4A8" } },
        { "scope": "string.quoted.compound.depth6.stata", "settings": { "foreground": "#8ECDC8" } },
        { "scope": "variable.other.macro.local.depth1.stata", "settings": { "foreground": "#9CDCFE" } },
        { "scope": "variable.other.macro.local.depth2.stata", "settings": { "foreground": "#7DCFEA" } },
        { "scope": "variable.other.macro.local.depth3.stata", "settings": { "foreground": "#6DD4D4" } },
        { "scope": "variable.other.macro.local.depth4.stata", "settings": { "foreground": "#5DC9B0" } },
        { "scope": "variable.other.macro.local.depth5.stata", "settings": { "foreground": "#B4A7D6" } },
        { "scope": "variable.other.macro.local.depth6.stata", "settings": { "foreground": "#C9A7DE" } }
      ]
    },
    "[*Light*]": {
      "textMateRules": [
        { "scope": "string.quoted.compound.depth1.stata", "settings": { "foreground": "#A31515" } },
        { "scope": "string.quoted.compound.depth2.stata", "settings": { "foreground": "#986801" } },
        { "scope": "string.quoted.compound.depth3.stata", "settings": { "foreground": "#6B8E23" } },
        { "scope": "string.quoted.compound.depth4.stata", "settings": { "foreground": "#2E8B57" } },
        { "scope": "string.quoted.compound.depth5.stata", "settings": { "foreground": "#008B8B" } },
        { "scope": "string.quoted.compound.depth6.stata", "settings": { "foreground": "#4682B4" } },
        { "scope": "variable.other.macro.local.depth1.stata", "settings": { "foreground": "#001080" } },
        { "scope": "variable.other.macro.local.depth2.stata", "settings": { "foreground": "#0000CD" } },
        { "scope": "variable.other.macro.local.depth3.stata", "settings": { "foreground": "#4169E1" } },
        { "scope": "variable.other.macro.local.depth4.stata", "settings": { "foreground": "#6A5ACD" } },
        { "scope": "variable.other.macro.local.depth5.stata", "settings": { "foreground": "#8A2BE2" } },
        { "scope": "variable.other.macro.local.depth6.stata", "settings": { "foreground": "#9932CC" } }
      ]
    }
  }
}
```

### 4. README Documentation

Add a new section to README.md explaining:
- How nesting depth colorization works
- That colors are automatically configured on first activation
- Default colors for each depth (dark and light themes)
- How to customize colors to match user's bracket pair colors
- Example configuration for matching bracket colors

## Data Models

### TextMate Rule Structure

```typescript
interface TextMateRule {
  scope: string;           // e.g., "string.quoted.compound.depth1.stata"
  settings: {
    foreground?: string;   // Hex color code
    fontStyle?: string;    // "italic", "bold", etc.
  };
}

interface ThemeTokenColorCustomizations {
  textMateRules: TextMateRule[];
}

interface TokenColorCustomizations {
  "[*Dark*]"?: ThemeTokenColorCustomizations;
  "[*Light*]"?: ThemeTokenColorCustomizations;
  "[*]"?: ThemeTokenColorCustomizations;  // All themes
  textMateRules?: TextMateRule[];         // Legacy format
}
```

### Color Palette Constants

```typescript
const DARK_STRING_COLORS = ['#CE9178', '#D4A373', '#DCDCAA', '#B5CEA8', '#A8D4A8', '#8ECDC8'];
const DARK_MACRO_COLORS = ['#9CDCFE', '#7DCFEA', '#6DD4D4', '#5DC9B0', '#B4A7D6', '#C9A7DE'];
const LIGHT_STRING_COLORS = ['#A31515', '#986801', '#6B8E23', '#2E8B57', '#008B8B', '#4682B4'];
const LIGHT_MACRO_COLORS = ['#001080', '#0000CD', '#4169E1', '#6A5ACD', '#8A2BE2', '#9932CC'];
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: All Dark Theme String Depths Have Distinct Colors

*For any* two different string depth levels (1-6), the configured dark theme foreground colors SHALL be different hex values.

**Validates: Requirements 1.4, 1.6**

### Property 2: All Dark Theme Macro Depths Have Distinct Colors

*For any* two different macro depth levels (1-6), the configured dark theme foreground colors SHALL be different hex values.

**Validates: Requirements 2.4, 2.6**

### Property 3: All Light Theme String Depths Have Distinct Colors

*For any* two different string depth levels (1-6), the configured light theme foreground colors SHALL be different hex values.

**Validates: Requirements 1.4, 1.6**

### Property 4: All Light Theme Macro Depths Have Distinct Colors

*For any* two different macro depth levels (1-6), the configured light theme foreground colors SHALL be different hex values.

**Validates: Requirements 2.4, 2.6**

### Property 5: Dark Theme String and Macro Color Sets Are Disjoint

*For any* dark theme string depth color and any dark theme macro depth color, the two colors SHALL be different hex values.

**Validates: Requirements 2.5**

### Property 6: Light Theme String and Macro Color Sets Are Disjoint

*For any* light theme string depth color and any light theme macro depth color, the two colors SHALL be different hex values.

**Validates: Requirements 2.5**

### Property 7: Inline Mata Does Not Block Subsequent Stata Commands

*For any* inline Mata statement (`mata: expression` on a single line), Stata commands on subsequent lines SHALL receive Stata command scopes (not Mata scopes).

**Validates: Requirements 6.1, 6.4**

### Property 8: Multi-line Mata Blocks End Correctly

*For any* multi-line Mata block (starting with `mata:` at end of line), the block SHALL end when `end` appears on its own line, and subsequent Stata commands SHALL receive Stata command scopes.

**Validates: Requirements 6.2, 6.3**

## Error Handling

### First Activation Detection

The extension uses `context.globalState` to track whether depth colors have been configured:
- On first activation: configure colors and set flag
- On subsequent activations: skip configuration
- This prevents overwriting user customizations after initial setup

### User Override Behavior

The extension checks for existing depth color rules before adding defaults:
- If user already has rules for `string.quoted.compound.depth*.stata` scopes, skip configuration
- This respects manual user customizations made before extension installation

### Settings Update Failures

If `configuration.update()` fails:
- Log the error for debugging
- Continue extension activation (colors are not critical for core functionality)
- User can manually add colors following README instructions

### Theme Compatibility

The chosen colors are designed to:
- Work with dark themes (using `[*Dark*]` selector with bright, high-contrast colors)
- Work with light themes (using `[*Light*]` selector with darker, appropriate-contrast colors)
- Not conflict with common theme colors for other syntax elements
- Maintain readability against typical editor backgrounds

## Testing Strategy

### Unit Tests

1. **Color Palette Tests**: Verify all color constants are valid hex codes
2. **Color Uniqueness Tests**: Verify all colors are distinct within each category and across categories for both themes
3. **Scope Name Tests**: Verify scope names match the TextMate grammar exactly
4. **Settings Detection Tests**: Verify `hasDepthColorRules()` correctly detects existing rules
5. **Settings Merge Tests**: Verify `mergeDepthColors()` correctly merges with existing settings

### Property-Based Tests

1. **Distinct Colors Property (Dark)**: For all pairs of depth levels, verify dark theme colors are different
2. **Distinct Colors Property (Light)**: For all pairs of depth levels, verify light theme colors are different
3. **Disjoint Sets Property (Dark)**: For all dark theme string/macro color pairs, verify no overlap
4. **Disjoint Sets Property (Light)**: For all light theme string/macro color pairs, verify no overlap

### Integration Tests

1. **First Activation Test**: Verify colors are added to empty settings on first activation
2. **Existing Settings Test**: Verify existing user settings are preserved
3. **Subsequent Activation Test**: Verify colors are not re-added on subsequent activations

### Manual Verification

1. Open a Stata file with nested strings/macros in VS Code
2. Use "Developer: Inspect Editor Tokens and Scopes" to verify scope assignment
3. Visually confirm different depths show different colors
4. Switch between dark and light themes to verify appropriate colors are applied

## Implementation Notes

### Programmatic Settings Configuration

The extension must configure colors programmatically because VS Code does not support `editor.tokenColorCustomizations` in `configurationDefaults`. The implementation:

1. **On activation**: Call `configureDepthColors(context)` 
2. **Check global state**: Use `context.globalState.get('depthColorsConfigured')` to detect first run
3. **Check existing settings**: Look for existing depth color rules to avoid overwriting
4. **Update settings**: Use `configuration.update()` with `ConfigurationTarget.Global` to add colors
5. **Set flag**: Mark configuration as complete in global state

### Theme Selectors

VS Code supports theme-specific token color customizations using selectors:
- `[*Dark*]` - Matches all dark themes (Dark+, Monokai, One Dark, etc.)
- `[*Light*]` - Matches all light themes (Light+, Solarized Light, etc.)
- `[*]` - Matches all themes (fallback)

The extension uses `[*Dark*]` and `[*Light*]` to provide optimized colors for each theme type.

### Mata Block Fix

The current Mata block pattern has a critical issue: it treats ALL `mata:` statements as starting a multi-line block that waits for `end`. However, Stata has multiple forms of Mata:

1. **Multi-line Mata block** (with or without colon): 
   ```stata
   mata:
   // Mata code here
   end
   ```
   or
   ```stata
   mata
   // Mata code here
   end
   ```

2. **Inline Mata** (single line, no `end`):
   ```stata
   mata: recoded_files = recoded_files \ st_local("path")
   ```
   or
   ```stata
   mata recoded_files = recoded_files \ st_local("path")
   ```

The colon after `mata` is optional in Stata. The fix requires two separate patterns:

#### Pattern 1: Inline Mata (Higher Priority)
```json
{
    "match": "\\b(mata)\\s*:?\\s+(.+)$",
    "captures": {
        "1": { "name": "keyword.control.mata.stata" },
        "2": { "name": "meta.embedded.inline.mata.stata" }
    }
}
```

This matches `mata` (with optional colon) followed by non-whitespace content on the same line. The key is `\\s+` (one or more whitespace) followed by `.+` (one or more characters) - this ensures there's actual code after `mata`.

#### Pattern 2: Multi-line Mata Block (Lower Priority)
```json
{
    "begin": "\\b(mata)\\s*:?\\s*$",
    "beginCaptures": {
        "1": { "name": "keyword.control.mata.stata" }
    },
    "end": "^\\s*(end)\\s*$",
    "endCaptures": {
        "1": { "name": "keyword.control.mata.stata" }
    },
    "name": "meta.embedded.block.mata.stata",
    "patterns": [...]
}
```

This matches `mata` (with optional colon) at end of line (with optional trailing whitespace) and waits for `end` on its own line.

The inline pattern must appear BEFORE the block pattern in the grammar's pattern list to take precedence.

### Color Selection Rationale

Colors were chosen to:
1. Start with VS Code's default string/variable colors for depth 1 (familiar to users)
2. Progress through visually distinct hues for each depth
3. Use warm colors for strings (orange → green for dark, red → blue for light)
4. Use cool colors for macros (blue → purple for both themes)
5. Maintain sufficient contrast for readability
6. Optimize brightness for each theme type (brighter for dark, darker for light)
