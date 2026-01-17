# Design Document: Macro Reference Variable Registration Bug Fix

## Overview

This design addresses a bug in the Stata LSP analyzer where macro references (both local and global) are incorrectly registered as variable symbols. The fix adds a guard check to all variable extraction functions to skip varlist items that are macro references rather than plain identifiers.

The implementation introduces a reusable helper function `is_macro_reference()` that detects both local macro references (`` `name' ``) and global macro references (`$name`, `${name}`). This function is then used consistently across all five affected variable extraction functions.

## Architecture

The change is localized to the semantic analyzer (`src/analyzer/index.ts`). No changes are needed to the parser, lexer, or type definitions.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Parser                                    │
│  confirm variable `my_var' → CommandNode {                       │
│    name: "confirm",                                              │
│    varlist: [{name: "variable"}, {name: "`my_var'"}]            │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SemanticAnalyzer                              │
│  extract_confirm_variable() → is_macro_reference("`my_var'")    │
│                              │                                   │
│                              ▼                                   │
│  Returns true → SKIP registration (no VariableSymbol created)    │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Components

#### 1. SemanticAnalyzer (`src/analyzer/index.ts`)

Add a new helper method to detect macro references:

```typescript
/**
 * Check if a varlist item name is a macro reference rather than a plain identifier.
 * 
 * Local macro references: `name' (backtick + name + single quote)
 * Global macro references: $name or ${name}
 * 
 * @param name - The varlist item name to check
 * @returns true if the name is a macro reference, false if it's a plain identifier
 */
private is_macro_reference(name: string): boolean {
    // Local macro reference: starts with backtick and ends with single quote
    if (name.startsWith('`') && name.endsWith("'")) {
        return true;
    }
    
    // Global macro reference: starts with $ or ${
    if (name.startsWith('$')) {
        return true;
    }
    
    return false;
}
```

#### 2. extract_confirm_variable (lines 1478-1502)

Add guard check before registering variable:

```typescript
private extract_confirm_variable(node: CommandNode, symbols: SymbolTable): void {
    if (!node.varlist || node.varlist.length < 2) {
        return;
    }

    const first_item = node.varlist[0].name.toLowerCase();

    if (first_item !== 'variable' && first_item !== 'var') {
        return;
    }

    const var_node = node.varlist[1];
    
    // Skip macro references - they are not actual variable definitions
    if (this.is_macro_reference(var_node.name)) {
        return;
    }

    const var_symbol: VariableSymbol = {
        name: var_node.name,
        location: { uri: this.uri, range: var_node.range },
        sourceUri: this.uri,
        source: 'confirm',
    };

    symbols.variables.set(var_node.name, var_symbol);
}
```

#### 3. extract_gen_variable (lines 1256-1275)

Add guard check before registering variable:

```typescript
private extract_gen_variable(node: CommandNode, symbols: SymbolTable): void {
    if (!node.varlist || node.varlist.length === 0) {
        return;
    }

    const first_var = node.varlist[0];
    
    // Skip macro references - they are not actual variable definitions
    if (this.is_macro_reference(first_var.name)) {
        return;
    }

    const var_symbol: VariableSymbol = {
        name: first_var.name,
        location: { uri: this.uri, range: first_var.range },
        sourceUri: this.uri,
        source: 'gen',
    };

    symbols.variables.set(first_var.name, var_symbol);
}
```

#### 4. extract_egen_variable (lines 1279-1295)

Add guard check before registering variable:

```typescript
private extract_egen_variable(node: CommandNode, symbols: SymbolTable): void {
    if (!node.varlist || node.varlist.length === 0) {
        return;
    }

    const first_var = node.varlist[0];
    
    // Skip macro references - they are not actual variable definitions
    if (this.is_macro_reference(first_var.name)) {
        return;
    }

    const var_symbol: VariableSymbol = {
        name: first_var.name,
        location: { uri: this.uri, range: first_var.range },
        sourceUri: this.uri,
        source: 'egen',
    };

    symbols.variables.set(first_var.name, var_symbol);
}
```

#### 5. extract_input_variables (lines 1305-1316)

Add guard check inside the loop:

```typescript
private extract_input_variables(node: CommandNode, symbols: SymbolTable): void {
    if (!node.varlist) {
        return;
    }

    for (const var_node of node.varlist) {
        // Skip macro references - they are not actual variable definitions
        if (this.is_macro_reference(var_node.name)) {
            continue;
        }
        
        const var_symbol: VariableSymbol = {
            name: var_node.name,
            location: { uri: this.uri, range: var_node.range },
            sourceUri: this.uri,
            source: 'input',
        };

        symbols.variables.set(var_node.name, var_symbol);
    }
}
```

#### 6. extract_rename_variables (lines 1372-1430)

Add guard check before registering variable in simple syntax case:

```typescript
// In the simple syntax case (rename oldvar newvar):
const new_var = node.varlist[1];

// Skip macro references - they are not actual variable definitions
if (this.is_macro_reference(new_var.name)) {
    return;
}

const var_symbol: VariableSymbol = {
    name: new_var.name,
    location: { uri: this.uri, range: new_var.range },
    sourceUri: this.uri,
    source: 'rename',
};

symbols.variables.set(new_var.name, var_symbol);
```

#### 7. extract_grouped_rename_variables (lines 1434-1458)

Add guard check inside the loop:

```typescript
private extract_grouped_rename_variables(
    group_content: string,
    group_range: Range,
    symbols: SymbolTable
): void {
    const inner = group_content.slice(1, -1).trim();
    const the_names = inner.split(/\s+/).filter(n => n.length > 0);

    for (const my_name of the_names) {
        // Skip wildcards
        if (this.contains_wildcard(my_name)) {
            continue;
        }
        
        // Skip macro references - they are not actual variable definitions
        if (this.is_macro_reference(my_name)) {
            continue;
        }

        const var_symbol: VariableSymbol = {
            name: my_name,
            location: { uri: this.uri, range: group_range },
            sourceUri: this.uri,
            source: 'rename',
        };

        symbols.variables.set(my_name, var_symbol);
    }
}
```

## Data Models

No new data models are introduced. The existing `VariableSymbol` interface remains unchanged.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Macro References Not Registered as Variables

*For any* local macro reference (`` `name' ``) or global macro reference (`$name`, `${name}`) used as a varlist item in any variable-extracting command (`confirm variable`, `gen`, `egen`, `input`, `rename`), the analyzer SHALL NOT register the macro reference as a VariableSymbol in the symbol table.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5**

### Property 2: is_macro_reference Correctly Identifies Macro References

*For any* string, the `is_macro_reference` helper function SHALL return true if and only if the string is a local macro reference (starts with backtick and ends with single quote) or a global macro reference (starts with `$`).

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 3: Valid Identifiers Still Registered as Variables

*For any* valid Stata identifier used as a varlist item in a variable-extracting command (`confirm variable`, `gen`, `egen`, `input`, `rename`), the analyzer SHALL register the identifier as a VariableSymbol in the symbol table with the appropriate source.

**Validates: Requirements 4.1, 4.2**

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Macro reference in varlist | Skip registration, no error |
| Empty varlist | Skip registration (existing behavior) |
| Incomplete command | Skip registration (existing behavior) |
| Mixed macro refs and identifiers in input command | Register only the plain identifiers |

## Testing Strategy

### Unit Tests

- Test `is_macro_reference` with local macro references (`` `name' ``, `` `my_var' ``)
- Test `is_macro_reference` with global macro references (`$name`, `${name}`)
- Test `is_macro_reference` with plain identifiers (should return false)
- Test each extraction function with macro reference inputs
- Test each extraction function with plain identifier inputs (regression)

### Property-Based Tests

Property-based tests will use fast-check to generate random valid inputs and verify the correctness properties hold.

**Configuration:**
- Minimum 100 iterations per property test
- Use existing `arbitrary_identifier` generator from `tests/property/generators`
- Create generators for local and global macro references

**Test Tags:**
- **Feature: macro-ref-variable-registration-bug, Property 1: Macro references not registered as variables**
- **Feature: macro-ref-variable-registration-bug, Property 2: is_macro_reference correctly identifies macro references**
- **Feature: macro-ref-variable-registration-bug, Property 3: Valid identifiers still registered as variables**

### Test File Location

`tests/property/macro-ref-variable-registration.prop.test.ts`
