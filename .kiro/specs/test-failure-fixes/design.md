# Design Document: Test Failure Fixes

## Overview

This design document describes the fixes needed for 11 failing tests in the Stata LSP. The failures are caused by bugs in the context tracker, parser, analyzer, and symbol provider components. Each fix is targeted and minimal to address the specific test failure without introducing regressions.

## Architecture

The fixes span four components in the LSP pipeline:

```
Source Code → Lexer → Parser → Analyzer → Providers → LSP Response
                        ↓          ↓           ↓
                    Fix #2,5    Fix #3      Fix #4
                        
Context Tracker (parallel) → Fix #1
```

### Component Interactions

1. **Context Tracker** (`src/context-tracker/index.ts`): Validates block structure and emits diagnostics for malformed blocks
2. **Parser** (`src/parser/index.ts`): Builds AST from tokens, handles embedded blocks and commands
3. **Analyzer** (`src/analyzer/index.ts`): Performs semantic analysis, registers macros in symbol tables
4. **Symbol Provider** (`src/providers/symbols.ts`): Provides document symbols for LSP outline

## Components and Interfaces

### Fix 1: Context Tracker Error Code

**Problem**: The `validate_end_delimiters` method emits `INVALID_DELIMITER_POSITION` (4007) for `end python` outside python context, but tests expect `MISMATCHED_END_PYTHON` (4005).

**Root Cause**: The code checks for `end python` and emits `INVALID_DELIMITER_POSITION` with a message about invalid syntax, but the test expects `MISMATCHED_END_PYTHON` which indicates the command is misplaced (not in a python block).

**Error Code Boundaries**:
- `MISMATCHED_END_PYTHON` (4005): Used for `end python` appearing anywhere outside a python block (including Stata context and inside mata blocks)
- `INVALID_DELIMITER_POSITION` (4007): Used for malformed syntax like `end mata` inside mata blocks (where `end` alone is correct)

**Solution**: Change the error code from `INVALID_DELIMITER_POSITION` to `MISMATCHED_END_PYTHON` for `end python` commands regardless of context.

```typescript
// In validate_end_delimiters(), change:
if (my_code_trimmed.toLowerCase() === 'end python') {
    this.diagnostics.push({
        message: 'Invalid syntax: use "end" instead of "end python" to close python blocks',
        // ...
        code: ContextErrorCode.INVALID_DELIMITER_POSITION,  // WRONG
    });
}

// To:
if (my_code_trimmed.toLowerCase() === 'end python') {
    this.diagnostics.push({
        message: '"end python" command outside python block - use "end" to close python blocks',
        // ...
        code: ContextErrorCode.MISMATCHED_END_PYTHON,  // CORRECT
    });
}
```

### Fix 2: Parser Content Extraction

**Problem**: The parser fails to correctly extract content when it contains special characters like `# !`. The test expects 2 content words but receives 1.

**Root Cause**: The content extraction logic may be treating `#` as a comment delimiter or special character, causing content to be truncated.

**Solution**: Review the content extraction in the parser's embedded block handling to ensure special characters are preserved. The fix must be scoped to embedded blocks only:

1. Within `mata`/`python` blocks: Use raw content extraction that preserves all characters
2. Outside embedded blocks: Keep existing comment handling semantics for Stata code

```typescript
// In parser, ensure content extraction doesn't strip special characters
// ONLY within embedded blocks - scope the fix carefully
if (is_embedded_block) {
    // Raw content extraction - preserve all characters including # !
    content = extract_raw_content_between_delimiters();
} else {
    // Normal Stata parsing with comment handling
    content = extract_with_comment_handling();
}
```

### Fix 3: Extended Macro Definition Recognition

**Problem**: The analyzer produces false positive undefined macro warnings for macros defined with extended functions like `: subinstr`.

**Root Cause**: The analyzer's `extract_macro_refs_from_extended_args` method may be incorrectly identifying the macro name as a reference instead of recognizing it as the definition target.

**Counterexample from test**: `["aaa","subinstr","_"]` - macro name "aaa" with function "subinstr" and arg "_" produces an undefined macro warning.

**Solution**: Ensure the analyzer correctly registers macros defined with recognized extended function types. Gate registration on a whitelist of known extended functions to avoid masking real errors:

**Recognized Extended Functions**:
- List operations: `list`
- String functions: `word`, `subinstr`, `length`, `substr`, `upper`, `lower`, `piece`
- Type/format functions: `type`, `format`, `label`, `variable`, `value`, `data`, `display`
- Temp functions: `permname`, `tempvar`, `tempfile`

```typescript
// In analyzer, gate registration on recognized functions
const RECOGNIZED_EXTENDED_FUNCTIONS = new Set([
    'list', 'word', 'subinstr', 'length', 'substr', 'upper', 'lower', 'piece',
    'type', 'format', 'label', 'variable', 'value', 'data', 'display',
    'permname', 'tempvar', 'tempfile'
]);

if (is_extended_macro_definition(node)) {
    const function_name = extract_function_name(node);
    if (RECOGNIZED_EXTENDED_FUNCTIONS.has(function_name)) {
        register_macro(macro_name, symbols);
    } else {
        // Still register but could warn about unrecognized function
        register_macro(macro_name, symbols);
    }
}
```

### Fix 4: Symbol Provider Embedded Block Detection

**Problem**: The symbol provider doesn't include embedded language blocks (mata/python) as structural elements in document symbols.

**Root Cause**: The `get_document_symbols` method may not be iterating over embedded blocks in the AST or may be filtering them out.

**Counterexample from test**: Document with `python\nx = 5\nend python\nmata\nx = 5\nend\n` doesn't produce Module symbols for the blocks.

**Solution**: Add logic to the symbol provider to iterate over embedded blocks in the AST and create Module symbols for each.

```typescript
// In symbol provider, add:
for (const node of ast.nodes) {
    if (node.type === 'embedded_block') {
        const label = node.language === 'mata' ? 'Mata Block' : 'Python Block';
        symbols.push({
            name: label,
            kind: SymbolKind.Module,
            range: node.range,
            selectionRange: node.range,
        });
    }
}
```

### Fix 5: Parser Unab Command AST

**Problem**: The parser produces 2 AST nodes instead of 1 for `unab` commands.

**Root Cause**: The parser may be treating the colon (`:`) in `unab my_vars: var1 var2 var3` as a statement separator or the varlist after the colon as a separate command.

**Solution**: Ensure the parser recognizes `unab` as a single command that includes the colon and varlist as part of its arguments.

```typescript
// In parser, ensure unab command parsing consumes the entire command
// including the colon and varlist
```

## Data Models

No new data models are required. The fixes modify existing behavior without changing interfaces.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: End Python Error Code

*For any* Stata code followed by `end python` (outside a python block), the context tracker should emit a diagnostic with code `MISMATCHED_END_PYTHON` (4005), not `INVALID_DELIMITER_POSITION` (4007).

**Validates: Requirements 1.1, 1.4**

### Property 2: End Python Inside Mata

*For any* mata block containing `end python`, the context tracker should emit a diagnostic with code `MISMATCHED_END_PYTHON` (4005), not `INVALID_DELIMITER_POSITION` (4007).

**Validates: Requirements 1.2, 1.4**

### Property 3: Invalid Delimiter Position Usage

*For any* mata block containing `end mata` (malformed syntax), the context tracker should emit a diagnostic with code `INVALID_DELIMITER_POSITION` (4007).

**Validates: Requirements 1.3**

### Property 4: Embedded Block Content Preservation

*For any* embedded block (mata or python) with content containing non-empty words, the parser should extract all content words correctly, preserving the word count.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 5: Stata Comment Handling Preserved

*For any* Stata code outside embedded blocks containing line comments (`*` or `//`), the parser should correctly handle comments without treating them as content.

**Validates: Requirements 2.5**

### Property 6: Extended Macro Registration

*For any* macro defined using a recognized extended function syntax (`: list`, `: word`, `: subinstr`, `: length`, `: substr`, `: upper`, `: lower`, etc.), the analyzer should register the macro in the symbol table.

**Validates: Requirements 3.1, 3.4**

### Property 7: No False Positive Extended Macro Warnings

*For any* macro defined with extended function syntax and subsequently referenced, the analyzer should not emit an undefined macro warning for that macro.

**Validates: Requirements 3.2, 3.3**

### Property 8: Genuine Undefined Macro Detection Preserved

*For any* macro that is genuinely undefined (never defined anywhere), the analyzer should still emit an undefined macro warning.

**Validates: Requirements 3.6**

### Property 9: Embedded Block Symbols

*For any* document containing embedded language blocks (mata or python), the symbol provider should include a Module symbol for each block with the appropriate label ("Mata Block" or "Python Block").

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 10: Unab Command AST Structure

*For any* `unab` command, the parser should produce exactly one AST node of type `command`.

**Validates: Requirements 5.1, 5.2, 5.3**

## Error Handling

The fixes should not introduce new error conditions. Each fix corrects existing behavior to match expected test outcomes:

1. **Context Tracker**: Error code change only, no new error conditions
2. **Parser**: Content extraction fix, should not introduce parse errors
3. **Analyzer**: Symbol registration fix, should not introduce analysis errors
4. **Symbol Provider**: Symbol generation fix, should not introduce errors

## Testing Strategy

### Unit Tests

The existing failing tests serve as the primary validation:

1. `tests/unit/context-tracker.test.ts` - "should detect end python outside python context"
2. `tests/property/program-block-end-recognition.prop.test.ts` - "should still flag end python outside python context"
3. `tests/property/symbol-completeness.prop.test.ts` - "should include embedded language blocks as structural elements"
4. `tests/property/extended-macro-definition-recognition.prop.test.ts` - 2 failing tests
5. `tests/property/genuine-undefined-macro-detection.prop.test.ts` - 3 failing tests (may be flaky)
6. `tests/property/parser-end-delimiter-handling.prop.test.ts` - "Parser correctly extracts content between start and end delimiters"
7. `tests/integration/list-macro-operations.test.ts` - "should still detect genuine undefined macros"
8. `tests/integration/end-to-end-pipeline.test.ts` - "should correctly parse unab commands into AST"

### Property-Based Tests

The existing property tests will validate the fixes:

- Property tests use fast-check with minimum 100 iterations
- Each property test references its design document property
- Tag format: **Feature: test-failure-fixes, Property {number}: {property_text}**

### Test Execution

Run all tests to verify fixes:
```bash
bun test
```

Run specific failing tests:
```bash
bun test tests/unit/context-tracker.test.ts
bun test tests/property/program-block-end-recognition.prop.test.ts
bun test tests/property/symbol-completeness.prop.test.ts
bun test tests/property/extended-macro-definition-recognition.prop.test.ts
bun test tests/property/parser-end-delimiter-handling.prop.test.ts
bun test tests/integration/end-to-end-pipeline.test.ts
```
