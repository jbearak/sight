# Design Document: Cross-File Awareness

## Overview

This design document describes the architecture and implementation of cross-file awareness for the Stata LSP. The feature enables the LSP to understand symbol scope across multiple files by using directive-based dependency declarations.

The core insight is that Stata's `do` and `include` commands execute at runtime, making static analysis of callers impractical. Instead, we invert the dependency declaration: files declare their callers via directives, allowing the LSP to build scope chains by following these declarations recursively.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LSP Server                                   │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │  Document   │  │  Workspace  │  │  Directive  │                  │
│  │   Store     │  │   Indexer   │  │   Parser    │                  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │
│         │                │                │                          │
│         └────────────────┼────────────────┘                          │
│                          ▼                                           │
│                 ┌─────────────────┐                                  │
│                 │  Scope Resolver │                                  │
│                 └────────┬────────┘                                  │
│                          │                                           │
│         ┌────────────────┼────────────────┐                          │
│         ▼                ▼                ▼                          │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐          │
│  │Completion │ │Definition │ │   Hover   │ │Diagnostics│          │
│  │ Provider  │ │ Provider  │ │ Provider  │ │ Provider  │          │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘          │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Document Open/Change**: Document Store parses file, extracts directives
2. **Directive Resolution**: Directive Parser follows parent chain recursively
3. **Scope Construction**: Scope Resolver builds symbol table from chain
4. **Provider Queries**: Providers use resolved scope for completions, definitions, diagnostics

## Components and Interfaces

### 1. Directive Parser

Parses directive comments from the top of Stata files.

```typescript
interface Directive {
    type: 'done-by' | 'included-by';
    path: string;                    // Resolved absolute path
    raw_path: string;                // Original path from directive
    call_site?: CallSite;            // Optional call site specification
    range: Range;                    // Location in source file
}

interface CallSite {
    type: 'line' | 'match';
    value: number | string;          // Line number or match string
    resolved_line?: number;          // Resolved line number (for match)
}

interface DirectiveParseResult {
    directives: Directive[];
    diagnostics: Diagnostic[];
}

class DirectiveParser {
    /**
     * Parse directives from file content.
     * Stops at first non-comment, non-blank line.
     */
    parse(content: string, file_uri: string): DirectiveParseResult;
    
    /**
     * Resolve a path relative to the containing file.
     * Handles .., ., and platform separators.
     */
    resolve_path(raw_path: string, containing_uri: string): string;
    
    /**
     * Find the line number for a match= parameter.
     * Returns undefined if not found.
     */
    find_match_line(parent_content: string, match_string: string): number | undefined;
}
```

### 2. Scope Resolver

Builds the complete symbol scope for a file by following directives.

```typescript
interface ScopeChainEntry {
    uri: string;
    directive_type: 'done-by' | 'included-by';
    call_site_line: number;          // Line in parent where call occurs
    symbols: SymbolTable;            // Symbols from this file
    depth: number;                   // Distance from current file (0 = current)
}

interface ResolvedScope {
    chain: ScopeChainEntry[];        // Ordered from current to root
    symbols: SymbolTable;            // Merged symbols respecting shadowing
    diagnostics: Diagnostic[];       // Cycle warnings, missing files, etc.
}

interface ScopeResolverConfig {
    assume_call_site: 'end' | 'start';
    max_chain_depth: number;         // Prevent runaway recursion
}

class ScopeResolver {
    private visited: Set<string>;    // Cycle detection
    
    /**
     * Resolve the complete scope for a file.
     * Follows directives recursively, respecting inheritance rules.
     */
    resolve(
        file_uri: string,
        file_content: string,
        config: ScopeResolverConfig
    ): ResolvedScope;
    
    /**
     * Filter symbols by call site line.
     * Only includes symbols defined on or before the call site.
     */
    filter_by_call_site(
        symbols: SymbolTable,
        call_site_line: number
    ): SymbolTable;
    
    /**
     * Apply inheritance rules based on directive type.
     * done-by: excludes locals
     * included-by: includes all symbols
     */
    apply_inheritance_rules(
        symbols: SymbolTable,
        directive_type: 'done-by' | 'included-by'
    ): SymbolTable;
    
    /**
     * Merge symbol tables with shadowing.
     * Nearer symbols shadow more distant ones.
     */
    merge_with_shadowing(
        base: SymbolTable,
        overlay: SymbolTable
    ): SymbolTable;
}
```

### 3. Enhanced Workspace Indexer

Extends the existing indexer with directive awareness.

```typescript
interface IndexedFile {
    uri: string;
    symbols: SymbolTable;
    directives: Directive[];
    last_modified: number;
}

interface WorkspaceIndex {
    files: Map<string, IndexedFile>;
    symbol_lookup: Map<string, Set<string>>;  // symbol name -> file URIs
}

class EnhancedWorkspaceIndexer extends WorkspaceIndexer {
    private directive_parser: DirectiveParser;
    
    /**
     * Index a file, extracting both symbols and directives.
     */
    async index_file(file_path: string): Promise<void>;
    
    /**
     * Get symbols reachable from a file via its directive chain.
     * Used for completion filtering.
     */
    get_reachable_symbols(
        file_uri: string,
        scope_resolver: ScopeResolver
    ): SymbolTable;
    
    /**
     * Search for a symbol across all indexed files.
     * Returns all definition locations.
     */
    find_symbol_definitions(
        name: string,
        symbol_type?: 'program' | 'global' | 'scalar' | 'matrix'
    ): Location[];
}
```

### 4. Enhanced Completion Provider

Extends completion with cross-file awareness and ranking.

```typescript
interface CompletionRanking {
    current_file: number;            // Highest priority
    direct_include_local: number;    // Locals from direct includes
    direct_parent_global: number;    // Globals from immediate parents
    distant_ancestor: number;        // Symbols from distant ancestors
    workspace: number;               // Workspace symbols (no directives)
}

class EnhancedCompletionProvider extends CompletionProvider {
    private scope_resolver: ScopeResolver;
    private ranking: CompletionRanking;
    
    /**
     * Get completions with cross-file awareness.
     * Filters by directive chain if present, otherwise includes all workspace symbols.
     */
    get_completions(
        document: DocumentState,
        position: Position,
        trigger_character?: string
    ): CompletionItem[];
    
    /**
     * Rank completion items by scope proximity.
     */
    rank_completions(
        items: CompletionItem[],
        scope_chain: ScopeChainEntry[]
    ): CompletionItem[];
    
    /**
     * Annotate completion item with source file.
     */
    annotate_source(
        item: CompletionItem,
        source_uri: string
    ): CompletionItem;
}
```

### 5. Enhanced Definition Provider

Extends go-to-definition with cross-file navigation.

```typescript
class EnhancedDefinitionProvider extends DefinitionProvider {
    private scope_resolver: ScopeResolver;
    private workspace_indexer: EnhancedWorkspaceIndexer;
    
    /**
     * Get definition with cross-file awareness.
     * Searches scope chain first, then workspace index.
     */
    get_definition(
        document: DocumentState,
        position: Position
    ): Definition | Definition[] | null;
    
    /**
     * Handle multiple definitions.
     * Returns array when symbol is defined in multiple files.
     */
    get_all_definitions(
        symbol_name: string,
        symbol_type: string
    ): Definition[];
}
```

### 6. Enhanced Diagnostics Provider

Extends diagnostics with directive-aware undefined symbol detection.

```typescript
interface DiagnosticSeverityConfig {
    undefined_symbol: DiagnosticSeverity | 'off';
    out_of_scope: DiagnosticSeverity | 'off';
    missing_file: DiagnosticSeverity | 'off';
    circular_dependency: DiagnosticSeverity | 'off';
}

class EnhancedDiagnosticsProvider {
    private scope_resolver: ScopeResolver;
    private severity_config: DiagnosticSeverityConfig;
    
    /**
     * Generate diagnostics with cross-file awareness.
     */
    get_diagnostics(
        document: DocumentState,
        resolved_scope: ResolvedScope
    ): Diagnostic[];
    
    /**
     * Check if a symbol reference is defined in scope.
     */
    is_symbol_in_scope(
        name: string,
        scope: 'local' | 'global',
        resolved_scope: ResolvedScope
    ): boolean;
    
    /**
     * Check if a symbol is potentially out of scope.
     * (Defined after inferred call site)
     */
    is_potentially_out_of_scope(
        name: string,
        reference_line: number,
        resolved_scope: ResolvedScope
    ): boolean;
}
```

### 7. Enhanced Hover Provider

Extends hover with cross-file symbol information.

```typescript
interface HoverInfo {
    symbol_type: 'local' | 'global' | 'scalar' | 'matrix' | 'program';
    name: string;
    value?: string;
    source_uri: string;
    definition_line: number;
    signature?: ProgramSignature;
}

class EnhancedHoverProvider {
    private scope_resolver: ScopeResolver;
    private workspace_indexer: EnhancedWorkspaceIndexer;
    
    /**
     * Get hover information with cross-file awareness.
     * Searches scope chain first, then workspace index.
     */
    get_hover(
        document: DocumentState,
        position: Position
    ): Hover | null;
    
    /**
     * Build hover content for a symbol.
     * Includes type, definition site, and source file for cross-file symbols.
     */
    build_hover_content(info: HoverInfo): MarkupContent;
    
    /**
     * Get program signature for hover display.
     */
    get_program_signature(
        program_name: string,
        resolved_scope: ResolvedScope
    ): ProgramSignature | null;
}
```

## Data Models

### Extended Symbol Table

```typescript
interface ExtendedSymbolTable extends SymbolTable {
    scalars: Map<string, ScalarSymbol>;
    matrices: Map<string, MatrixSymbol>;
}

interface ScalarSymbol {
    name: string;
    location: Location;
    source_uri: string;
    definition_line: number;
}

interface MatrixSymbol {
    name: string;
    location: Location;
    source_uri: string;
    definition_line: number;
}
```

### Configuration Schema

```typescript
interface CrossFileConfig {
    index_workspace: boolean;
    max_indexed_files: number;
    directives_required: boolean;
    assume_call_site: 'end' | 'start';
    diagnostics: {
        undefined_symbol: 'error' | 'warning' | 'info' | 'off';
        out_of_scope: 'error' | 'warning' | 'info' | 'off';
        missing_file: 'error' | 'warning' | 'info' | 'off';
    };
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Directive Parsing Round-Trip

*For any* valid directive string in either `*` or `//` comment format, parsing the directive and reconstructing it SHALL produce an equivalent directive with the same path and call site parameters.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 2: Directive Location Constraint

*For any* file with directives, the parser SHALL only recognize directives that appear before the first non-comment, non-blank line. Directives appearing after code SHALL be ignored.

**Validates: Requirements 2.6**

### Property 3: Path Resolution Correctness

*For any* relative path in a directive, resolving it relative to the containing file's directory and then normalizing SHALL produce a valid absolute path. The path `a/b/../c` SHALL resolve to `a/c`.

**Validates: Requirements 2.9, 2.10**

### Property 4: Match Parameter Precedence

*For any* directive with both `line=` and `match=` parameters where they would resolve to different lines, the `match=` parameter SHALL determine the call site.

**Validates: Requirements 2.5**

### Property 5: Cycle Detection Completeness

*For any* directive graph containing a cycle, the scope resolver SHALL detect the cycle, emit a diagnostic containing the cycle path, and terminate without infinite recursion.

**Validates: Requirements 2.14, 2.15, 12.4**

### Property 6: Inheritance Rule Correctness

*For any* parent file with locals, globals, scalars, matrices, and programs:
- An `@lsp-included-by` directive SHALL inherit all five symbol types
- An `@lsp-done-by` directive SHALL inherit globals, scalars, matrices, and programs but NOT locals

**Validates: Requirements 3.2, 3.3**

### Property 7: Call Site Filtering

*For any* parent file with symbols defined at various lines and a call site at line N, the inherited symbols SHALL include only those defined on or before line N.

**Validates: Requirements 3.4, 3.5**

### Property 8: Shadowing Semantics

*For any* symbol defined in both a file and its ancestor, the file's definition SHALL shadow the ancestor's. *For any* symbol defined in multiple ancestors, the nearer ancestor's definition SHALL shadow more distant ones.

**Validates: Requirements 3.8, 3.9**

### Property 9: Multi-Parent Union

*For any* file with multiple directives pointing to different parents, the resolved scope SHALL contain the union of all inherited symbols (respecting inheritance rules per directive type).

**Validates: Requirements 2.7, 3.6**

### Property 10: Same-Parent Directive Precedence

*For any* file with both `@lsp-done-by` and `@lsp-included-by` pointing to the same parent, the `@lsp-included-by` semantics SHALL apply (locals are inherited).

**Validates: Requirements 2.8**

### Property 11: Transitive Inheritance

*For any* chain of files A → B → C (where → means "declares parent"), symbols from A SHALL be available in C according to the composition of inheritance rules along the chain.

**Validates: Requirements 3.7**

### Property 12: Index Lifecycle Consistency

*For any* sequence of file operations (create, modify, rename, delete), the workspace index SHALL accurately reflect the current state of the filesystem after each operation.

**Validates: Requirements 4.5, 4.6, 4.7, 12.6, 12.7**

### Property 13: Completion Filtering by Directives

*For any* file with directives, completion suggestions SHALL include only symbols reachable via the directive chain. *For any* file without directives, completion suggestions SHALL include all workspace symbols.

**Validates: Requirements 4.9, 4.10, 11.5**

### Property 14: Completion Ranking Order

*For any* completion list with symbols from multiple scope levels, the ranking SHALL be: current file > direct include locals > direct parent globals > distant ancestors > workspace.

**Validates: Requirements 5.6**

### Property 15: Go-to-Definition Correctness

*For any* symbol reference in a file, go-to-definition SHALL navigate to the symbol's definition site. If the symbol is defined in multiple files, all definitions SHALL be presented.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 16: Hover Information Correctness

*For any* symbol in the resolved scope, hovering over a reference to that symbol SHALL display the symbol's type and definition site. *For any* cross-file symbol, the hover SHALL include the source file path.

**Validates: Requirements 7.1, 7.2**

### Property 17: Undefined Symbol Detection

*For any* symbol reference where the symbol is not in the resolved scope, the diagnostics provider SHALL emit a warning (unless severity is configured to 'off').

**Validates: Requirements 8.1**

### Property 18: Configuration Precedence

*For any* configuration option set in both initialization options and `.stata-lsp.json`, the initialization option value SHALL take precedence.

**Validates: Requirements 11.3**

### Property 19: Error Resilience

*For any* malformed directive, encoding error, or file read error, the LSP SHALL emit appropriate diagnostics and continue processing without crashing.

**Validates: Requirements 12.1, 12.2, 12.5**

### Property 20: File Type Equivalence

*For any* Stata code, parsing and indexing SHALL produce identical results regardless of whether the file extension is `.do`, `.ado`, or `.doh`.

**Validates: Requirements 10.1**

## Error Handling

### Directive Parsing Errors

| Error | Handling | Diagnostic |
|-------|----------|------------|
| Malformed directive syntax | Skip directive, continue parsing | Warning with syntax hint |
| Missing closing quote in path | Skip directive | Warning with location |
| Invalid line= value | Ignore parameter, use default | Warning |
| Empty path | Skip directive | Warning |

### Scope Resolution Errors

| Error | Handling | Diagnostic |
|-------|----------|------------|
| File not found | Skip file, continue chain | Warning with path |
| File read error | Skip file, continue chain | Warning with error message |
| Circular dependency | Break cycle, provide partial scope | Warning with cycle path |
| Match string not found | Fall back to end-of-file | Info |
| Max depth exceeded | Stop recursion | Warning |

### Indexing Errors

| Error | Handling | Diagnostic |
|-------|----------|------------|
| Encoding error | Skip file | Warning logged |
| Parse error | Index partial symbols | Error at location |
| Max files exceeded | Stop indexing | Info logged |

## Testing Strategy

### Unit Tests

1. **Directive Parser**
   - Valid directive syntax (both comment styles)
   - Call site parameters (line=, match=)
   - Path resolution and normalization
   - Malformed directive handling

2. **Scope Resolver**
   - Single-level inheritance
   - Multi-level chains
   - Cycle detection
   - Call site filtering
   - Shadowing

3. **Workspace Indexer**
   - File discovery by extension
   - Symbol extraction
   - Index updates (add, modify, delete, rename)

### Property-Based Tests

Using fast-check for property-based testing with minimum 100 iterations per test.

1. **Directive Parsing Properties** (P1, P2, P3, P4)
2. **Cycle Detection Properties** (P5)
3. **Inheritance Properties** (P6, P7, P8, P9, P10, P11)
4. **Index Lifecycle Properties** (P12)
5. **Completion Properties** (P13, P14)
6. **Definition Properties** (P15)
7. **Hover Properties** (P16)
8. **Diagnostic Properties** (P17)
9. **Configuration Properties** (P18)
10. **Error Handling Properties** (P19)
11. **File Type Properties** (P20)

### Integration Tests

1. **Multi-file scope resolution** - Create test workspace with directive chains
2. **Cross-file navigation** - Test go-to-definition across files
3. **Completion filtering** - Test completion with and without directives
4. **Diagnostic accuracy** - Test undefined symbol detection with cross-file scope

