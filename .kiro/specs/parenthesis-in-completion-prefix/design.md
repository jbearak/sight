# Design Document: Parenthesis in Completion Prefix Fix

## Overview

This design addresses three related bugs in the LSP completion system:

1. **Completion display bug**: Variable, scalar, and matrix completions don't have explicit `textEdit` and `filterText` properties, causing VS Code to incorrectly include surrounding punctuation in the completion display and filtering.

2. **Variable name validation bug**: The analyzer doesn't validate that variable names match the identifier pattern before adding them to the symbol table.

3. **Context detection bug**: The completion provider suggests dataset variables in `if {}` block conditions when it should only suggest them in command contexts.

## Architecture

The fix involves changes to two main components:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Completion Provider                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  get_variable_completions()                              │    │
│  │  - Add textEdit with word prefix range                   │    │
│  │  - Add filterText with symbol name only                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  detect_completion_context()                             │    │
│  │  - Detect block condition context (if/while)             │    │
│  │  - Return 'expression' context instead of 'variable'     │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Analyzer                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  extract_gen_variable() / extract_egen_variable()        │    │
│  │  extract_input_variables()                               │    │
│  │  - Validate variable name matches identifier pattern     │    │
│  │  - Skip variables with parentheses or invalid chars      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Completion Provider Changes

#### 1.1 Word Prefix Range Computation

Add a helper function to compute the word prefix range at a given position:

```typescript
/**
 * Compute the word prefix range at a given position.
 * The range starts at the beginning of the current word (alphanumeric + underscore)
 * and ends at the cursor position.
 * 
 * @param document - The document state
 * @param position - The cursor position
 * @returns Range from word start to cursor position
 */
function compute_word_prefix_range(document: DocumentState, position: Position): Range {
    const content = document.content;
    const the_lines = content.split('\n');
    
    if (position.line >= the_lines.length) {
        return Range.create(position, position);
    }
    
    const current_line = the_lines[position.line];
    const text_before_cursor = current_line.substring(0, position.character);
    
    // Find the start of the current word (alphanumeric + underscore)
    let word_start = text_before_cursor.length;
    while (word_start > 0) {
        const char = text_before_cursor[word_start - 1];
        if (!/[a-zA-Z0-9_]/.test(char)) {
            break;
        }
        word_start--;
    }
    
    return Range.create(
        Position.create(position.line, word_start),
        position
    );
}
```

#### 1.2 Variable Completion Enhancement

Modify `get_variable_completions()` to include `textEdit` and `filterText`:

```typescript
private get_variable_completions(
    document: DocumentState,
    position: Position,
    symbols: SymbolTable,
    resolved_scope?: ResolvedScope,
    forward_scope?: ForwardResolvedScope
): CompletionItem[] {
    const the_completions: CompletionItem[] = [];
    
    // Compute the word prefix range once for all completions
    const replacement_range = compute_word_prefix_range(document, position);

    // Variables
    for (const [name, variable] of symbols.variables) {
        // ... existing ranking logic ...

        the_completions.push({
            label: name,
            kind: CompletionItemKind.Field,
            detail,
            documentation: variable.label || `Created via ${variable.source}`,
            sortText: compute_ranking_key(ranking_factors),
            filterText: name,  // Filter by name only, not surrounding punctuation
            textEdit: {
                range: replacement_range,
                newText: name,
            },
        });
    }

    // Similar changes for scalars and matrices...
}
```

#### 1.3 Block Condition Context Detection

Add detection for block condition context in `detect_completion_context()`:

```typescript
/**
 * Detect if we're inside a control flow block condition.
 * Returns true for contexts like: if (|), while (|), else if (|)
 */
function is_block_condition_context(text_before_cursor: string): boolean {
    // Check for "if (" or "while (" or "else if (" patterns
    // where we're inside the parentheses
    const block_pattern = /\b(if|while|else\s+if)\s*\(\s*[^)]*$/i;
    return block_pattern.test(text_before_cursor);
}
```

Modify `detect_completion_context()` to check for block condition context before variable context:

```typescript
export function detect_completion_context(
    document: DocumentState,
    position: Position,
    tokens?: Token[]
): CompletionContext {
    // ... existing code ...

    // Check for block condition context (before variable context)
    if (is_block_condition_context(text_before_cursor)) {
        return { type: 'expression' };  // New context type for expressions
    }

    // Check for variable context (after command name)
    if (is_variable_context(text_before_cursor)) {
        return { type: 'variable' };
    }

    // ... rest of existing code ...
}
```

### 2. Analyzer Changes

#### 2.1 Variable Name Validation

Add a helper function to validate variable names:

```typescript
/**
 * Check if a name is a valid Stata identifier.
 * Valid identifiers match: [a-zA-Z_][a-zA-Z0-9_]*
 */
function is_valid_identifier(name: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}
```

Modify variable extraction functions to validate names:

```typescript
private extract_gen_variable(node: CommandNode, symbols: SymbolTable): void {
    if (!node.varlist || node.varlist.length === 0) {
        return;
    }

    const first_var = node.varlist[0];
    
    // Validate that the variable name is a valid identifier
    if (!is_valid_identifier(first_var.name)) {
        return;  // Skip invalid variable names (e.g., parenthesized groups)
    }

    const var_symbol: VariableSymbol = {
        name: first_var.name,
        location: { uri: this.uri, range: first_var.range },
        sourceUri: this.uri,
        source: 'gen',
    };

    symbols.variables.set(first_var.name, var_symbol);
}
```

## Data Models

### New Completion Context Type

Add a new context type for expression contexts:

```typescript
export type CompletionContext =
    | { type: 'command' }
    | { type: 'option'; command: string }
    | MacroCompletionContext
    | { type: 'variable' }
    | { type: 'expression' }  // New: for block conditions
    | { type: 'program' }
    | { type: 'directive_path'; directive: string; partial_path?: string }
    | { type: 'command_path'; command: string; partial_path?: string }
    | { type: 'fallback' };
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Variable Completion Text Edit Range

*For any* document with defined variables and *for any* cursor position in a variable context, all variable completion items SHALL have a textEdit property with a range that:
- Starts at the beginning of the word prefix (first non-identifier character before cursor)
- Ends at the cursor position

**Validates: Requirements 1.1, 1.2, 2.1, 2.2**

### Property 2: Completion Filter Text Equals Label

*For any* variable, scalar, or matrix completion item, the filterText property SHALL equal the label (symbol name without surrounding punctuation).

**Validates: Requirements 3.1, 3.2**

### Property 3: Variable Name Identifier Validation

*For any* variable extracted from a generate, egen, or input command, the variable name SHALL match the pattern `[a-zA-Z_][a-zA-Z0-9_]*`. Variables with parentheses or other non-identifier characters SHALL NOT be added to the symbol table.

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 4: Block Condition Context Detection

*For any* cursor position inside a control flow block condition (e.g., `if (|)`, `while (|)`), the completion context SHALL be detected as 'expression', NOT 'variable'.

**Validates: Requirements 5.1, 5.3**

### Property 5: Command If Qualifier Context Detection

*For any* cursor position after a command's `if` qualifier (e.g., `summarize x if |`), the completion context SHALL be detected as 'variable', and dataset variables SHALL be suggested.

**Validates: Requirements 5.2**

### Property 6: Expression Context Completions

*For any* cursor position in an expression context (block condition), the completion provider SHALL suggest macros and scalars, but SHALL NOT suggest dataset variables.

**Validates: Requirements 5.4**

## Error Handling

### Invalid Variable Names

When the analyzer encounters a varlist item with an invalid name (e.g., parenthesized group), it should:
1. Skip adding the item to the symbol table
2. Not emit any diagnostic (this is expected behavior for commands like `recode`)
3. Continue processing other varlist items

### Empty Word Prefix

When the cursor is immediately after a non-word character with no partial word typed:
1. The word prefix range should be empty (start == end == cursor position)
2. All completions should still be shown (no filtering by prefix)
3. The textEdit should insert at the cursor position without replacing anything

## Testing Strategy

### Unit Tests

1. **Word prefix range computation**:
   - Test with cursor after `if (` → range should be empty
   - Test with cursor after `if (var` → range should cover `var`
   - Test with cursor after `summarize ` → range should be empty

2. **Block condition detection**:
   - Test `if (` → should detect block condition
   - Test `while (` → should detect block condition
   - Test `summarize x if ` → should NOT detect block condition

3. **Variable name validation**:
   - Test `myvar` → valid
   - Test `(myvar)` → invalid
   - Test `_myvar` → valid
   - Test `123var` → invalid

### Property-Based Tests

Property-based tests should use fast-check to generate random inputs and verify the properties hold:

1. **Property 1**: Generate random documents with variables and cursor positions, verify textEdit ranges
2. **Property 2**: Generate random completions, verify filterText equals label
3. **Property 3**: Generate random varlist items, verify only valid identifiers are added
4. **Property 4**: Generate random block condition contexts, verify 'expression' context detected
5. **Property 5**: Generate random command if qualifier contexts, verify 'variable' context detected
6. **Property 6**: Generate random expression contexts, verify no variables suggested

Each property test should run at least 100 iterations to ensure comprehensive coverage.
