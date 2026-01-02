# Design Document: Quote Auto-Delete Simplification

## Overview

This design simplifies the quote auto-delete logic in the Stata VS Code extension. The current `compute_deletion_cleanup` function in `quote-auto-close.ts` uses complex pattern matching with multiple conditions. This redesign replaces it with two simple rules based solely on the deleted character and the character immediately to its right.

The key insight is that we don't need to track nesting levels or analyze context. The auto-close feature already ensures that when a user types an opening delimiter, the corresponding closer is inserted. Therefore, when deleting an opener, if the closer is immediately to the right, it should be deleted.

## Architecture

The feature lives entirely in the VS Code client extension (`client/src/`). The architecture remains unchanged:

```
Document Change Event → handle_document_change() → handle_character_deletion()
                                                          ↓
                                                 compute_deletion_cleanup()
                                                          ↓
                                                 Apply WorkspaceEdit (if needed)
```

The only change is to the `compute_deletion_cleanup` function, which will be dramatically simplified.

## Components and Interfaces

### Modified Component: `compute_deletion_cleanup`

Location: `client/src/quote-auto-close.ts`

Current signature (unchanged):
```typescript
function compute_deletion_cleanup(my_before: string, my_after: string): number
```

The function receives:
- `my_before`: Text before the cursor position (after the deletion has occurred)
- `my_after`: Text after the cursor position

The function returns the number of characters to delete after the cursor (0, 1, or more).

### New Logic

The simplified logic requires knowing what character was deleted. Currently, the function only receives `my_before` and `my_after` but not the deleted character itself. We need to pass the deleted character to the function.

New signature:
```typescript
function compute_deletion_cleanup(
    my_deleted_char: string,
    my_char_to_right: string
): number
```

Implementation (pseudocode):
```
IF deleted_char is backtick (`) AND char_to_right is apostrophe (')
    RETURN 1
ELSE IF deleted_char is double_quote (") AND char_to_right is double_quote (")
    RETURN 1
ELSE
    RETURN 0
```

### Modified Component: `handle_character_deletion`

The caller needs to be updated to:
1. Capture the deleted character from the change event
2. Extract the character immediately to the right of the cursor
3. Pass both to `compute_deletion_cleanup`

The deleted character can be obtained from the document content at the deletion range before the change is applied, or from the change event's `rangeOffset` in the original document. However, since `onDidChangeTextDocument` fires AFTER the change, we need to get the deleted character from the change event itself.

Looking at the VS Code API, `TextDocumentContentChangeEvent` has:
- `range`: The range that got replaced
- `rangeOffset`: Offset of the range
- `rangeLength`: Length of the range (1 for single char deletion)
- `text`: The new text (empty string for deletion)

The deleted character is NOT directly available in the event. We need to track it differently.

**Solution**: Use the document's version history or capture the character before deletion. Since we're in `onDidChangeTextDocument` (after the change), we can't directly access the deleted character. However, we can infer it from context:

Actually, looking more carefully at the current implementation, it doesn't have access to the deleted character either - it uses pattern matching on `my_before` and `my_after`. 

**Revised approach**: We can determine what was deleted by looking at what's now at the cursor position in `my_after`. But that's the character AFTER the cursor, not what was deleted.

**Better solution**: Store the previous document state or use `workspace.onWillSaveTextDocument` to capture state. But this adds complexity.

**Simplest solution**: Since we only care about backtick and double-quote deletions, and we only act when specific characters are to the right, we can use a heuristic:

- If `my_after` starts with `'` and the deletion could have been a backtick → delete the `'`
- If `my_after` starts with `"` and the deletion could have been a `"` → delete the `"`

But this is what the current complex logic tries to do. The issue is we can't know FOR CERTAIN what was deleted.

**Final solution**: Use VS Code's `onDidChangeTextDocument` event which provides the range of the change. We can read the character that WAS at that position from a cached copy of the document, or we can use a different approach:

Since the `rangeLength` is 1 and we know the exact position, we can use `workspace.onWillChangeTextDocument` (if available) or maintain a simple character cache.

Actually, the simplest approach: **Use the character that's now at the cursor position in the BEFORE text**. Wait, that doesn't work either because the deletion already happened.

**Practical solution**: We'll modify the architecture slightly. Before the deletion is processed, we'll capture the character at the deletion position. We can do this by:

1. Using a pre-change listener to cache the character
2. Or, checking if the cursor was positioned after a specific character type

Looking at the current code more carefully, `my_change.range` gives us the range that was deleted. We can use this to determine what character was at that position by looking at the line content before the change... but we don't have access to that.

**Implemented solution**: We'll use a simple state variable to track the last character at each position, updated on each change. Or simpler: we'll use the `TextDocumentChangeEvent.reason` if available.

Actually, the cleanest solution is to **not need the deleted character at all** for the simple cases:

- If `my_after[0]` is `'` and `my_before` doesn't end with `'` → a backtick was likely deleted, delete the `'`
- If `my_after[0]` is `"` and `my_before` doesn't end with `"` → a quote was likely deleted, delete the `"`

But this is still heuristic-based.

**Final practical solution**: We'll capture the deleted character by reading from the document BEFORE applying our cleanup edit. We can do this by:

1. In `handle_character_deletion`, before calling `compute_deletion_cleanup`, read the character that was at `my_change.range.start` from a cached version
2. Or, use the fact that VS Code fires events in order - we can cache on `onWillChangeTextDocument`

For simplicity, we'll use a **document content cache** that stores the previous content of each line. This is updated after each change.

### New Component: Line Cache (Optional Optimization)

If we want to avoid the cache complexity, we can use a simpler approach:

**Observation**: The user's rules don't actually require knowing the deleted character! They require knowing:
1. What character is to the right of the cursor
2. What the "logical" deletion was

Since the auto-close feature inserts closers immediately after openers, and we're handling backspace (which deletes the character immediately before the cursor), we can infer:

- If cursor is now at position P, the deleted character was at position P
- The character to the right is at position P (which is `my_after[0]`)

The rules become:
- If `my_after[0]` is `'` → check if a backtick was deleted → delete `'`
- If `my_after[0]` is `"` → check if a quote was deleted → delete `"`

To check if a backtick/quote was deleted, we need the deleted character. 

**Simplest implementation**: Store the document text before each change using a Map keyed by URI. Update it after processing each change.

## Data Models

### DocumentCache (New)

```typescript
interface DocumentCache {
    uri: string;
    content: string;
    version: number;
}

const document_cache: Map<string, DocumentCache> = new Map();
```

This cache stores the previous document content so we can determine what character was deleted.

### Deletion Context

```typescript
interface DeletionContext {
    deleted_char: string;
    char_to_right: string;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Backtick deletion cleanup

*For any* single-character deletion where the deleted character is a backtick (`), the cleanup function SHALL delete exactly one character if and only if the character immediately to the right of the cursor is an apostrophe (').

**Validates: Requirements 1.1, 1.2**

### Property 2: Apostrophe deletion passthrough

*For any* single-character deletion where the deleted character is an apostrophe ('), the cleanup function SHALL delete zero additional characters regardless of surrounding context.

**Validates: Requirements 2.1**

### Property 3: Double quote deletion cleanup

*For any* single-character deletion where the deleted character is a double quote ("), the cleanup function SHALL delete exactly one character if and only if the character immediately to the right of the cursor is also a double quote (").

**Validates: Requirements 3.1, 3.2**

### Property 4: Multi-character deletion passthrough

*For any* deletion where more than one character is removed, the cleanup function SHALL delete zero additional characters.

**Validates: Requirements 5.1, 5.2**

## Error Handling

- If the document cache is stale or missing, fall back to no cleanup (safe default)
- If the cursor position is at end of line (no character to right), no cleanup needed
- If the deletion range spans multiple lines, no cleanup (multi-char deletion)

## Testing Strategy

### Unit Tests

Unit tests will cover specific examples and edge cases:

1. **Compound string cleanup sequence** (Requirement 4): Test the exact sequence described in the requirements where typing `` `"a`"b `` and then backspacing produces the expected results at each step.

2. **Edge cases**:
   - Deletion at end of line (no character to right)
   - Deletion at end of document
   - Empty document
   - Non-delimiter character deletion (should never trigger cleanup)

### Property-Based Tests

Property-based tests will use fast-check to verify the correctness properties hold across many generated inputs.

**Test Configuration**:
- Minimum 100 iterations per property test
- Each test tagged with: **Feature: quote-auto-delete-simplification, Property N: [property text]**

**Generator Strategy**:
- Generate random "before" strings (0-10 chars from alphabet + delimiters)
- Generate random "after" strings (0-10 chars from alphabet + delimiters)  
- Generate random deleted characters (from full character set)
- Verify the cleanup function returns the correct value based on the simple rules

**Property Test Structure**:
```typescript
// Property 1: Backtick deletion cleanup
fc.assert(
    fc.property(
        fc.string(), // before
        fc.string(), // after  
        (before, after) => {
            const deleted_char = '`';
            const char_to_right = after[0] ?? '';
            const result = compute_deletion_cleanup(deleted_char, char_to_right);
            
            if (char_to_right === "'") {
                return result === 1;
            } else {
                return result === 0;
            }
        }
    ),
    { numRuns: 100 }
);
```
