# Design Document: Fix Property-Based Test Failures

## Overview

This design addresses two failing property-based tests by improving error handling in syntax command parsing and macro detection. The fixes involve:

1. **Syntax Option Parsing**: Preserve all options even when names are identical, with correct required/optional flags
2. **Macro Detection**: Gracefully handle incomplete macro syntax and continue processing subsequent definitions
3. **Test Coverage**: Add unit tests for edge cases to prevent regressions

## Architecture

The fixes span three components in the LSP pipeline:

```
Source Code → Lexer → Parser → Analyzer → Providers → LSP Response
                ↑        ↑         ↑
              Fix 2    Fix 1      Fix 2
```

### Component 1: Parser (Syntax Command Handling)

**Current Behavior**: Option deduplication removes duplicate option names, collapsing them into one entry.

**Desired Behavior**: Preserve all options with their respective required/optional flags, emit diagnostic for duplicates.

**Changes**:
- Modify syntax command option parsing to not deduplicate by name
- Ensure `isRequired` flag is correctly set from `*optname` syntax
- Add diagnostic emission for duplicate option names
- Maintain option order as they appear in syntax declaration

**Key Functions**:
- `parse_syntax_command()` - Main syntax command parser
- `parse_option_spec()` - Individual option parsing
- `build_option_signature()` - Signature construction

### Component 2: Lexer (Macro Tokenization)

**Current Behavior**: Incomplete macro syntax like `'${` without closing `}` breaks tokenization and prevents subsequent macros from being recognized.

**Desired Behavior**: Emit diagnostic for incomplete syntax, continue tokenizing, maintain correct positions.

**Changes**:
- Improve macro tokenization to handle unclosed `${...}` expressions
- Add recovery logic to continue after malformed macros
- Maintain accurate line and character positions
- Emit diagnostics for incomplete macro syntax

**Key Functions**:
- `tokenize_macro_reference()` - Macro tokenization
- `handle_incomplete_macro()` - Error recovery
- `update_position()` - Position tracking

### Component 3: Analyzer (Symbol Table Building)

**Current Behavior**: Incomplete macro syntax prevents subsequent macro definitions from being registered.

**Desired Behavior**: Register all macro definitions even when preceded by incomplete syntax.

**Changes**:
- Ensure macro definitions are captured before incomplete syntax is encountered
- Add recovery logic for malformed macro expressions
- Verify symbol table registration for all macros

**Key Functions**:
- `register_macro_definition()` - Macro registration
- `analyze_macro_expression()` - Macro analysis
- `recover_from_error()` - Error recovery

## Data Models

### OptionSpec (Enhanced)

```typescript
interface OptionSpec {
  name: string;              // Option name (e.g., "myopt")
  isRequired: boolean;       // true if prefixed with *
  isOptional: boolean;       // true if wrapped in []
  argumentType?: string;     // Type if specified (e.g., "real")
  defaultValue?: string;     // Default value if specified
  minAbbreviation: string;   // Minimum unambiguous abbreviation
  range: Range;              // Source range
  // NEW: Track if this is a duplicate
  isDuplicate?: boolean;
  duplicateOf?: string;      // Reference to original if duplicate
}
```

### MacroToken (Enhanced)

```typescript
interface MacroToken {
  type: 'macro_reference' | 'macro_definition';
  name: string;
  scope: 'local' | 'global';
  isComplete: boolean;       // NEW: false if incomplete syntax
  range: Range;
  // NEW: Error information if incomplete
  error?: {
    message: string;
    recoveryPoint: Position;
  };
}
```

## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Option Preservation
**For any** syntax command with multiple options (including duplicates), all options should be preserved in the parsed signature with their respective required/optional flags.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Duplicate Option Diagnostics
**For any** syntax command with duplicate option names, the parser should emit a diagnostic warning while still preserving all options.

**Validates: Requirements 1.4**

### Property 3: Edge Case Option Names
**For any** valid option name (including edge cases like `O_`), the parser should correctly parse and preserve it.

**Validates: Requirements 1.5**

### Property 4: Incomplete Macro Recovery
**For any** document with incomplete macro syntax followed by valid macro definitions, the analyzer should register all macros in the symbol table.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 5: Macro Symbol Completeness
**For any** document with macro definitions, all macros should appear in document symbols regardless of preceding syntax errors.

**Validates: Requirements 2.4**

### Property 6: Position Accuracy After Recovery
**For any** incomplete macro syntax, the lexer should maintain correct line and character positions for subsequent tokens.

**Validates: Requirements 2.5**

## Error Handling

### Syntax Command Parsing Errors

1. **Duplicate Option Names**
   - Severity: Warning
   - Message: "Duplicate option name '{name}' in syntax command"
   - Action: Continue parsing, preserve both options

2. **Invalid Option Syntax**
   - Severity: Error
   - Message: "Invalid option syntax: {syntax}"
   - Action: Skip option, continue parsing

### Macro Detection Errors

1. **Incomplete Macro Expression**
   - Severity: Warning
   - Message: "Incomplete macro expression: expected '}' or closing quote"
   - Action: Continue tokenizing from recovery point

2. **Malformed Macro Definition**
   - Severity: Warning
   - Message: "Malformed macro definition: {definition}"
   - Action: Attempt to register macro, continue analysis

## Testing Strategy

### Unit Tests

**File**: `tests/unit/syntax-option-parsing.test.ts`
- Test duplicate option names with different required flags
- Test option parsing with edge case names
- Test `isRequired` flag correctness
- Test diagnostic emission for duplicates

**File**: `tests/unit/macro-detection-edge-cases.test.ts`
- Test incomplete macro syntax: `'${` without closing `}`
- Test macro definitions after incomplete syntax
- Test recovery from malformed macro expressions
- Test symbol table registration after errors

### Property-Based Tests

**File**: `tests/property/syntax-command-parsing.prop.test.ts`
- Property 17: Completion Differentiation and Filtering (fix)
- Verify all options are preserved with correct flags

**File**: `tests/property/symbol-completeness.prop.test.ts`
- Property 25: Macros Included (fix)
- Verify all macros appear in symbols despite syntax errors

### Regression Tests

- All 533 existing tests must continue to pass
- No performance regression in parsing or analysis

## Implementation Notes

1. **Option Deduplication**: The current implementation likely has a Map or Set that deduplicates by option name. This needs to be changed to preserve all options.

2. **Macro Recovery**: The lexer needs to identify a recovery point (next valid token) when incomplete macro syntax is encountered.

3. **Position Tracking**: After recovery, ensure line and character positions are correctly updated for subsequent tokens.

4. **Diagnostic Emission**: Use existing diagnostic infrastructure to emit warnings/errors at appropriate severity levels.

5. **Symbol Table**: Ensure macro registration happens before incomplete syntax is encountered, or add recovery logic to register macros after error recovery.
