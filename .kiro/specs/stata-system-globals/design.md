# Design Document: Stata System-Defined Global Macros

## Overview

This design addresses the false positive warnings for Stata system-defined global macros. The solution adds a constant set of known system global macro names to the analyzer and checks this set in the `is_macro_defined` function before reporting undefined global macro warnings.

Stata has a set of system-defined global macros that are automatically set at runtime. These legacy macros have been replaced by `c()` class results but are still widely used for backward compatibility. The LSP should recognize these macros and not flag them as undefined.

## Architecture

The solution follows the existing pattern used for positional arguments (`is_positional_argument`):

```
┌─────────────────────────────────────────────────────────────┐
│ Analyzer (src/analyzer/index.ts)                            │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ STATA_SYSTEM_GLOBALS: Set<string>                   │   │
│  │ - Contains all known system global macro names      │   │
│  │ - Case-sensitive (Stata is case-sensitive)          │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                              │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ is_system_global(name: string): boolean             │   │
│  │ - Checks if name is in STATA_SYSTEM_GLOBALS         │   │
│  │ - O(1) lookup via Set                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                              │
│                              ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ is_macro_defined(name, scope, ...)                  │   │
│  │ - For global scope: check is_system_global first    │   │
│  │ - Return true if system global                      │   │
│  │ - Otherwise continue with existing logic            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. System Globals Constant

A new exported constant set containing all known Stata system-defined global macro names:

```typescript
/**
 * Stata system-defined global macros.
 * These are automatically set by Stata at runtime and should never
 * be flagged as undefined. Case-sensitive (Stata is case-sensitive).
 * 
 * Reference: Stata documentation on system macros
 * Note: These are legacy macros replaced by c() class results but
 * still widely used for backward compatibility.
 */
export const STATA_SYSTEM_GLOBALS = new Set<string>([
    // Date and time
    'S_DATE',      // Current date (format: "dd Mon yyyy")
    'S_TIME',      // Current time (format: "hh:mm:ss")
    
    // File information
    'S_FN',        // Current filename (name of file in memory)
    'S_FNDATE',    // Date/time when current file was last saved
    
    // System information
    'S_ADO',       // ado-path
    'S_FLAVOR',    // Stata flavor (Small, IC, SE, MP)
    'S_OS',        // Operating system
    'S_MACH',      // Machine type
    'S_OSDTL',     // OS details
    'S_LEVEL',     // Confidence level (default 95)
    
    // Edition indicators
    'S_StataSE',   // Stata SE edition indicator
    'S_StataMP',   // Stata MP edition indicator
    'S_StataIC',   // Stata IC edition indicator
    
    // Mode indicators
    'S_CONSOLE',   // Console mode indicator
    'S_MODE',      // Stata mode
]);
```

### 2. System Global Check Function

A new private method in the `SemanticAnalyzer` class:

```typescript
/**
 * Check if a macro name is a Stata system-defined global macro.
 * System globals are automatically set by Stata at runtime.
 * 
 * @param name - The macro name to check (without $ prefix)
 * @returns true if the name is a known system global
 */
private is_system_global(name: string): boolean {
    return STATA_SYSTEM_GLOBALS.has(name);
}
```

### 3. Modified is_macro_defined Function

The existing `is_macro_defined` function will be modified to check for system globals as a **fallback** after checking user-defined globals. This is more efficient because:
- User-defined globals are far more common than system globals
- System globals are rarely used (legacy macros replaced by `c()` class)
- The check only happens when a global is NOT found in the symbol table

```typescript
private is_macro_defined(
    name: string,
    scope: 'local' | 'global',
    symbols: SymbolTable,
    reference_index?: number,
    reference_line?: number
): boolean {
    if (scope === 'local') {
        // Existing local macro logic (unchanged)
        // ...
    } else {
        // Existing global macro logic (unchanged)
        // Check declared globals from @lsp-global directive
        // Check global macros in symbol table
        // ...
        
        // NEW: Check for system-defined global macros as FALLBACK
        // Only reached if not found in symbol table or directives
        if (this.is_system_global(name)) {
            return true;
        }
    }
    return false;
}
```

## Data Models

### STATA_SYSTEM_GLOBALS

- Type: `Set<string>`
- Location: `src/analyzer/index.ts` (module-level constant)
- Exported: Yes (for use by hover provider and tests)
- Contents: All known Stata system-defined global macro names

### No Changes to Existing Types

The existing `MacroSymbol`, `SymbolTable`, and `AnalyzerConfig` types remain unchanged.



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: System Globals Never Flagged as Undefined

*For any* Stata code containing a reference to a system-defined global macro (from the `STATA_SYSTEM_GLOBALS` set), the analyzer shall NOT produce an undefined global macro diagnostic for that reference.

**Validates: Requirements 1.1, 1.2**

### Property 2: Case-Sensitive System Global Matching

*For any* system global macro name, when referenced with incorrect case (e.g., `$s_date` instead of `$S_DATE`), the analyzer SHALL produce an undefined global macro warning.

**Validates: Requirements 1.3**

### Property 3: Non-System Globals Still Flagged

*For any* global macro name that is NOT in the `STATA_SYSTEM_GLOBALS` set and is not defined in the code, the analyzer SHALL produce an undefined global macro warning.

**Validates: Requirements 2.1, 2.2**

### Property 4: System Global Set Completeness

*For any* macro name in the `STATA_SYSTEM_GLOBALS` set, the `is_system_global` function shall return true, and for any macro name NOT in the set, it shall return false.

**Validates: Requirements 4.1**

## Error Handling

### Unknown System Globals

If Stata introduces new system globals in future versions:
- The LSP will flag them as undefined until the `STATA_SYSTEM_GLOBALS` set is updated
- Users can use `@lsp-global` directive as a workaround
- The set should be updated in future LSP releases

### Case Sensitivity

Stata is case-sensitive, so:
- `$S_DATE` is recognized as a system global
- `$s_date` is NOT recognized and will be flagged as undefined
- This matches Stata's actual behavior

### Empty or Invalid Macro Names

- Empty macro names are handled by existing validation
- Invalid characters in macro names are handled by the lexer/parser

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **All system globals recognized**: Test each macro in `STATA_SYSTEM_GLOBALS` is not flagged
2. **Case sensitivity**: Test that lowercase variants ARE flagged
3. **Non-system globals flagged**: Test that `$S_CUSTOM` and similar are flagged
4. **Integration with existing checks**: Test that user-defined globals still work
5. **Export verification**: Test that `STATA_SYSTEM_GLOBALS` is exported

### Property-Based Tests

Property-based tests use fast-check to verify universal properties:

1. **Property 1**: Generate code with random system global references, verify no diagnostics
2. **Property 2**: Generate lowercase variants of system globals, verify diagnostics produced
3. **Property 3**: Generate random non-system global names, verify diagnostics produced
4. **Property 4**: Test `is_system_global` function with random inputs

### Test Configuration

- Property tests: minimum 100 iterations per property
- Use fast-check for property-based testing
- Tag format: `Feature: stata-system-globals, Property N: {property_text}`

## Implementation Notes

### Placement of STATA_SYSTEM_GLOBALS

The constant should be placed near the top of `src/analyzer/index.ts`, after imports and before the `SemanticAnalyzer` class definition. This follows the pattern of other module-level constants.

### is_system_global Method

The method should be placed near `is_positional_argument` in the `SemanticAnalyzer` class to maintain logical grouping of similar helper methods.

### Modification to is_macro_defined

The system global check should be the LAST check in the global scope branch, as a fallback after checking declared globals and the symbol table. This is more efficient because:
- User-defined globals are far more common than system globals
- System globals are legacy macros rarely used in modern code
- The O(1) Set lookup only happens when a global is not found elsewhere

### Future Extensibility

The `STATA_SYSTEM_GLOBALS` set can be easily extended by adding new entries. Consider adding a comment with a reference to Stata documentation for maintainability.
