# Design Document: Quote Auto-Close (Quote Snippets)

## Overview

This design addresses broken auto-closing behavior for nested Stata string and macro syntax in VS Code. Stata's quoting conventions require overlapping delimiters (e.g., `` ` `` vs `` `" ``) that VS Code's declarative `autoClosingPairs` cannot reliably express.

**Previous Approach (Failed):** The initial implementation used a `type` command interceptor. This approach is fundamentally flawed because VS Code only allows ONE extension to register the `type` command. If any other extension (Vim, etc.) registers it first, our interceptor silently fails.

**New Approach:** Use VS Code snippets combined with `onDidChangeTextDocument` event listener. This approach:
- Does not conflict with other extensions
- Uses VS Code's built-in snippet expansion
- Reacts to document changes to insert closing characters

## Architecture

The solution uses two mechanisms:

1. **Document Change Listener** (`client/src/quote-auto-close.ts`): Listens to `workspace.onDidChangeTextDocument` and inserts closing characters when it detects Stata quote patterns being typed.
2. **Language Configuration** (`client/language-configuration.json`): Handles non-conflicting pairs (braces/brackets/parens). Quote-related pairs are handled by the listener.

```
User Input (keystrokes)
        ↓
VS Code processes keystroke
        ↓
onDidChangeTextDocument fires
        ↓
┌──────────────────────────────────────────────┐
│ Quote Auto-Close Listener (client)           │
│ - detects ` or " typed in Stata docs         │
│ - checks context (what's before/after)       │
│ - inserts closing characters via edit        │
└──────────────────────────────────────────────┘
        ↓
Formatted Output
```

## Components and Interfaces

### Component 1: Document Change Listener

**File**: `client/src/quote-auto-close.ts`

The listener subscribes to `workspace.onDidChangeTextDocument` and performs edits when it recognizes Stata quoting patterns.

```typescript
interface QuoteAutoCloseResult {
    handled: boolean;
    insert_text: string;      // Text to insert after cursor
    delete_before: number;    // Characters to delete before cursor (for skip-over)
    delete_after: number;     // Characters to delete after cursor (for transformations)
    cursor_offset: number;    // Where to place cursor relative to insertion point
}

function compute_quote_auto_close(
    typed_char: string,
    text_before: string,
    text_after: string
): QuoteAutoCloseResult;
```

**Key Logic:**

1. **Single backtick** (`` ` ``): Insert `'` after cursor → `` `|' ``
2. **Double backtick** (`` `` `` when already have `` `|' ``): Transform to `` ``|'' ``
3. **Compound string** (`` `" `` when already have `` `|' ``): Transform to `` `"|"' ``
4. **Nested compound** (`` `"`" ``): Transform to `` `"`"|"'"' ``
5. **Macro in compound** (`` `"` ``): Insert `'` → `` `"`|'"' ``
6. **Macro in double-quote** (`` "` ``): Insert `'` → `` "`|'" ``
7. **Standalone double quote** (`"`): Insert `"` → `"|"`
8. **Skip-over apostrophe**: When typing `'` before existing `'`, delete typed char and move cursor past existing `'`
9. **Skip-over double quote**: When typing `"` before existing `"`, delete typed char and move cursor past existing `"`
10. **Skip-over compound close**: When typing `'` before existing `"'`, delete typed char and move cursor past `"'`

**Safeguards:**
- Only active for `languageId === 'stata'`
- Only processes single-character insertions (backtick, double quote, or apostrophe)
- Uses recursion guard to avoid re-triggering on our own edits
- Checks context to avoid false positives
- Skip-over behavior prevents duplicate closing characters

### Component 2: Language Configuration

**File**: `client/language-configuration.json`

We keep non-conflicting pairs and REMOVE the `"` → `"` pair to avoid conflicts:

```json
{
    "autoClosingPairs": [
        { "open": "{", "close": "}" },
        { "open": "[", "close": "]" },
        { "open": "(", "close": ")" }
    ]
}
```

**Note:** The `"` → `"` pair is intentionally removed because our listener handles quote contexts. VS Code's auto-close would interfere with compound string handling.

## Data Flow

1. User types a character (e.g., `` ` ``)
2. VS Code inserts the character into the document
3. `onDidChangeTextDocument` fires with the change event
4. Listener extracts: typed character, text before cursor, text after cursor
5. `compute_quote_auto_close()` determines what (if anything) to insert
6. If handled, listener applies a `WorkspaceEdit` to insert closing characters
7. Listener repositions cursor between opening and closing

## Correctness Properties

The behavior is example-based: specific input sequences must yield specific output strings + cursor placement.

### Example-Based Tests

| Requirement | Input | Expected Output |
|-------------|-------|-----------------|
| Req 1 | `` ` `` | `` `\|' `` |
| Req 3 | `` `` `` (from `` `\|' ``) | `` ``\|'' `` |
| Req 5 | `"` (from `` `\|' ``) | `` `"\|"' `` |
| Req 6 | `"` (from `` `\|'"' ``) | `` `"\|"'"' `` |
| Req 7 | `` ` `` (from `` `"\|"' ``) | `` `"`\|'"' `` |
| Req 8 | `` ` `` (from `"\|"`) | `` "`\|'" `` |
| Req 9 | `{`, `[`, `(` | Continue to work via language-configuration.json |
| Req 9.4 | `"` | `"\|"` |
| Req 10.1 | `'` (from `` `macro\|' ``) | `` `macro'\| `` (skip-over) |
| Req 10.2 | `"` (from `"string\|"`) | `"string"\|` (skip-over) |
| Req 10.3 | `'` (from `` `"string\|"' ``) | `` `"string"'\| `` (skip-over) |

Note: `\|` represents cursor position.

## Error Handling

- If the listener cannot confidently match a known pattern, it does nothing (character already inserted by VS Code)
- If the edit application fails, the typed character remains (graceful degradation)
- Recursion guard prevents infinite loops from our own edits

## Testing Strategy

### Unit Tests

The core logic in `quote-auto-close-core.ts` can be unit tested:
- Test `compute_quote_auto_close()` with various inputs
- Verify correct `insert_text` and `cursor_offset` for each scenario

### Manual Testing

Manual testing verifies VS Code integration:
1. Open a `.do` file
2. Type each input sequence
3. Confirm exact output + cursor placement

## Migration from Previous Implementation

1. Remove `commands.registerCommand('type', ...)` registration
2. Add `workspace.onDidChangeTextDocument` subscription
3. Update `compute_quote_auto_close()` to return insert text instead of replacement text
4. Remove `"` → `"` from `language-configuration.json` autoClosingPairs
5. Update extension activation to use new listener

## Known Limitations

- The listener reacts AFTER the character is inserted, so there's a brief moment where the unclosed quote is visible
- Multi-cursor scenarios may not work perfectly (listener processes first cursor only)
- Very rapid typing might occasionally miss a closing character (debouncing trade-off)
