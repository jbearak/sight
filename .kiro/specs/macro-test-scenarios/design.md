# Design Document: Macro Test Scenarios

## Overview

This design adds specific test scenarios to verify macro completion and undefined macro diagnostic behavior. These are example-based unit tests that complement the property-based tests in the macro-case-sensitivity spec.

## Architecture

Tests will be added to existing test files:
- `tests/unit/completion.test.ts` - Macro completion scenarios
- `tests/unit/diagnostics-provider.test.ts` - Undefined macro diagnostic scenarios

```
tests/
├── unit/
│   ├── completion.test.ts          ← Add macro completion tests
│   └── diagnostics-provider.test.ts ← Add undefined macro tests
```

## Components and Interfaces

### Test Helpers

Use existing test utilities:
- `create_test_document()` - Creates a DocumentState from source code
- `CompletionProvider` - The completion provider under test
- `DiagnosticsProvider` - The diagnostics provider under test

### Completion Test Structure

```typescript
describe('Macro Completion', () => {
    describe('prefix filtering', () => {
        it('should suggest apple when typing `a after local apple sauce', () => {
            const content = 'local apple sauce\ndisplay `a';
            const doc = create_test_document(content);
            const position = { line: 1, character: 10 }; // After `a
            
            const completions = provider.get_completions(doc, position);
            
            expect(completions.map(c => c.label)).toContain('apple');
        });

        it('should suggest apple when typing `A (case-insensitive)', () => {
            const content = 'local apple sauce\ndisplay `A';
            const doc = create_test_document(content);
            const position = { line: 1, character: 10 };
            
            const completions = provider.get_completions(doc, position);
            
            expect(completions.map(c => c.label)).toContain('apple');
        });

        it('should suggest both apple and apricot when typing `ap', () => {
            const content = 'local apple sauce\nlocal apricot jam\ndisplay `ap';
            const doc = create_test_document(content);
            const position = { line: 2, character: 11 };
            
            const completions = provider.get_completions(doc, position);
            const labels = completions.map(c => c.label);
            
            expect(labels).toContain('apple');
            expect(labels).toContain('apricot');
        });
    });
});
```

### Diagnostic Test Structure

```typescript
describe('Undefined Macro Diagnostics', () => {
    describe('case sensitivity', () => {
        it('should warn when referencing Apple but only apple is defined', () => {
            const content = "local apple sauce\nlocal fruit `Apple'";
            const doc = create_test_document(content);
            
            const diagnostics = provider.get_diagnostics(doc, config);
            
            const undefined_macro = diagnostics.find(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            );
            expect(undefined_macro).toBeDefined();
            expect(undefined_macro?.message).toContain('Apple');
        });

        it('should NOT warn when referencing apple with correct case', () => {
            const content = "local apple sauce\nlocal fruit `apple'";
            const doc = create_test_document(content);
            
            const diagnostics = provider.get_diagnostics(doc, config);
            
            const undefined_macro = diagnostics.find(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO &&
                     d.message.includes('apple')
            );
            expect(undefined_macro).toBeUndefined();
        });

        it('should warn when referencing completely undefined macro', () => {
            const content = "local fruit `banana'";
            const doc = create_test_document(content);
            
            const diagnostics = provider.get_diagnostics(doc, config);
            
            const undefined_macro = diagnostics.find(
                d => d.code === StataDiagnosticCode.UNDEFINED_MACRO
            );
            expect(undefined_macro).toBeDefined();
            expect(undefined_macro?.message).toContain('banana');
        });
    });
});
```

## Data Models

No new data models. Uses existing test infrastructure.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

This spec focuses on example-based tests rather than property-based tests. The examples verify specific scenarios that users care about:

1. **Completion suggests defined macros** - Typing a prefix shows matching macros
2. **Completion is case-insensitive** - Typing `A` matches `apple`
3. **Diagnostics are case-sensitive** - `Apple` ≠ `apple` for undefined macro detection
4. **Diagnostic messages include the reference** - Message shows what was typed

These complement the property-based tests in the macro-case-sensitivity spec.

## Error Handling

Tests should handle:
- Empty document state
- Position at end of document
- Malformed macro syntax

## Testing Strategy

### Unit Tests

This spec IS the test strategy. The deliverable is a set of unit tests:

1. **Completion tests** in `tests/unit/completion.test.ts`:
   - `should suggest apple when typing \`a after local apple sauce`
   - `should suggest apple when typing \`A (case-insensitive)`
   - `should suggest both apple and apricot when typing \`ap`

2. **Diagnostic tests** in `tests/unit/diagnostics-provider.test.ts`:
   - `should warn when referencing Apple but only apple is defined`
   - `should NOT warn when referencing apple with correct case`
   - `should warn when referencing completely undefined macro`
   - `diagnostic message should include the macro name as written`

### Test Configuration

- Test framework: Jest (via Bun)
- Run with: `bun test`
