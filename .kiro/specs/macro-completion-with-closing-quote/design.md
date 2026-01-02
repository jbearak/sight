# Design Document: Macro Completion with Closing Quote

## Overview

This design specifies how the Stata LSP completion provider detects macro contexts and provides completions for both local macros (`` `name' ``) and global macros (`$name` or `${name}`). The key challenge is producing correct completions when the cursor is anywhere within a macro name (not just at the end) and when closing delimiters may already be present (e.g., from snippet insertion), while avoiding destructive edits to surrounding text.

## Architecture

The macro completion system consists of four main components:

1. **Context Detection** - Determines if the cursor is in a macro context (local or global)
2. **Replacement Range Computation** - Determines exactly which characters will be replaced
3. **Prefix Derivation** - Uses the replacement range text to filter completions
4. **Completion Generation** - Produces completion items using range-based edits and optional suffix insertion

```
┌────────────────────────────────────────────────────────────────────┐
│                    Completion Request                               │
│  (document, position, trigger_character)                            │
└────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                    Context Detection                                │
│  detect_macro_context(document, position, trigger_character)        │
│    → MacroContext | null                                            │
└────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│              Replacement Range Computation                          │
│  compute_replacement_range(document, position, context)             │
│    → Range                                                         │
└────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                    Prefix Derivation                                │
│  prefix = document.getText(replacement_range)                       │
└────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                    Completion Generation                            │
│  get_macro_completions(context, prefix, replacement_range, symbols) │
│    → CompletionItem[]                                               │
└────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Shared Definitions

Macro identifier characters are limited to ASCII letters, digits, and underscore.

```typescript
const MACRO_IDENTIFIER_CHAR_REGEX = /[A-Za-z0-9_]/;

type MacroScope = 'local' | 'global';

type MacroContext =
    | { type: 'macro'; scope: 'local' }
    | { type: 'macro'; scope: 'global' };
```

### Context Detection

Context detection uses the document and cursor position (not just the prefix string), because correctness depends on whether the cursor is strictly inside the delimiters.

```typescript
function detect_macro_context(
    document: DocumentState,
    position: Position,
    trigger_character: string | null
): MacroContext | null;
```

#### Local Macro Context Detection

A local macro context is detected when the cursor is strictly between the opening backtick `` ` `` and the closing apostrophe `'` (if present). The provider must not return local macro context when the cursor is after the closing apostrophe.

Trigger behavior:
- When the backtick trigger character is typed outside comments, return local macro completions.
- In string literals, also return local macro completions immediately after typing `` ` ``.

#### Global Macro Context Detection

A global macro context is detected when the cursor is:
- in unbraced form: after `$` and within the macro name
- in braced form: after `${` and before the closing `}` (if present)

The provider must not return global macro context when the cursor is after the closing `}` (e.g., `${name}|`).

This rule is based only on cursor position relative to the `}`, not on who typed the `}`:
- If the cursor is to the left of the `}` (even if the `}` was inserted by a snippet), completions are required.
- If the cursor is to the right of the `}`, completions are not required.

Examples:
- `${|}` → global macro context (completions shown)
- `${na|}` → global macro context (completions shown)
- `${na|me}` → global macro context (completions shown)
- `${name}|` → NOT global macro context (no completions)

Trigger behavior:
- When `$` is typed, return global macro completions.
- When completion is invoked immediately after `${` (empty braced form), return global macro completions.

### Replacement Range Computation

Replacement ranges are computed to ensure completion is safe and non-destructive. In particular, non-identifier characters (e.g., whitespace) terminate the macro name and must not be replaced.

```typescript
function compute_replacement_range(
    document: DocumentState,
    position: Position,
    context: MacroContext
): Range;
```

Rules:
- For both local and global macros, compute the maximal contiguous span of `Macro_Identifier_Char` surrounding the cursor, bounded by non-identifier characters.
- For braced global macros, the replacement range must be restricted to the `{ ... }` contents.
- For unbraced globals, any non-identifier character after `$` terminates the macro name. Example: `$apple.sauce` means `$apple` is a macro reference and `.sauce` is plain text and must not be replaced.
- For local macros and braced globals, a non-identifier character before the closing delimiter is invalid macro syntax. Example: `` `apple.sauce' `` and `${apple.sauce}` are syntax errors that SHOULD be reported by diagnostics. Completion still must not replace text after the first non-identifier character.

The computed range is referred to as `Replacement_Range` in the requirements.

### Prefix Derivation

Prefix derivation is purely:
- `Prefix = document.getText(Replacement_Range)`

This ensures prefix filtering always matches what will actually be replaced.

### Completion Generation

Completions must replace exactly `Replacement_Range` using a range-based edit, and may append a closing delimiter only when it is not already present immediately after the insertion.

```typescript
interface CompletionItem {
    label: string;
    kind: CompletionItemKind;
    detail: string;
    textEdit: { range: Range; newText: string };
    // ... other fields
}
```

Kind-specific completion lists:
- In local `Macro_Context`, return local macros only.
- In global `Macro_Context`, return global macros only.

Suffix behavior:
- Local: if there is no apostrophe immediately after the insertion point within the local reference, append `'`.
- Global unbraced: do not append any suffix.
- Global braced: if there is no `}` immediately after the insertion point within the braced reference, append `}`.

## Data Models

### Completion Context Type

The macro completion logic produces a `{ type: 'macro', scope: ... }` context which can be integrated into a broader provider-level `CompletionContext` if needed.

```typescript
type CompletionContext =
    | { type: 'command' }
    | { type: 'option'; command: string }
    | { type: 'macro'; scope: 'local' | 'global' }
    | { type: 'variable' }
    | { type: 'program' }
    | { type: 'fallback' };
```

### Symbol Table (existing)

```typescript
interface SymbolTable {
    localMacros: Map<string, MacroInfo>;
    globalMacros: Map<string, MacroInfo>;
    // ... other fields
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties bridge human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Local Macro Context Detection Boundary

*For any* document containing a local macro reference `` `name' ``, when the cursor position is strictly between the backtick and the closing apostrophe, the context detector SHALL return a local macro context. When the cursor is after the closing apostrophe, the context detector SHALL NOT return a local macro context.

**Validates: Requirements 1.1, 1.3**

### Property 2: Global Macro Context Detection Boundary

*For any* document containing a global macro reference (`$name` or `${name}`):
- If the cursor is inside the braced reference (after `${` and before the closing `}`), the context detector SHALL return a global macro context (regardless of whether the `}` was typed by the user or inserted by a snippet).
- If the cursor is after the closing `}` of a braced reference, the context detector SHALL NOT return a global macro context.

**Validates: Requirements 2.1, 2.2, 2.4**

### Property 3: Replacement Range Stops at Non-Identifier Characters

*For any* macro context (local or global), the replacement range SHALL include only contiguous macro identifier characters (`[A-Za-z0-9_]`) and SHALL NOT include any non-identifier characters (e.g., whitespace or `.`). Therefore, selecting a completion SHALL NOT delete text after the first non-identifier character within the reference.

**Validates: Requirements 4.1, 4.3, 5.1, 5.4**

### Property 4: Unbraced Global Terminates at First Non-Identifier

*For any* text containing an unbraced global macro reference followed by a non-identifier character, such as `$apple.sauce`, the macro name SHALL be `apple` and the suffix `.sauce` SHALL be outside the macro name and SHALL NOT be replaced by a completion.

**Validates: Requirements 5.4**

### Property 5: Prefix Derivation Matches Replacement Range

*For any* macro context, the derived prefix SHALL equal the exact text inside the computed replacement range.

**Validates: Requirements 4.2, 5.3**

### Property 6: Prefix Filtering

*For any* non-empty prefix and set of available macros of the relevant kind, the returned completions SHALL contain exactly those macros whose names start with the prefix (case-insensitive comparison).

**Validates: Requirements 6.1**

### Property 7: Kind-Specific Completion Lists

*For any* local macro context, the completion provider SHALL return only local macros. *For any* global macro context, the completion provider SHALL return only global macros.

**Validates: Requirements 6.2**

### Property 8: Local Macro Suffix Handling

*For any* local macro completion, the inserted text SHALL include a closing apostrophe if and only if there is no apostrophe immediately following the replacement range in the document.

**Validates: Requirements 7.2, 7.3**

### Property 9: Global Macro Brace Suffix Handling

*For any* global macro completion in braced form (`${}`), the inserted text SHALL include a closing brace if and only if there is no closing brace immediately following the replacement range in the document.

**Validates: Requirements 7.6, 7.7**

### Property 10: Comment Context Exclusion

*For any* cursor position inside a comment (line comment `//` or `*`, or block comment `/* */`), the completion provider SHALL NOT return macro completions regardless of macro-like patterns in the comment text.

**Validates: Requirements 3.1, 3.2**

### Property 11: Trigger Character Behavior

*For any* backtick trigger character typed outside comments, the completion provider SHALL return local macro completions. *For any* dollar sign trigger character typed, the completion provider SHALL return global macro completions.

**Validates: Requirements 1.7, 2.5**

## Error Handling

1. **Malformed macro references**: If a local or braced global macro reference contains invalid characters (e.g., `` `foo bar' `` or `${apple.sauce}`), treat the first invalid character as ending the macro name and do not replace text after it. Diagnostics SHOULD report an error covering the full macro reference span with a message like "invalid character in macro name".

2. **Nested macros**: If nested macro-like delimiters occur, context detection should prefer the nearest valid context that contains the cursor.

3. **Empty documents**: Return empty completion list if document has no content.

4. **Missing symbols**: Return empty completion list if the symbol table has no macros of the requested type.

## Testing Strategy

### Unit Tests

- Test context detection boundaries for local and global macros
- Test replacement range computation (especially whitespace termination)
- Test kind-specific completion lists (locals-only vs globals-only)
- Test suffix insertion with/without existing closing delimiters
- Test comment suppression

### Property-Based Tests

Using fast-check library with minimum 100 iterations per property:

1. **Context detection property**: Generate random text with macro references and cursor positions, verify context detection boundaries
2. **Replacement range property**: Generate random macro references with injected non-identifier chars, verify replacement never crosses the first non-identifier
3. **Filtering property**: Generate random prefixes and macro lists, verify filtering correctness
4. **Suffix handling property**: Generate completion scenarios with/without closing delimiters, verify correct suffix insertion

### Edge Cases

- Empty macro reference: `` `' ``
- Single character prefix: `` `a' ``
- Cursor at various positions within macro name (including mid-identifier)
- Macro references inside strings
- Macro references in embedded language blocks
- Macro references in comments (ensure suppression)
