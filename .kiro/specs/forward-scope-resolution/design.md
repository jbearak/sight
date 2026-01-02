# Design Document: Forward Scope Resolution

## Overview

This design extends the existing cross-file scope resolution system to support "forward-looking" resolution. The current system uses `@lsp-done-by` and `@lsp-included-by` directives to let child files declare their parent, inheriting the parent's symbols. This feature adds the complementary capability: following `do`, `run`, and `include` commands (and their directive equivalents) to inherit symbols from called files into the caller's scope.

The design reuses the existing `ScopeResolver` infrastructure (caching, file parsing, symbol merging) and extends it with:
1. New directive types (`@lsp-do`, `@lsp-run`, `@lsp-include`) parsed by `DirectiveParser`
2. Forward call detection in the analyzer for `do`, `run`, `include` commands (the analyzer scans the AST built by the parser)
3. A `ForwardScopeResolver` component that follows forward calls and builds scope
4. Integration with the existing scope merging and completion/diagnostic providers

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Caller File                                    │
│  ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐  │
│  │ DirectiveParser │    │     Parser       │    │ SemanticAnalyzer  │  │
│  │ (@lsp-do, etc.) │    │ (builds AST)     │    │ (forward calls)   │  │
│  └────────┬────────┘    └────────┬─────────┘    └─────────┬─────────┘  │
│           │                      │                        │            │
│           │                      ▼                        │            │
│           │             ┌──────────────────┐              │            │
│           │             │       AST        │──────────────┤            │
│           │             └──────────────────┘              │            │
│           │                                               │            │
│           └───────────────────────┬───────────────────────┘            │
│                                   ▼                                    │
│                        ┌──────────────────────┐                        │
│                        │  ForwardCallList     │                        │
│                        │  (path, type, line)  │                        │
│                        └──────────┬───────────┘                        │
│                                   │                                    │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │
                                    ▼
                           ┌────────────────────┐              ┌─────────────────────┐
                           │ForwardScopeResolver│◄─────────────│   ScopeResolver     │
                           │                    │              │ (backward + cache)  │
                           └────────┬───────────┘              └─────────────────────┘
                                    │
                                    ▼
                           ┌────────────────────┐
                           │   Callee Files     │
                           │ (recursive follow) │
                           └────────────────────┘
```

### Data Flow

1. **Directive Parsing**: `DirectiveParser` extracts `@lsp-do`, `@lsp-run`, `@lsp-include` directives from comments (anywhere in file, not just header)
2. **Command Detection**: `SemanticAnalyzer` scans the AST (built by `Parser`) to identify `do`, `run`, `include` commands with static paths and records them as forward calls
3. **Forward Resolution**: `ForwardScopeResolver` follows forward calls recursively, applying inheritance rules
4. **Scope Merging**: Forward-resolved symbols are merged with backward-resolved symbols and current file symbols
5. **Provider Integration**: Completion and diagnostic providers use the merged scope with call-site filtering

## Components and Interfaces

### DirectiveParser Extensions

Extend the existing `DirectiveParser` to recognize forward call directives:

```typescript
// New directive types
type ForwardCallType = 'do' | 'run' | 'include';

interface ForwardCallDirective {
  type: ForwardCallType;
  path: string;           // Resolved absolute path
  raw_path: string;       // Original path from directive
  call_site_line: number; // Line where directive appears (0-indexed)
  range: Range;           // Location in source file
}

// Extended parse result
interface DirectiveParseResult {
  directives: Directive[];                    // Existing backward directives
  declaration_directives: DeclarationDirective[];
  forward_calls: ForwardCallDirective[];      // NEW: forward call directives
  diagnostics: DirectiveDiagnostic[];
}
```

The directive pattern extends to:
```
@lsp-(do|run|include):?\s+(?:"([^"]+)"|([^\s]+))(?:\s+(.*))?$
```

Forward call directives can appear anywhere in the file (not just header), since calls can occur at any point in execution.

### Analyzer Extensions

The analyzer scans the AST to detect `do`, `run`, `include` commands:

```typescript
interface ForwardCall {
  type: ForwardCallType;
  path: string;           // Resolved absolute path (or undefined if macro)
  raw_path: string;       // Original path from command
  call_site_line: number; // Line where command appears (0-indexed)
  range: Range;           // Full command range
  is_static: boolean;     // false if path contains macro references
}

// Extended analysis result
interface AnalysisResult {
  symbols: SymbolTable;
  diagnostics: Diagnostic[];
  forward_calls: ForwardCall[];  // NEW: detected forward calls
}
```

Detection rules:
- Match commands: `do`, `run`, `include` (case-insensitive, with abbreviations)
- Extract path from first argument (quoted or unquoted)
- Mark as non-static if path contains macro references (`\\`...'` or `$...`)

Ignore handling:
- The analyzer records candidate forward calls while traversing the AST.
- Application of `@lsp-ignore` / `@lsp-ignore-next` (which is defined in terms of comment directives and statement boundaries) is performed during analysis, which has access to directive parsing + statement boundaries.

### ForwardScopeResolver

New component that follows forward calls and builds scope:

```typescript
interface ForwardScopeConfig {
  max_forward_depth: number;  // Default: 10
}

interface ForwardResolveContext {
  visited: Map<string, EffectiveCallType>;  // URI -> how it was first called
  effective_call_type: EffectiveCallType;   // 'do' | 'include' (run treated as do)
  depth: number;
  diagnostics: DirectiveDiagnostic[];
}

type EffectiveCallType = 'do' | 'include';

interface ForwardResolvedScope {
  symbols: SymbolTable;           // Accumulated symbols from all callees
  call_sites: ForwardCallSite[];  // For call-site filtering
  diagnostics: DirectiveDiagnostic[];
}

interface ForwardCallSite {
  callee_uri: string;
  call_line: number;              // 0-indexed line in caller
  symbols: SymbolTable;           // Symbols from this callee
}

class ForwardScopeResolver {
  constructor(
    private scope_resolver: ScopeResolver,  // Reuse file cache
    private config: ForwardScopeConfig
  );

  /**
   * Resolve forward scope for a file.
   * @param file_uri - URI of the caller file
   * @param forward_calls - Combined list from directives and parser
   * @param effective_call_type - How this file was called ('do' or 'include')
   * @param context - Resolution context for recursion tracking
   */
  async resolve(
    file_uri: string,
    forward_calls: ForwardCall[],
    effective_call_type: EffectiveCallType,
    context?: ForwardResolveContext
  ): Promise<ForwardResolvedScope>;
}
```

### Scope Inheritance Logic

```typescript
function apply_forward_inheritance(
  callee_symbols: SymbolTable,
  effective_call_type: EffectiveCallType
): SymbolTable {
  if (effective_call_type === 'include') {
    // Include: inherit everything
    return callee_symbols;
  }
  
  // Do/Run: exclude local macros
  return {
    programs: new Map(callee_symbols.programs),
    localMacros: new Map(),  // Exclude locals
    globalMacros: new Map(callee_symbols.globalMacros),
    variables: new Map(callee_symbols.variables),
    scalars: new Map(callee_symbols.scalars),
    matrices: new Map(callee_symbols.matrices),
  };
}

function compute_effective_call_type(
  call_type: ForwardCallType,
  parent_effective_type: EffectiveCallType
): EffectiveCallType {
  // IMPORTANT: If any ancestor in the recursion chain was effectively 'do',
  // then locals must not pass through anywhere downstream.
  // This implements: "if a callee contains an include but any caller in the
  // recursion path called it via do/run, treat the include as do".
  if (parent_effective_type === 'do') {
    return 'do';
  }
  // Otherwise, use the actual call type (run -> do)
  return call_type === 'include' ? 'include' : 'do';
}
```

### Duplicate Call Handling

```typescript
type DuplicateCallDecision =
  | { action: 'skip' }
  | { action: 'use_cached_full' }
  | { action: 'use_cached_add_locals_only' };

function should_process_call(
  callee_uri: string,
  call_type: ForwardCallType,
  visited: Map<string, EffectiveCallType>
): DuplicateCallDecision {
  const previous_type = visited.get(callee_uri);

  if (previous_type === undefined) {
    // First time seeing this file.
    // NOTE: "use_cached_full" may still perform an initial read+parse; the key
    // requirement is that subsequent calls do not re-read/re-parse.
    return { action: 'use_cached_full' };
  }

  if (previous_type === 'include') {
    // Already have all symbols including locals
    return { action: 'skip' };
  }

  // previous_type === 'do'
  if (call_type === 'include') {
    // Do-then-include: do NOT re-read/re-parse the file; just add locals based
    // on already-cached analysis results.
    return { action: 'use_cached_add_locals_only' };
  }

  // Another do/run - already have non-local symbols
  return { action: 'skip' };
}
```

### Configuration Extension

Extend `StataLSPConfig` and `.stata-lsp.json` schema:

```typescript
interface CrossFileConfig {
  // ... existing fields ...
  max_forward_depth: number;  // NEW: default 10
}
```

Example `.stata-lsp.json`:
```json
{
  "cross_file": {
    "max_forward_depth": 15
  }
}
```

### Integration with Existing ScopeResolver

The `ForwardScopeResolver` reuses the existing `ScopeResolver`'s file cache:

```typescript
class ForwardScopeResolver {
  constructor(private scope_resolver: ScopeResolver) {}

  private async get_callee_scope_inputs(callee_uri: string, callee_path: string): Promise<{
    symbols: SymbolTable;
    forward_calls: ForwardCall[];
    callsite_diagnostics: DirectiveDiagnostic[];
  }> {
    // Reuse ScopeResolver's file cache for parsing.
    // This avoids duplicate file reads and parsing.
    const cached = await this.scope_resolver.get_parsed_file(callee_uri, callee_path);

    if ('error' in cached) {
      // Caller-visible diagnostics are emitted on the CALL SITE (in the caller),
      // not imported from the callee.
      return {
        symbols: create_empty_symbol_table(),
        forward_calls: [],
        callsite_diagnostics: [{ message: `Cannot read file: ${callee_path}`, ... }]
      };
    }

    return {
      symbols: cached.symbols,
      forward_calls: this.extract_forward_calls(cached),
      // IMPORTANT: Do NOT propagate cached.diagnostics (callee parse/analyze
      // diagnostics) into the caller. Callee diagnostics are only shown when
      // the callee is opened in the editor.
      callsite_diagnostics: []
    };
  }
}
```

## Data Models

### Forward Call Types

```typescript
// Unified forward call representation (from directives or commands)
interface ForwardCall {
  type: ForwardCallType;        // 'do' | 'run' | 'include'
  path: string;                 // Resolved absolute path
  raw_path: string;             // Original path string
  call_site_line: number;       // 0-indexed line number
  range: Range;                 // Source location
  source: 'directive' | 'command';  // Where it came from
  is_static: boolean;           // false if path has macros
}

type ForwardCallType = 'do' | 'run' | 'include';
type EffectiveCallType = 'do' | 'include';  // run normalized to do
```

### Resolution State

```typescript
interface ForwardResolveState {
  // Files visited in current resolution, with their effective call type
  visited: Map<string, EffectiveCallType>;
  
  // Current recursion depth
  depth: number;
  
  // Accumulated symbols by call site
  call_sites: ForwardCallSite[];
  
  // Accumulated diagnostics
  diagnostics: DirectiveDiagnostic[];
}

interface ForwardCallSite {
  callee_uri: string;
  call_line: number;        // 0-indexed line in caller where call occurs
  symbols: SymbolTable;     // Symbols inherited from this call
  effective_type: EffectiveCallType;
}
```

### Merged Scope Result

```typescript
interface MergedScope {
  // Backward-resolved symbols (from @lsp-done-by, @lsp-included-by)
  backward_symbols: SymbolTable;
  
  // Forward-resolved symbols (from do/run/include)
  forward_call_sites: ForwardCallSite[];
  
  // Current file symbols
  current_symbols: SymbolTable;
  
  // Final merged symbols (for simple lookups)
  merged_symbols: SymbolTable;
  
  // All diagnostics
  diagnostics: DirectiveDiagnostic[];
}
```

### Call-Site Aware Symbol Lookup

For position-aware features (completion, diagnostics), we need to filter symbols by call site:

```typescript
function get_symbols_at_line(
  merged_scope: MergedScope,
  line: number
): SymbolTable {
  // Start with backward symbols (always available)
  let result = clone_symbol_table(merged_scope.backward_symbols);
  
  // Add current file symbols defined before this line
  result = merge_with_line_filter(result, merged_scope.current_symbols, line);
  
  // Add forward call symbols where call_line < line
  for (const call_site of merged_scope.forward_call_sites) {
    if (call_site.call_line < line) {
      result = merge_symbol_tables(result, call_site.symbols);
    }
  }
  
  return result;
}
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Forward Directive Parsing Correctness

*For any* valid forward call directive string (`@lsp-do`, `@lsp-run`, or `@lsp-include`) with a path, parsing SHALL produce a `ForwardCallDirective` with the correct `type` field matching the directive keyword.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Quoted and Unquoted Path Equivalence

*For any* valid file path, parsing a forward call directive with the path quoted (`"path.do"`) SHALL produce the same resolved path as parsing with the path unquoted (`path.do`).

**Validates: Requirements 1.4**

### Property 3: Legacy Syntax Acceptance

*For any* valid forward call directive, parsing with colon (`@lsp-do: "path"`) SHALL produce an equivalent result to parsing without colon (`@lsp-do "path"`).

**Validates: Requirements 1.5**

### Property 4: Parameter Extraction Correctness

*For any* forward call directive with `line=N` or `match="string"` parameters, parsing SHALL correctly extract and record the parameter value.

**Validates: Requirements 1.6, 1.7**

### Property 5: Do/Run Inheritance Excludes Locals

*For any* symbol table from a callee file, applying `do` or `run` inheritance rules SHALL produce a symbol table containing all programs, globals, scalars, matrices, and variables, but zero local macros.

**Validates: Requirements 2.1, 2.2**

### Property 6: Include Inheritance Preserves All Symbols

*For any* symbol table from a callee file, applying `include` inheritance rules SHALL produce a symbol table identical to the input (all symbol types preserved).

**Validates: Requirements 2.3**

### Property 7: Symbol Accumulation Order

*For any* sequence of forward calls to files with non-overlapping symbols, the merged symbol table SHALL contain all symbols from all callees.

**Validates: Requirements 2.4**

### Property 8: Later Definition Wins

*For any* sequence of forward calls where multiple callees define the same symbol name, the merged symbol table SHALL contain the definition from the last callee in call order.

**Validates: Requirements 2.5**

### Property 9: Recursive Resolution Completeness

*For any* chain of forward calls (A calls B, B calls C), resolving A's forward scope SHALL include symbols from both B and C (transitively).

**Validates: Requirements 3.1**

### Property 10: Depth Limit Enforcement

*For any* forward call chain exceeding `max_forward_depth`, resolution SHALL stop at the configured depth and emit a warning diagnostic.

**Validates: Requirements 3.2, 14.3**

### Property 11: Cycle Detection

*For any* circular forward call dependency (A calls B calls A), resolution SHALL detect the cycle, stop recursion, and emit a warning diagnostic without infinite looping.

**Validates: Requirements 3.3**

### Property 12: Backward Directive Isolation

*For any* callee file containing `@lsp-done-by` or `@lsp-included-by` directives, forward resolution SHALL ignore those directives (not follow them).

**Validates: Requirements 3.4**

### Property 13: Ignore Directive Skips Call

*For any* forward call preceded by `@lsp-ignore-next` or with `@lsp-ignore` on the same line, the call SHALL be skipped entirely (no symbols imported, no file read).

**Validates: Requirements 4.1, 4.2**

### Property 14: Ignored Call Diagnostic Isolation

*For any* ignored forward call, no diagnostics from the callee file SHALL appear in the caller's diagnostic list.

**Validates: Requirements 4.3, 7.4**

### Property 15: Cache Hit on Unchanged Content

*For any* file parsed twice with identical content, the second parse SHALL be a cache hit (reusing cached symbols without re-parsing).

**Validates: Requirements 5.1, 5.2**

### Property 16: Cache Invalidation on Change

*For any* cached file that is modified, subsequent resolution SHALL invalidate the cache entry and re-parse the file.

**Validates: Requirements 5.3**

### Property 17: Call-Site Visibility Boundary

*For any* forward call at line N, symbols from that call SHALL be visible at line N+1 and beyond, but NOT visible at line N or earlier.

**Validates: Requirements 6.1, 6.2**

### Property 18: Independent Call Site Tracking

*For any* file with multiple forward calls at different lines, each call's symbols SHALL have independent visibility boundaries based on their respective call lines.

**Validates: Requirements 6.3**

### Property 19: Diagnostic Suppression After Call Site

*For any* macro defined in a called file and referenced after the call site, no "undefined macro" diagnostic SHALL be reported for that reference.

**Validates: Requirements 7.1**

### Property 20: Diagnostic Reported Before Call Site

*For any* macro defined only in a called file and referenced before the call site, an "undefined macro" diagnostic SHALL be reported.

**Validates: Requirements 7.2**

### Property 21: Missing File Diagnostic

*For any* forward call to a non-existent file, a warning diagnostic SHALL be reported on the call directive or command.

**Validates: Requirements 7.3**

### Property 22: Completion Includes Callee Symbols After Call Site

*For any* completion request at a position after a forward call site, the completion list SHALL include symbols from the called file.

**Validates: Requirements 8.1, 8.2**

### Property 23: Completion Source Attribution

*For any* completion item originating from a called file, the completion detail SHALL indicate the source file.

**Validates: Requirements 8.3**

### Property 24: Command Detection for All Call Types

*For any* `do`, `run`, or `include` command with a static path, the parser SHALL record it as a forward call with the correct type.

**Validates: Requirements 9.1, 9.2, 9.3**

### Property 25: Unquoted Command Path Resolution

*For any* call command with an unquoted path, path resolution SHALL follow the same rules as directive path resolution.

**Validates: Requirements 9.4**

### Property 26: Macro Path Non-Resolution

*For any* call command where the path contains a macro reference, the call SHALL be marked as non-static and not resolved.

**Validates: Requirements 9.5**

### Property 27: Bidirectional Symbol Merging

*For any* file with both backward directives and forward calls, the merged scope SHALL contain symbols from both directions.

**Validates: Requirements 10.1**

### Property 28: Execution Order Precedence

*For any* symbol defined in both backward scope and forward scope, the merged scope SHALL use the definition that appears later in execution order (backward first, then forward in call order).

**Validates: Requirements 10.2, 10.3**

### Property 29: AST Unchanged After Forward Resolution

*For any* file with forward calls, the caller's AST structure SHALL be identical before and after forward scope resolution (no callee AST nodes added).

**Validates: Requirements 11.1, 11.2**

### Property 30: Duplicate Do/Run Call Optimization

*For any* file called multiple times via `do` or `run`, the file SHALL be parsed only once and symbols reused.

**Validates: Requirements 12.1**

### Property 31: Do-Then-Include Adds Only Locals

*For any* file first called via `do`/`run` and later called via `include`, the second call SHALL add only local macros to scope (non-locals already present).

**Validates: Requirements 12.2**

### Property 32: Include-First Skips Subsequent Calls

*For any* file first called via `include`, subsequent calls to the same file SHALL be skipped (all symbols already in scope).

**Validates: Requirements 12.3**

### Property 33: Include Downgrade in Do Chain

*For any* `include` call where any ancestor in the call chain was called via `do`/`run`, the include SHALL be treated as `do` (locals not inherited).

**Validates: Requirements 13.1**

### Property 34: Include Preservation in Include Chain

*For any* `include` call where all ancestors in the call chain were called via `include`, full include semantics SHALL be preserved (locals inherited).

**Validates: Requirements 13.2**

### Property 35: Configurable Max Depth

*For any* configured `max_forward_depth` value, the resolver SHALL respect that limit instead of the default.

**Validates: Requirements 14.1**

## Error Handling

### File Not Found

When a forward call references a non-existent file:
1. Emit a warning diagnostic on the call directive/command
2. Continue processing other calls (don't fail the entire resolution)
3. Return empty symbols for that call

### Parse Errors in Callee

When a callee file has parse errors:
1. Do NOT surface callee diagnostics to the caller
2. Extract whatever symbols are available from partial parse
3. Continue with available symbols

### Encoding Errors

When a callee file has encoding issues:
1. Log a warning
2. Emit a diagnostic on the call
3. Skip the file and continue

### Circular Dependencies

When a cycle is detected:
1. Emit a warning diagnostic showing the cycle path
2. Stop recursion at the cycle point
3. Return symbols accumulated before the cycle

### Depth Limit Exceeded

When max depth is reached:
1. Emit a warning diagnostic indicating depth limit
2. Stop recursion at that point
3. Return symbols accumulated up to the limit

## Testing Strategy

### Unit Tests

Unit tests focus on individual components:

1. **DirectiveParser**: Test parsing of `@lsp-do`, `@lsp-run`, `@lsp-include` directives
   - Valid directive formats (quoted, unquoted, with/without colon)
   - Parameter extraction (line=, match=)
   - Invalid directive handling

2. **Parser Forward Call Detection**: Test detection of `do`, `run`, `include` commands
   - Static paths (quoted and unquoted)
   - Macro paths (should be marked non-static)
   - Prefix commands (quietly do, capture include)

3. **Inheritance Rules**: Test `apply_forward_inheritance` function
   - Do/run excludes locals
   - Include preserves all

4. **Duplicate Call Logic**: Test `should_process_call` function
   - First call processing
   - Do-then-include case
   - Include-first case

5. **Effective Call Type**: Test `compute_effective_call_type` function
   - Include downgrade in do chain
   - Include preservation in include chain

### Property-Based Tests

Property-based tests use fast-check to verify universal properties:

1. **Directive Parsing Properties** (Properties 1-4)
   - Generate random valid directive strings
   - Verify parsing correctness

2. **Inheritance Rule Properties** (Properties 5-6)
   - Generate random symbol tables
   - Verify inheritance rules

3. **Call-Site Filtering Properties** (Properties 17-18)
   - Generate random call sequences and query positions
   - Verify visibility boundaries

4. **Cache Properties** (Properties 15-16)
   - Generate file content sequences
   - Verify cache behavior

5. **Cycle Detection Property** (Property 11)
   - Generate random call graphs including cycles
   - Verify cycle detection

### Integration Tests

Integration tests verify end-to-end behavior:

1. **Full Resolution Pipeline**: Test complete forward resolution with real files
2. **Bidirectional Merging**: Test files with both forward and backward directives
3. **Completion Integration**: Test completions include forward-resolved symbols
4. **Diagnostic Integration**: Test diagnostic suppression for forward-resolved symbols

### Test Configuration

- Property tests: minimum 100 iterations per property
- Use fast-check for property-based testing
- Tag format: `Feature: forward-scope-resolution, Property N: <property_text>`
