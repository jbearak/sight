# Design Document: Namelist Argument Type Support

## Overview

This design extends the Stata LSP's syntax command parsing to recognize the `namelist` argument type. The `namelist` type is a valid Stata syntax argument that creates a local macro containing a list of names. This is a targeted enhancement to the existing syntax command parsing feature.

The implementation requires changes to three locations:
1. Type definitions (`src/types/index.ts`) - Add `namelist` to the `ArgumentSpec.type` union
2. Parser (`src/parser/index.ts`) - Add `namelist` to the `standard_types` array
3. Analyzer (`src/analyzer/index.ts`) - Add `namelist` to the `valid_types` array

## Architecture

The change follows the existing LSP architecture pipeline. No new components are needed - we're extending existing type definitions and validation lists.

```
Source Code
    ↓
Lexer (unchanged)
    ↓
Parser (add 'namelist' to standard_types)
    ↓
Analyzer (add 'namelist' to valid_types, register implicit local)
    ↓
Providers (unchanged - implicit local suppresses diagnostics)
    ↓
LSP Response (no false "undefined macro" warning)
```

## Components and Interfaces

### 1. Type Definitions (src/types/index.ts)

Update the `ArgumentSpec.type` union to include `namelist`:

```typescript
export interface ArgumentSpec {
  type: 'varlist' | 'varname' | 'newvarname' | 'anything' | 'if' | 'in' | 'using' | 'exp' | 'name' | 'namelist';
  name?: string;
  isOptional: boolean;
  range: Range;
}
```

### 2. Parser Extension (src/parser/index.ts)

Update the `standard_types` array in `parse_argument_spec()`:

```typescript
const standard_types = [
  'varlist',
  'varname',
  'newvarname',
  'anything',
  'if',
  'in',
  'using',
  'name',
  'namelist',  // NEW
];
```

The parser already handles parenthesized constraints like `(min=1 max=1)` for other argument types. The `namelist` type will automatically benefit from this existing parsing logic.

### 3. Analyzer Extension (src/analyzer/index.ts)

Update the `valid_types` array in `validate_argument_type()`:

```typescript
private validate_argument_type(arg_type: string): void {
  const valid_types = [
    'varlist', 'varname', 'newvarname', 'anything', 'if', 'in', 'using', 'exp', 'name', 'namelist'
  ];
  // ...
}
```

The existing `register_implicit_locals()` method already handles registering argument types as implicit local macros via `get_implicit_local_name()`, which returns the argument type name. No changes needed there.

## Data Models

No new data models are required. The existing `ArgumentSpec` interface is extended with a new type value.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Namelist Argument Parsing

*For any* `syntax` command containing `namelist` (with or without constraints, in required or optional position), the parser should create an `ArgumentSpec` with type `namelist` and correct `isOptional` flag.

**Validates: Requirements 1.1, 1.3, 3.2**

### Property 2: Implicit Local Registration for Namelist

*For any* program containing a `syntax` command with `namelist`, the analyzer should register a local macro named `namelist` in the program scope's symbol table.

**Validates: Requirements 1.4, 3.1**

### Property 3: Diagnostic Suppression for Namelist References

*For any* program containing a `syntax` command with `namelist` followed by references to `` `namelist' ``, the analyzer should not emit "Undefined Macro" diagnostics for those references.

**Validates: Requirements 1.5**

## Error Handling

No new error handling is required. The existing error handling for unknown argument types will no longer trigger for `namelist` since it will be in the valid types list.

## Testing Strategy

### Unit Tests

- **Parser tests**: Verify `namelist` is parsed correctly in various positions
- **Analyzer tests**: Verify implicit local registration and diagnostic suppression

### Property-Based Tests

Each correctness property should be implemented as a property-based test:

- **Property 1**: Generate random syntax commands with `namelist` in various positions, verify parsing
- **Property 2**: Generate programs with `syntax namelist`, verify symbol table contains implicit local
- **Property 3**: Generate programs using `namelist` macro, verify no undefined macro diagnostics

**Test Configuration**:
- Minimum 100 iterations per property test
- Tag format: `Feature: namelist-argument-type, Property N: [property text]`

### Integration Tests

- Test with real-world Stata code patterns (like `aww_confirm_var.do`)
- Verify the specific case that triggered this issue is resolved

## Performance Considerations

No performance impact expected. This change adds a single string to two arrays that are checked during parsing/analysis.
