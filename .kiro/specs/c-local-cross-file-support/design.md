# Design Document: c_local Cross-File Support

## Overview

This design extends the Stata LSP's `c_local` support to work across files. The current implementation only recognizes `c_local` macros from programs defined in the same file. This design adds support for:

1. Looking up programs from workspace-indexed symbols
2. Preserving `c_locals` through forward scope resolution
3. Preserving `c_locals` through backward directive resolution

The key insight is that the analyzer already extracts `c_locals` from program definitions and the `merge_symbol_tables` function already preserves them. The missing piece is passing workspace symbols to the analyzer so it can look up programs not defined in the current file.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Document Store                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐  │
│  │   Lexer     │───▶│   Parser    │───▶│       Analyzer          │  │
│  └─────────────┘    └─────────────┘    │  ┌───────────────────┐  │  │
│                                         │  │ process_command() │  │  │
│                                         │  │                   │  │  │
│                                         │  │ 1. Check local    │  │  │
│                                         │  │    symbols.programs│  │  │
│                                         │  │                   │  │  │
│                                         │  │ 2. Check workspace │  │  │
│                                         │  │    symbols.programs│  │  │
│                                         │  │                   │  │  │
│                                         │  │ 3. Register c_locals│  │  │
│                                         │  └───────────────────┘  │  │
│                                         └─────────────────────────┘  │
│                                                      ▲               │
│                                                      │               │
│                                         ┌────────────┴────────────┐  │
│                                         │   Workspace Indexer     │  │
│                                         │   (provides programs    │  │
│                                         │    with c_locals)       │  │
│                                         └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Components

#### 1. SemanticAnalyzer (`src/analyzer/index.ts`)

The analyzer will be modified to:
- Accept an optional `workspace_symbols` parameter (re-enabling the currently deprecated parameter)
- Store workspace symbols as an instance field during analysis
- Look up programs in workspace symbols when not found in local symbols

```typescript
// Modified analyze method signature (re-enable workspace_symbols)
analyze(
    ast: StataAST,
    uri: string,
    workspace_symbols?: SymbolTable,  // Re-enabled
    config?: Partial<AnalyzerConfig>,
    tokens?: Token[]
): AnalysisResult

// New instance field
private workspace_symbols?: SymbolTable;

// Modified process_command to check workspace symbols
private process_command(
    node: CommandNode,
    symbols: SymbolTable,
    current_scope: ScopeInfo,
    all_scopes: ScopeInfo[],
    node_index: number
): void {
    // ... existing code ...
    
    // Check if command is a known program with c_locals
    // First check local symbols, then workspace symbols
    let program = symbols.programs.get(cmd_name);
    if (!program && this.workspace_symbols) {
        program = this.workspace_symbols.programs.get(cmd_name);
    }
    
    if (program?.c_locals) {
        // Register c_locals in caller scope (existing logic)
    }
}
```

#### 2. DocumentStore (`src/document-store.ts`)

The document store will be modified to pass workspace symbols to the analyzer:

```typescript
// Modified update_document to pass workspace symbols
private async update_document(
    uri: string,
    version: number,
    content: string,
    analyzer: SemanticAnalyzer,
    workspace_symbols?: SymbolTable  // New parameter
): Promise<DocumentState> {
    // ... existing code ...
    
    const analyze_result = await with_parse_timeout(() =>
        analyzer.analyze(
            parse_result.result!.ast,
            uri,
            workspace_symbols,  // Pass workspace symbols
            {
                working_directory: resolved_working_directory,
                workspace_root: this.workspace_root,
            },
            lex_result.result!.tokens
        )
    );
}
```

#### 3. Server Handlers (`src/server-handlers.ts`)

The server handlers will be modified to pass workspace symbols when updating documents:

```typescript
// In didChangeTextDocument handler
const workspace_symbols = workspace_indexer?.get_all_symbols();
await document_store.update(uri, version, content, analyzer, workspace_symbols);
```

### Unchanged Components

The following components already handle `c_locals` correctly and require no changes:

- **WorkspaceIndexer**: Already uses the analyzer which extracts `c_locals`
- **ScopeResolver**: Already uses `merge_symbol_tables` which preserves `c_locals`
- **ForwardScopeResolver**: Already uses `merge_symbol_tables` which preserves `c_locals`
- **merge_symbol_tables**: Already preserves all `ProgramSymbol` properties including `c_locals`

## Data Models

### Existing Types (No Changes Required)

```typescript
// ProgramSymbol already has c_locals field
export interface ProgramSymbol {
    name: string;
    location: { uri: string; range: Range };
    sourceUri: string;
    parameters?: string[];
    signature?: ProgramSignature;
    c_locals?: string[];  // Already exists
}

// MacroSymbol already has definition_index for forward reference detection
export interface MacroSymbol {
    name: string;
    scope: 'local' | 'global';
    location: { uri: string; range: Range };
    sourceUri: string;
    value?: string;
    containingScope?: ScopeType;
    extendedFunction?: ExtendedMacroFunction;
    definition_index?: number;  // Already exists
    definition_line?: number;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Workspace c_local Suppression

*For any* workspace-indexed program with `c_locals`, when that program is called and its `c_local` macros are subsequently referenced, the Analyzer SHALL NOT emit undefined macro warnings for those macros.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Same-File c_local Preservation

*For any* program defined in the same file with `c_locals`, the existing behavior SHALL be preserved: calling the program and referencing its `c_local` macros SHALL NOT emit undefined macro warnings.

**Validates: Requirements 1.4**

### Property 3: Forward Scope c_local Preservation

*For any* file resolved via forward scope (`do`/`run`/`include`) containing programs with `c_locals`, those `c_locals` SHALL be available for suppressing undefined macro warnings after the call site.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 4: Backward Scope c_local Preservation

*For any* file resolved via backward directives (`@lsp-done-by`/`@lsp-included-by`) containing programs with `c_locals`, those `c_locals` SHALL be available for suppressing undefined macro warnings after the program is called.

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 5: c_local Definition Position

*For any* program call that creates `c_local` macros, those macros SHALL have their `definition_index` set to the call site's preorder index.

**Validates: Requirements 4.1**

### Property 6: c_local Forward Reference Detection

*For any* `c_local` macro referenced before the program call that creates it, the Analyzer SHALL emit a forward reference warning.

**Validates: Requirements 4.2**

### Property 7: c_local Post-Call Reference

*For any* `c_local` macro referenced after the program call that creates it, the Analyzer SHALL NOT emit an undefined macro warning.

**Validates: Requirements 4.3**

### Property 8: Workspace Symbols Lookup Fallback

*For any* program not defined in the current file but present in workspace symbols, the Analyzer SHALL find it when looking up programs for `c_local` registration.

**Validates: Requirements 5.2, 5.3**

## Error Handling

### Missing Workspace Symbols

When workspace symbols are not provided (e.g., during initial indexing or in tests), the analyzer falls back to current-file-only behavior. This is the existing behavior and ensures backward compatibility.

### Program Not Found

When a command doesn't match any program in local or workspace symbols, no `c_locals` are registered. This is expected behavior for built-in commands and undefined programs.

### Circular Dependencies

The existing cycle detection in ScopeResolver and ForwardScopeResolver handles circular dependencies. The `c_local` feature doesn't introduce new cycle risks since it only reads program metadata, not file content.

## Testing Strategy

### Unit Tests

Unit tests will verify:
- Analyzer accepts workspace symbols parameter
- Analyzer looks up programs in workspace symbols when not found locally
- c_locals are registered from workspace programs
- Backward compatibility when workspace symbols are not provided

### Property-Based Tests

Property-based tests will verify the correctness properties using fast-check:
- Generate random programs with c_locals
- Generate random call sequences
- Verify no false-positive warnings for c_local macros
- Verify forward reference detection still works

Each property test will run a minimum of 100 iterations and be tagged with the property it validates.

### Integration Tests

Integration tests will verify end-to-end behavior:
- Real file scenarios like the `bh_merge` example
- Cross-file resolution with forward and backward directives
- Workspace indexing preserves c_locals
