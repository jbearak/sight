# Design Document: Confirm Variable Registration

## Overview

This feature extends the Stata LSP's semantic analyzer to recognize variables referenced via the `confirm variable` (or `confirm var`) command. When a user writes `confirm variable myvar` or `capture confirm var myvar`, the analyzer will register `myvar` as a defined variable in the symbol table, enabling completions, go-to-definition, and suppressing undefined variable warnings.

The `confirm variable` command is commonly used in Stata to verify that a variable exists before operating on it. When the LSP sees this command, it's a strong signal that the variable is expected to exist in the dataset.

The implementation follows the existing pattern used for `gen`, `egen`, `input`, and `rename` commands, adding a new extraction method for confirm variable commands.

## Architecture

The change is localized to the semantic analyzer (`src/analyzer/index.ts`) with a minor type update in `src/types/index.ts`.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Parser                                    │
│  confirm variable myvar → CommandNode {                          │
│    name: "confirm",                                              │
│    varlist: [{name: "variable"}, {name: "myvar"}]               │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SemanticAnalyzer                              │
│  process_command() → extract_confirm_variable()                  │
│                              │                                   │
│                              ▼                                   │
│  symbols.variables.set("myvar", { source: "confirm", ... })      │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Components

#### 1. SemanticAnalyzer (`src/analyzer/index.ts`)

Add handling for `confirm` command in `process_command()`:

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
    } else if (cmd_name === 'confirm') {
        this.extract_confirm_variable(node, symbols);
    }
    // ... rest of existing code
}
```

Add new extraction method:

```typescript
/**
 * Extract variable from confirm variable command.
 * 
 * Supported syntaxes:
 * - confirm variable varname [, exact]
 * - confirm var varname [, exact]
 * - capture confirm variable varname
 * - capture: confirm var varname
 * - quietly confirm variable varname
 * 
 * The parser produces a CommandNode with:
 * - name: "confirm"
 * - varlist: [{name: "variable"|"var"}, {name: varname}, ...]
 * 
 * We check if the first varlist item is "variable" or "var",
 * then register the second varlist item as the variable.
 */
private extract_confirm_variable(node: CommandNode, symbols: SymbolTable): void {
    if (!node.varlist || node.varlist.length < 2) {
        return;
    }

    const first_item = node.varlist[0].name.toLowerCase();
    
    // Check if this is a "confirm variable" or "confirm var" command
    if (first_item !== 'variable' && first_item !== 'var') {
        return;
    }

    // The second item is the variable name
    const var_node = node.varlist[1];
    
    const var_symbol: VariableSymbol = {
        name: var_node.name,
        location: { uri: this.uri, range: var_node.range },
        sourceUri: this.uri,
        source: 'confirm',
    };

    symbols.variables.set(var_node.name, var_symbol);
}
```

#### 2. VariableSymbol Type (`src/types/index.ts`)

Update the `source` union type to include `'confirm'`:

```typescript
export interface VariableSymbol {
  name: string;
  location: { uri: string; range: Range };
  sourceUri: string;
  type?: string;
  label?: string;
  source: 'gen' | 'egen' | 'input' | 'inferred' | 'directive' | 'rename' | 'confirm';
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
| source | 'gen' \| 'egen' \| 'input' \| 'inferred' \| 'directive' \| 'rename' \| 'confirm' | How the variable was created |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Confirm Variable Registration

*For any* valid identifier and command form ('confirm variable' or 'confirm var'), when the analyzer processes the command, the symbol table SHALL contain a VariableSymbol for the variable name with source='confirm' and location matching the variable name token position.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

### Property 2: Prefixed Confirm Variable Registration

*For any* prefix command combination (capture, capture:, quietly, noisily, or combinations thereof) followed by 'confirm variable varname', the analyzer SHALL register the variable in the symbol table with source='confirm'.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 3: Confirm Variable with Options

*For any* 'confirm variable varname' command with options (e.g., 'exact'), the analyzer SHALL register the variable in the symbol table with source='confirm'.

**Validates: Requirements 3.1, 3.2**

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Incomplete command (< 2 varlist items) | Gracefully skip, no variable registered |
| Non-variable confirm subcommand (e.g., `confirm file`) | Skip registration (not a variable confirmation) |
| Macro references in variable name | Register as-is (may contain unexpanded macro) |

## Testing Strategy

### Unit Tests

- Test `extract_confirm_variable` with simple `confirm variable varname` syntax
- Test `extract_confirm_variable` with abbreviated `confirm var varname` form
- Test with `exact` option
- Test incomplete command handling
- Test non-variable confirm subcommands (should not register)

### Property-Based Tests

Property-based tests will use fast-check to generate random valid inputs and verify the correctness properties hold.

**Configuration:**
- Minimum 100 iterations per property test
- Use existing `arbitrary_identifier` generator from `tests/property/generators`

**Test Tags:**
- **Feature: confirm-variable-registration, Property 1: Confirm variable registration**
- **Feature: confirm-variable-registration, Property 2: Prefixed confirm variable registration**
- **Feature: confirm-variable-registration, Property 3: Confirm variable with options**

### Test File Location

`tests/property/confirm-variable-registration.prop.test.ts`
