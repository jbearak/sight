# Design Document: LSP Declaration Directives

## Overview

This feature extends the directive parser to recognize five new declaration directives (`@lsp-local`, `@lsp-global`, `@lsp-scalar`, `@lsp-matrix`, `@lsp-program`) that allow users to explicitly declare symbols to the LSP. These directives suppress false-positive "undefined" warnings for symbols that are defined dynamically or in ways the LSP cannot detect.

The implementation integrates with the existing directive parsing infrastructure and analyzer to register declared symbols in the symbol table.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Source File                               │
│  // @lsp-local myvar                                            │
│  // @lsp-global config                                          │
│  display `myvar'                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Directive Parser                              │
│  - Parses @lsp-local, @lsp-global, @lsp-scalar, @lsp-matrix,   │
│    @lsp-program directives                                      │
│  - Validates single-argument constraint                         │
│  - Returns DeclarationDirective objects + diagnostics           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Analyzer                                    │
│  - Registers declared symbols in SymbolTable                    │
│  - Marks symbols with source: 'directive'                       │
│  - Symbols suppress undefined warnings                          │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### DeclarationDirective Interface

New interface to represent parsed declaration directives:

```typescript
interface DeclarationDirective {
    type: 'local' | 'global' | 'scalar' | 'matrix' | 'program';
    name: string;
    range: Range;
}
```

### Extended DirectiveParseResult

The existing `DirectiveParseResult` will be extended to include declaration directives:

```typescript
interface DirectiveParseResult {
    directives: Directive[];                    // Existing cross-file directives
    declaration_directives: DeclarationDirective[];  // New declaration directives
    diagnostics: DirectiveDiagnostic[];
}
```

### DirectiveParser Extensions

The `DirectiveParser` class will be extended with:

1. New regex pattern for declaration directives
2. Method to parse declaration directives from any comment line in the file
3. Validation for single-argument constraint

```typescript
// Pattern to match declaration directives
const DECLARATION_DIRECTIVE_PATTERN = 
    /@lsp-(local|global|scalar|matrix|program)\s+(\S+)(?:\s+(.*))?$/;

class DirectiveParser {
    // Existing methods...
    
    /**
     * Parse declaration directives from entire file content.
     * Unlike cross-file directives, these can appear anywhere.
     */
    parse_declaration_directives(
        content: string, 
        file_uri: string
    ): { declarations: DeclarationDirective[]; diagnostics: DirectiveDiagnostic[] };
}
```

### Analyzer Integration

The analyzer's `extract_comment_directives_from_tokens` method will be extended to:

1. Parse declaration directives from comment tokens
2. Register declared symbols in the symbol table with appropriate metadata

```typescript
// In AnalyzerConfig
interface AnalyzerConfig {
    // Existing fields...
    declared_locals: Map<string, { line: number }>;
    declared_globals: Map<string, { line: number }>;
    declared_scalars: Map<string, { line: number }>;
    declared_matrices: Map<string, { line: number }>;
    declared_programs: Map<string, { line: number }>;
}
```

## Data Models

### Symbol Registration

Declared symbols are registered with `source: 'directive'` to distinguish them from code-detected symbols:

```typescript
// For @lsp-local and @lsp-global
const macro_symbol: MacroSymbol = {
    name: directive.name,
    scope: directive.type === 'local' ? 'local' : 'global',
    location: { uri: file_uri, range: directive.range },
    sourceUri: file_uri,
    containingScope: 'dofile',
    definition_line: directive.range.start.line,
};

// For @lsp-scalar
const scalar_symbol: ScalarSymbol = {
    name: directive.name,
    location: { uri: file_uri, range: directive.range },
    sourceUri: file_uri,
    definition_line: directive.range.start.line,
};

// For @lsp-matrix
const matrix_symbol: MatrixSymbol = {
    name: directive.name,
    location: { uri: file_uri, range: directive.range },
    sourceUri: file_uri,
    definition_line: directive.range.start.line,
};

// For @lsp-program
const program_symbol: ProgramSymbol = {
    name: directive.name,
    location: { uri: file_uri, range: directive.range },
    sourceUri: file_uri,
};
```

### VariableSymbol Source Extension

The `VariableSymbol.source` type already includes `'directive'` as a valid value, which will be used for consistency.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Directive Parsing Correctness

*For any* valid directive type (`local`, `global`, `scalar`, `matrix`, `program`) and any valid Stata identifier, when the directive `@lsp-{type} {name}` appears in a comment line, the parser SHALL produce a `DeclarationDirective` with the correct type and extracted name.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7**

### Property 2: Comment Style Invariance

*For any* valid declaration directive content, parsing the directive in a `*` comment style SHALL produce the same `DeclarationDirective` as parsing it in a `//` comment style.

**Validates: Requirements 1.6**

### Property 3: Single Argument Acceptance

*For any* valid Stata identifier with optional trailing whitespace, a declaration directive containing only that identifier SHALL be accepted without producing a diagnostic warning.

**Validates: Requirements 2.1, 2.3**

### Property 4: Multiple Argument Warning

*For any* declaration directive containing two or more space-separated tokens after the directive keyword, the parser SHALL produce a warning diagnostic.

**Validates: Requirements 2.2**

### Property 5: Symbol Registration Correctness

*For any* parsed declaration directive, the analyzer SHALL register the symbol in the appropriate symbol table map (`localMacros` for `@lsp-local`, `globalMacros` for `@lsp-global`, `scalars` for `@lsp-scalar`, `matrices` for `@lsp-matrix`, `programs` for `@lsp-program`) with the location referencing the directive's line.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

### Property 6: Warning Suppression for Declared Macros

*For any* local or global macro declared via `@lsp-local` or `@lsp-global`, references to that macro appearing after the directive line SHALL NOT produce undefined macro warnings.

**Validates: Requirements 4.1, 4.2**

### Property 7: Forward-Only Effect

*For any* declaration directive at line N, references to the declared symbol at lines < N SHALL still produce undefined warnings (if applicable), while references at lines >= N SHALL NOT produce warnings.

**Validates: Requirements 5.3**

## Error Handling

### Invalid Directive Syntax

When a declaration directive is malformed, the parser produces a warning diagnostic:

1. **Missing argument**: `// @lsp-local` → Warning: "Declaration directive requires exactly one argument"
2. **Multiple arguments**: `// @lsp-local apple berry` → Warning: "Declaration directive accepts exactly one argument; found multiple tokens"
3. **Invalid directive type**: `// @lsp-foo bar` → Ignored (not a recognized directive)

### Duplicate Declarations

If the same symbol is declared multiple times:
- First declaration wins for `definition_line` tracking
- No warning is produced (consistent with existing macro behavior)

### Case Sensitivity

- Macro names (`@lsp-local`, `@lsp-global`) are case-sensitive (consistent with Stata)
- Program names (`@lsp-program`) are normalized to lowercase for lookup (consistent with Stata)
- Scalar and matrix names are case-sensitive

## Testing Strategy

### Unit Tests

Unit tests will verify:
- Directive pattern matching for all five directive types
- Single argument extraction
- Multiple argument detection and warning generation
- Missing argument detection
- Comment style handling (`*` vs `//`)
- Symbol registration in correct symbol table maps

### Property-Based Tests

Property-based tests will use fast-check to verify:
- **Property 1**: Generate random directive types and valid identifiers, verify correct parsing
- **Property 2**: Generate directives, wrap in both comment styles, verify equivalent results
- **Property 3**: Generate single identifiers with varying trailing whitespace, verify no warnings
- **Property 4**: Generate multiple-token arguments, verify warning production
- **Property 5**: Generate directives, verify symbol appears in correct map with correct location
- **Property 6**: Generate code with directive + macro reference, verify no undefined warning
- **Property 7**: Generate code with reference before and after directive, verify correct warning behavior

### Test Configuration

- Minimum 100 iterations per property test
- Tests tagged with: **Feature: lsp-declare-symbols, Property N: {property_text}**

