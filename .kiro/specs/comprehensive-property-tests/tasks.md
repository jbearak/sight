# Implementation Tasks

## Task 1: Create Generator Infrastructure

- [x] Create `tests/property/generators/index.ts` with re-exports
- [x] Create `tests/property/generators/primitives.ts` with:
  - `arbitrary_identifier()` - valid Stata identifiers
  - `arbitrary_macro_name()` - valid macro names
  - `arbitrary_variable_name()` - valid variable names
  - `arbitrary_simple_string()` - simple quoted strings
  - `arbitrary_compound_string()` - compound quoted strings
  - `arbitrary_number()` - numeric literals
- [x] Create `tests/property/generators/ast-nodes.ts` with:
  - `arbitrary_command_node()` - commands with prefix/options
  - `arbitrary_macro_def_node()` - local/global macro definitions
  - `arbitrary_program_node()` - program definitions
  - `arbitrary_control_flow_node()` - if/foreach/forvalues/while
- [x] Create `tests/property/generators/documents.ts` with:
  - `arbitrary_stata_document()` - valid mixed documents
  - `arbitrary_document_with_macros()` - documents with specific macros
  - `arbitrary_document_with_programs()` - documents with programs
  - `arbitrary_malformed_document()` - documents with specific errors

**Requirement:** Supports all requirements by providing test inputs

---

## Task 2: Create Helper Utilities

- [x] Create `tests/property/helpers/index.ts` with re-exports
- [x] Create `tests/property/helpers/ast-comparison.ts` with:
  - `ast_equivalent()` - compare ASTs ignoring ranges
  - `deep_equal_ignoring_ranges()` - recursive comparison
  - `nodes_equal()` - single node comparison
- [x] Create `tests/property/helpers/document-utils.ts` with:
  - `create_document_state()` - create DocumentState from string
  - `parse_and_analyze()` - full pipeline for document
  - `extract_comments()` - get all comments from document
  - `tokenize_non_whitespace()` - get non-whitespace tokens
- [x] Create `tests/property/helpers/position-utils.ts` with:
  - `ranges_overlap()` - check if ranges overlap
  - `ranges_equal()` - check if ranges are equal
  - `location_matches()` - compare Location objects
  - `extract_text_at_range()` - get text at Range

**Requirement:** Supports all requirements by providing comparison utilities

---

## Task 3: Implement Parser Round-Trip Property Tests

- [x] Create `tests/property/parser-roundtrip.prop.test.ts`
- [x] Implement Property 1: Parser Round-Trip Consistency
  - Generate valid ASTs using `arbitrary_stata_ast()`
  - Print AST to source using pretty-printer
  - Parse source back to AST
  - Verify AST equivalence (ignoring ranges)
  - Run minimum 100 iterations

**Requirement:** 1 (Parser Round-Trip Property Test)

---

## Task 4: Implement Lexer Tokenization Property Tests

- [x] Create `tests/property/lexer-tokenization.prop.test.ts`
- [x] Implement Property 2: Token Concatenation
  - Generate valid documents
  - Tokenize and concatenate token values
  - Verify reconstruction matches original (modulo whitespace)
- [x] Implement Property 3: Delimiter Mode Handling
  - Generate documents with `#delimit` switches
  - Verify STATEMENT_TERMINATOR tokens match expected mode
- [x] Implement Property 4: Continuation Handling
  - Generate documents with `///` continuations
  - Verify no STATEMENT_TERMINATOR after CONTINUATION
- [x] Implement Property 5: String Boundary Detection
  - Generate simple and compound strings
  - Verify single STRING token per literal
- [x] Implement Property 6: Global Macro Tokenization
  - Generate `${name}` references
  - Verify single MACRO_REF_GLOBAL token
- [x] Implement Property 7: Source Span Accuracy
  - For each token, verify range extracts correct text
- [x] Run minimum 100 iterations per property

**Requirement:** 2 (Lexer Tokenization Property Test)

---

## Task 5: Implement Completion Relevance Property Tests

- [x] Create `tests/property/completion-relevance.prop.test.ts`
- [x] Implement Property 8: Prefix Matching
  - Generate command prefixes
  - Verify all completions match prefix
- [x] Implement Property 9: Macro Inclusion
  - Generate documents with defined macros
  - Verify macro completions include defined macros
- [x] Implement Property 10: Option Validity
  - Generate commands with option context
  - Verify returned options are valid for command
- [x] Implement Property 11: Symbol Precedence
  - Generate documents with shadowing symbols
  - Verify user-defined symbols appear first
- [x] Run minimum 100 iterations per property

**Requirement:** 3 (Completion Relevance Property Test)

---

## Task 6: Implement Diagnostic Accuracy Property Tests

- [x] Create `tests/property/diagnostic-accuracy.prop.test.ts`
- [x] Implement Property 12: Position Accuracy
  - Generate malformed documents with known error positions
  - Verify diagnostics have accurate ranges
- [x] Implement Property 13: No False Positives
  - Generate valid documents
  - Verify no syntax error diagnostics
- [x] Implement Property 14: Clearing on Update
  - Generate fixable errors
  - Verify diagnostics clear after fix
- [x] Add specific error pattern tests:
  - `} else {` on same line
  - Closing brace not alone on line
  - `program define` without `end`
  - Unclosed block structures
  - Unbalanced string quotes
- [x] Run minimum 100 iterations per property

**Requirement:** 4 (Diagnostic Accuracy Property Test)

---

## Task 7: Implement Formatting Preservation Property Tests

- [x] Create `tests/property/formatting-preservation.prop.test.ts`
- [x] Implement Property 15: Semantic Preservation
  - Generate valid documents
  - Format and reparse
  - Verify AST equivalence
- [x] Implement Property 16: Whitespace Only
  - Generate valid documents
  - Verify only whitespace changes after formatting
- [x] Implement Property 17: Comment Preservation
  - Generate documents with comments
  - Verify all comments preserved after formatting
- [x] Implement Property 18: No Token Normalization
  - Generate documents with abbreviated commands
  - Verify abbreviations NOT expanded
- [x] Run minimum 100 iterations per property

**Requirement:** 5 (Formatting Semantic Preservation Property Test)

---

## Task 8: Implement Go-to-Definition Property Tests

- [x] Create `tests/property/goto-definition.prop.test.ts`
- [x] Implement Property 19: Defined Symbols
  - Generate documents with macro/program definitions and references
  - Verify go-to-definition returns correct location
- [x] Implement Property 20: Undefined Symbols
  - Generate documents with undefined references
  - Verify go-to-definition returns empty (not error)
- [x] Add cross-file test for global macros (if workspace indexer available)
- [x] Run minimum 100 iterations per property

**Requirement:** 6 (Go-to-Definition Correctness Property Test)

---

## Task 9: Implement Hover Completeness Property Tests

- [x] Create `tests/property/hover-completeness.prop.test.ts`
- [x] Implement Property 21: Built-in Commands
  - Generate built-in command names
  - Verify hover returns syntax and description
- [x] Implement Property 22: User Macros
  - Generate documents with macro definitions and references
  - Verify hover shows definition info
- [x] Implement Property 23: Non-Hoverable Positions
  - Generate positions on whitespace/operators
  - Verify hover returns null
- [x] Run minimum 100 iterations per property

**Requirement:** 7 (Hover Information Completeness Property Test)

---

## Task 10: Implement Symbol Completeness Property Tests

- [x] Create `tests/property/symbol-completeness.prop.test.ts`
- [x] Implement Property 24: Programs Included
  - Generate documents with program definitions
  - Verify all programs in document symbols
- [x] Implement Property 25: Macros Included
  - Generate documents with macro definitions
  - Verify all macros in document symbols
- [x] Implement Property 26: Symbol Information Correctness
  - Verify kind, name, and location for each symbol
- [x] Implement Property 27: Embedded Blocks
  - Generate documents with mata/python blocks
  - Verify embedded blocks appear as structural elements
- [x] Run minimum 100 iterations per property

**Requirement:** 8 (Symbol Information Completeness Property Test)

---

## Task 11: Integration and Validation

- [x] Run full test suite with `bun test`
- [x] Verify all 27 properties pass with 100+ iterations
- [x] Check for any flaky tests and adjust generators if needed
- [x] Verify shrinking produces minimal failing examples on intentional failures
- [x] Document any discovered edge cases or bugs

**Requirement:** All requirements validated
