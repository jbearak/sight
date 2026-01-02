# Design Document: Comprehensive Property-Based Tests

## Overview

This document describes the design for adding comprehensive property-based tests to the Stata LSP implementation. These tests will validate critical correctness properties identified during the spec review, ensuring the LSP behaves correctly across a wide range of inputs.

The implementation uses fast-check for property-based testing, following the patterns established in the existing `embedded-language-detection.prop.test.ts`.

## Architecture

Property-based tests sit alongside existing unit and integration tests, providing a complementary verification approach:

```
tests/
├── unit/           # Component-level tests with specific inputs
├── integration/    # Cross-component tests with realistic scenarios
└── property/       # Property-based tests with generated inputs
    ├── embedded-language-detection.prop.test.ts  # Existing
    ├── parser-roundtrip.prop.test.ts             # New
    ├── lexer-tokenization.prop.test.ts           # New
    ├── completion-relevance.prop.test.ts         # New
    ├── diagnostic-accuracy.prop.test.ts          # New
    ├── formatting-preservation.prop.test.ts      # New
    ├── goto-definition.prop.test.ts              # New
    ├── hover-completeness.prop.test.ts           # New
    └── symbol-completeness.prop.test.ts          # New
```

### Generator Strategy

Each property test requires custom generators that produce valid Stata constructs. We'll build a hierarchy of generators:

```typescript
// Base generators (primitives)
arbitrary_identifier()      // Valid Stata identifiers
arbitrary_macro_name()      // Valid macro names
arbitrary_variable_name()   // Valid variable names
arbitrary_string_literal()  // Simple and compound quotes

// Composite generators (AST nodes)
arbitrary_command_node()    // Commands with options
arbitrary_macro_def_node()  // Local/global macro definitions
arbitrary_program_node()    // Program definitions
arbitrary_control_flow()    // if/else/foreach/forvalues/while

// Document generators
arbitrary_stata_document()  // Complete valid documents
arbitrary_malformed_document() // Documents with specific errors
```

## Components and Interfaces

### 1. Test Generators (`tests/property/generators/`)

```typescript
// generators/primitives.ts
interface PrimitiveGenerators {
  // Identifiers: letters, digits, underscores; must start with letter/underscore
  arbitrary_identifier(): fc.Arbitrary<string>;
  
  // Macro names: same rules as identifiers
  arbitrary_macro_name(): fc.Arbitrary<string>;
  
  // Variable names: case-sensitive identifiers
  arbitrary_variable_name(): fc.Arbitrary<string>;
  
  // String literals with proper quoting
  arbitrary_simple_string(): fc.Arbitrary<string>;
  arbitrary_compound_string(): fc.Arbitrary<string>;
  
  // Numbers: integers and decimals
  arbitrary_number(): fc.Arbitrary<string>;
}

// generators/ast-nodes.ts
interface ASTNodeGenerators {
  // Command with optional prefix, varlist, options
  arbitrary_command_node(): fc.Arbitrary<CommandNode>;
  
  // Macro definition (local or global)
  arbitrary_macro_def_node(): fc.Arbitrary<MacroDefNode>;
  
  // Program definition with body
  arbitrary_program_node(): fc.Arbitrary<ProgramNode>;
  
  // Control flow structures
  arbitrary_if_node(): fc.Arbitrary<ControlFlowNode>;
  arbitrary_foreach_node(): fc.Arbitrary<ControlFlowNode>;
  arbitrary_forvalues_node(): fc.Arbitrary<ControlFlowNode>;
  arbitrary_while_node(): fc.Arbitrary<ControlFlowNode>;
}

// generators/documents.ts
interface DocumentGenerators {
  // Valid Stata document with mixed constructs
  arbitrary_stata_document(): fc.Arbitrary<string>;
  
  // Document with specific macro definitions
  arbitrary_document_with_macros(
    num_locals: number,
    num_globals: number
  ): fc.Arbitrary<{ document: string; macros: MacroInfo[] }>;
  
  // Document with specific programs
  arbitrary_document_with_programs(
    num_programs: number
  ): fc.Arbitrary<{ document: string; programs: ProgramInfo[] }>;
  
  // Malformed documents for error detection tests
  arbitrary_malformed_document(
    error_type: MalformedType
  ): fc.Arbitrary<{ document: string; expected_error: DiagnosticCode }>;
}

type MalformedType =
  | 'unbalanced_quotes'
  | 'unclosed_block'
  | 'missing_program_end'
  | 'brace_else_same_line'
  | 'brace_not_alone';
```

### 2. Property Test Structure

Each property test file follows this structure:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import * as fc from 'fast-check';

describe('Feature Property Tests', () => {
  /**
   * Property N: Property Name
   * Description of what the property verifies.
   * Feature: comprehensive-property-tests, Property N: Property Name
   * Validates: Requirement X.Y
   */
  it('should [property description]', () => {
    fc.assert(
      fc.property(
        arbitrary_generator(),
        (input) => {
          // Property verification logic
          // Returns boolean or throws on failure
        }
      ),
      { numRuns: 100 }  // Minimum 100 iterations per requirement
    );
  });
});
```

## Correctness Properties

### Property 1: Parser Round-Trip Consistency

*For any* valid Stata AST, printing the AST to source code and then parsing it back should produce an equivalent AST.

```typescript
// Equivalence definition: same node structure, token content, trivia content
// Ignores: source ranges (positions may shift after formatting)
function ast_equivalent(ast_a: StataAST, ast_b: StataAST): boolean {
  return deep_equal_ignoring_ranges(ast_a, ast_b);
}

// Property test
fc.property(
  arbitrary_stata_ast(),
  (ast) => {
    const my_printed = pretty_printer.print(ast);
    const my_reparsed = parser.parse(lexer.tokenize(my_printed).tokens);
    return ast_equivalent(ast, my_reparsed.ast);
  }
);
```

**Validates: Requirement 1**

### Property 2: Lexer Token Concatenation

*For any* valid Stata source code, concatenating all token values should reconstruct the original source (modulo whitespace normalization).

```typescript
fc.property(
  arbitrary_stata_document(),
  (source) => {
    const my_result = lexer.tokenize(source);
    const my_reconstructed = my_result.tokens
      .map(t => t.value)
      .join('');
    return normalize_whitespace(source) === normalize_whitespace(my_reconstructed);
  }
);
```

**Validates: Requirement 2.1**

### Property 3: Lexer Delimiter Mode Handling

*For any* document with `#delimit` directives, the lexer should correctly switch between CR and semicolon modes.

```typescript
fc.property(
  arbitrary_document_with_delimit_switches(),
  ({ document, expected_modes }) => {
    const my_result = lexer.tokenize(document);
    // Verify STATEMENT_TERMINATOR tokens match expected delimiter mode
    return verify_delimiter_modes(my_result.tokens, expected_modes);
  }
);
```

**Validates: Requirement 2.2**

### Property 4: Lexer Continuation Handling

*For any* document with `///` continuations, the lexer should join lines correctly.

```typescript
fc.property(
  arbitrary_document_with_continuations(),
  (document) => {
    const my_result = lexer.tokenize(document);
    // Verify no STATEMENT_TERMINATOR after CONTINUATION token
    return verify_continuation_handling(my_result.tokens);
  }
);
```

**Validates: Requirement 2.3**

### Property 5: Lexer String Boundary Detection

*For any* string literal (simple or compound), the lexer should produce a single STRING token.

```typescript
fc.property(
  fc.oneof(arbitrary_simple_string(), arbitrary_compound_string()),
  (string_literal) => {
    const my_document = `display ${string_literal}`;
    const my_result = lexer.tokenize(my_document);
    const my_string_tokens = my_result.tokens.filter(t => t.type === 'STRING');
    return my_string_tokens.length === 1 && 
           my_string_tokens[0].value === string_literal;
  }
);
```

**Validates: Requirement 2.4**

### Property 6: Lexer Global Macro Tokenization

*For any* global macro reference `${name}`, the lexer should produce a single MACRO_REF_GLOBAL token.

```typescript
fc.property(
  arbitrary_macro_name(),
  (name) => {
    const my_document = `display \${${name}}`;
    const my_result = lexer.tokenize(my_document);
    const my_macro_tokens = my_result.tokens.filter(
      t => t.type === 'MACRO_REF_GLOBAL'
    );
    return my_macro_tokens.length === 1 && 
           my_macro_tokens[0].value === `\${${name}}`;
  }
);
```

**Validates: Requirement 2.5**

### Property 7: Lexer Source Span Accuracy

*For any* token, its source span should correctly identify its position in the source.

```typescript
fc.property(
  arbitrary_stata_document(),
  (source) => {
    const my_result = lexer.tokenize(source);
    for (const my_token of my_result.tokens) {
      const my_extracted = extract_text_at_range(source, my_token.range);
      if (my_extracted !== my_token.value) {
        return false;
      }
    }
    return true;
  }
);
```

**Validates: Requirement 2.6**

### Property 8: Completion Prefix Matching

*For any* command completion context with a prefix, all returned items should match the prefix.

```typescript
fc.property(
  arbitrary_command_prefix(),
  (prefix) => {
    const my_document = prefix;
    const my_position = { line: 0, character: prefix.length };
    const my_completions = completion_provider.get_completions(
      create_document_state(my_document),
      my_position,
      { type: 'command' }
    );
    return my_completions.every(
      item => item.label.toLowerCase().startsWith(prefix.toLowerCase())
    );
  }
);
```

**Validates: Requirement 3.1**

### Property 9: Completion Macro Inclusion

*For any* document with defined macros, macro completions should include those macros.

```typescript
fc.property(
  arbitrary_document_with_macros(3, 2),
  ({ document, macros }) => {
    const my_doc_state = parse_and_analyze(document);
    const my_position = find_macro_completion_position(document);
    const my_completions = completion_provider.get_completions(
      my_doc_state,
      my_position,
      { type: 'macro', scope: 'local' }
    );
    const my_local_macros = macros.filter(m => m.scope === 'local');
    return my_local_macros.every(
      m => my_completions.some(c => c.label === m.name)
    );
  }
);
```

**Validates: Requirement 3.2**

### Property 10: Completion Option Validity

*For any* option completion context, returned options should be valid for the current command.

```typescript
fc.property(
  arbitrary_command_with_options(),
  ({ command, valid_options }) => {
    const my_document = `${command}, `;
    const my_position = { line: 0, character: my_document.length };
    const my_completions = completion_provider.get_completions(
      create_document_state(my_document),
      my_position,
      { type: 'option', command }
    );
    return my_completions.every(
      item => valid_options.includes(item.label)
    );
  }
);
```

**Validates: Requirement 3.3**

### Property 11: Completion Symbol Precedence

*For any* document where a user-defined symbol shadows a built-in, the user-defined symbol should appear first.

```typescript
fc.property(
  arbitrary_shadowing_document(),
  ({ document, shadowed_name }) => {
    const my_doc_state = parse_and_analyze(document);
    const my_position = find_command_position(document);
    const my_completions = completion_provider.get_completions(
      my_doc_state,
      my_position,
      { type: 'command' }
    );
    const my_matching = my_completions.filter(
      c => c.label.startsWith(shadowed_name)
    );
    // User-defined should come before built-in
    return my_matching[0]?.data?.source === 'user';
  }
);
```

**Validates: Requirement 3.4**

### Property 12: Diagnostic Position Accuracy

*For any* malformed document, reported diagnostics should have accurate positions.

```typescript
fc.property(
  arbitrary_malformed_document('unbalanced_quotes'),
  ({ document, error_position }) => {
    const my_diagnostics = get_diagnostics(document);
    const my_quote_errors = my_diagnostics.filter(
      d => d.code === StataDiagnosticCode.UNBALANCED_QUOTES
    );
    return my_quote_errors.some(
      d => ranges_overlap(d.range, error_position)
    );
  }
);
```

**Validates: Requirement 4.1**

### Property 13: No False Positive Diagnostics

*For any* valid Stata document, no syntax error diagnostics should be reported.

```typescript
fc.property(
  arbitrary_valid_stata_document(),
  (document) => {
    const my_diagnostics = get_diagnostics(document);
    const my_syntax_errors = my_diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    return my_syntax_errors.length === 0;
  }
);
```

**Validates: Requirement 4.2**

### Property 14: Diagnostic Clearing on Update

*For any* document update that fixes an error, the corresponding diagnostic should be cleared.

```typescript
fc.property(
  arbitrary_fixable_error(),
  ({ broken_document, fixed_document, error_code }) => {
    // Get diagnostics for broken document
    const my_broken_diagnostics = get_diagnostics(broken_document);
    expect(my_broken_diagnostics.some(d => d.code === error_code)).toBe(true);
    
    // Get diagnostics for fixed document
    const my_fixed_diagnostics = get_diagnostics(fixed_document);
    return !my_fixed_diagnostics.some(d => d.code === error_code);
  }
);
```

**Validates: Requirement 4.3**

### Property 15: Formatting Semantic Preservation

*For any* valid Stata document, formatting should produce code that parses to an equivalent AST.

```typescript
fc.property(
  arbitrary_valid_stata_document(),
  (document) => {
    const my_original_ast = parse(document);
    const my_formatted = format(document);
    const my_formatted_ast = parse(my_formatted);
    return ast_equivalent(my_original_ast, my_formatted_ast);
  }
);
```

**Validates: Requirement 5.1**

### Property 16: Formatting Whitespace Only

*For any* valid Stata document, formatting should only change whitespace and indentation.

```typescript
fc.property(
  arbitrary_valid_stata_document(),
  (document) => {
    const my_formatted = format(document);
    const my_original_tokens = tokenize_non_whitespace(document);
    const my_formatted_tokens = tokenize_non_whitespace(my_formatted);
    return tokens_equal(my_original_tokens, my_formatted_tokens);
  }
);
```

**Validates: Requirement 5.2**

### Property 17: Formatting Comment Preservation

*For any* document with comments, formatting should preserve all comments.

```typescript
fc.property(
  arbitrary_document_with_comments(),
  (document) => {
    const my_original_comments = extract_comments(document);
    const my_formatted = format(document);
    const my_formatted_comments = extract_comments(my_formatted);
    return comments_equal(my_original_comments, my_formatted_comments);
  }
);
```

**Validates: Requirement 5.3**

### Property 18: Formatting No Token Normalization

*For any* document with abbreviated commands, formatting should NOT expand abbreviations.

```typescript
fc.property(
  arbitrary_document_with_abbreviations(),
  ({ document, abbreviations }) => {
    const my_formatted = format(document);
    return abbreviations.every(
      abbrev => my_formatted.includes(abbrev)
    );
  }
);
```

**Validates: Requirement 5.4**

### Property 19: Go-to-Definition for Defined Symbols

*For any* document with defined symbols, go-to-definition should return the definition location.

```typescript
fc.property(
  arbitrary_document_with_definitions(),
  ({ document, definitions }) => {
    const my_doc_state = parse_and_analyze(document);
    for (const my_def of definitions) {
      const my_ref_position = my_def.reference_position;
      const my_result = definition_provider.get_definition(
        my_doc_state,
        my_ref_position
      );
      if (!my_result || !location_matches(my_result, my_def.definition_location)) {
        return false;
      }
    }
    return true;
  }
);
```

**Validates: Requirement 6.1**

### Property 20: Go-to-Definition Empty for Undefined

*For any* reference to an undefined symbol, go-to-definition should return empty (not error).

```typescript
fc.property(
  arbitrary_document_with_undefined_refs(),
  ({ document, undefined_positions }) => {
    const my_doc_state = parse_and_analyze(document);
    for (const my_position of undefined_positions) {
      const my_result = definition_provider.get_definition(
        my_doc_state,
        my_position
      );
      if (my_result !== null && my_result !== undefined) {
        return false;
      }
    }
    return true;
  }
);
```

**Validates: Requirement 6.2**

### Property 21: Hover for Built-in Commands

*For any* built-in command, hover should return syntax and description.

```typescript
fc.property(
  arbitrary_builtin_command(),
  (command) => {
    const my_document = command;
    const my_position = { line: 0, character: 0 };
    const my_hover = hover_provider.get_hover(
      create_document_state(my_document),
      my_position
    );
    return my_hover !== null &&
           my_hover.contents.includes('Syntax') &&
           my_hover.contents.includes(command);
  }
);
```

**Validates: Requirement 7.1**

### Property 22: Hover for User Macros

*For any* document with user-defined macros, hover on macro reference should show definition info.

```typescript
fc.property(
  arbitrary_document_with_macro_refs(),
  ({ document, macro_refs }) => {
    const my_doc_state = parse_and_analyze(document);
    for (const my_ref of macro_refs) {
      const my_hover = hover_provider.get_hover(my_doc_state, my_ref.position);
      if (!my_hover || !my_hover.contents.includes(my_ref.name)) {
        return false;
      }
    }
    return true;
  }
);
```

**Validates: Requirement 7.2, 7.3**

### Property 23: Hover Null for Non-Hoverable

*For any* position that is not hoverable (whitespace, operators), hover should return null.

```typescript
fc.property(
  arbitrary_non_hoverable_position(),
  ({ document, position }) => {
    const my_hover = hover_provider.get_hover(
      create_document_state(document),
      position
    );
    return my_hover === null;
  }
);
```

**Validates: Requirement 7.4**

### Property 24: Symbol Provider Includes All Programs

*For any* document with program definitions, document symbols should include all programs.

```typescript
fc.property(
  arbitrary_document_with_programs(3),
  ({ document, programs }) => {
    const my_doc_state = parse_and_analyze(document);
    const my_symbols = symbol_provider.get_document_symbols(my_doc_state);
    const my_program_symbols = my_symbols.filter(
      s => s.kind === SymbolKind.Function
    );
    return programs.every(
      p => my_program_symbols.some(s => s.name === p.name)
    );
  }
);
```

**Validates: Requirement 8.1**

### Property 25: Symbol Provider Includes All Macros

*For any* document with macro definitions, document symbols should include all macros.

```typescript
fc.property(
  arbitrary_document_with_macros(5, 3),
  ({ document, macros }) => {
    const my_doc_state = parse_and_analyze(document);
    const my_symbols = symbol_provider.get_document_symbols(my_doc_state);
    const my_macro_symbols = my_symbols.filter(
      s => s.kind === SymbolKind.Variable
    );
    return macros.every(
      m => my_macro_symbols.some(s => s.name === m.name)
    );
  }
);
```

**Validates: Requirement 8.2**

### Property 26: Symbol Information Correctness

*For any* symbol in document symbols, kind, name, and location should be correct.

```typescript
fc.property(
  arbitrary_document_with_mixed_symbols(),
  ({ document, expected_symbols }) => {
    const my_doc_state = parse_and_analyze(document);
    const my_symbols = symbol_provider.get_document_symbols(my_doc_state);
    for (const my_expected of expected_symbols) {
      const my_found = my_symbols.find(s => s.name === my_expected.name);
      if (!my_found ||
          my_found.kind !== my_expected.kind ||
          !ranges_equal(my_found.range, my_expected.range)) {
        return false;
      }
    }
    return true;
  }
);
```

**Validates: Requirement 8.3**

### Property 27: Embedded Blocks in Symbols

*For any* document with embedded language blocks, they should appear as structural elements.

```typescript
fc.property(
  arbitrary_document_with_embedded_blocks(),
  ({ document, embedded_blocks }) => {
    const my_doc_state = parse_and_analyze(document);
    const my_symbols = symbol_provider.get_document_symbols(my_doc_state);
    return embedded_blocks.every(
      block => my_symbols.some(
        s => s.name.includes(block.language) && 
             ranges_overlap(s.range, block.range)
      )
    );
  }
);
```

**Validates: Requirement 8.4**

## Testing Strategy

### Test Organization

```
tests/property/
├── generators/
│   ├── index.ts              # Re-exports all generators
│   ├── primitives.ts         # Basic value generators
│   ├── ast-nodes.ts          # AST node generators
│   └── documents.ts          # Document generators
├── helpers/
│   ├── index.ts              # Re-exports all helpers
│   ├── ast-comparison.ts     # AST equivalence functions
│   ├── document-utils.ts     # Document manipulation utilities
│   └── position-utils.ts     # Position/range utilities
├── parser-roundtrip.prop.test.ts
├── lexer-tokenization.prop.test.ts
├── completion-relevance.prop.test.ts
├── diagnostic-accuracy.prop.test.ts
├── formatting-preservation.prop.test.ts
├── goto-definition.prop.test.ts
├── hover-completeness.prop.test.ts
└── symbol-completeness.prop.test.ts
```

### Test Execution

All property tests run with `bun test` alongside existing tests. Each property test runs minimum 100 iterations as specified in requirements.

### Shrinking

fast-check provides automatic shrinking to find minimal failing examples. Custom generators should support shrinking by using fast-check's built-in combinators where possible.

## Error Handling

Property tests should handle edge cases gracefully:

1. **Empty documents**: Generators should occasionally produce empty or minimal documents
2. **Unicode content**: Generators should include non-ASCII characters in strings
3. **Large documents**: Occasional large documents to test performance
4. **Deeply nested structures**: Test parser limits with nested control flow

## Dependencies

- `fast-check`: Already installed, used for property-based testing
- Existing LSP components: lexer, parser, analyzer, providers
- Test utilities from existing test infrastructure
