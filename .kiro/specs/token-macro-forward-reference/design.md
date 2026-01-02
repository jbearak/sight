# Design Document: Token-Only Macro Forward Reference Detection

## Overview

This design extends the forward macro reference detection (from the parent spec) to cover token-only macro references. Currently, `check_token_macro_references` calls `is_macro_defined` without a `reference_index`, so token-only references bypass position checking. This creates inconsistent behavior.

The solution derives a position indicator from token line/character positions and passes it to `is_macro_defined`.

## Architecture

The change is localized to `src/analyzer/index.ts`, specifically the `check_token_macro_references` method.

### Current Flow (Problematic)
```
check_token_macro_references(tokens, symbols, diagnostics, reported_ranges):
    for each token:
        if MACRO_REF_LOCAL or MACRO_REF_GLOBAL:
            is_macro_defined(name, scope, symbols)  // No reference_index!
            → Forward references not detected for token-only refs
```

### New Flow
```
check_token_macro_references(tokens, symbols, diagnostics, reported_ranges):
    for each token:
        if MACRO_REF_LOCAL or MACRO_REF_GLOBAL:
            token_index = derive_token_index(token)
            is_macro_defined(name, scope, symbols, token_index)
            → Forward references detected consistently
```

## Components and Interfaces

### Token Index Derivation Strategy

The challenge is making token positions comparable to AST preorder indices. Two approaches:

**Option A: Line-based index (Recommended)**
Use the token's start line as a proxy for position. This works because:
- AST nodes have ranges with start lines
- Macro definitions store their range in `MacroSymbol.location`
- Line order generally matches execution order

```typescript
private derive_token_index(token: Token): number {
    // Use line number as position proxy
    // Multiply by large factor to leave room for multiple items per line
    return token.range.start.line * 10000 + token.range.start.character;
}
```

**Option B: Build token-to-AST-index map**
During AST traversal, build a map from line ranges to preorder indices. Then look up tokens in this map. More accurate but more complex.

**Decision: Option A** - Line-based index is simpler and sufficient for most cases. The `definition_index` stored in `MacroSymbol` can also be converted to a line-based value for comparison, OR we can store the definition line alongside the preorder index.

### Modified: MacroSymbol Interface

Add `definition_line` field for token-based comparison:

```typescript
export interface MacroSymbol {
    name: string;
    scope: 'local' | 'global';
    location: Location;
    sourceUri: string;
    value?: string;
    containingScope?: string;
    extendedFunction?: ExtendedFunctionInfo;
    definition_index?: number;      // Preorder index (for AST refs)
    definition_line?: number;       // NEW: Line number (for token refs)
}
```

### Modified: Macro Registration

When registering macros, also store the definition line:

```typescript
const macro_symbol: MacroSymbol = {
    // ... existing fields
    definition_index: existing?.definition_index ?? node_index,
    definition_line: existing?.definition_line ?? node.range.start.line,
};
```

### Modified: is_macro_defined Method

Accept either preorder index or line-based index:

```typescript
private is_macro_defined(
    name: string,
    scope: 'local' | 'global',
    symbols: SymbolTable,
    reference_index?: number,
    reference_line?: number  // NEW: for token-based checks
): boolean {
    // ... existing logic for reference_index
    
    // NEW: Line-based check for token references
    if (reference_line !== undefined && macro.definition_line !== undefined) {
        if (macro.definition_line > reference_line) {
            return false;  // Forward reference
        }
    }
    // ... rest of method
}
```

### Modified: check_token_macro_references Method

Pass token line to `is_macro_defined`:

```typescript
private check_token_macro_references(
    tokens: Token[],
    symbols: SymbolTable,
    diagnostics: SemanticDiagnostic[],
    reported_ranges: Set<string>
): void {
    for (const token of tokens) {
        if (this.config.ignored_lines.has(token.range.start.line)) {
            continue;
        }
        
        const range_key = /* ... */;
        if (reported_ranges.has(range_key)) {
            continue;
        }
        
        const token_line = token.range.start.line;  // NEW
        
        if (token.type === 'MACRO_REF_LOCAL') {
            const macro_name = this.extract_local_macro_name(token.value);
            if (macro_name && !this.is_macro_defined(
                macro_name, 
                'local', 
                symbols, 
                undefined,      // No preorder index for tokens
                token_line      // NEW: Pass token line
            )) {
                diagnostics.push(/* ... */);
            }
        } else if (token.type === 'MACRO_REF_GLOBAL') {
            const macro_name = this.extract_global_macro_name(token.value);
            if (macro_name && !this.is_macro_defined(
                macro_name, 
                'global', 
                symbols, 
                undefined,
                token_line      // NEW: Pass token line
            )) {
                diagnostics.push(/* ... */);
            }
        }
    }
}
```

## Data Models

### Line-Based Position Comparison

For token-only references, we compare line numbers:
- Token reference line vs macro definition line
- If `definition_line > reference_line`, it's a forward reference

This is simpler than preorder indices but has a limitation: multiple statements on the same line (with `#delimit ;`) may not be ordered correctly. However:
1. Token-only references are rare edge cases
2. Same-line ordering is already handled by AST-based detection for most cases
3. The line-based approach catches the vast majority of forward references

### Dual Index Storage

MacroSymbol now stores both:
- `definition_index`: Preorder index for AST-based comparison
- `definition_line`: Line number for token-based comparison

Both use "first definition wins" - only the first definition's values are stored.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system.*

### Property 1: Token forward references produce warnings

*For any* token-only macro reference that appears on a line before the macro's definition line, the analyzer SHALL produce an undefined macro warning.

**Validates: Requirements 1.1, 1.3**

### Property 2: Token properly-ordered references produce no warnings

*For any* token-only macro reference that appears on a line after the macro's definition line (or references a workspace global), the analyzer SHALL NOT produce an undefined macro warning.

**Validates: Requirements 1.2, 1.4**

### Property 3: Token-AST consistency

*For any* macro reference that exists in both AST and token form, the forward reference detection result SHALL be identical.

**Validates: Requirements 2.1, 2.2**

### Property 4: Token first-definition-wins

*For any* macro with multiple definitions, token-only references SHALL use the first definition's line for forward reference detection.

**Validates: Requirements 2.3**

## Error Handling

### Edge Cases

1. **Same-line token and definition**: If a token reference and definition are on the same line, no warning is produced (definition_line == reference_line is not a forward reference)
2. **Token in comment**: Macro references in comments are still checked (this is existing behavior)
3. **Missing definition_line**: If a macro has no definition_line (legacy or external), skip line-based check

### Error Messages

Same format as AST-based detection:
- Local macros: `Undefined local macro: \`name'`
- Global macros: `Undefined global macro: name`

## Testing Strategy

### Unit Tests

1. **Token forward reference**: Token-only `\`x'` before `local x value` → warning
2. **Token proper order**: `local x value` before token-only `\`x'` → no warning
3. **Token workspace global**: Token reference to workspace global → no warning
4. **Token multiple definitions**: Token reference before first definition → warning
5. **Token same-line**: Token and definition on same line → no warning (edge case)

### Property-Based Tests

1. **Token forward detection**: Generate token-only references before definitions, verify warnings
2. **Token-AST consistency**: Generate references in both forms, verify identical results

Each property test should run minimum 100 iterations.

**Testing Framework**: Use fast-check for property-based testing.

### Test Execution

Run tests with: `bun test`
