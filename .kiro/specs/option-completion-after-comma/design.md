# Design Document: Option Completion After Comma

## Overview

This feature modifies the Completion Provider and Hover Provider to properly handle option context (text after a comma in a command line). Currently, the completion provider returns an empty list when in option context, and the hover provider incorrectly treats text after a comma as a command name. This design addresses both issues by:

1. Removing the early return in `get_option_completions` that requires a non-empty prefix
2. Adding option context detection to the hover provider
3. Providing option-specific hover information when hovering over recognized options

## Architecture

The changes are localized to two provider files:
- `src/providers/completion.ts` - Completion Provider
- `src/providers/hover.ts` - Hover Provider

Both providers will share a common pattern for detecting option context by checking for a comma before the cursor position.

```
┌─────────────────────────────────────────────────────────────────┐
│                        LSP Request                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Context Detection                             │
│  - Check for comma before cursor (option context)               │
│  - Extract command name from text before comma                  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│   Completion Provider   │     │     Hover Provider      │
│                         │     │                         │
│ If option context:      │     │ If option context:      │
│ - Return all options    │     │ - Skip command lookup   │
│   for detected command  │     │ - Look up option info   │
│ - Let client filter     │     │ - Return option hover   │
└─────────────────────────┘     └─────────────────────────┘
```

## Components and Interfaces

### Completion Provider Changes

#### Modified: `get_option_completions`

Remove the early return when `option_prefix === ''`:

```typescript
private get_option_completions(
    command_name: string,
    document: DocumentState,
    position: Position
): CompletionItem[] {
    // REMOVED: Early return for empty prefix
    // if (option_prefix === '') {
    //     return [];
    // }
    
    // Return all options for the command
    // VS Code client handles filtering based on user input
    ...
}
```

### Hover Provider Changes

#### New: `is_in_option_context`

Add a helper function to detect if a position is in option context:

```typescript
private is_in_option_context(
    document: DocumentState,
    position: Position
): { in_option_context: boolean; command_name: string | null } {
    const lines = document.content.split('\n');
    if (position.line >= lines.length) {
        return { in_option_context: false, command_name: null };
    }
    
    const line = lines[position.line];
    const text_before_cursor = line.substring(0, position.character);
    
    // Find last comma not inside quotes or parentheses
    // (reuse logic from completion provider)
    ...
    
    if (last_comma_pos >= 0) {
        const text_before_comma = text_before_cursor.substring(0, last_comma_pos);
        const command_name = extract_command_name(text_before_comma);
        return { in_option_context: true, command_name };
    }
    
    return { in_option_context: false, command_name: null };
}
```

#### Modified: `get_hover`

Add option context check before command lookup:

```typescript
async get_hover(...): Promise<Hover | null> {
    ...
    
    // Check if we're in option context BEFORE checking for commands
    const option_context = this.is_in_option_context(document, position);
    if (option_context.in_option_context) {
        // Try to get option hover
        const option_hover = this.get_option_hover(
            option_context.command_name,
            word
        );
        if (option_hover) {
            return { contents: option_hover, range };
        }
        // Don't fall through to command lookup
        return null;
    }
    
    // Existing command lookup logic
    ...
}
```

#### New: `get_option_hover`

Add a method to get hover information for options:

```typescript
private get_option_hover(
    command_name: string | null,
    option_name: string
): MarkupContent | null {
    if (!command_name) {
        return null;
    }
    
    // Look up command in database
    const command_info = this.command_db.lookup(command_name);
    if (!command_info) {
        // Try abbreviation expansion
        const matches = this.command_db.expand_abbreviation(command_name);
        if (matches.length !== 1) {
            return null;
        }
        command_info = matches[0];
    }
    
    // Find matching option
    const option = command_info.options.find(
        opt => opt.name.toLowerCase().startsWith(option_name.toLowerCase())
    );
    
    if (!option) {
        return null;
    }
    
    return {
        kind: MarkupKind.Markdown,
        value: `**Option:** \`${option.name}\`\n\n${option.description || ''}`
    };
}
```

### Shared Utility: Command Name Extraction

The `extract_command_name` function in `completion.ts` handles:
- Prefix commands (`by`, `bysort`, `quietly`, `capture`, etc.)
- Colon syntax (`merge 1:m` → `merge`)
- Simple command extraction

This function will be reused by the hover provider (either by importing or duplicating the logic).

## Data Models

No new data models are required. The existing `CommandInfo` and `OptionSpec` types from the command database are sufficient.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Option completions returned for commands with options

*For any* command line with a comma where the command is recognized in the database and has options, the Completion Provider SHALL return a non-empty list of completion items.

**Validates: Requirements 1.1**

### Property 2: Command name extraction handles various formats

*For any* command line containing prefix commands, colons, or abbreviations, the command name extraction SHALL correctly identify the main command name.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Hover suppression in option context

*For any* position after a comma in a command line, the Hover Provider SHALL NOT return command documentation for the word at that position.

**Validates: Requirements 3.1, 3.3**

### Property 4: Option hover for recognized options

*For any* recognized option name after a comma in a command line, the Hover Provider SHALL return option-specific documentation.

**Validates: Requirements 3.2**

## Error Handling

- If command name cannot be extracted: Return empty completions / no hover
- If command not found in database: Return empty completions / no hover  
- If command has no options: Return empty completions
- If option not recognized: Return no hover (but don't show command hover)

## Testing Strategy

### Unit Tests

1. Test `extract_command_name` with various inputs:
   - Simple command: `regress` → `regress`
   - With prefix: `quietly regress` → `regress`
   - With colon: `merge 1:m` → `merge`
   - With by prefix: `by varlist: regress` → `regress`
   - Abbreviation: `reg` → `regress` (via database lookup)

2. Test `is_in_option_context`:
   - After comma: `regress y x, ` → true
   - Before comma: `regress y x` → false
   - Comma in string: `display "a, b"` → false
   - Comma in parentheses: `gen x = cond(a, b, c)` → false

3. Test option hover:
   - Known option: `merge ..., keep` → option hover
   - Unknown option: `merge ..., xyz` → null
   - No command: `, keep` → null

### Property-Based Tests

Use fast-check to generate:
- Random command lines with commas
- Random prefix command combinations
- Random option names

Verify:
- Completion provider returns options when in option context
- Hover provider doesn't return command hover in option context
- Command extraction is consistent across formats

**Property Test Configuration:**
- Minimum 100 iterations per property test
- Tag format: **Feature: option-completion-after-comma, Property N: description**
