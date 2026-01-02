# Design Document: SMCL Syntax Cleanup

## Overview

This design removes the problematic `syntax` field from command metadata extraction and display. Instead of attempting to clean up SMCL markup, we simplify by removing syntax extraction entirely and displaying only the options list in completions.

## Architecture

The change affects three layers:
1. **Data Layer**: SMCL extractor and cache types
2. **Storage Layer**: Command database and cache files
3. **Presentation Layer**: Completion provider display

```
┌─────────────────────────────────────────────────────────────────┐
│                     SMCL Help Files                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SMCL Extractor                                │
│  - Extract command name, abbreviation, options                   │
│  - [REMOVED] Extract syntax field                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Command Cache (JSON)                          │
│  - commands: { name, min_abbreviation, options, priority }       │
│  - [REMOVED] syntax field                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Command Database                              │
│  - Loads cache, provides lookup                                  │
│  - Returns CommandInfo with optional syntax                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Completion Provider                           │
│  - detail: options list (not syntax)                             │
│  - documentation: help link                                      │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Type Definitions

**File: `src/command-database/types.ts`**

Make `syntax` optional in `CommandInfo`:

```typescript
export interface CommandInfo {
    name: string;
    syntax?: string;  // Made optional - will be removed from cache
    min_abbreviation: number;
    options: OptionInfo[];
    subcommands?: SubcommandInfo[];
    priority?: 1 | 2 | 3;
}
```

**File: `src/types/index.ts`**

Make `syntax` optional in provider `CommandInfo`:

```typescript
export interface CommandInfo {
    name: string;
    minAbbreviation: string;
    syntax?: string;  // Made optional
    options: OptionInfo[];
    subcommands?: SubcommandInfo[];
    category: string;
    isBuiltin: boolean;
    priority?: 1 | 2 | 3;
}
```

### 2. SMCL Extractor Changes

**File: `src/command-database/smcl-extractor.ts`**

Remove `extract_syntax_for_command` entirely (syntax is no longer extracted).

Update `ExtractedCommand` interface to make syntax optional:

```typescript
export interface ExtractedCommand {
    name: string;
    min_abbreviation: number;
    syntax?: string;  // Made optional
    description: string;
    source_file: string;
    is_primary: boolean;
    options: ExtractedOption[];
}
```

### 3. Command Database Changes

**File: `src/command-database/index.ts`**

Update `to_provider_command_info` to handle missing syntax:

```typescript
private to_provider_command_info(cmd: CommandInfo): ProviderCommandInfo {
    return {
        name: cmd.name,
        minAbbreviation: cmd.name.substring(0, cmd.min_abbreviation),
        syntax: cmd.syntax || '',  // Default to empty string
        options: the_provider_options,
        subcommands: the_provider_subcommands,
        category: 'builtin',
        isBuiltin: true,
        priority: cmd.priority || get_command_priority(cmd.name)
    };
}
```

### 4. Completion Provider Changes

**File: `src/providers/completion.ts`**

Update `create_command_completion` to show options instead of syntax:

```typescript
private create_command_completion(command: CommandInfo): CompletionItem {
    // Build detail from options list
    let detail = '';
    if (command.options && command.options.length > 0) {
        const option_names = command.options.slice(0, 5).map(opt => opt.name);
        detail = `Options: ${option_names.join(', ')}`;
        if (command.options.length > 5) {
            detail += `, ... (+${command.options.length - 5} more)`;
        }
    }

    return {
        label: command.name,
        kind: CompletionItemKind.Keyword,
        detail: detail || undefined,
        documentation: {
            kind: 'markdown' as const,
            value: `See Stata documentation: \`help ${command.name}\``,
        },
        sortText: '1' + command.name,
    };
}
```

### 5. Cache Generation Changes

**File: `scripts/generate-cache.ts`**

Update to not include syntax in cache:

```typescript
the_tuples.push([
    normalized_key,
    {
        name: my_cmd.name,
        // syntax field removed
        min_abbreviation: my_cmd.min_abbreviation,
        options: cache_options,
        priority: get_command_priority(my_cmd.name)
    }
]);
```

## Data Models

### Before (Current)

```json
{
    "dotplot": {
        "name": "dotplot",
        "syntax": "{cmd:dotplot} {varname} {ifin} [{cmd:,} {it:options}]",
        "min_abbreviation": 7,
        "options": [...]
    }
}
```

### After (Proposed)

```json
{
    "dotplot": {
        "name": "dotplot",
        "min_abbreviation": 7,
        "options": [...]
    }
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Completion Detail Shows Options Not Syntax

*For any* command with options in the database, when generating a completion item, the detail field should contain option names and should NOT contain SMCL tags (like `{cmd:`, `{varname}`, `{ifin}`, `{it:`).

**Validates: Requirements 2.2, 2.3**

### Property 2: Completion Without Options Has Appropriate Fallback

*For any* command without options in the database, when generating a completion item, the detail field should be empty or undefined, and the documentation should contain a help link.

**Validates: Requirements 2.4**

### Property 3: Cache Commands Have No Syntax Field

*For any* command in a newly generated cache, the syntax field should either not exist or be an empty string.

**Validates: Requirements 1.1, 1.2**

## Error Handling

- If a command has no options, the completion detail will be empty/undefined (graceful degradation)
- If the syntax field is accessed on old cache data, the code handles undefined gracefully
- Backward compatibility: old caches with syntax fields will still work (syntax is optional)

## Testing Strategy

### Unit Tests

1. Test `create_command_completion` with commands that have options
2. Test `create_command_completion` with commands that have no options
3. Test that completion items don't contain SMCL tags

### Property-Based Tests

1. **Property 1**: Generate random commands with options, verify completion detail contains option names
2. **Property 2**: Generate random commands without options, verify appropriate fallback
3. **Property 3**: Generate cache from sample SMCL content, verify no syntax fields

### Integration Tests

1. Verify completion provider works with updated command database
2. Verify hover provider continues to work (no changes needed)
