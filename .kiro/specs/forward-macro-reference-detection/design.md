# Design Document: Forward Macro Reference Detection

## Overview

This design modifies the Semantic Analyzer to detect forward macro references - cases where a macro is used before it's defined in the execution order. The current implementation builds a complete symbol table first, then checks references, which incorrectly treats macros defined later in the file as "defined" when referenced earlier.

The solution tracks the AST node index where each macro is defined, then compares reference positions against definition positions during the undefined reference detection pass.

## Architecture

The change is localized to `src/analyzer/index.ts`. No new files or components are needed.

### Current Flow (Problematic)
```
1. First pass: Extract comment directives
2. Second pass: Build complete symbol table (all macros registered)
3. Third pass: Check references against complete symbol table
   → Problem: All macros appear "defined" regardless of position
```

### New Flow
```
1. First pass: Extract comment directives
2. Second pass: Build symbol table WITH preorder indices
   → Each MacroSymbol now includes definition_index (preorder)
   → Index increments for EVERY node visited (preorder traversal)
3. Third pass: Check references against symbol table WITH position comparison
   → Reference is undefined if its preorder_index < macro's definition_index
```

## Components and Interfaces

### Modified: MacroSymbol Interface

Add a `definition_index` field to track when the macro was defined:

```typescript
// In src/types/index.ts (or wherever MacroSymbol is defined)
export interface MacroSymbol {
    name: string;
    scope: 'local' | 'global';
    location: Location;
    sourceUri: string;
    value?: string;
    containingScope?: string;
    extendedFunction?: ExtendedFunctionInfo;
    definition_index?: number;  // NEW: Preorder index where macro was defined
}
```

### Modified: SemanticAnalyzer Class

#### New Instance Variable

```typescript
private preorder_index: number = 0;
```

#### Modified: analyze Method

MUST reset the preorder index at the start of each analysis to prevent stale state when the analyzer instance is reused:

```typescript
analyze(ast: StataAST, uri: string, ...): AnalysisResult {
    // MANDATORY FIRST STEP: Reset preorder index for each document
    this.preorder_index = 0;
    
    this.uri = uri;
    this.config = { ...create_default_config(), ...config };
    this.workspace_symbols = workspace_symbols;
    // ... rest of method
}
```

### Unified AST Traversal

To guarantee identical traversal order between build_symbols and detect_undefined_references, we use a shared traversal helper:

```typescript
/**
 * Traverse AST nodes in preorder, calling callback for each node.
 * CRITICAL: Both symbol building and reference checking MUST use this method
 * to ensure identical traversal order.
 */
private traverse_ast_preorder(
    nodes: StataNode[],
    callback: (node: StataNode, index: number) => void
): void {
    for (const node of nodes) {
        const node_index = this.preorder_index++;
        callback(node, node_index);
        
        // Recurse into children (order matters!)
        if (node.type === 'program') {
            this.traverse_ast_preorder(node.body, callback);
        } else if (this.is_control_flow(node)) {
            this.traverse_ast_preorder(node.body, callback);
        }
    }
}
```

#### Modified: build_symbols Method

Uses the shared traversal helper:

```typescript
private build_symbols(
    nodes: StataNode[],
    symbols: SymbolTable,
    current_scope: ScopeInfo,
    all_scopes: ScopeInfo[]
): void {
    this.traverse_ast_preorder(nodes, (node, node_index) => {
        this.process_node(node, symbols, current_scope, all_scopes, node_index);
    });
}
```

#### Modified: detect_undefined_references Method

Uses the same shared traversal helper:

```typescript
private detect_undefined_references(
    nodes: StataNode[],
    symbols: SymbolTable,
    diagnostics: SemanticDiagnostic[],
    reported_ranges: Set<string>
): void {
    // Reset index for reference pass (MUST match build_symbols traversal)
    this.preorder_index = 0;
    
    this.traverse_ast_preorder(nodes, (node, node_index) => {
        this.check_node_references(node, symbols, diagnostics, reported_ranges, node_index);
    });
}
```

#### Modified: process_macro_def Method

Store the current preorder index when registering a macro. Only store the first definition's index:

```typescript
private process_macro_def(
    node: MacroDefNode,
    symbols: SymbolTable,
    current_scope: ScopeInfo,
    node_index: number
): void {
    // Check if macro already exists (for "first definition wins" rule)
    const existing = node.scope === 'local' 
        ? symbols.localMacros.get(node.name)
        : symbols.globalMacros.get(node.name);
    
    // RULE: If macro already exists with a definition_index, preserve it.
    // Otherwise use current node_index. This handles:
    // - First definition: no existing → use node_index
    // - Redefinition: existing with index → preserve existing index
    // - Legacy symbol without index: existing but no index → use node_index
    const definition_index = existing?.definition_index ?? node_index;
    
    const macro_symbol: MacroSymbol = {
        name: node.name,
        scope: node.scope,
        location: { uri: this.uri, range: node.range },
        sourceUri: this.uri,
        value: node.value,
        containingScope: current_scope.type,
        extendedFunction: node.extendedFunction,
        definition_index,
    };
    // ... rest of method (register in symbol table)
}
```

#### Modified: process_loop Method

Loop variables are defined at the loop header node:

```typescript
private process_loop(
    node: ControlFlowNode,
    symbols: SymbolTable,
    current_scope: ScopeInfo,
    all_scopes: ScopeInfo[],
    node_index: number
): void {
    if (node.loopVar) {
        const macro_symbol: MacroSymbol = {
            name: node.loopVar,
            scope: 'local',
            location: { uri: this.uri, range: node.range },
            sourceUri: this.uri,
            containingScope: current_scope.type,
            definition_index: node_index,  // Loop header's index
        };
        current_scope.localMacros.set(node.loopVar, macro_symbol);
        symbols.localMacros.set(node.loopVar, macro_symbol);
    }
    // Note: body traversal handled by traverse_ast_preorder
}
```

#### Modified: is_macro_defined Method

Add position-aware checking:

```typescript
private is_macro_defined(
    name: string,
    scope: 'local' | 'global',
    symbols: SymbolTable,
    reference_index?: number
): boolean {
    if (scope === 'local') {
        if (this.is_positional_argument(name)) {
            return true;
        }
        if (this.might_be_defined_elsewhere(name)) {
            return true;
        }
        const macro = symbols.localMacros.get(name);
        if (macro) {
            // Forward reference check: definition must come before reference
            if (reference_index !== undefined && 
                macro.definition_index !== undefined &&
                macro.definition_index > reference_index) {
                return false;  // Forward reference
            }
            return true;
        }
    } else {
        // Check file-local global first
        const macro = symbols.globalMacros.get(name);
        if (macro) {
            if (reference_index !== undefined && 
                macro.definition_index !== undefined &&
                macro.definition_index > reference_index) {
                return false;  // Forward reference
            }
            return true;
        }
        // Workspace globals: defined in OTHER files, indexed by workspace indexer
        // These bypass position checking because they're external definitions
        if (this.workspace_symbols?.globalMacros.has(name)) {
            return true;
        }
    }
    return false;
}
```

## Data Models

### Preorder Index Assignment Example

Concrete example showing exact index assignment for nested structures:

```stata
* Index 0: local a 1
local a 1
* Index 1: program foo
program foo
    * Index 2: di "`x'"  ← Forward reference! (x defined at index 3)
    di "`x'"
    * Index 3: local x value
    local x value
    * Index 4: di "`x'"  ← OK (x defined at index 3)
    di "`x'"
end
* Index 5: local b 2
local b 2
```

Loop variable example:
```stata
* Index 0: di "`i'"  ← Forward reference! (i defined at index 1)
di "`i'"
* Index 1: foreach i in 1 2 3 {  ← Loop variable `i` defined here
foreach i in 1 2 3 {
    * Index 2: di "`i'"  ← OK (i defined at index 1)
    di "`i'"
}
* Index 3: di "`i'"  ← OK (i still defined from index 1)
di "`i'"
```

### Index Reset

The `preorder_index` MUST be reset to 0 at the start of each `analyze()` call. This is critical because:
- The SemanticAnalyzer instance may be reused across multiple documents
- Stale index values would cause incorrect forward reference detection
- The reset MUST happen BEFORE any other initialization

### Multiple Definitions Rule

When a macro is defined multiple times, only the first definition's index is stored:

```stata
* Index 0: di "`x'"  ← Forward reference (x first defined at index 1)
di "`x'"
* Index 1: local x a  ← First definition, definition_index = 1
local x a
* Index 2: di "`x'"  ← OK (1 < 2)
di "`x'"
* Index 3: local x b  ← Redefinition, definition_index stays 1
local x b
* Index 4: di "`x'"  ← OK (1 < 4)
di "`x'"
```

Rationale: The macro becomes "available" at its first definition point. This matches Stata's behavior.

### Workspace Globals vs File-Local Globals

- **Workspace globals**: Defined in OTHER files, indexed by the workspace indexer. These have no `definition_index` in the current file's symbol table and bypass position checking entirely.
- **File-local globals**: Defined in the current file with `global name value`. These have a `definition_index` and are subject to forward reference detection.

If `workspace_symbols` is undefined or empty, only file-local globals are checked.

### Macro Registration Points (Complete List)

All methods that add macros to the symbol table MUST set `definition_index`:

1. `process_macro_def` - `local`/`global` commands
2. `process_loop` - `foreach`/`forvalues` loop variables
3. `extract_tempvar_macro` - `tempvar`/`tempfile`/`tempname` commands
4. `extract_unab_macro` - `unab` command
5. `register_implicit_locals` - `syntax` command implicit locals

Search pattern to verify completeness:
```
grep -n "localMacros.set\|globalMacros.set" src/analyzer/index.ts
```

## Performance Considerations

The preorder index increment adds O(1) work per node. For a file with N nodes:
- Additional memory: One integer per MacroSymbol (~8 bytes)
- Additional CPU: One increment + one comparison per node

Estimated impact for a 10,000-node file: ~0.1ms additional processing time. This is negligible compared to parsing and lexing costs.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system.*

### Property 1: Forward references produce warnings

*For any* Stata code where a local or global macro reference appears in an AST node that precedes the macro's definition node, the analyzer SHALL produce an undefined macro warning for that reference.

**Validates: Requirements 1.1, 2.1**

### Property 2: Properly ordered references produce no warnings

*For any* Stata code where a macro is defined before it is referenced (definition node precedes reference node in preorder), the analyzer SHALL NOT produce an undefined macro warning for that reference.

**Validates: Requirements 1.2, 3.1**

### Property 3: First definition determines forward reference boundary

*For any* Stata code with multiple definitions of the same macro, references before the first definition SHALL produce warnings, and references after the first definition SHALL NOT produce warnings.

**Validates: Requirements 1.3**

### Property 4: Workspace globals bypass position checking

*For any* global macro defined in workspace symbols (from another file), references to that macro SHALL NOT produce warnings regardless of their position in the current file.

**Validates: Requirements 2.2**

### Property 5: Loop variables are defined at loop header

*For any* foreach or forvalues loop, references to the loop variable within the loop body SHALL NOT produce warnings (body nodes have higher preorder indices than the loop header), but references before the loop SHALL produce warnings.

**Validates: Requirements 3.2**

### Property 6: Positional arguments are always defined

*For any* reference to a positional argument (`0', `1', `2', etc.), the analyzer SHALL NOT produce an undefined macro warning regardless of preorder index.

**Validates: Requirements 4.1**

### Property 7: Nested forward references are detected

*For any* program block containing a macro reference before an inner local definition (both within the same program), the analyzer SHALL produce an undefined macro warning for the reference (nested nodes have distinct preorder indices).

**Validates: Requirements 3.5**

## Error Handling

### Edge Cases

1. **Empty files**: No nodes to process, no diagnostics produced
2. **Macro-only files**: Files with only macro definitions and no references produce no diagnostics
3. **Circular references**: Not possible in Stata's sequential execution model
4. **Nested scopes**: Each node gets a unique preorder index regardless of nesting depth

### Error Messages

The existing error message format is preserved:
- Local macros: `Undefined local macro: \`name'`
- Global macros: `Undefined global macro: name`

Future enhancement (optional): Consider adding definition location hint:
- `Local macro \`name' used before definition (defined on line X)`

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Basic forward reference**: `di "`x'"` followed by `local x value` → warning
2. **Proper order**: `local x value` followed by `di "`x'"` → no warning
3. **Same-line with semicolon delimiter**: `#delimit ;` then `di "`x'" ; local x value ;` → warning
4. **Same-line proper order**: `#delimit ;` then `local x value ; di "`x'" ;` → no warning
5. **Loop variable inside body**: `foreach i in 1 2 { di "`i'" }` → no warning
6. **Loop variable before loop**: `di "`i'"` then `foreach i in 1 2 { }` → warning
7. **Multiple definitions**: `di "`x'"` then `local x a` then `local x b` → warning
8. **Global in workspace**: Reference to workspace-defined global → no warning
9. **Positional arguments**: Reference to `\`1'` → no warning
10. **Nested forward reference in program**: `program foo` with `di "`x'"` before `local x value` inside → warning
11. **tempvar before reference**: `tempvar t` then `di "``t''"` → no warning
12. **Reference before tempvar**: `di "``t''"` then `tempvar t` → warning
13. **@lsp-ignore-next with forward reference**: `// @lsp-ignore-next` then `di "`x'"` then `local x value` → no warning
14. **Embedded Mata block**: `mata: ... "`x'" ...` → no Stata macro warning
15. **Analyzer reuse**: Call analyze() twice on different documents, verify indices reset correctly

### Property-Based Tests

Property-based tests verify universal properties across many generated inputs using fast-check:

1. **Forward reference detection**: Generate random macro definitions and references, verify warnings match position ordering
2. **No false positives**: Generate properly-ordered code, verify no warnings produced
3. **First definition wins**: Generate code with multiple definitions, verify first definition's position is used

Each property test should run minimum 100 iterations and be tagged with the property it validates.

**Testing Framework**: Use fast-check for property-based testing (already used in the project).

### Test Execution

Run tests with: `bun test`

Success criteria:
- All new tests pass
- Full test suite passes (no regressions)
- Property tests complete 100+ iterations without failures
