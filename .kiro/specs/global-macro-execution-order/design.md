# Design Document: Global Macro Execution Order

## Overview

This design addresses foundational issues in the Stata LSP's cross-file awareness system and simplifies the configuration model. The changes focus on three areas:

1. **Line Number Normalization**: Standardize on 0-indexed line numbers internally, converting to 1-indexed only for user-facing messages
2. **Diagnostic Message Consistency**: Ensure AST-based and token-based detection use identical message formats
3. **Automatic Call Site Inference**: Automatically detect `do`/`include` statements in parent files when directives don't specify explicit call sites
4. **Configuration Simplification**: Remove the `directives_required` setting entirely

## Architecture

The changes affect three main components:

```
┌─────────────────────────────────────────────────────────────────┐
│                      DiagnosticsProvider                        │
│  - Extracts symbol names from diagnostic messages               │
│  - Reports undefined/out-of-scope warnings                      │
│  - Converts 0-indexed lines to 1-indexed for display            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       ScopeResolver                             │
│  - Follows directive chains                                     │
│  - Filters symbols by call site (0-indexed internally)          │
│  - NEW: Infers call site from do/include statements             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DirectiveParser                            │
│  - Parses @lsp-done-by and @lsp-included-by                     │
│  - find_match_line returns 0-indexed (CHANGED)                  │
│  - NEW: infer_call_site_for_file method                         │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### DirectiveParser Changes

The `DirectiveParser` class gains a new method for automatic call site inference:

```typescript
interface DirectiveParser {
    // EXISTING - signature unchanged
    parse(content: string, file_uri: string): DirectiveParseResult;
    resolve_path(raw_path: string, containing_dir: string): string;
    
    // CHANGED: Returns 0-indexed line number (was 1-indexed)
    find_match_line(parent_content: string, match_string: string): number | undefined;
    
    // NEW: Infer call site by scanning for do/include statements
    infer_call_site_for_file(
        parent_content: string,
        child_filename: string
    ): number | undefined;
}
```

The `infer_call_site_for_file` method scans the parent file for statements like:
- `do "child.do"` or `do child.do` or `do child`
- `include "child.do"` or `include child.do` or `include child`
- `run "child.do"` (less common but valid)

It returns the 0-indexed line number of the first match, or `undefined` if no match is found.

### ScopeResolver Changes

The `ScopeResolver` class is updated to:
1. Use 0-indexed line numbers consistently
2. Call `infer_call_site_for_file` when no explicit call site is provided

```typescript
// In follow_directives method:
private follow_directives(
    directives: Directive[],
    current_uri: string,
    visited: Set<string>,
    chain: ScopeChainEntry[],
    diagnostics: DirectiveDiagnostic[],
    out_of_scope: OutOfScopeSymbol[],
    depth: number,
    config: ScopeResolverConfig
): void {
    // ... existing code ...
    
    // Resolve call site line (all values are now 0-indexed)
    let my_call_site_line: number;
    if (my_directive.call_site) {
        // Explicit call site provided
        if (my_directive.call_site.type === 'line') {
            // User-provided line numbers are 1-indexed, convert to 0-indexed
            my_call_site_line = (my_directive.call_site.value as number) - 1;
        } else {
            // match= parameter
            const my_match_line = this.directive_parser.find_match_line(
                my_parent_content,
                my_directive.call_site.value as string
            );
            // find_match_line now returns 0-indexed
            my_call_site_line = my_match_line ?? this.get_default_call_site(config);
        }
    } else {
        // NEW: Try to infer call site from do/include statements
        const current_filename = this.extract_filename(current_uri);
        const inferred_line = this.directive_parser.infer_call_site_for_file(
            my_parent_content,
            current_filename
        );
        
        if (inferred_line !== undefined) {
            my_call_site_line = inferred_line;
        } else {
            // Fall back to config default
            my_call_site_line = this.get_default_call_site(config);
        }
    }
    // ... rest of method ...
}

private get_default_call_site(config: ScopeResolverConfig): number {
    return config.assume_call_site === 'end' 
        ? Number.MAX_SAFE_INTEGER 
        : 0;
}

private extract_filename(uri: string): string {
    // Extract filename from URI, e.g., "file:///path/to/child.do" -> "child.do"
    const path = URI.parse(uri).fsPath;
    return path.split(/[/\\]/).pop() || '';
}
```

### OutOfScopeSymbol Changes

The `OutOfScopeSymbol` interface is updated to use 0-indexed line numbers consistently:

```typescript
export interface OutOfScopeSymbol {
    name: string;
    type: 'local' | 'global' | 'program' | 'variable' | 'scalar' | 'matrix';
    source_uri: string;
    defined_line: number;      // 0-indexed line where symbol is defined
    call_site_line: number;    // 0-indexed call site line (CHANGED from 1-indexed)
}
```

### DiagnosticsProvider Changes

The `DiagnosticsProvider` is updated to:
1. Handle the new `$name` format for global macro messages
2. Convert 0-indexed line numbers to 1-indexed for user display
3. Apply cross-file resolution rules consistently across all supported symbol types (macros, programs, variables, scalars, matrices)

#### Consistent Cross-File Behavior Across Symbol Types

This feature must behave consistently across symbol types (Requirement 6). Concretely:

1. **Symbol name extraction remains macro-specific (and must preserve local/global kind)**
   - The diagnostic-message parsing described below is used for macro diagnostics produced by the analyzer.
   - The parser MUST infer `symbol_kind` from the macro syntax:
     - local macros use `` `name' `` → `symbol_kind = macro_local`
     - globals use `$name` → `symbol_kind = macro_global`
   - This avoids confusing a local `foo` with a global `foo`.

2. **Cross-file resolution is type-agnostic (but symbol identity is not name-only)**
   - Stata allows a local and a global macro to share the same *name*; these are distinct symbols.
   - Therefore, symbol identity MUST include a namespace/kind in addition to the string name.
   - Once the provider has a `(symbol_name, symbol_kind, symbol_type)` triple (regardless of where it came from: analyzer, parser, indexer, or provider-local logic), it MUST use the same scope-resolution pipeline:
     - Follow directive chains (if present)
     - Determine a call site (explicit `line=` / `match=` or inferred)
     - Filter candidates by call site line
     - Classify any excluded candidates as out-of-scope

   Where:
   - `symbol_kind` distinguishes at least: `macro_local` vs `macro_global`.
   - `symbol_type` is the broader category used elsewhere in this document (e.g., macro/program/variable/scalar/matrix).

3. **Undefined vs out-of-scope diagnostics are consistent**
   - If a symbol has no in-scope definition in the resolved scope chain, the provider emits an **undefined symbol** diagnostic for that `(symbol_name, symbol_kind, symbol_type)`.
   - If a definition exists but is excluded by call-site filtering, the provider emits an **out-of-scope** diagnostic (and MUST NOT also emit an undefined diagnostic for the same reference).

4. **Suppression directives apply to all undefined symbol diagnostics**
   - `@lsp-ignore` and `@lsp-ignore-next` suppression MUST be evaluated before emitting undefined diagnostics for any symbol type (Requirement 6.3), not only macros.
   - Suppression also applies to out-of-scope diagnostics for consistency and predictability (unless explicitly excluded by config in the future).

```typescript
// Updated extract_symbol_name_from_diagnostic method
// NOTE: For macros, extraction MUST preserve local-vs-global kind so that
// a local `foo' is not treated as the same symbol as a global $foo.
private extract_symbol_name_from_diagnostic(
    diagnostic: { message: string; code: number }
): string | null {
    // Handle local macro format: `name'
    const local_match = diagnostic.message.match(/`([^']+)'/);
    if (local_match) {
        return local_match[1];
    }
    
    // Handle global macro format: $name (NEW)
    const global_match = diagnostic.message.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/);
    if (global_match) {
        return global_match[1];
    }
    
    // Handle quoted format: 'name'
    const quoted_match = diagnostic.message.match(/'([^']+)'/);
    if (quoted_match) {
        return quoted_match[1];
    }
    
    return null;
}

// Provider code that consumes this method MUST also determine macro kind
// from the message format (local vs global) and carry it through resolution.

// Updated out-of-scope message to use 1-indexed line for display
// In get_diagnostics method:
if (out_of_scope) {
    const source_file = out_of_scope.source_uri.split('/').pop() || out_of_scope.source_uri;
    // Convert 0-indexed call_site_line to 1-indexed for display
    const display_line = out_of_scope.call_site_line + 1;
    the_diagnostics.push({
        range: my_diagnostic.range,
        message: `'${symbol_name}' is defined in ${source_file} but after the call site (line ${display_line})`,
        severity: this.cross_file_severity_to_lsp(out_of_scope_severity),
        source: 'stata-lsp',
        code: StataDiagnosticCode.OUT_OF_SCOPE_SYMBOL,
    });
}
```

### SemanticAnalyzer Changes

The `SemanticAnalyzer` is updated to use consistent message formats:

```typescript
// For local macros - use backtick format matching Stata syntax
diagnostics.push({
    message: `Undefined local macro: \`${macro_name}'`,
    range: token.range,
    code: StataDiagnosticCode.UNDEFINED_MACRO,
    severity: 'warning',
});

// For global macros - use dollar sign format matching Stata syntax
diagnostics.push({
    message: `Undefined global macro: $${macro_name}`,
    range: token.range,
    code: StataDiagnosticCode.UNDEFINED_MACRO,
    severity: 'warning',
});
```

### Configuration Changes

Remove `directives_required` from `CrossFileConfig`.

#### Backward Compatibility for Removed Fields

To satisfy Requirement 3 (removal) while avoiding unnecessary breakage for existing users, the implementation should:
- **Remove** `cross_file.directives_required` from the documented config schema and all internal config types.
- **Ignore** `cross_file.directives_required` if it appears in a user config file at runtime (no behavior changes based on it, and no error).
- Optionally emit a low-severity, non-blocking notice (e.g., log-level warning) that the field is deprecated/ignored.

```typescript
// BEFORE
export interface CrossFileConfig {
    index_workspace: boolean;
    max_indexed_files: number;
    directives_required: boolean;  // REMOVE
    assume_call_site: 'end' | 'start';
    diagnostics: {
        undefined_symbol: 'error' | 'warning' | 'info' | 'off';
        out_of_scope: 'error' | 'warning' | 'info' | 'off';
        missing_file: 'error' | 'warning' | 'info' | 'off';
    };
}

// AFTER
export interface CrossFileConfig {
    index_workspace: boolean;
    max_indexed_files: number;
    assume_call_site: 'end' | 'start';
    diagnostics: {
        undefined_symbol: 'error' | 'warning' | 'info' | 'off';
        out_of_scope: 'error' | 'warning' | 'info' | 'off';
        missing_file: 'error' | 'warning' | 'info' | 'off';
    };
}
```

Files to update:
- `src/types/index.ts` - Remove from interface
- `src/server-handlers.ts` - Remove from default config
- `src/utils/config-validator.ts` - Remove validation logic
- `src/utils/workspace-config.ts` - Remove mapping logic
- `src/providers/completion.ts` - Remove conditional logic based on this setting

## Data Models

### Call Site Inference Pattern Matching

The `infer_call_site_for_file` method uses pattern matching to find `do`/`include` statements:

```typescript
// Pattern to match do/include/run statements
// Captures: command, optional quotes, filename
const DO_INCLUDE_PATTERN = /^\s*(do|include|run)\s+(?:"([^"]+)"|([^\s,]+))/i;

function infer_call_site_for_file(
    parent_content: string,
    child_filename: string
): number | undefined {
    const the_lines = parent_content.split('\n');
    const child_basename = child_filename.replace(/\.do$/i, '');
    
    for (let i = 0; i < the_lines.length; i++) {
        const my_line = the_lines[i];
        const my_match = my_line.match(DO_INCLUDE_PATTERN);
        
        if (my_match) {
            const my_target = my_match[2] || my_match[3]; // quoted or unquoted
            const my_target_basename = my_target.replace(/\.do$/i, '');
            
            // Match if basenames are equal (case-insensitive on Windows)
            if (my_target_basename.toLowerCase() === child_basename.toLowerCase() ||
                my_target.toLowerCase() === child_filename.toLowerCase()) {
                return i; // 0-indexed
            }
        }
    }
    
    return undefined;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: find_match_line Returns 0-Indexed Line Numbers

*For any* content string containing a match string at line N (where N is the 0-indexed position), `find_match_line` SHALL return N.

**Validates: Requirements 1.2**

### Property 2: OutOfScopeSymbol Uses 0-Indexed Line Numbers

*For any* `OutOfScopeSymbol` produced by the scope resolver, the `call_site_line` field SHALL be 0-indexed (first line = 0).

**Validates: Requirements 1.3**

### Property 3: Display Line Numbers Are 1-Indexed

*For any* out-of-scope diagnostic message displayed to the user, the line number in the message SHALL be the internal 0-indexed value plus 1.

**Validates: Requirements 1.4**

### Property 4: Local Macro Diagnostic Format

*For any* undefined local macro with name N, the diagnostic message SHALL match the format `Undefined local macro: \`N'` (with backtick prefix and apostrophe suffix).

**Validates: Requirements 2.1**

### Property 5: Global Macro Diagnostic Format

*For any* undefined global macro with name N, the diagnostic message SHALL match the format `Undefined global macro: $N` (with dollar sign prefix).

**Validates: Requirements 2.2**

### Property 6: Symbol Name Extraction Round-Trip

*For any* valid macro name N, creating a diagnostic message in either local (`` `N' ``) or global (`$N`) format and then extracting the symbol name SHALL return N.

**Validates: Requirements 2.3, 2.4**

### Property 7: AST and Token Diagnostic Consistency

*For any* macro reference that is detected by both AST-based and token-based analysis, the diagnostic message format SHALL be identical.

**Validates: Requirements 2.5**

### Property 8: Call Site Inference Correctness

*For any* parent file content containing `do "child.do"` at 0-indexed line L, calling `infer_call_site_for_file` with that content and filename "child.do" SHALL return L.

**Validates: Requirements 4.1, 4.2**

### Property 9: Call Site Inference First Match

*For any* parent file containing multiple `do "child.do"` statements at lines L1, L2, ... (where L1 < L2 < ...), `infer_call_site_for_file` SHALL return L1.

**Validates: Requirements 4.3**

### Property 10: Call Site Inference Fallback

*For any* parent file that does NOT contain a `do`/`include` statement for the child file, `infer_call_site_for_file` SHALL return `undefined`, and the scope resolver SHALL use the `assume_call_site` config default.

**Validates: Requirements 4.4**

### Property 11: Explicit Call Site Override

*For any* directive with explicit `match=` or `line=` parameters, the scope resolver SHALL use the explicit value and NOT call `infer_call_site_for_file`.

**Validates: Requirements 4.5**

### Property 12: Call Site Inference Suffix Handling

*For any* parent file containing `do child` (without `.do` suffix) and child filename "child.do", `infer_call_site_for_file` SHALL match and return the correct line number.

**Validates: Requirements 4.6**

### Property 13: Call Site Filtering Behavior

*For any* symbol defined at line D in a parent file with call site at line C:
- If D <= C, the symbol SHALL be included in the resolved scope
- If D > C, the symbol SHALL be excluded and added to `out_of_scope_symbols`

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 14: Suppression Directive Effectiveness

*For any* undefined macro diagnostic on a line with `@lsp-ignore` comment or preceded by `@lsp-ignore-next`, the diagnostic SHALL NOT be reported.

**Validates: Requirements 3.4, 6.3**

## Error Handling

### Call Site Inference Failures

When `infer_call_site_for_file` cannot find a matching `do`/`include` statement:
1. Return `undefined`
2. The caller falls back to `assume_call_site` config (default: `'end'`)
3. No diagnostic is emitted (this is expected behavior for files not explicitly called)

### Invalid Line Numbers in Directives

When a user specifies `line=0` or a negative line number:
1. Treat as 0-indexed line 0 (first line of file)
2. This maintains backward compatibility with any existing usage

### Malformed do/include Statements

The pattern matching is intentionally permissive:
- Handles both quoted and unquoted paths
- Handles paths with or without `.do` suffix
- Ignores lines that don't match the pattern (no error)

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **DirectiveParser.find_match_line**
   - Match on first line returns 0
   - Match on second line returns 1
   - No match returns undefined

2. **DirectiveParser.infer_call_site_for_file**
   - `do "child.do"` matches child.do
   - `do child` matches child.do (no suffix)
   - `include "child.do"` matches
   - `run "child.do"` matches
   - Case-insensitive matching on Windows-style paths
   - No match returns undefined

3. **DiagnosticsProvider.extract_symbol_name_from_diagnostic**
   - Extracts from `` `name' `` format
   - Extracts from `$name` format
   - Returns null for unrecognized formats

4. **ScopeResolver.filter_by_call_site**
   - Symbols before call site are included
   - Symbols after call site are excluded
   - Boundary case: symbol on same line as call site

### Property-Based Tests

Property tests use fast-check with minimum 100 iterations per test.

**Test File**: `tests/property/global-macro-execution-order.prop.test.ts`

Each property test should be tagged with:
```typescript
// Feature: global-macro-execution-order, Property N: [property description]
// Validates: Requirements X.Y
```

**Generators needed**:
- `arbitraryStataContent`: Generates valid Stata file content with do/include statements
- `arbitraryMacroName`: Generates valid macro names (alphanumeric + underscore)
- `arbitraryFilename`: Generates valid .do filenames

### Integration Tests

1. **End-to-end directive chain with inference**
   - Parent file with `do child.do` at line 5
   - Child file with `@lsp-done-by: "parent.do"` (no match= or line=)
   - Verify call site is inferred as line 5 (0-indexed: 4)

2. **Config compatibility**
   - Verify configs containing `cross_file.directives_required` don't cause errors
   - Verify the field is ignored (has no effect on behavior)

3. **Diagnostic format consistency**
   - Same macro reference produces identical messages from AST and token paths

## Documentation Updates

### README.md Changes

The README.md must be updated to reflect the simplified behavior:

1. **Remove `directives_required` documentation**
   - Remove any mention of the `cross_file.directives_required` configuration option
   - Remove examples showing this setting

2. **Add automatic call site inference documentation**
   - Explain that when using `@lsp-done-by` or `@lsp-included-by` without `match=` or `line=` parameters, the LSP automatically scans the parent file for `do`/`include` statements
   - Document that the first matching statement is used as the call site
   - Explain the fallback to `assume_call_site` when no match is found

3. **Update directive examples**
   - Show simplified directive usage: `// @lsp-done-by: "parent.do"` (without match= parameter)
   - Explain when explicit `match=` or `line=` parameters are still useful (e.g., when the parent calls the child multiple times)

### Example README Section

```markdown
## Cross-File Awareness

### Automatic Call Site Detection

When you use `@lsp-done-by` or `@lsp-included-by` directives, the LSP automatically
detects where your file is called in the parent file:

```stata
// child.do
// @lsp-done-by: "parent.do"

display $my_global  // LSP checks if $my_global is defined before the call site
```

The LSP scans `parent.do` for statements like `do "child.do"` or `do child` and uses
that line as the call site. If multiple calls exist, the first one is used.

### Explicit Call Site (Optional)

You can still specify an explicit call site when needed:

```stata
// @lsp-done-by: "parent.do" match="do child.do"
// @lsp-done-by: "parent.do" line=42
```
```
