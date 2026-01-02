# Design Document: Syntax Command Simplification

## Overview

This design eliminates the buggy syntax command diagnostic feature to reach an MVP faster. The current implementation produces false positive warnings for valid Stata syntax commands. The fix removes all diagnostic emissions from syntax command parsing while preserving the core option extraction functionality for completions.

The changes are minimal and surgical:
1. Remove all `addError()` calls from `parseSyntaxCommand()` in the parser
2. Remove validation method calls from the analyzer

## Architecture

The existing architecture remains unchanged. The modification is purely about removing diagnostic emissions:

```
Source Code → Lexer → Parser → Analyzer → Providers → LSP Response
                        ↓           ↓
                   (no diagnostics) (no diagnostics)
```

## Components and Interfaces

### Component 1: Parser (`src/parser/index.ts`)

**Current Behavior**: The `parseSyntaxCommand()` method emits three types of diagnostics:
1. Warning when syntax appears outside a program block
2. Error for unknown argument types
3. Warning for duplicate option names

**New Behavior**: Remove all `addError()` calls from syntax command parsing. The parser will:
- Parse syntax commands silently in all contexts
- Skip unrecognized tokens without emitting diagnostics
- Extract options on a best-effort basis

**Changes Required**:
- Remove the `addError()` call for "syntax command should only appear inside program define"
- Remove the `addError()` call for "Unknown argument type: X"
- Remove the `addError()` calls for "Duplicate option: X"

**Preserved Functionality**:
- `SyntaxNode` creation with `ProgramSignature`
- Option extraction with names
- Arbitrary options marker (`*`) handling

### Component 2: Analyzer (`src/analyzer/index.ts`)

**Current Behavior**: The `analyze_syntax_node()` method calls validation methods.

**New Behavior**: Remove validation method calls entirely.

**Changes Required**:
- Remove calls to `validate_argument_type()`
- Remove calls to `validate_option_argument_type()`
- Keep `register_implicit_locals()` call

**Preserved Functionality**:
- `register_implicit_locals()` continues to work
- Symbol table population for syntax-defined macros
- Signature attachment to `ProgramNode`

## Data Models

No changes to data models. The existing types remain unchanged.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: No Syntax Command Diagnostics

*For any* syntax command (inside or outside a program block, with any combination of argument types and option patterns), the parser SHALL NOT emit any diagnostics.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: Option Extraction Preserved

*For any* syntax command containing options, option names SHALL be extracted and available in the resulting `ProgramSignature`.

**Validates: Requirements 2.1, 2.3, 2.4**

### Property 3: Implicit Local Registration Preserved

*For any* syntax command processed by the analyzer, implicit local macros SHALL be registered in the symbol table.

**Validates: Requirements 3.1, 3.2**

## Error Handling

The parser will silently skip unrecognized tokens and continue parsing. No exceptions will be thrown for malformed input.

## Testing Strategy

### Unit Tests

Unit tests will verify:
- Parser produces `SyntaxNode` without diagnostics
- Options are extracted
- Analyzer doesn't emit syntax-related diagnostics
- Implicit locals are registered

### Property-Based Tests

Property-based tests will use fast-check to verify:
- **Property 1**: Generate random syntax commands and verify zero diagnostics
- **Property 2**: Generate syntax commands with options and verify extraction
- **Property 3**: Generate syntax commands and verify implicit local registration

**Test Configuration**:
- Minimum 100 iterations per property test
- Tag format: **Feature: syntax-command-simplification, Property N: description**
