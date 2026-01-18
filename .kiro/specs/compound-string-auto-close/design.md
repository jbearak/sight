# Design Document: Compound String Auto-Close

## Overview

This design addresses proper auto-closing behavior for Stata's compound strings in both VS Code and Zed extensions, and documents the grammar revision update process. The implementation leverages the existing `quote-auto-close-core.ts` architecture while adding verification and potential fixes for compound string handling.

## Architecture

The auto-close system operates at two levels:

1. **VS Code Extension**: Uses `onDidChangeTextDocument` listener with custom logic in `quote-auto-close-core.ts` to handle Stata's unique quoting conventions
2. **Zed Extension**: Uses declarative bracket pairs in `config.toml` with limitations for multi-character sequences

```
┌─────────────────────────────────────────────────────────────────┐
│                        VS Code Extension                         │
├─────────────────────────────────────────────────────────────────┤
│  quote-auto-close.ts (listener)                                  │
│       │                                                          │
│       ▼                                                          │
│  quote-auto-close-core.ts (pure logic)                          │
│       │                                                          │
│       ├── compute_quote_auto_close()                            │
│       │     ├── Backtick handling (` → `|')                     │
│       │     ├── Compound string (`" → `"|"')                    │
│       │     └── Skip-over behavior                              │
│       │                                                          │
│       └── compute_deletion_cleanup()                            │
│             └── Paired character deletion                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Zed Extension                             │
├─────────────────────────────────────────────────────────────────┤
│  config.toml                                                     │
│       │                                                          │
│       └── brackets = [                                          │
│             { start = "`", end = "'", close = true }            │
│             { start = "\"", end = "\"", close = true }          │
│           ]                                                      │
│                                                                  │
│  Limitation: Cannot handle multi-character sequences like `"    │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Component 1: VS Code Quote Auto-Close Core

**File**: `client/src/quote-auto-close-core.ts`

The existing `compute_quote_auto_close` function handles compound strings through the following logic:

```typescript
// Current implementation for compound string (Req 5 in existing code)
if (my_typed === '"') {
    // Compound string open - before ends with `" (backtick then quote just typed)
    // and after starts with ' (from the backtick's auto-close)
    if (my_before.endsWith('`"') && my_after.startsWith("'")) {
        // Delete the ' and replace with "' for compound string close
        return {
            handled: true,
            insert_text: "\"'",
            delete_before: 0,
            delete_after: 1, // Delete the existing '
            cursor_offset: 0,
        };
    }
}
```

**Verification needed**: Ensure this produces `` `"|"' `` with cursor between the quotes.

### Component 2: VS Code Quote Auto-Close Listener

**File**: `client/src/quote-auto-close.ts`

The listener intercepts document changes and applies the core logic. Key aspects:
- Uses `onDidChangeTextDocument` to avoid conflicts with other extensions
- Maintains recursion guard (`is_applying_edit`) to prevent infinite loops
- Caches line content for deletion tracking

### Component 3: Zed Extension Configuration

**File**: `zed-extension/languages/stata/config.toml`

Current configuration:
```toml
brackets = [
  { start = "`", end = "'", close = true, newline = false },
  { start = "\"", end = "\"", close = true, newline = false },
]
```

**Limitation**: Zed's bracket system only supports single-character start/end pairs. Multi-character sequences like `` `" `` → `` "' `` cannot be configured. This is a fundamental limitation of Zed's architecture.

### Component 4: AGENTS.md Documentation Update

**File**: `AGENTS.md`

New section to be added after the existing "Zed + Tree-sitter Alignment" section:

```markdown
### Grammar Revision Update Process

When the tree-sitter-stata grammar is updated, the Zed extension must be updated
to reference the new revision.

**When to update:**
- After merging changes to tree-sitter-stata that affect parsing
- After adding/removing/renaming node types
- After fixing grammar bugs that affect syntax highlighting

**How to update:**
1. Get the new commit SHA from tree-sitter-stata repository
2. Update `zed-extension/extension.toml`:
   ```toml
   [grammars.stata]
   repository = "https://github.com/jbearak/tree-sitter-stata"
   rev = "<new-sha>"
   ```
3. If node types changed, update query files in `zed-extension/languages/stata/`:
   - `highlights.scm` - syntax highlighting
   - `brackets.scm` - bracket matching
   - `indents.scm` - auto-indentation
   - `outline.scm` - code outline

**Testing after update:**
1. Clear Zed's grammar cache:
   ```bash
   rm -rf ~/Library/Application\ Support/Zed/extensions/installed/sight/grammars
   ```
2. Rebuild the extension in Zed (Extensions: Rebuild)
3. Restart Zed
4. Verify syntax highlighting works on sample Stata files
5. Check Zed logs for grammar load errors:
   ```bash
   tail -f ~/Library/Logs/Zed/zed.log | grep -i stata
   ```

**Relationship between repositories:**
- `tree-sitter-stata`: Grammar definition (grammar.js, scanner.c)
- `sight`: LSP server + editor extensions that consume the grammar
- Changes flow: tree-sitter-stata → sight/zed-extension/extension.toml
```

## Data Models

### QuoteAutoCloseResult Interface

```typescript
export interface QuoteAutoCloseResult {
    handled: boolean;
    insert_text: string;      // Text to insert after cursor
    delete_before: number;    // Characters to delete before cursor
    delete_after: number;     // Characters to delete after cursor
    cursor_offset: number;    // Cursor movement after edit
}
```

### Compound String State Transitions

| Initial State | User Types | Before Context | After Context | Result |
|--------------|------------|----------------|---------------|--------|
| Empty | `` ` `` | `` ` `` | (empty) | `` `\|' `` (VS Code handles) |
| `` `\|' `` | `"` | `` `" `` | `'` | `` `"\|"' `` |
| `` `"\|"' `` | text | `` `"text `` | `"'` | `` `"text\|"' `` |
| `` `"text\|"' `` | `"` | `` `"text" `` | `"'` | `` `"text"\|"' `` (skip-over) |
| `` `"text"\|"' `` | `'` | `` `"text"' `` | `'` | `` `"text"'\| `` (skip-over) |



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, the following properties are testable:

### Property 1: Compound String Transformation

*For any* text context where the user has typed a backtick (producing `` `|' ``), when the user subsequently types a double quote, the system SHALL transform the state to `` `"|"' `` with the cursor positioned between the inner quotes.

**Validates: Requirements 1.1**

### Property 2: Skip-Over Behavior for Closing Characters

*For any* auto-closed quote pattern (local macro `` `|' `` or compound string `` `"|"' ``), when the user types the closing character(s) that already exist after the cursor, the system SHALL skip over the existing characters instead of inserting duplicates.

**Validates: Requirements 1.3, 2.3**

### Property 3: Nested Backtick Handling

*For any* state where a backtick has been typed and auto-closed (`` `|' ``), when the user types another backtick, the system SHALL produce `` ``|'' `` with proper nested closing apostrophes.

**Validates: Requirements 2.2**

### Property 4: Backtick Deletion Cleanup

*For any* single-character deletion where the deleted character is a backtick, the cleanup function SHALL delete exactly one character if and only if the character immediately to the right of the cursor is an apostrophe.

**Validates: Requirements 2.4**

*Note: This property is already tested in `quote-auto-delete.property.test.ts`.*

## Error Handling

### VS Code Extension

1. **Recursion Guard**: The `is_applying_edit` flag prevents infinite loops when our edits trigger additional change events
2. **Document Cache**: Line content is cached to track deleted characters; if cache is missing, deletion cleanup is skipped gracefully
3. **Multi-cursor/Selection**: Auto-close only applies to single cursor with empty selection
4. **Non-Stata Files**: Changes to non-Stata files are ignored

### Zed Extension

1. **Grammar Load Failures**: If the grammar revision is invalid, Zed logs errors and falls back to plain text
2. **Bracket Pair Conflicts**: The `autoclose_before` setting prevents auto-closing in certain contexts

### Documentation

1. **Missing Section**: If AGENTS.md doesn't have the grammar revision section, the implementation task will add it
2. **Stale Information**: Documentation should be updated whenever the process changes

## Testing Strategy

### Dual Testing Approach

- **Unit tests**: Verify specific examples, edge cases, and error conditions
- **Property tests**: Verify universal properties across all inputs

Both are complementary and necessary for comprehensive coverage.

### Property-Based Testing Configuration

- **Library**: fast-check (already used in the project)
- **Minimum iterations**: 100 per property test
- **Tag format**: `Feature: compound-string-auto-close, Property N: {property_text}`

### Test Files

1. **New Property Tests**: `tests/property/compound-string-auto-close.property.test.ts`
   - Property 1: Compound string transformation
   - Property 2: Skip-over behavior
   - Property 3: Nested backtick handling

2. **Existing Tests**: `tests/property/quote-auto-delete.property.test.ts`
   - Property 4 is already covered here

3. **Unit Tests**: Add edge cases to existing test file or create new unit test file
   - Empty compound strings
   - Nested compound strings (edge case from 1.2)
   - Context boundaries (start/end of line)

### Test Scenarios

| Scenario | Input State | Action | Expected Output |
|----------|-------------|--------|-----------------|
| Basic compound string | `` `\|' `` | Type `"` | `` `"\|"' `` |
| Skip-over `"` | `` `"text\|"' `` | Type `"` | `` `"text"\|"' `` |
| Skip-over `'` | `` `"text"\|"' `` | Type `'` | `` `"text"'\| `` |
| Nested backticks | `` `\|' `` | Type `` ` `` | `` ``\|'' `` |
| Delete backtick | `` \|' `` (after deleting `` ` ``) | (automatic) | `` \| `` (apostrophe deleted) |

### Regression Testing

All existing tests in `quote-auto-delete.property.test.ts` must continue to pass.
