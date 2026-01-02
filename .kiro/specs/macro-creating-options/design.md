# Design Document: Macro-Creating Options

## Overview

This feature extends the Stata LSP analyzer to recognize commands that create local or global macros via `local()` and `global()` options. When a supported command (either from a hardcoded allowlist or a detected user-defined program) includes these options, the analyzer will register the corresponding macros in the symbol table, preventing false "undefined macro" warnings and enabling proper completion/navigation support.

## Architecture

The implementation integrates into the existing analyzer pipeline:

```
Parser → CommandNode (with options) → Analyzer.process_command() → Macro Registration
```

### Key Integration Points

1. **Analyzer.process_command()**: Extended to check for macro-creating options on supported commands
2. **Hardcoded Allowlist**: New constant defining built-in commands that create macros via options
3. **Program Detection**: Extended `c_locals` extraction to detect the `c_local \`local'` pattern
4. **Option Parsing**: New helper to extract literal identifiers from option arguments

## Components and Interfaces

### 1. Macro-Creating Commands Allowlist

```typescript
// src/analyzer/macro-creating-commands.ts

/**
 * Commands known to create macros via local() or global() options.
 * Each entry specifies which options create macros and their abbreviations.
 */
export interface MacroCreatingCommand {
    /** Command name (full form) */
    name: string;
    /** Minimum abbreviation length for the command (0 = no abbreviation) */
    min_abbreviation: number;
    /** Options that create local macros */
    local_options: MacroCreatingOption[];
    /** Options that create global macros */
    global_options: MacroCreatingOption[];
}

export interface MacroCreatingOption {
    /** Option name (full form) */
    name: string;
    /** Minimum abbreviation length (0 = no abbreviation) */
    min_abbreviation: number;
}

/**
 * Hardcoded allowlist of built-in commands that create macros via options.
 */
export const MACRO_CREATING_COMMANDS: MacroCreatingCommand[] = [
    {
        name: 'levelsof',
        min_abbreviation: 0, // No abbreviation
        local_options: [{ name: 'local', min_abbreviation: 1 }],  // l() is valid
        global_options: [{ name: 'global', min_abbreviation: 1 }], // g() is valid
    },
    {
        name: 'glevelsof',
        min_abbreviation: 0,
        local_options: [{ name: 'local', min_abbreviation: 5 }],  // local() min 5 chars
        global_options: [{ name: 'global', min_abbreviation: 0 }], // No abbreviation
    },
];

/**
 * Check if a command name matches a macro-creating command (with abbreviation support).
 */
export function find_macro_creating_command(cmd_name: string): MacroCreatingCommand | undefined;

/**
 * Check if an option name matches a macro-creating option (with abbreviation support).
 */
export function matches_option(
    option_name: string,
    option_spec: MacroCreatingOption
): boolean;
```

### 2. Option Argument Parser

```typescript
// src/analyzer/option-argument-parser.ts

/**
 * Result of parsing an option argument for macro name extraction.
 */
export interface OptionArgumentResult {
    /** Whether the argument is a valid literal identifier */
    is_literal: boolean;
    /** The extracted identifier (if literal) */
    identifier?: string;
    /** Reason for rejection (if not literal) */
    rejection_reason?: 'empty' | 'macro_expansion' | 'quoted' | 'whitespace' | 'invalid_chars';
}

/**
 * Parse an option argument and extract a literal identifier if valid.
 * 
 * Rules:
 * - Trims leading/trailing whitespace
 * - Rejects if empty after trimming
 * - Rejects if contains macro expansion (` or $)
 * - Rejects if contains quotes
 * - Rejects if contains non-identifier characters
 * - Returns the identifier if valid
 */
export function parse_option_argument(argument: string | undefined): OptionArgumentResult;

/**
 * Check if a string is a valid Stata identifier.
 * Valid: starts with letter or underscore, followed by letters, digits, or underscores.
 */
export function is_valid_identifier(name: string): boolean;
```

### 3. Extended Analyzer

```typescript
// Additions to src/analyzer/index.ts

/**
 * Process macro-creating options on a command.
 * Called from process_command() for supported commands.
 */
private extract_macro_creating_options(
    node: CommandNode,
    symbols: SymbolTable,
    current_scope: ScopeInfo,
    node_index: number
): void;

/**
 * Check if a program creates macros via local()/global() options.
 * Returns the option names that create macros.
 */
private get_program_macro_creating_options(
    program: ProgramSymbol
): { local_options: string[]; global_options: string[] } | undefined;
```

### 4. Extended ProgramSymbol

```typescript
// Addition to src/types/index.ts ProgramSymbol interface

export interface ProgramSymbol {
    // ... existing fields ...
    
    /** 
     * Options that create local macros when this program is called.
     * Detected from `c_local \`local'` pattern in program body.
     */
    macro_creating_local_options?: string[];
    
    /**
     * Options that create global macros when this program is called.
     * Detected from `global \`global'` pattern in program body.
     */
    macro_creating_global_options?: string[];
}
```

## Data Models

### Option Argument Parsing Flow

```
OptionNode.argument → trim whitespace → check for macro expansion → check for quotes → validate identifier → result
```

### Macro Registration Flow

```
CommandNode
    ↓
Check if command is in allowlist OR is a detected user-defined program
    ↓
For each option in CommandNode.options:
    ↓
    Check if option matches a macro-creating option spec
        ↓
        Parse option argument
            ↓
            If literal identifier:
                Register MacroSymbol in symbol table
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Option Argument Extraction
*For any* valid Stata identifier wrapped in `local(...)` or `global(...)` option syntax (with optional whitespace padding), the parser should extract the identifier correctly after trimming whitespace.
**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Non-Literal Argument Rejection
*For any* option argument containing macro expansion characters (`` ` `` or `$`), quotes, or invalid identifier characters, the parser should classify it as non-literal and skip macro registration.
**Validates: Requirements 1.4, 3.2, 4.2**

### Property 3: Abbreviation Matching
*For any* option name and abbreviation specification, the matcher should correctly identify whether the option name is a valid abbreviation (length >= min_abbreviation and is a prefix of the full name).
**Validates: Requirements 1.5**

### Property 4: Macro Registration for Supported Commands
*For any* supported command (from allowlist or detected user-defined program) with a valid `local(identifier)` or `global(identifier)` option, the analyzer should register the corresponding macro in the symbol table.
**Validates: Requirements 3.1, 4.1**

### Property 5: No Undefined Warning After Registration
*For any* macro registered via a `local()` or `global()` option, subsequent references to that macro (after the command in file position) should not produce undefined macro warnings.
**Validates: Requirements 3.4, 4.4**

### Property 6: Program Pattern Detection
*For any* program that has a `local` option in its syntax AND contains `c_local \`local'` in its body, the analyzer should detect that the program creates local macros via its `local()` option. Similarly for `global` options with `global \`global'` pattern.
**Validates: Requirements 5.1, 5.2**

### Property 7: User-Defined Program Macro Creation
*For any* user-defined program with detected macro-creating behavior, when called with a `local(name)` or `global(name)` option, the analyzer should register the corresponding macro.
**Validates: Requirements 5.3, 5.4**

## Error Handling

### Invalid Option Arguments
- Empty arguments: Skip registration silently
- Macro expansions: Skip registration silently (cannot determine name statically)
- Invalid identifiers: Skip registration silently
- No error diagnostics produced for these cases (they may be valid at runtime)

### Missing Options Array
- If `CommandNode.options` is undefined, skip macro-creating option processing
- This is normal for commands without options

### Collision Handling
- When a macro name from `local()` collides with an existing local macro, treat as redefinition
- Update the definition location to the new command's location
- This matches existing behavior for `local name = value` redefinitions

## Testing Strategy

### Unit Tests
- Test `parse_option_argument()` with various inputs:
  - Valid identifiers: `"myvar"`, `"x"`, `"_temp"`
  - Whitespace: `" myvar "`, `"  x  "`
  - Macro expansions: `` "`name'" ``, `"$name"`, `` "${name}" ``
  - Quotes: `"\"quoted\""`, `"'quoted'"`
  - Invalid chars: `"my-var"`, `"my.var"`, `"123var"`
- Test `find_macro_creating_command()` with abbreviations
- Test `matches_option()` with abbreviations

### Property-Based Tests
- Use fast-check to generate random identifiers and verify round-trip behavior
- Generate random option arguments and verify classification consistency
- Generate command sequences and verify macro visibility after definition

### Integration Tests
- Full analyzer tests with `levelsof varname, local(mylocal)` patterns
- Verify no undefined macro warnings for subsequent `\`mylocal'` references
- Test user-defined programs with the `c_local \`local'` pattern
- Test workspace symbol lookup for cross-file program detection

### Test Configuration
- Minimum 100 iterations per property test
- Tag format: **Feature: macro-creating-options, Property N: [property text]**
