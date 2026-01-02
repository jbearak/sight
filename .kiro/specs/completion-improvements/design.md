# Design Document: Completion Improvements

## Overview

This design addresses three issues with the Stata LSP auto-completion:
1. Duplicate commands appearing in the completion list
2. Incorrect/truncated descriptions in the command cache
3. Overly aggressive completion triggering

The solution involves changes to the command cache format, completion provider logic, and LSP server configuration.

## Architecture

The completion system has three main components:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  LSP Server     │────▶│ Completion       │────▶│ Command         │
│  (triggers)     │     │ Provider         │     │ Database        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │ CompletionItem[] │
                        └──────────────────┘
```

Changes span all three components:
- **LSP Server**: Remove problematic trigger characters
- **Completion Provider**: Add prefix filtering, remove abbreviation duplicates, implement priority sorting
- **Command Database**: Remove descriptions, add priority tiers

## Components and Interfaces

### 1. Command Cache Format (Modified)

Remove `description` fields from commands and options. Add `priority` field.

```typescript
// src/command-database/types.ts

interface OptionInfo {
    name: string;
    min_abbreviation: number;
    has_argument: boolean;
    // REMOVED: description: string;
}

interface CommandInfo {
    name: string;
    syntax: string;
    min_abbreviation: number;
    options: OptionInfo[];
    priority: 1 | 2 | 3;  // NEW: priority tier
    // REMOVED: description: string;
}

interface CommandCache {
    version: StataVersion;
    commands: Record<string, CommandInfo>;
    abbreviations: Record<string, string>;
}
```

### 2. Priority Tier Constants

```typescript
// src/command-database/priority-tiers.ts

export const TIER_1_COMMANDS: Set<string> = new Set([
    // Data manipulation
    'generate', 'replace', 'drop', 'keep', 'rename', 'sort', 'order',
    'merge', 'append', 'reshape', 'collapse', 'expand', 'contract',
    'encode', 'decode', 'destring', 'tostring', 'egen', 'recode',
    'label', 'notes',
    // Programming
    'local', 'global', 'scalar', 'matrix', 'display', 'capture',
    'quietly', 'noisily', 'return', 'program', 'end', 'if', 'else',
    'foreach', 'forvalues', 'while', 'continue', 'break', 'exit',
    'error', 'assert', 'confirm', 'do', 'run', 'include', `unab`,
    // Analysis
    'summarize', 'describe', 'list', 'tabulate', 'table', 'count',
    'codebook', 'inspect', 'compare',
    // I/O
    'use', 'save', 'clear', 'set', 'sysuse', 'webuse', 'input',
    'edit', 'browse',
]);

export const TIER_2_COMMANDS: Set<string> = new Set([
    // Estimation
    'regress', 'logit', 'probit', 'logistic', 'ologit', 'oprobit',
    'mlogit', 'poisson', 'nbreg', 'tobit', 'ivregress', 'xtreg',
    'xtlogit', 'areg', 'rreg', 'qreg', 'xtset', 'tsset', 'predict',
    'margins', 'marginsplot', 'test', 'lincom', 'nlcom', 'contrast',
    'pwcompare', 'estimates', 'hausman', 'estat',
    // Graphics
    'graph', 'twoway', 'scatter', 'line', 'histogram', 'kdensity',
    'boxplot', 'bar', 'pie', 'dot',
    // I/O
    'import', 'export', 'insheet', 'outsheet', 'infile', 'outfile',
    'xmlsave', 'odbc', 'copy', 'type', 'log', 'cmdlog',
    // Data management
    'duplicates', 'isid', 'levelsof', 'distinct', 'fillin', 'cross',
    'stack', 'xpose', 'separate',
]);

export function get_command_priority(name: string): 1 | 2 | 3 {
    const lower_name = name.toLowerCase();
    if (TIER_1_COMMANDS.has(lower_name)) return 1;
    if (TIER_2_COMMANDS.has(lower_name)) return 2;
    return 3;
}
```

### 3. Completion Provider Changes

#### 3.1 Empty Prefix Guard

Add early return when prefix is empty in command context:

```typescript
// In get_command_completions()
private get_command_completions(
    document: DocumentState,
    position: Position,
    symbols: SymbolTable,
    resolved_scope?: ResolvedScope
): CompletionItem[] {
    const prefix = this.get_word_at_position(document, position);
    
    // NEW: Return empty if no prefix typed (reduces noise)
    if (prefix === '') {
        return [];
    }
    
    // ... rest of implementation
}
```

#### 3.2 Remove Abbreviation Duplicates

Remove the code that adds separate completion items for abbreviations:

```typescript
// REMOVE this block from get_command_completions():
// Also add abbreviation if different from full name
// if (my_command.minAbbreviation !== my_command.name) {
//     const abbrev_completion = this.create_abbreviation_completion(my_command);
//     ...
// }
```

#### 3.3 Priority-Based Sorting

Update `compute_ranking_key` to incorporate command priority:

```typescript
export function compute_ranking_key(factors: CompletionRankingFactors): string {
    const scope_priority = Math.min(factors.scope_depth, 9);
    const directive_priority = /* ... existing logic ... */;
    
    // NEW: Add command priority for built-in commands
    let command_priority = 0;
    if (factors.symbol_type === 'builtin' && factors.command_priority) {
        command_priority = factors.command_priority; // 1, 2, or 3
    }
    
    let symbol_priority: number;
    if (factors.symbol_type === 'user-program') {
        symbol_priority = 0;
    } else if (factors.symbol_type === 'builtin') {
        // Tier 1 = 61, Tier 2 = 62, Tier 3 = 63
        symbol_priority = 60 + command_priority;
    }
    // ... rest unchanged
    
    return `${scope_priority}${directive_priority}${symbol_priority_padded}|${parent_uri}|${name}`;
}
```

#### 3.4 Option Context Empty Prefix Guard

```typescript
// In get_option_completions()
private get_option_completions(
    command_name: string,
    document: DocumentState,
    position: Position
): CompletionItem[] {
    // NEW: Get prefix after comma
    const prefix = this.get_option_prefix_at_position(document, position);
    
    // NEW: Return empty if no prefix typed after comma
    if (prefix === '') {
        return [];
    }
    
    // ... rest of implementation
}
```

### 4. LSP Server Configuration Changes

Update trigger characters in `server-handlers.ts`:

```typescript
// In create_initialize_handler()
completionProvider: {
    // CHANGED: Remove '\n', ',', '.'
    // Keep only Stata-specific triggers
    triggerCharacters: [':', '`', '"', '$'],
    resolveProvider: false,
},
```

### 5. Command Database Changes

#### 5.1 Remove Description from Provider Format

```typescript
// In to_provider_command_info()
private to_provider_command_info(cmd: CommandInfo): ProviderCommandInfo {
    const the_provider_options = (cmd.options || []).map(my_opt => ({
        name: my_opt.name,
        minAbbreviation: my_opt.name.substring(0, my_opt.min_abbreviation),
        hasArgument: my_opt.has_argument,
        // REMOVED: description field
    }));

    return {
        name: cmd.name,
        minAbbreviation: cmd.name.substring(0, cmd.min_abbreviation),
        syntax: cmd.syntax,
        options: the_provider_options,
        category: 'builtin',
        isBuiltin: true,
        priority: cmd.priority || get_command_priority(cmd.name),
        // REMOVED: description field
    };
}
```

#### 5.2 Cache Regeneration

The cache generation script needs to be updated to:
1. Remove description fields
2. Add priority field based on tier lookup

## Data Models

### CompletionRankingFactors (Extended)

```typescript
interface CompletionRankingFactors {
    scope_depth: number;
    directive_type: 'current' | 'included-by' | 'done-by';
    symbol_type: 'user-program' | 'local-macro' | 'global-macro' | 
                 'variable' | 'scalar' | 'matrix' | 'builtin' | 'program-argument';
    alphabetical_order: string;
    parent_uri?: string;
    command_priority?: 1 | 2 | 3;  // NEW: for built-in commands
}
```

### ProviderCommandInfo (Modified)

```typescript
interface ProviderCommandInfo {
    name: string;
    minAbbreviation: string;
    syntax: string;
    options: ProviderOptionInfo[];
    category: string;
    isBuiltin: boolean;
    priority: 1 | 2 | 3;  // NEW
    // REMOVED: description: string;
}

interface ProviderOptionInfo {
    name: string;
    minAbbreviation: string;
    hasArgument: boolean;
    // REMOVED: description: string;
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: No Duplicate Commands in Completions

*For any* prefix string and document state, when the Completion_Provider generates command completions, the resulting list shall contain no duplicate command names (each label appears at most once).

**Validates: Requirements 1.1, 1.2**

### Property 2: No Descriptions in Completion Items

*For any* completion item returned by the Completion_Provider (command or option), the `detail` field shall not contain a description string from the command database.

**Validates: Requirements 2.3, 2.4**

### Property 3: Required Fields Preserved

*For any* command in the Command_Database, the command shall have non-empty `name`, `syntax`, and `min_abbreviation` fields, and each option shall have non-empty `name` and `min_abbreviation` fields.

**Validates: Requirements 2.5**

### Property 4: Empty Prefix Returns Empty Completions

*For any* document position where the word prefix is empty (empty line, whitespace-only before cursor, or immediately after comma), the Completion_Provider shall return an empty completion list.

**Validates: Requirements 3.1, 3.2, 3.7, 6.4**

### Property 5: Non-Empty Prefix Returns Relevant Completions

*For any* document position where the word prefix is non-empty and matches at least one command, the Completion_Provider shall return a non-empty completion list containing only commands that start with the prefix.

**Validates: Requirements 3.4, 3.8, 6.3**

### Property 6: User Programs Rank Above Built-ins

*For any* completion list containing both user-defined programs and built-in commands, all user-defined programs shall appear before all built-in commands (have lower sortText values).

**Validates: Requirements 5.1**

### Property 7: Priority Tier Ordering

*For any* completion list of built-in commands, commands shall be ordered by priority tier (Tier 1 before Tier 2 before Tier 3), and within each tier, commands shall be sorted alphabetically.

**Validates: Requirements 5.2, 5.4**

### Property 8: Prefix Filtering Preserves Priority Order

*For any* prefix string, when filtering completions to matching commands, the priority ordering (user programs > Tier 1 > Tier 2 > Tier 3, alphabetical within tier) shall be preserved.

**Validates: Requirements 5.5**

## Error Handling

### Invalid Cache Format

If the command cache JSON is malformed or missing required fields:
- Log a warning message
- Continue with an empty command database
- Completions will still work for user-defined symbols

### Missing Priority Tier

If a command is not in Tier 1 or Tier 2 sets:
- Default to Tier 3 (lowest priority)
- No error or warning needed (this is expected for most commands)

### Empty Document State

If document state is null or undefined:
- Return empty completion list
- Do not throw an error

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases:

1. **Trigger character configuration**: Verify triggerCharacters is exactly `[':', '\`', '"', '$']`
2. **Empty line completion**: Verify empty list returned for empty line
3. **Whitespace-only completion**: Verify empty list for whitespace-only prefix
4. **After-comma completion**: Verify empty list immediately after comma
5. **Tier assignment**: Verify specific commands are in correct tiers (e.g., `generate` in Tier 1, `regress` in Tier 2)
6. **Dollar sign trigger**: Verify global macro completions returned for `$` trigger

### Property-Based Tests

Property-based tests use fast-check to verify universal properties across many generated inputs:

1. **No duplicates property**: Generate random prefixes, verify no duplicate labels in results
2. **No descriptions property**: Generate completions, verify no detail fields contain descriptions
3. **Required fields property**: Load cache, verify all commands have required fields
4. **Empty prefix property**: Generate empty-prefix positions, verify empty results
5. **Non-empty prefix property**: Generate non-empty prefixes, verify matching results
6. **User program ranking property**: Generate mixed completions, verify user programs first
7. **Priority ordering property**: Generate completions, verify tier ordering
8. **Filter preserves order property**: Generate prefixes, verify filtered results maintain order

### Test Configuration

- Property tests: minimum 100 iterations per property
- Use fast-check for property-based testing
- Tag format: `Feature: completion-improvements, Property N: {property_text}`
