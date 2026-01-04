# Design Document: Block Start Indentation Diagnostic

## Overview

This feature enhances the Stata LSP's indentation analysis to detect and fix two related issues:

1. **Unnecessary indentation at top level**: Any statement at depth 0 with leading whitespace should be diagnosed as unnecessarily indented.
2. **Mixed indentation normalization**: The formatter should normalize mixed indentation (space + tab combinations) to the correct indentation based on configuration.

The implementation extends the existing `IndentationDiagnosticAnalyzer` and `SourcePreservingFormatter` components to provide comprehensive indentation validation and correction.

## Architecture

The feature builds on the existing indentation infrastructure:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Document Processing                          │
├─────────────────────────────────────────────────────────────────┤
│  Source Code → Lexer → Parser → AST → IndentationAnalyzer       │
│                                         ↓                       │
│                              IndentationDiagnosticAnalyzer      │
│                                         ↓                       │
│                              Diagnostics (UNNECESSARY/MISSING)  │
├─────────────────────────────────────────────────────────────────┤
│                    Formatting Pipeline                          │
├─────────────────────────────────────────────────────────────────┤
│  AST + Tokens → IndentationAnalyzer → TokenReconstructor        │
│                                              ↓                  │
│                                    Formatted Source             │
└─────────────────────────────────────────────────────────────────┘
```

### Design Decisions

1. **Depth-based analysis**: Use the AST to compute expected indentation depth for each line, then compare against actual indentation. This leverages the existing `IndentationAnalyzer` infrastructure.

2. **Unified diagnostic approach**: Both unnecessary and missing indentation use the same depth computation, ensuring consistency between diagnostics and formatter.

3. **Exclusion rules**: Blank lines, comment-only lines, and continuation lines are excluded from unnecessary indentation checks to avoid false positives.

4. **Mixed indentation handling**: The formatter normalizes all leading whitespace to the configured style (spaces or tabs), regardless of the original mix.

## Components and Interfaces

### IndentationDiagnosticAnalyzer (Enhanced)

The existing `IndentationDiagnosticAnalyzer` class in `src/providers/indentation-diagnostics.ts` will be enhanced with new methods:

```typescript
export class IndentationDiagnosticAnalyzer {
    // Existing methods...
    
    /**
     * Analyze all lines for indentation issues, including:
     * - Unnecessary indentation at top level (depth 0)
     * - Unnecessary indentation (over-indented) inside blocks
     * - Missing indentation (under-indented) inside blocks
     */
    analyze(document: DocumentState, config: StataLSPConfig): Diagnostic[];
    
    /**
     * NEW: Find lines with unnecessary indentation at any depth.
     * A line has unnecessary indentation if its actual indentation
     * exceeds the expected indentation for its depth.
     */
    private find_unnecessary_indentation_issues(
        document: DocumentState,
        lines: string[],
        range: { start: number; end: number },
        block_comment_lines: Set<number>,
        indent_size: number
    ): Diagnostic[];
    
    /**
     * NEW: Compute expected indentation depth for each line using AST.
     * Returns a Map from line number to expected depth.
     */
    private compute_expected_depths(
        document: DocumentState,
        range: { start: number; end: number }
    ): Map<number, number>;
    
    /**
     * NEW: Check if a line should be excluded from unnecessary indentation checks.
     * Excludes: blank lines, comment-only lines, continuation lines.
     */
    private should_skip_unnecessary_check(
        line: string,
        lineIndex: number,
        lines: string[],
        block_comment_lines: Set<number>
    ): boolean;
}
```

### IndentationAnalyzer (Existing)

The existing `IndentationAnalyzer` in `src/formatter/indentation-analyzer.ts` already computes expected indentation levels from the AST. The diagnostic analyzer will reuse this logic.

### TokenReconstructor (Enhanced)

The existing `TokenReconstructor` in `src/formatter/token-reconstructor.ts` handles indentation application. It already supports:
- Converting tabs to spaces when `indent_style: 'spaces'`
- Generating correct indentation from indent levels

Enhancement needed: Ensure mixed indentation (space + tab) at line start is fully replaced, not just adjusted.

```typescript
export class TokenReconstructor {
    // Existing methods...
    
    /**
     * ENHANCED: At line start, always generate fresh indentation
     * from the computed indent level, replacing any mixed indentation.
     */
    reconstruct(
        tokens: Token[],
        line_indents: Map<number, number | IndentationInfo>,
        config: FormatterConfig,
        original_source: string
    ): string;
}
```

## Data Models

### Diagnostic Codes (Existing)

```typescript
export enum StataDiagnosticCode {
    // ... existing codes ...
    UNNECESSARY_INDENTATION = 5001,
    MISSING_INDENTATION = 5002,
}
```

### IndentationInfo (Existing)

```typescript
export interface IndentationInfo {
    line: number;
    indent_level: number;
    is_continuation: boolean;
    is_block_start: boolean;
    is_block_end: boolean;
    preserve_whitespace: boolean;
    indent_delta: number;
    original_indent: number;
}
```

### Expected Depth Map (New Internal Structure)

```typescript
// Internal to IndentationDiagnosticAnalyzer
type ExpectedDepthMap = Map<number, number>;  // line number → expected depth
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Top-level unnecessary indentation detection

*For any* Stata source code where a non-excluded statement at depth 0 has leading whitespace, the `IndentationDiagnosticAnalyzer` SHALL emit an `UNNECESSARY_INDENTATION` diagnostic for that line.

**Validates: Requirements 1.1, 2.1**

### Property 2: Correct indentation produces no unnecessary diagnostic

*For any* Stata source code where statements inside blocks have exactly the expected indentation for their depth, the `IndentationDiagnosticAnalyzer` SHALL NOT emit an `UNNECESSARY_INDENTATION` diagnostic for those lines.

**Validates: Requirements 1.2**

### Property 3: Under-indentation produces missing diagnostic

*For any* Stata source code where a statement inside a brace block has less indentation than expected for its depth, the `IndentationDiagnosticAnalyzer` SHALL emit a `MISSING_INDENTATION` diagnostic for that line.

**Validates: Requirements 1.3**

### Property 4: Over-indentation produces unnecessary diagnostic

*For any* Stata source code where a statement inside a block has more indentation than expected for its depth, the `IndentationDiagnosticAnalyzer` SHALL emit an `UNNECESSARY_INDENTATION` diagnostic for that line.

**Validates: Requirements 2.2**

### Property 5: Excluded lines produce no unnecessary diagnostic

*For any* blank line, comment-only line, or continuation line (following `///`), regardless of its indentation, the `IndentationDiagnosticAnalyzer` SHALL NOT emit an `UNNECESSARY_INDENTATION` diagnostic.

**Validates: Requirements 2.3, 2.4**

### Property 6: Formatter normalizes indentation to configured style

*For any* Stata source code with mixed indentation (spaces and tabs), after formatting:
- If configured for spaces: all leading whitespace SHALL be spaces only
- If configured for tabs: all leading whitespace SHALL be tabs only

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 7: Formatter preserves non-whitespace content

*For any* Stata source code, after formatting, the non-whitespace content of each line SHALL be identical to the original.

**Validates: Requirements 3.4**

### Property 8: Formatting eliminates all indentation diagnostics (Round-trip)

*For any* Stata source code, after running the formatter, re-analyzing the formatted code SHALL produce zero indentation diagnostics (`UNNECESSARY_INDENTATION` or `MISSING_INDENTATION`).

**Validates: Requirements 4.1, 4.2, 4.3**

## Error Handling

### Invalid Input Handling

- **Empty documents**: Return empty diagnostic array, no errors.
- **Documents with only comments/whitespace**: Skip all lines per exclusion rules.
- **Malformed AST**: Fall back to line-by-line analysis without depth information; emit warnings but don't crash.

### Edge Cases

- **Continuation lines spanning multiple lines**: Track continuation state across lines; all continuation lines inherit the base statement's expected depth + 1.
- **Nested blocks with mixed styles**: Each nesting level adds one indent unit; mixed styles within a line are normalized.
- **Block comments**: Lines inside block comments are excluded from all indentation checks.
- **Embedded language blocks (Mata/Python)**: Excluded from Stata indentation analysis via existing `getStataRanges()` filtering.

## Testing Strategy

### Unit Tests

Unit tests will verify specific examples and edge cases:

1. **Top-level indentation**: Verify diagnostic for indented top-level statements
2. **Nested block indentation**: Verify correct depth calculation for nested blocks
3. **Exclusion rules**: Verify blank lines, comments, and continuations are skipped
4. **Mixed indentation**: Verify formatter normalizes space+tab combinations
5. **Configuration respect**: Verify spaces vs tabs config is honored

### Property-Based Tests

Property tests will use fast-check to verify universal properties:

- **Library**: fast-check
- **Minimum iterations**: 100 per property
- **Tag format**: `Feature: block-start-indentation-diagnostic, Property N: <property_text>`

Each correctness property (1-8) will have a corresponding property-based test that generates random Stata code structures and verifies the property holds.

### Integration Tests

Integration tests will verify end-to-end behavior:

1. **Diagnostic-formatter consistency**: Diagnostics point to issues that formatter fixes
2. **Round-trip stability**: Formatted code produces no indentation diagnostics
3. **Real-world code samples**: Test against representative Stata code patterns
