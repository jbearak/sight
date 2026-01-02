# Design Document: SMCL Subcommand Extraction Bug Fix

## Overview

This design addresses a bug in the SMCL extractor where subcommands are incorrectly extracted as standalone commands. When a help file documents a subcommand like `estat framework`, the extractor picks up `{cmdab:fra:mework}` and treats it as a standalone command "framework" with min_abbreviation=3.

The fix introduces prefix command detection to identify when a `{cmdab:...}` pattern is a subcommand rather than a standalone command.

## Architecture

The fix modifies the existing `extract_cmdab_patterns()` function in `src/command-database/smcl-extractor.ts` to be context-aware. Instead of extracting every `{cmdab:...}` pattern, it will check if the pattern immediately follows a known prefix command.

```
┌─────────────────────────────────────────────────────────────────┐
│                    SMCL Content                                  │
│  {cmd:estat} {cmdab:fra:mework} [{cmd:,} {it:options}]          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              extract_cmdab_patterns()                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  For each {cmdab:...} match:                            │    │
│  │    1. Check preceding context                           │    │
│  │    2. If preceded by {cmd:PREFIX}, skip extraction      │    │
│  │    3. Otherwise, extract as standalone command          │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Extracted Commands                                  │
│  - "estat" (standalone)                                         │
│  - NOT "framework" (subcommand, skipped)                        │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### New Constant: PREFIX_COMMANDS

A set of known Stata prefix commands that take subcommands:

```typescript
/**
 * Stata commands that take subcommands. When a {cmdab:...} pattern
 * immediately follows one of these in {cmd:PREFIX} form, it should
 * be treated as a subcommand, not a standalone command.
 */
export const PREFIX_COMMANDS = new Set<string>([
    'estat',
    'mi',
    'graph',
    'sts',
    'stcox',
    'streg',
    'me',
    'sem',
    'gsem',
    'bayes',
    'bayesmh',
    'collect',
    'dtable',
    'etable',
    'table',
]);
```

### Modified Function: extract_cmdab_patterns()

The existing function signature remains unchanged, but the implementation adds context checking:

```typescript
export function extract_cmdab_patterns(
    content: string,
    include_opt_patterns: boolean = true
): CommandAbbreviation[]
```

**New behavior:**
- Before extracting a `{cmdab:...}` pattern, check the preceding text
- If the pattern is immediately preceded by `{cmd:PREFIX}` where PREFIX is in `PREFIX_COMMANDS`, skip extraction
- "Immediately preceded" means only whitespace between the `{cmd:...}` closing brace and the `{cmdab:...}` opening brace

### New Helper Function: is_preceded_by_prefix_command()

```typescript
/**
 * Check if a match position is immediately preceded by a prefix command.
 * 
 * @param content - The full SMCL content
 * @param match_index - The starting index of the {cmdab:...} match
 * @returns true if preceded by {cmd:PREFIX} where PREFIX is a known prefix command
 */
function is_preceded_by_prefix_command(
    content: string,
    match_index: number
): boolean
```

## Data Models

No new data models are required. The existing `CommandAbbreviation` interface remains unchanged:

```typescript
export interface CommandAbbreviation {
    name: string;
    min_abbrev: number;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Subcommand Suppression

*For any* SMCL content containing `{cmd:PREFIX} {cmdab:X:Y}` where PREFIX is a known prefix command (from the PREFIX_COMMANDS set), and X and Y are valid identifier parts, the extractor SHALL NOT include the command `X+Y` in its output.

**Validates: Requirements 1.1**

### Property 2: Standalone Command Preservation

*For any* SMCL content containing `{cmdab:X:Y}` that is NOT immediately preceded by a `{cmd:PREFIX}` pattern where PREFIX is a known prefix command, the extractor SHALL include the command `X+Y` in its output with min_abbreviation equal to the length of X.

**Validates: Requirements 1.3, 3.1**

### Example Tests (Non-Property)

The following acceptance criteria are best tested as specific examples rather than properties:

- **Requirement 1.2**: Verify PREFIX_COMMANDS contains all 15 specified prefix commands (static configuration check)
- **Requirement 2.1**: Verify "framework" is removed from NON_COMMAND_TOKENS (static code check)
- **Requirements 2.2, 2.3**: Verify extraction from sem_estat_framework.sthlp content does not produce "framework" command
- **Requirements 3.2, 3.3**: Verify cache monotonicity through integration test comparing command counts before/after fix

## Error Handling

The fix is purely additive filtering logic. Error handling remains unchanged:
- If regex matching fails, the function continues to the next pattern
- If file reading fails, existing error handling returns empty results with warnings
- Invalid prefix command names in the constant set would simply not match anything (fail-safe)

## Testing Strategy

### Unit Tests

1. **Subcommand detection test**: Verify `{cmd:estat} {cmdab:fra:mework}` does not extract "framework"
2. **Standalone preservation test**: Verify `{cmdab:fra:mework}` without prefix extracts "framework"
3. **All prefix commands test**: Verify each prefix command in the set correctly suppresses subcommand extraction
4. **Whitespace handling test**: Verify various whitespace patterns between prefix and subcommand are handled

### Property-Based Tests

Property tests will use fast-check to generate:
- Random prefix commands from the PREFIX_COMMANDS set
- Random subcommand names (valid Stata identifiers)
- Random standalone command patterns
- Mixed content with both subcommands and standalone commands

Each property test will run a minimum of 100 iterations.

### Integration Tests

1. **Real file test**: Process actual sem_estat_framework.sthlp and verify "framework" is not extracted
2. **Cache monotonicity test**: Regenerate cache and verify command count stability
3. **Regression test**: Verify existing commands are still extracted correctly

