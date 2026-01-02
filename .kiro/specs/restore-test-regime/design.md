# Design Document: Restore Test Regime

## Overview

This design addresses the restoration of tests that were removed or altered during the embedded language detection feature development. The changes involve restoring parser error handling tests, enabling skipped document symbol tests, fixing test infrastructure issues, and correcting TypeScript type errors.

## Architecture

The test restoration follows the existing test architecture:

```
tests/
├── unit/
│   └── parser.test.ts      # Add error handling tests
├── integration/
│   └── embedded-language-lsp.test.ts  # Fix skipped tests, type errors
└── property/
    └── (no changes needed)
```

## Components and Interfaces

### Parser Error Handling Tests

The parser tests need an "error handling" describe block restored with tests for:
- Missing `end` statement in program blocks
- Missing closing brace in if/loop blocks

```typescript
describe('error handling', () => {
    test('should handle missing program end', () => {
        const source = `program define myprog
            display "Hello"`;
        const lexResult = lexer.tokenize(source);
        const parseResult = parser.parse(lexResult.tokens);
        
        expect(parseResult.errors.length).toBeGreaterThan(0);
        expect(parseResult.errors[0].message).toContain('Missing');
    });

    test('should handle missing closing brace', () => {
        const source = `if age > 18 {
            display "Adult"`;
        const lexResult = lexer.tokenize(source);
        const parseResult = parser.parse(lexResult.tokens);
        
        expect(parseResult.errors.length).toBeGreaterThan(0);
        expect(parseResult.errors[0].message).toContain('Missing closing brace');
    });
});
```

### Document Symbol Tests

The skipped tests need to be either:
1. Enabled if the functionality works
2. Removed with a TODO comment if functionality is incomplete

Current skipped tests:
- `should include mata blocks in document symbols`
- `should include python blocks in document symbols`

### Test Infrastructure Fixes

The `DEFAULT_CONFIG` constant needs proper literal types:

```typescript
const DEFAULT_CONFIG = {
    diagnostics: {
        enabled: true,
        severity: {
            undefinedMacro: 'warning' as const,
            undefinedVariable: 'information' as const,
            styleWarnings: 'hint' as const,
        },
        undefinedVariableEnabled: false,
    },
    // ...
} as const;
```

Unused imports need to be removed:
- `afterAll`
- `ContextTracker`
- `URI`
- `Position`

## Data Models

No new data models are required. This is a test restoration effort.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Parser Error Detection for Malformed Inputs

*For any* malformed Stata source code (missing end statements, unclosed braces, etc.), the parser SHALL return a non-empty errors array with descriptive error messages.

**Validates: Requirements 1.1, 1.2, 1.4**

This property ensures the parser correctly identifies and reports syntax errors rather than silently accepting malformed input.

## Error Handling

### Parser Error Messages

The parser should produce clear, actionable error messages:
- For missing `end`: Message should indicate which construct is unclosed
- For missing braces: Message should indicate the location of the opening brace

### Test Infrastructure Errors

The test suite should:
- Properly isolate tests that require LSP connections
- Mock connection dependencies to avoid runtime errors
- Clean up resources between tests

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Parser error handling tests** (restored)
   - Test missing `end` in program blocks
   - Test missing closing brace in if blocks
   - Test missing closing brace in loop blocks

2. **Document symbol tests** (enabled or documented)
   - Test mata blocks appear in symbols
   - Test python blocks appear in symbols

### Integration Tests

Integration tests verify cross-component behavior:

1. **LSP lifecycle tests** - Ensure proper mocking of connections
2. **Embedded language tests** - Verify context-aware behavior

### Property-Based Tests

Property-based tests verify universal properties:

1. **Parser error detection** - For all malformed inputs, errors should be reported

**Property Test Configuration:**
- Minimum 100 iterations per property test
- Tag format: **Feature: restore-test-regime, Property 1: Parser error detection**

### Test Infrastructure Requirements

1. Fix TypeScript type errors in `DEFAULT_CONFIG`
2. Remove unused imports
3. Ensure tests don't depend on real LSP connections
4. Verify `bun test` runs with 0 failures and 0 errors
