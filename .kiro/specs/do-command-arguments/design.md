# Design Document: Do Command Arguments Parsing

## Overview

This design addresses the incorrect parsing of `do`, `run`, and `include` commands when they include arguments passed to the callee script. The fix is localized to the `detect_forward_call` method in the Analyzer, which currently concatenates all varlist items into a single path string instead of using only the first item.

## Architecture

The fix requires a minimal change to the Analyzer component. The Parser already correctly separates the file path from arguments in the varlist - the issue is in how the Analyzer consumes this data.

```
Source Code → Lexer → Parser → Analyzer → Forward Scope Resolver
                         ↓           ↓
                    varlist[]    forward_calls[]
                    [path,       [path only]
                     arg1,
                     arg2]
```

## Components and Interfaces

### Affected Component: Analyzer (`src/analyzer/index.ts`)

The `detect_forward_call` method needs modification to extract only the first varlist item as the file path.

**Current behavior (incorrect):**
```typescript
// Concatenates ALL varlist items into raw_path
for (const my_item of node.varlist) {
    raw_path += my_item.name;
}
// Result for `do "wfs/survey.do" Cameroon 1978`:
// raw_path = '"wfs/survey.do"Cameroon1978'
```

**New behavior (correct):**
```typescript
// Use only the FIRST varlist item as the file path
const first_item = node.varlist[0];
let raw_path = first_item.name;

// Check for macro references in the path only
let has_macro = raw_path.includes('`') || raw_path.includes('$');
// Result for `do "wfs/survey.do" Cameroon 1978`:
// raw_path = '"wfs/survey.do"'
```

### Unchanged Components

- **Parser**: Already correctly parses file path and arguments into separate varlist items
- **Forward Scope Resolver**: Will receive correct paths from Analyzer
- **Lexer**: No changes needed

## Data Models

No changes to data models. The existing `ForwardCall` interface already has the correct structure:

```typescript
interface ForwardCall {
    type: 'do' | 'run' | 'include';
    path: string;           // Resolved file path (first varlist item only)
    raw_path: string;       // Original path from source (first varlist item only)
    call_site_line: number;
    range: Range;
    source: 'command' | 'directive';
    is_static: boolean;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system - essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: File Path Extraction Correctness

*For any* `do`, `run`, or `include` command with a file path followed by zero or more arguments, the Analyzer SHALL extract only the first varlist item as the file path, regardless of whether the path is quoted or unquoted.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3**

### Property 2: Forward Scope Resolution Path Accuracy

*For any* forward call command with arguments, the Forward Scope Resolver SHALL attempt to resolve only the file path (first argument), not the concatenation of all arguments.

**Validates: Requirements 3.1, 3.2**

### Property 3: Diagnostic Path Accuracy

*For any* forward call command where the file path cannot be resolved, the diagnostic message SHALL contain only the file path portion, not the script arguments.

**Validates: Requirements 4.1, 4.2**

## Error Handling

- If the first varlist item is empty or missing, the forward call detection should return early (existing behavior)
- If the file path contains macro references, mark `is_static` as false (existing behavior, now applied only to the path)
- If the file path cannot be resolved, generate a diagnostic with only the path in the message

## Testing Strategy

### Property-Based Tests

Use fast-check to generate random combinations of:
- File commands: `do`, `run`, `include`
- Path formats: quoted (double/single), unquoted
- Number of arguments: 0 to 5
- Argument types: words, numbers, quoted strings

Each property test should run minimum 100 iterations.

### Unit Tests

1. **Quoted path with arguments**: `do "wfs/survey.do" Cameroon 1978`
2. **Unquoted path with arguments**: `do survey.do Cameroon 1978`
3. **Path with spaces**: `do "path with spaces/file.do" arg1`
4. **Single-quoted path**: `do 'survey.do' arg1 arg2`
5. **No arguments**: `do survey.do` (regression test)
6. **Path with macro**: `do "`path'" arg1` (should mark as non-static)

### Integration Tests

Test with the actual `fertility_surveys/wfs/loop.do` file to verify:
- Forward scope resolution works correctly
- No false positive diagnostics for the file path
- Arguments are not included in resolved paths
