# Design Document: Current File Forward Call Resolution

## Overview

This design extends the `ScopeResolver` to process forward calls (both directives and commands) from the current file, making symbols from target files visible in hover, completion, and diagnostics.

Forward calls include:
- **Directives**: `@lsp-do`, `@lsp-run`, `@lsp-include` (comment-based)
- **Commands**: `do`, `run`, `include` (actual Stata commands)

Both types are treated equivalently for symbol inheritance purposes.

## Architecture

The current architecture processes:
1. Backward directives → parent file symbols
2. Parent file forward calls → grandparent file symbols (before call site)

The enhancement adds:
3. Current file forward calls → target file symbols (after call site line)

```
ScopeResolver.resolve()
    ├── Parse current file directives
    ├── Follow backward directive chain (existing)
    ├── Resolve parent forward calls (existing)
    ├── Parse current file forward calls [NEW]
    │   ├── From directives (@lsp-do, @lsp-run, @lsp-include)
    │   └── From commands (do, run, include)
    └── Resolve current file forward calls [NEW]
        ├── For each include (directive or command): include all symbols (including locals)
        └── For each do/run (directive or command): include non-local symbols only
```

## Components and Interfaces

### Modified: ScopeResolver.resolve()

Add processing of forward calls from the current file (both directives and commands):

```typescript
async resolve(file_uri: string, file_content: string, ...): Promise<ResolvedScope> {
    // ... existing backward directive resolution ...
    
    // NEW: Get forward calls from current file
    // This includes both:
    // - Directives: @lsp-do, @lsp-run, @lsp-include (from directive_parser)
    // - Commands: do, run, include (from analyzer)
    const current_file_forward_calls = this.get_current_file_forward_calls(
        file_content, 
        file_uri
    );
    
    if (current_file_forward_calls.length > 0 && this.forward_scope_resolver) {
        const forward_symbols = await this.forward_scope_resolver.resolve(
            file_uri,
            current_file_forward_calls,
            'include', // effective call type for current file
            { working_directory: own_working_directory || inherited_working_directory }
        );
        
        // Merge forward symbols into resolved scope
        // Each symbol should track its visibility_after_line
    }
    
    return resolved_scope;
}
```

### New: Position-Aware Symbol Visibility

Symbols from forward calls need to track when they become visible:

```typescript
interface ForwardCallSymbol {
    symbol: MacroSymbol | VariableSymbol | ...;
    visible_after_line: number; // 0-indexed line of the directive
}
```

### Modified: HoverProvider / CompletionProvider

Check position against `visible_after_line` when looking up symbols from forward calls.

## Data Models

### Extended ResolvedScope

```typescript
interface ResolvedScope {
    // ... existing fields ...
    
    // NEW: Symbols from current file's forward calls, with visibility info
    forward_call_symbols?: {
        localMacros: Map<string, ForwardCallSymbol>;
        globalMacros: Map<string, ForwardCallSymbol>;
        programs: Map<string, ForwardCallSymbol>;
        // ... etc
    };
}
```

## Implementation Notes

1. The `ForwardScopeResolver` already handles the inheritance rules (include vs do/run)
2. The `DirectiveParser.parse_forward_call_directives()` already parses forward calls
3. Main work is wiring these together in `ScopeResolver.resolve()` and updating providers to check position

## Duplicate File Handling

The `ForwardScopeResolver.should_process_call()` method handles duplicate file references:

| Previous Call Type | Current Call Type | Action |
|-------------------|-------------------|--------|
| (none) | any | Process normally |
| `include` | any | Skip (all symbols already included) |
| `do`/`run` | `do`/`run` | Skip (non-locals already included) |
| `do`/`run` | `include` | Add locals only |

This ensures efficient processing without redundant symbol extraction.

## Forward-Only Resolution

When resolving forward calls, the `ForwardScopeResolver`:
- Extracts symbols defined directly in the target file
- Recursively follows the target file's own forward calls
- Does NOT follow backward directives (`@lsp-done-by`, `@lsp-included-by`) in target files

This prevents unexpected inheritance chains and keeps resolution predictable.

## Testing Strategy

- Unit tests for forward call parsing from current file
- Integration tests for hover/completion with forward call directives and commands
- Integration tests for duplicate file handling (do-then-include, include-then-do)
- Integration tests for forward-only resolution (no backward directive following)
- Property tests for position-aware visibility
