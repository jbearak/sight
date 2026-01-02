# Design Document: Rename Command Options

## Overview

This design adds hardcoded options for the Stata `rename` command to the LSP's built-in command database. The `rename` command supports several undocumented options that are not present in the sthlp file but are available in Stata. By adding these options to `builtin-commands.ts`, users will receive option completions when typing `rename *,`.

## Architecture

The implementation leverages the existing hardcoded options infrastructure:

```
builtin-commands.ts (hardcoded options)
         ↓
    CommandDatabase (runtime lookup)
         ↓
    CompletionProvider (option completions)
```

The existing cache generator already supports hardcoded options as a fallback when SMCL extraction yields no options (see `option-extraction` spec). This means:
1. Options added to `builtin-commands.ts` will be used immediately
2. If the cache is regenerated, hardcoded options persist as fallback
3. No changes to the cache generator are needed

## Components and Interfaces

### Modified Component: builtin-commands.ts

The `rename` command entry will be updated to include options:

```typescript
builtin_command(
    'rename',
    'rename',
    'rename old_name new_name',
    'data_manipulation',
    [
        option('addnumber', 'addn', true),      // addnumber(#)
        option('renumber', 'renum', true),      // renumber(#)
        option('sort', 'sort', false),
        option('dryrun', 'dry', false),
        option('upper', 'up', false),
        option('lower', 'low', false),
        option('proper', 'prop', false),
    ]
)
```

### Existing Infrastructure (No Changes Needed)

- **CommandDatabase**: Already supports looking up options from command metadata
- **CompletionProvider**: Already generates option completions from command metadata
- **Cache Generator**: Already applies hardcoded options fallback (Property 10)

## Data Models

### OptionInfo Structure (Existing)

```typescript
interface OptionInfo {
    name: string;           // Full option name
    minAbbreviation: string; // Minimum abbreviation
    hasArgument: boolean;   // Whether option takes an argument
}
```

### Rename Options Data

| Option | Min Abbreviation | Has Argument | Description |
|--------|-----------------|--------------|-------------|
| addnumber | addn | true | Add number suffix, e.g., `addnumber(#)` |
| renumber | renum | true | Renumber variables, e.g., `renumber(#)` |
| sort | sort | false | Sort variables alphabetically |
| dryrun | dry | false | Show what would be renamed without doing it |
| upper | up | false | Convert names to uppercase |
| lower | low | false | Convert names to lowercase |
| proper | prop | false | Convert names to proper case |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Non-argument Options Have hasArgument False

*For any* rename option in the set {sort, dryrun, upper, lower, proper}, the option's `hasArgument` field SHALL be `false`.

**Validates: Requirements 1.5**

### Property 2: All Rename Options Have Valid Abbreviations

*For any* rename option, the option SHALL have a non-empty `minAbbreviation` that is a prefix of the option's `name`.

**Validates: Requirements 2.1**

## Error Handling

No new error handling is required. The existing completion provider gracefully handles:
- Commands with no options (returns empty completions)
- Commands with options (returns filtered completions)
- Invalid option prefixes (returns no matches)

## Testing Strategy

### Unit Tests

1. **Rename Options Existence Test**: Verify the `rename` command in BUILTIN_COMMANDS contains all 7 expected options
2. **Argument Options Test**: Verify `addnumber` and `renumber` have `hasArgument: true`
3. **Non-argument Options Test**: Verify `sort`, `dryrun`, `upper`, `lower`, `proper` have `hasArgument: false`

### Integration Tests

1. **Completion Integration Test**: Create a document with `rename *,` and verify completions include `upper` and `lower`

### Property-Based Tests

Property tests will use fast-check to verify:
- Property 1: Non-argument options correctness
- Property 2: Abbreviation validity

Each property test should run minimum 100 iterations and reference the design document property.

### Existing Tests (No Changes Needed)

The existing `option-extraction.prop.test.ts` already covers:
- Property 10: Hardcoded Options Fallback - ensures hardcoded options persist through cache regeneration
