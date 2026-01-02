# Design Document: Syntax Command Parsing

## Overview

This design extends the Stata LSP parser to understand `syntax` commands within user-defined programs. The `syntax` command declares a program's interface (arguments and options), enabling the LSP to provide intelligent completions, hover information, and diagnostics when users call custom programs.

The implementation follows the existing LSP architecture pipeline: Lexer → Parser → Analyzer → Providers. We introduce a new `SyntaxNode` AST node type, a `Program_Signature` data structure, and extend the analyzer to register implicit local macros created by `syntax` declarations.

## Architecture

### Data Flow

```
Source Code
    ↓
Lexer (tokenizes, handles delimiters)
    ↓
Parser (builds AST with SyntaxNode for syntax commands)
    ↓
Analyzer (extracts Program_Signature, registers implicit locals)
    ↓
Providers (completion, hover, diagnostics use Program_Signature)
    ↓
LSP Response
```

### Key Design Decisions

1. **Distinct SyntaxNode Type**: Rather than treating `syntax` as a generic command, we create a dedicated `SyntaxNode` to enable targeted analysis and error handling.

2. **Program_Signature Structure**: Encapsulates extracted arguments and options with metadata (types, defaults, ranges) for use by providers.

3. **Implicit Local Registration**: The analyzer automatically registers all argument and option names as local macros within the program scope, suppressing false "undefined macro" diagnostics.

4. **Graceful Error Recovery**: Syntax parsing errors produce diagnostics but do not corrupt the program node or prevent partial signature extraction.

5. **Scope Isolation**: Implicit locals are restricted to the program body and do not leak into global or parent scopes.

6. **Delimiter Awareness**: Parsing honors current `#delimit cr` or `#delimit ;` mode and continued lines when tokenizing `syntax` statements, so multi-line declarations remain intact.

## Components and Interfaces

### 1. Type Definitions (src/types/index.ts)

Add new types to support syntax command parsing:

```typescript
// Argument specification from syntax command
export interface ArgumentSpec {
  type: 'varlist' | 'varname' | 'newvarname' | 'anything' | 'if' | 'in' | 'using' | 'exp' | 'name';
  name?: string; // For 'anything(name=...)'
  isOptional: boolean; // true if wrapped in brackets (e.g., [varlist])
  range: Range;
}

// Option specification from syntax command
export interface OptionSpec {
  name: string;
  minAbbreviation: string; // Computed from casing
  isRequired: boolean; // true if marked with *
  isOptional: boolean; // true if in brackets
  argumentType?: 'real' | 'integer' | 'string' | 'varlist' | 'name' | 'filename' | 'numlist' | 'varname' | 'passthru';
  defaultValue?: string;
  range: Range;
}

// Program signature extracted from syntax command
export interface ProgramSignature {
  arguments: ArgumentSpec[];
  options: OptionSpec[];
  allowsArbitraryOptions: boolean; // true if * appears
  syntaxRanges: Range[]; // Ranges of all syntax commands (for multiple syntax support)
}

// New AST node type for syntax commands
export interface SyntaxNode {
  type: 'syntax';
  signature: ProgramSignature;
  range: Range;
  leadingTrivia?: TriviaNode[];
  trailingTrivia?: TriviaNode[];
}

// Extend StataNode union to include SyntaxNode
// Note: SyntaxNode only appears inside ProgramNode.body[], not at top level.
// Syntax commands outside programs are treated as generic CommandNode.
export type StataNode = 
  | CommandNode
  | ProgramNode
  | MacroDefNode
  | MacroRefNode
  | ControlFlowNode
  | StringLiteralNode
  | DirectiveNode
  | EmbeddedLanguageBlockNode
  | SyntaxNode; // NEW: only valid inside program bodies

// Extend ProgramNode to include optional signature
export interface ProgramNode {
  type: 'program';
  name: string;
  body: StataNode[];
  signature?: ProgramSignature; // NEW: extracted from syntax command
  range: Range;
  leadingTrivia?: TriviaNode[];
  trailingTrivia?: TriviaNode[];
}
```

### 2. Parser Extension (src/parser/index.ts)

Extend the parser to recognize and parse `syntax` commands:

**Key Methods**:

- `parseSyntaxCommand()`: Main entry point for parsing syntax commands
  - Validates syntax is inside a program (via context tracking)
  - Extracts arguments and options
  - Returns `SyntaxNode` with `ProgramSignature`
  - Emits warning if outside program
  - Honors current delimiter mode (`cr` or `;`) and continued lines when assembling the full command text

- `parseArgumentSpec()`: Parses individual argument specifications
  - Recognizes standard types: varlist, varname, newvarname, anything, if, in, using, =exp
  - Handles parentheses-delimited expressions
  - Handles `newvarname = exp` by capturing the trailing expression requirement and its range
  - Handles `using` filename (quoted or unquoted, with spaces) as a required filename token
  - Returns `ArgumentSpec` with range

- `parseOptionSpec()`: Parses individual option specifications
  - Recognizes required marker (`*`)
  - Recognizes optional marker (brackets)
  - Parses argument types and defaults
  - Computes minimum abbreviation from casing
  - Returns `OptionSpec` with range

- `computeMinAbbreviation(name: string)`: Computes minimum unambiguous abbreviation
  - Computed per-option based on casing alone (not globally disambiguated)
  - Preserves casing: `MyOpt` → `M`, `OPTion` → `O`
  - Handles all-lowercase: `myopt` → `m`
  - Handles all-uppercase: `MYOPT` → `M`
  - Note: If two options have the same abbreviation (e.g., `OPTion1` and `OPTion2` both → `O`), the completion provider handles disambiguation at display time

**Integration Points**:

- In `parseStatement()`: Check for `syntax` keyword and route to `parseSyntaxCommand()`
- In `parseProgramDefinition()`: After parsing program body, extract and attach signature to `ProgramNode`
- Note: `syntax` commands outside programs are parsed as generic `CommandNode` with a warning diagnostic

### 3. Analyzer Extension (src/analyzer/index.ts)

Extend the analyzer to process syntax commands and register implicit locals:

**Key Methods**:

- `analyzeSyntaxNode(node: SyntaxNode, scope: ScopeInfo)`: Process syntax node
  - Validates argument types and option syntax
  - Emits diagnostics for errors (duplicates, unknown types, mismatched delimiters)
  - Registers implicit locals for all arguments and options
  - Merges multiple `syntax` commands in appearance order; later option specs override earlier ones while emitting duplicate-option diagnostics that reference both ranges

- `registerImplicitLocals(signature: ProgramSignature, scope: ScopeInfo)`: Register implicit locals
  - For each argument: register as local macro (e.g., `varlist` → local macro)
  - For each option: register option name as local macro
  - Mark as implicit (suppress "undefined macro" diagnostics)
  - Symbol resolution keeps implicit locals in the innermost program scope without shadowing existing globals; global lookups remain visible unless a local is explicitly referenced.

- `validateArgumentType(type: string)`: Validate argument type is recognized
  - Allowed types: varlist, varname, newvarname, anything, if, in, using, =exp, name
  - Emit diagnostic for unknown types

- `validateOptionSyntax(spec: OptionSpec)`: Validate option syntax
  - Check for duplicate option names
  - Validate argument type if present
  - Emit diagnostics for errors

**Integration Points**:

- In `analyzeNode()`: Add case for `SyntaxNode` to call `analyzeSyntaxNode()`
- In `analyzeProgramNode()`: Extract signature from program body and attach to program symbol
- Extend `ProgramSymbol` in `src/types/index.ts` to include `signature?: ProgramSignature`
- Note: Multiple `syntax` commands in a program are merged in order of appearance, with later options overriding earlier ones for the same option name. Arguments are concatenated.

- `validateProgramCall(programName: string, callArguments: string[], callOptions: Map<string, string>)`: Validate a program call
  - Look up program signature from symbol table
  - If multiple syntaxes exist, iterate through each and check if call is valid under any
  - If call is valid under at least one syntax, no diagnostic
  - If call is invalid under all syntaxes, emit diagnostic listing violations

### 4. Completion Provider Extension (src/providers/completion.ts)

Extend completion provider to suggest options from program signatures:

**Key Methods**:

- `getCompletionsForUserProgramCall(programName: string, partialOption: string)`: Get option completions
  - Look up program signature from symbol table
  - Filter options by partial abbreviation match using disambiguated minimum abbreviation lengths computed across the full option set (increase length until unique)
  - Exclude options already present in the call (case-insensitive, matches both full names and any valid abbreviation)
  - Return completions with descriptions and placeholders

- `formatOptionCompletion(option: OptionSpec)`: Format option for completion
  - Show option name with minimum abbreviation
  - Add description based on type (e.g., `real` → "numeric value")
  - If has argument: insert parentheses with placeholder
  - Differentiate required vs optional visually

**Integration Points**:

- In `getCompletions()`: Detect when completing options after user program call
- Use program signature to filter and format completions

### 5. Hover Provider Extension (src/providers/hover.ts)

Extend hover provider to show program signatures:

**Key Methods**:

- `getHoverForUserProgram(programName: string)`: Get hover for program call
  - Look up program signature from symbol table
  - Format in Stata help-style
  - Return hover text

- `getHoverForOption(programName: string, optionName: string)`: Get hover for option
  - Look up option in program signature
  - Show type, default, required status
  - Return hover text

- `formatSignatureForHover(signature: ProgramSignature)`: Format signature
  - Stata help-style formatting
  - Show arguments in order
  - Show options with types and defaults

**Integration Points**:

- In `getHover()`: Detect when hovering over program name or option
- Use program signature to format hover text

## Data Models

### ProgramSignature Structure

```typescript
interface ProgramSignature {
  arguments: ArgumentSpec[];      // Positional arguments in order
  options: OptionSpec[];          // Named options
  allowsArbitraryOptions: boolean; // true if * appears
  syntaxRanges: Range[];          // Ranges of all syntax commands (for multiple syntax support)
}
```
Provider behavior when `allowsArbitraryOptions` is true: diagnostics for unknown options are suppressed; completion still prefers known options but permits any additional option token without error.

### ArgumentSpec Structure

```typescript
interface ArgumentSpec {
  type: 'varlist' | 'varname' | 'newvarname' | 'anything' | 'if' | 'in' | 'using' | 'exp' | 'name';
  name?: string;  // For 'anything(name=...)'
  isOptional: boolean; // true if wrapped in brackets (e.g., [varlist])
  range: Range;
}
```

### OptionSpec Structure

```typescript
interface OptionSpec {
  name: string;
  minAbbreviation: string; // computed per-option based on casing alone
  isRequired: boolean;
  isOptional: boolean;
  argumentType?: 'real' | 'integer' | 'string' | 'varlist' | 'name' | 'filename' | 'numlist' | 'varname' | 'passthru';
  defaultValue?: string;
  range: Range;
}
```

## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Syntax Node Creation

*For any* program containing a `syntax` command, the parser should create a `SyntaxNode` in the AST rather than a generic `CommandNode`.

**Validates: Requirements 1.1**

### Property 2: Out-of-Program Syntax Warning

*For any* `syntax` command appearing outside a program block, the parser should emit a diagnostic warning and treat it as a generic command.

**Validates: Requirements 1.2**

### Property 3: Argument Extraction Order

*For any* `syntax` command with multiple arguments, all arguments should be extracted in the order they appear in the syntax declaration.

**Validates: Requirements 1.3**

### Property 4: Option Extraction with Markers

*For any* `syntax` command with options, each option should be extracted with its required/optional markers correctly recorded.

**Validates: Requirements 1.4**

### Property 5: Standard Argument Type Recognition

*For any* standard argument type (varlist, varname, newvarname, anything, if, in, using, =exp), the parser should correctly identify and extract it.

**Validates: Requirements 1.5**

### Property 6: Option Modifier Handling

*For any* option modifier (required `*`, optional brackets, typed arguments, defaults), the parser should correctly parse and record it.

**Validates: Requirements 1.6**

### Property 7: Signature Attachment with Ranges

*For any* program with a `syntax` command, the resulting `Program_Signature` should be attached to the `ProgramNode` with valid source ranges for all arguments and options.

**Validates: Requirements 1.7**

### Property 8: Optional Boolean Option Recognition

*For any* bracketed option `[Option]`, the parser should recognize it as an optional boolean option with no argument.

**Validates: Requirements 2.1**

### Property 9: Typed Option Recording

*For any* option with a type specification `Option(type)`, the parser should record the argument type correctly.

**Validates: Requirements 2.2**

### Property 10: Default Value Extraction

*For any* option with a default value `Option(type default)`, the parser should extract the default literal and include it in the signature.

**Validates: Requirements 2.3**

### Property 11: Arbitrary Options Marker

*For any* `syntax` command containing `*`, the signature should be marked as allowing arbitrary additional options.

**Validates: Requirements 2.4**

### Property 12: Abbreviation Computation

*For any* option name, the parser should compute the minimum unambiguous abbreviation preserving the original casing (e.g., `MyOpt` → `M`).

**Validates: Requirements 2.5**

### Property 13: Duplicate Option Handling

*For any* `syntax` command with duplicate option names, the parser should keep the last definition and emit a duplicate-option diagnostic.

**Validates: Requirements 2.6**

### Property 14: Completion Filtering by Abbreviation

*For any* partial option abbreviation typed after a user program call, the completion provider should filter options to only those matching the abbreviation.

**Validates: Requirements 3.1**

### Property 14b: Duplicate Option Resolution in Completions

*For any* program where an option name appears multiple times, completions should surface only the last-defined option (post-merge) and suppress earlier duplicates.

**Validates: Requirements 2.6, 3.4**

### Property 15: Option Description Generation

*For any* option with a type, the completion provider should generate a description derived from the type (e.g., `real` → "numeric value").

**Validates: Requirements 3.2**

### Property 16: Placeholder Insertion for Arguments

*For any* option with an argument type, the completion provider should insert parentheses with a placeholder.

**Validates: Requirements 3.3**

### Property 17: Completion Differentiation and Filtering

*For any* completion list for a user program call, required options should be visually differentiated from optional ones, and options already present in the call should be hidden.

**Validates: Requirements 3.4**

### Property 18: Hover Signature Formatting

*For any* user program with a signature, hovering over the program name should display the signature in Stata help-style formatting.

**Validates: Requirements 4.1**

### Property 19: Option Hover Information

*For any* option in a user program call, hovering over it should show the option's type, default (if any), and whether it is required.

**Validates: Requirements 4.2**

### Property 20: Hover Error Handling

*For any* hover request with unavailable signature data, the hover provider should fail silently without throwing an exception.

**Validates: Requirements 4.3**

### Property 21: Regression-Style Pattern Handling

*For any* `syntax varlist [if] [in] [, options]` pattern, the parser should correctly extract all components.

**Validates: Requirements 5.1**

### Property 22: Flexible Input Pattern Handling

*For any* `syntax anything [, options]` or `syntax anything(name=...)` pattern, the parser should correctly extract all components.

**Validates: Requirements 5.2**

### Property 23: File-Based Pattern Handling

*For any* `syntax [varlist] [if] [in] using ...` pattern, the parser should correctly capture the `using` keyword and filename requirement.

**Validates: Requirements 5.3**

### Property 24: Generate-Style Pattern Handling

*For any* `syntax newvarname = exp` pattern, the parser should correctly record the expression requirement.

**Validates: Requirements 5.4**

### Property 25: Graceful Error Recovery

*For any* malformed `syntax` command, the parser should emit diagnostics but not corrupt the `ProgramNode` or prevent downstream providers from functioning.

**Validates: Requirements 5.5**

### Property 26: Diagnostic Emission for Errors

*For any* `syntax` command with errors (duplicate options, unknown types, mismatched delimiters), the analyzer should emit diagnostics.

**Validates: Requirements 6.1**

### Property 27: Diagnostic Range Accuracy

*For any* diagnostic emitted for a syntax error, the range should point to the offending token.

**Validates: Requirements 6.2**

### Property 28: Partial Signature on Error

*For any* `syntax` command with recoverable errors, the analyzer should still build a partial `Program_Signature`.

**Validates: Requirements 6.3**

### Property 29: Implicit Local Registration

*For any* `syntax` command, the analyzer should register all argument and option names as implicit local macros in the program scope.

**Validates: Requirements 6.4**

### Property 30: Implicit Local Suppression of Undefined Macro Diagnostics

*For any* implicit local macro created by `syntax`, the analyzer should not report "Undefined Macro" diagnostics for references to that macro within the program.

**Validates: Requirements 6.5**

### Property 31: Implicit Local Scope Restriction

*For any* implicit local macro created by `syntax`, its visibility should be restricted to the body of the defining program.

**Validates: Requirements 7.1**

### Property 32: Implicit Local Non-Leakage

*For any* implicit local macro created by `syntax`, it should not leak into global scope or parent calling scopes.

**Validates: Requirements 7.2**

### Property 33: Implicit Local Independence

*For any* implicit local macro created by `syntax`, it should exist independently of global macros with the same name (no masking or shadowing).

**Validates: Requirements 7.3**

### Property 34: Multiple Syntax Commands Handling

*For any* program with multiple `syntax` commands, all implicit locals from all syntax commands should be available in the code following them.

**Validates: Requirements 7.4**

### Property 35: Command Validation Against Multiple Syntaxes

*For any* program call to a user program with multiple `syntax` commands, the analyzer should validate the call against each syntax in order and emit a diagnostic only if the call is invalid under all syntaxes.

**Validates: Requirements 3 (Completions), 6 (Diagnostics)**

## Error Handling

### Parser-Level Errors

1. **Syntax outside program**: Emit warning diagnostic, treat as generic command
2. **Unknown argument type**: Emit error diagnostic, skip argument
3. **Mismatched delimiters**: Emit error diagnostic, attempt recovery
4. **Duplicate options**: Emit warning diagnostic, keep last definition
5. **Malformed option syntax**: Emit error diagnostic, skip option
6. **Delimiter mismatch under `#delimit ;`**: Emit error diagnostic scoped to offending token; continue parsing remaining items

### Analyzer-Level Errors

1. **Duplicate option names**: Emit warning diagnostic
2. **Unknown argument types**: Emit error diagnostic
3. **Invalid default values**: Emit warning diagnostic
4. **Unresolvable abbreviation conflicts after merge**: Emit warning diagnostic and widen abbreviation length; if still ambiguous, fall back to full option name

### Error Recovery

- Partial signature extraction: Continue parsing remaining arguments/options despite errors
- Program node preservation: Errors in syntax parsing do not corrupt the program node
- Downstream provider resilience: Providers handle missing or partial signatures gracefully

### Severity and Retention Rules

- Errors remove only the offending argument/option; previously parsed elements are kept.
- Warnings retain the element but annotate diagnostics.
- When duplicate options occur, keep only the last definition in the merged signature; earlier definitions remain referenced only for diagnostics.

## Symbol Table Integration

### ProgramSymbol Extension

The existing `ProgramSymbol` interface in `src/types/index.ts` must be extended to include the signature:

```typescript
export interface ProgramSymbol {
  name: string;
  location: { uri: string; range: Range };
  sourceUri: string;
  parameters?: string[];
  signature?: ProgramSignature; // NEW: extracted from syntax command
}
```

### Signature Attachment Flow

1. **Parser**: Creates `SyntaxNode` with `ProgramSignature` inside program body
2. **Analyzer**: Extracts signature from program body and attaches to `ProgramSymbol`
3. **Providers**: Look up program in symbol table and use `ProgramSymbol.signature` for completions/hover

### Multiple Syntax Commands

When a program contains multiple `syntax` commands:
- Arguments are concatenated in order of appearance
- Options are merged, with later definitions overriding earlier ones for the same option name
- All `syntaxRanges` are recorded for diagnostic purposes
- Implicit locals from all syntax commands are registered
- **Command Validation**: When a user calls the program, the analyzer iterates through each syntax in order and attempts to validate the call against each one. If the call is valid under any syntax, no diagnostic is issued. If the call is invalid under all syntaxes, a diagnostic is emitted indicating which syntax rules were violated.

## Testing Strategy

### Unit Tests

- **Parser tests** (`tests/unit/parser.test.ts`):
  - Test `parseSyntaxCommand()` with various argument types
  - Test `parseOptionSpec()` with modifiers and defaults
  - Test `computeMinAbbreviation()` with different casings
  - Test error cases (unknown types, mismatched delimiters)
  - Test out-of-program syntax warning
  - Test delimiter modes (`#delimit cr` vs `#delimit ;`) with continued lines
  - Test `using` filenames (quoted/unquoted, spaces)
  - Test `newvarname = exp` parsing

- **Analyzer tests** (`tests/unit/analyzer.test.ts`):
  - Test implicit local registration
  - Test duplicate option diagnostics
  - Test scope restriction of implicit locals
  - Test multiple syntax commands
  - Test merge semantics (later overrides) and abbreviation disambiguation diagnostics

- **Provider tests** (`tests/unit/completion.test.ts`, `tests/unit/hover.test.ts`):
  - Test completion filtering by abbreviation
  - Test hover formatting
  - Test error handling for missing signatures
  - Test hiding already-present options (full name and abbreviation forms)
  - Test duplicate options post-merge appear only once in completions

### Property-Based Tests

Each correctness property should be implemented as a property-based test using fast-check:

- **Property 1-7**: Parser creates correct AST structure
  - Generate random syntax commands
  - Parse and verify SyntaxNode creation
  - Verify signature extraction

- **Property 8-13**: Option parsing correctness
  - Generate random option specifications
  - Verify parsing and abbreviation computation

- **Property 14-20**: Provider functionality
  - Generate random signatures and program calls
  - Verify completion and hover behavior

- **Property 21-25**: Pattern handling and error recovery
  - Generate random syntax patterns
  - Verify correct parsing and error recovery

- **Property 26-34**: Analyzer and scoping
  - Generate random programs with syntax commands
  - Verify implicit local registration and scoping
  - Verify merge of multiple syntax commands preserves last definitions and widens abbreviations when needed

**Test Configuration**:
- Minimum 100 iterations per property test
- Each test tagged with property number and requirements reference
- Tag format: `Feature: syntax-command-parsing, Property N: [property text]`

### Integration Tests

- **Cross-file navigation**: Verify completion and hover work across files
- **Real-world patterns**: Test with actual Stata code patterns
- **Performance**: Verify parse time increase < 5%
- **Delimiter coverage**: Integration cases mixing `#delimit ;` and continued lines

## Performance Considerations

1. **Lazy Signature Extraction**: Extract signatures only when needed (on first access)
2. **Caching**: Cache computed abbreviations and signatures
3. **Incremental Analysis**: Re-analyze only affected programs on document change
4. **Bounded Parsing**: Limit syntax command parsing to program bodies
5. **Measurement Plan**: Benchmark parse + analysis on the current corpus; set baseline, enforce ≤5% regression. Automate in CI with threshold alerting. Include cache invalidation cost in the timing budget.

## Examples (non-exhaustive)

- Delimiter-aware, continued line: `#delimit ;` then `syntax varlist [if] [in] , opt(real default(1)) ;`
- File-based pattern: `syntax [varlist] using \"my data.dta\" [, replace*]`
- Generate-style: `syntax newvarname = exp`

## Future Extensions

1. **Syntax Validation**: Validate syntax against Stata grammar specification
2. **Signature Inference**: Infer signatures from program calls if not explicitly declared
3. **Cross-File Signatures**: Index signatures across workspace for better completion
4. **Signature Documentation**: Extract documentation from comments above syntax commands
