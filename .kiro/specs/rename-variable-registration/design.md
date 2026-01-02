# Design Document: Rename Variable Registration

## Overview

This feature extends the Stata LSP's semantic analyzer to recognize variables created via the `rename` command. When a user writes `rename oldvar newvar`, the analyzer will register `newvar` as a defined variable in the symbol table, enabling completions, go-to-definition, and suppressing undefined variable warnings.

The implementation follows the existing pattern used for `gen`, `egen`, and `input` commands, adding a new extraction method for rename commands.

## Architecture

The change is localized to the semantic analyzer (`src/analyzer/index.ts`) with a minor type update in `src/types/index.ts`.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Parser                                    │
│  rename oldvar newvar → CommandNode { varlist: [oldvar, newvar] }│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SemanticAnalyzer                              │
│  process_command() → extract_rename_variable()                   │
│                              │                                   │
│                              ▼                                   │
│  symbols.variables.set("newvar", { source: "rename", ... })      │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Components

#### 1. SemanticAnalyzer (`src/analyzer/index.ts`)

Add handling for `rename` and `ren` commands in `process_command()`:

```typescript
private process_command(
    node: CommandNode,
    symbols: SymbolTable,
    current_scope: ScopeInfo,
    node_index: number
): void {
    const cmd_name = node.fullName;

    // Existing handlers...
    if (cmd_name === 'generate' || cmd_name === 'gen') {
        this.extract_gen_variable(node, symbols);
    } else if (cmd_name === 'egen') {
        this.extract_egen_variable(node, symbols);
    } else if (cmd_name === 'input') {
        this.extract_input_variables(node, symbols);
    } else if (cmd_name === 'rename' || cmd_name === 'ren') {
        this.extract_rename_variables(node, symbols);
    }
    // ... rest of existing code
}
```

Add new extraction method:

```typescript
/**
 * Extract variables from rename command.
 * 
 * Supported syntaxes:
 * - rename oldvar newvar
 * - ren oldvar newvar
 * - rename (old1 old2) (new1 new2)
 * 
 * Pattern-based renames (wildcards, stubs) are not supported
 * as they cannot be statically resolved.
 */
private extract_rename_variables(node: CommandNode, symbols: SymbolTable): void {
    if (!node.varlist || node.varlist.length < 2) {
        return;
    }

    // Check for grouped syntax: (old1 old2) (new1 new2)
    // Parser captures parenthesized groups as single varlist items with parens
    const first_item = node.varlist[0].name;
    const second_item = node.varlist[1].name;
    
    if (first_item.startsWith('(') && second_item.startsWith('(')) {
        // Grouped syntax - extract names from second group
        this.extract_grouped_rename_variables(second_item, node.varlist[1].range, symbols);
        return;
    }

    // Simple syntax: rename oldvar newvar
    // Skip if either name contains wildcards (* or ?)
    if (this.contains_wildcard(first_item) || this.contains_wildcard(second_item)) {
        return;
    }

    const new_var = node.varlist[1];
    const var_symbol: VariableSymbol = {
        name: new_var.name,
        location: { uri: this.uri, range: new_var.range },
        sourceUri: this.uri,
        source: 'rename',
    };

    symbols.variables.set(new_var.name, var_symbol);
}

/**
 * Extract variable names from a grouped rename expression.
 * Input: "(new1 new2 new3)" → registers new1, new2, new3
 */
private extract_grouped_rename_variables(
    group_content: string,
    group_range: Range,
    symbols: SymbolTable
): void {
    // Remove parentheses and split by whitespace
    const inner = group_content.slice(1, -1).trim();
    const names = inner.split(/\s+/).filter(n => n.length > 0);

    for (const name of names) {
        // Skip wildcards
        if (this.contains_wildcard(name)) {
            continue;
        }

        const var_symbol: VariableSymbol = {
            name,
            location: { uri: this.uri, range: group_range },
            sourceUri: this.uri,
            source: 'rename',
        };

        symbols.variables.set(name, var_symbol);
    }
}

/**
 * Check if a variable name contains wildcard characters.
 */
private contains_wildcard(name: string): boolean {
    return name.includes('*') || name.includes('?');
}
```

#### 2. VariableSymbol Type (`src/types/index.ts`)

Update the `source` union type to include `'rename'`:

```typescript
export interface VariableSymbol {
  name: string;
  location: { uri: string; range: Range };
  sourceUri: string;
  type?: string;
  label?: string;
  source: 'gen' | 'egen' | 'input' | 'inferred' | 'directive' | 'rename';
}
```

## Data Models

No new data models are introduced. The existing `VariableSymbol` interface is extended with a new source type.

### VariableSymbol (Updated)

| Field | Type | Description |
|-------|------|-------------|
| name | string | Variable name |
| location | { uri: string; range: Range } | Definition location |
| sourceUri | string | Source file URI |
| type | string? | Optional Stata type |
| label | string? | Optional variable label |
| source | 'gen' \| 'egen' \| 'input' \| 'inferred' \| 'directive' \| 'rename' | How the variable was created |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Simple Rename Variable Registration

*For any* valid identifier pair (oldvar, newvar) and command form ('rename' or 'ren'), when the analyzer processes `{cmd} {oldvar} {newvar}`, the symbol table SHALL contain a VariableSymbol for newvar with source='rename' and location matching the newvar token position.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: Grouped Rename Variable Registration

*For any* pair of identifier lists of equal length, when the analyzer processes `rename ({old_list}) ({new_list})`, the symbol table SHALL contain VariableSymbols for all names in new_list with source='rename'.

**Validates: Requirements 2.1**

### Property 3: Wildcard Rename Non-Registration

*For any* rename command containing wildcard characters (* or ?) in either the old or new variable position, the analyzer SHALL NOT register any new variables.

**Validates: Requirements 2.2, 2.3**

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Incomplete command (< 2 varlist items) | Gracefully skip, no variable registered |
| Wildcard patterns | Skip registration (cannot statically resolve) |
| Stub patterns (old* new*) | Skip registration (cannot statically resolve) |
| Macro references in names | Register as-is (may contain unexpanded macro) |

## Testing Strategy

### Unit Tests

- Test `extract_rename_variables` with simple rename syntax
- Test `extract_rename_variables` with abbreviated `ren` form
- Test `extract_grouped_rename_variables` with grouped syntax
- Test wildcard detection and skipping
- Test incomplete command handling

### Property-Based Tests

Property-based tests will use fast-check to generate random valid inputs and verify the correctness properties hold.

**Configuration:**
- Minimum 100 iterations per property test
- Use existing `arbitrary_identifier` generator from `tests/property/generators`

**Test Tags:**
- **Feature: rename-variable-registration, Property 1: Simple rename registration**
- **Feature: rename-variable-registration, Property 2: Grouped rename registration**
- **Feature: rename-variable-registration, Property 3: Wildcard non-registration**

### Test File Location

`tests/property/rename-variable-registration.prop.test.ts`
