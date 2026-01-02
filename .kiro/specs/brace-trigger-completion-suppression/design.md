# Design Document: Brace Trigger Completion Suppression

## Overview

This design addresses the issue where typing an opening brace `{` in control flow contexts (e.g., `if (fruit) {`) triggers unwanted completion suggestions. The `{` character is registered as a trigger character for global macro braced form completions (`${name}`), but when used outside macro contexts, it should not trigger completions.

The fix involves adding an early check in the completion handler to detect when `{` is the trigger character but the cursor is not in a macro context, and returning an empty completion list in that case.

## Architecture

The change is localized to the completion provider in `src/providers/completion.ts`. No new components are needed.

```
User types `{`
    ↓
LSP triggers completion (trigger_character = '{')
    ↓
Completion handler checks:
    - Is trigger_character `{`?
    - Is cursor in macro context (preceded by `$`)?
    ↓
If NOT in macro context → return empty list
If IN macro context → continue with macro completions
```

## Components and Interfaces

### Modified Component: CompletionProvider.get_completions()

The `get_completions` method will be modified to add an early check for the `{` trigger character.

```typescript
async get_completions(
    document: DocumentState,
    position: Position,
    trigger_character?: string,
    // ... other params
): Promise<CompletionItem[]> {
    // Existing newline check
    if (trigger_character === '\n') {
        return [];
    }

    // NEW: Brace trigger suppression
    // When `{` is the trigger, only provide completions if we're in a macro context
    if (trigger_character === '{') {
        const text_before_cursor = get_text_before_cursor(document, position);
        // Check if the character before `{` is `$` (global macro braced form)
        if (!text_before_cursor.endsWith('$')) {
            return [];
        }
    }

    // ... rest of existing logic
}
```

### Helper Function: get_text_before_cursor()

A simple helper to extract text before the cursor position (may already exist or be inlined).

```typescript
function get_text_before_cursor(document: DocumentState, position: Position): string {
    const lines = document.content.split('\n');
    if (position.line >= lines.length) {
        return '';
    }
    // Note: position.character is AFTER the trigger character was typed
    // So we need to look at character - 1 to see what was before the `{`
    return lines[position.line].substring(0, position.character - 1);
}
```

## Data Models

No new data models are required. The change uses existing types:
- `DocumentState` - existing document state
- `Position` - existing LSP position type
- `CompletionItem[]` - existing completion result type

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Non-Macro Brace Trigger Returns Empty Completions

*For any* document content and cursor position where the trigger character is `{` and the character immediately before the cursor (before the `{`) is NOT `$`, the completion provider SHALL return an empty completion list.

**Validates: Requirements 1.1, 1.4**

### Property 2: Macro Brace Trigger Returns Macro Completions

*For any* document content and cursor position where the trigger character is `{` and the text before the cursor ends with `$` (forming `${`), the completion provider SHALL detect a global macro braced context and return global macro completions.

**Validates: Requirements 1.2, 1.3, 2.1**

### Property 3: Macro Prefix Filtering (Existing Behavior)

*For any* partial macro name typed after `${`, the completion provider SHALL return global macro completions filtered to match the typed prefix.

**Validates: Requirements 2.2**

### Property 4: Inside-Brace Completions (Existing Behavior)

*For any* cursor position inside a global macro braced form `${...}` (between the opening `{` and closing `}`), the completion provider SHALL provide macro completions.

**Validates: Requirements 2.3**

## Error Handling

- If `document.content` is empty or malformed, the helper function returns an empty string, which correctly results in no `$` being found, thus returning empty completions for `{` trigger.
- If `position` is out of bounds, the helper function returns an empty string, with the same safe behavior.

## Testing Strategy

### Unit Tests

1. Test that `{` trigger after `if (fruit) ` returns empty completions
2. Test that `{` trigger after `$` returns macro completions
3. Test that `{` trigger after `foreach x in ` returns empty completions
4. Test that `{` trigger at start of line returns empty completions

### Property-Based Tests

Property tests will use fast-check to generate:
- Random Stata code snippets that don't end with `$`
- Random Stata code snippets that end with `$`
- Verify the completion behavior matches the properties above

Each property test should run at minimum 100 iterations.

**Tag format:** Feature: brace-trigger-completion-suppression, Property N: [property text]
