# Design Document: Option Extraction

## Overview

This design extends the SMCL extractor to parse command options from Stata help files and store them in the command cache. The implementation adds option extraction logic to the existing `smcl-extractor.ts` module, updates the cache types to include options, and modifies the `CommandDatabase` to expose options through the provider interface.

## Architecture

The option extraction integrates into the existing cache generation pipeline:

```
sthlp files → SMCL Extractor → ExtractedCommand (with options) → Cache Generator → JSON Cache
                                                                                      ↓
                                                              CommandDatabase ← Load Cache
                                                                      ↓
                                                              CompletionProvider (options available)
```

### Component Changes

1. **smcl-extractor.ts**: Add option extraction functions and update `ExtractedCommand` interface
2. **types.ts** (command-database): Add `OptionInfo` to `CommandInfo` interface
3. **index.ts** (command-database): Update `to_provider_command_info` to map options
4. **generate-cache.ts**: Update to merge SMCL-extracted options with BUILTIN_COMMANDS options as fallback

## Components and Interfaces

### Updated ExtractedCommand Interface

```typescript
/**
 * Represents an option extracted from an SMCL help file.
 */
export interface ExtractedOption {
    /** Option name (e.g., "noconstant") */
    name: string;
    /** Minimum abbreviation length (e.g., 5 for "nocons" -> "noconstant") */
    min_abbreviation: number;
    /** Brief description of the option */
    description: string;
    /** Whether the option takes an argument (e.g., level(#)) */
    has_argument: boolean;
    /** Argument type if has_argument is true (e.g., "#", "varname") */
    argument_type?: string;
}

/**
 * Represents a command extracted from an SMCL help file.
 */
export interface ExtractedCommand {
    name: string;
    min_abbreviation: number;
    syntax: string;
    description: string;
    source_file: string;
    is_primary: boolean;
    /** Options available for this command */
    options: ExtractedOption[];
}
```

### Updated Cache Types

```typescript
// In src/command-database/types.ts

export interface OptionInfo {
    name: string;
    min_abbreviation: number;
    description: string;
    has_argument: boolean;
}

export interface CommandInfo {
    name: string;
    syntax: string;
    description: string;
    min_abbreviation: number;
    options: OptionInfo[];  // NEW: required field
}
```

### Option Extraction Functions

```typescript
/**
 * Extract the Options section from SMCL content.
 * Looks for content between {marker options} and the next section marker.
 */
export function extract_options_section(content: string): string;

/**
 * Parse option patterns from the Options section.
 * Handles {opt}, {opth}, and {synopt} patterns.
 */
export function extract_options_from_section(
    options_section: string
): ExtractedOption[];

/**
 * Parse a single {opt} or {opth} pattern.
 * Returns null if pattern is malformed.
 */
export function parse_option_pattern(pattern: string): ExtractedOption | null;
```

## Data Models

### SMCL Option Patterns

The extractor handles these SMCL patterns:

| Pattern | Example | Extracted Name | Min Abbrev | Has Argument |
|---------|---------|----------------|------------|--------------|
| `{opt abbrev:rest}` | `{opt nocons:tant}` | noconstant | 6 | false |
| `{opt name}` | `{opt plus}` | plus | 4 | false |
| `{opt name(arg)}` | `{opt level(#)}` | level | 5 | true |
| `{opt a:bbrev(arg)}` | `{opt l:evel(#)}` | level | 1 | true |
| `{opth name(type)}` | `{opth vce(vcetype)}` | vce | 3 | true |
| `{opth a:bbrev(type)}` | `{opth ef:orm(string)}` | eform | 2 | true |

### Regex Patterns

```typescript
/**
 * Pattern for {opt abbrev:rest} - option with abbreviation
 * Groups: 1=abbreviation, 2=rest of name
 */
const OPT_ABBREV_PATTERN = /\{opt\s+([a-z]+):([a-z0-9_]+)\}/gi;

/**
 * Pattern for {opt name} - option without abbreviation
 * Group: 1=full name
 */
const OPT_SIMPLE_PATTERN = /\{opt\s+([a-z][a-z0-9_]*)\}/gi;

/**
 * Pattern for {opt name(argtype)} - option with argument
 * Groups: 1=name, 2=argument type
 */
const OPT_ARG_PATTERN = /\{opt\s+([a-z][a-z0-9_]*)\(([^)]+)\)\}/gi;

/**
 * Pattern for {opt abbrev:rest(argtype)} - option with abbreviation and argument
 * Groups: 1=abbreviation, 2=rest, 3=argument type
 */
const OPT_ABBREV_ARG_PATTERN = /\{opt\s+([a-z]+):([a-z0-9_]+)\(([^)]+)\)\}/gi;

/**
 * Pattern for {opth ...} variants (same as opt but hyperlinked)
 */
const OPTH_PATTERNS = /* same patterns with opth instead of opt */;

/**
 * Pattern for {synopt:{opt ...}} wrapper
 * Group: 1=inner content
 */
const SYNOPT_WRAPPER_PATTERN = /\{synopt\s*:\s*(\{opt[^}]+\})\}([^{]*)/gi;
```

### Description Extraction

Option descriptions follow the option tag and end at `{p_end}` or newline:

```
{synopt :{opt nocons:tant}}suppress constant term{p_end}
                          ^------------------------^
                          Description to extract
```

The extractor:
1. Captures text after the closing `}` of the option tag
2. Strips SMCL tags from the description
3. Normalizes whitespace
4. Truncates at 200 characters

### Hardcoded Options Integration

The `builtin-commands.ts` file contains manually curated options for fundamental commands. The cache generator integrates these as follows:

```typescript
/**
 * Merge options from SMCL extraction with BUILTIN_COMMANDS fallback.
 * 
 * Priority:
 * 1. SMCL-extracted options (if any)
 * 2. BUILTIN_COMMANDS options (as fallback)
 */
function merge_options(
    smcl_options: ExtractedOption[],
    builtin_options: OptionInfo[] | undefined
): OptionInfo[] {
    // If SMCL extraction found options, use those
    if (smcl_options.length > 0) {
        return smcl_options.map(convert_to_cache_format);
    }
    
    // Otherwise, use BUILTIN_COMMANDS options if available
    if (builtin_options && builtin_options.length > 0) {
        return builtin_options.map(convert_builtin_to_cache_format);
    }
    
    return [];
}

/**
 * Convert BUILTIN_COMMANDS OptionInfo (minAbbreviation: string) 
 * to cache format (min_abbreviation: number).
 */
function convert_builtin_to_cache_format(opt: ProviderOptionInfo): CacheOptionInfo {
    return {
        name: opt.name,
        min_abbreviation: opt.minAbbreviation.length,
        description: opt.description,
        has_argument: opt.hasArgument
    };
}
```

This ensures:
- Commands with SMCL help files get options from the authoritative source
- Fundamental commands without SMCL options still have completions from hardcoded data
- No duplicate options (SMCL takes precedence)

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Name and Abbreviation Extraction

*For any* valid option pattern (`{opt abbrev:rest}` or `{opt name}`), the extracted option name SHALL equal the full name (abbrev+rest or name), and the `min_abbreviation` SHALL equal the length of the abbreviation portion (or full name length for simple patterns).

**Validates: Requirements 1.1, 1.2**

### Property 2: Argument Detection

*For any* option pattern containing parentheses `(argtype)` (either `{opt}` or `{opth}`), the extracted option SHALL have `has_argument` set to true.

**Validates: Requirements 1.3, 1.4**

### Property 3: Synopt Wrapper Unwrapping

*For any* `{synopt:{opt ...}}` pattern, the extractor SHALL correctly extract the option from the inner `{opt}` tag, producing the same result as parsing the inner tag directly.

**Validates: Requirements 1.5**

### Property 4: Description Extraction and Cleaning

*For any* option with description text, the extracted description SHALL contain no SMCL tags, have normalized whitespace (no multiple consecutive spaces), and be trimmed of leading/trailing whitespace.

**Validates: Requirements 1.6, 5.3, 5.4**

### Property 5: Options Section Boundary

*For any* SMCL content with an Options section, options SHALL only be extracted from content between the Options marker (`{marker options}` or `{title:Options}`) and the next section marker, including content within `{dlgtab:}` subsections.

**Validates: Requirements 2.1, 2.2, 2.4**

### Property 6: Malformed Pattern Resilience

*For any* SMCL content containing both valid and malformed option patterns, all valid options SHALL be extracted and malformed patterns SHALL be skipped without causing extraction failure.

**Validates: Requirements 5.1**

### Property 7: No Duplicate Options

*For any* command, the extracted options array SHALL contain no duplicate option names (first occurrence wins).

**Validates: Requirements 5.2**

### Property 8: Multi-Command Options Association

*For any* help file documenting multiple commands, each extracted command SHALL have an options array, and shared options SHALL be associated with all commands in the file.

**Validates: Requirements 3.2, 3.4**

### Property 9: Cache Round-Trip

*For any* valid extracted option, serializing to JSON and deserializing SHALL produce an equivalent option object with identical name, min_abbreviation, description, and has_argument values.

**Validates: Requirements 8.1**

### Property 10: Hardcoded Options Fallback

*For any* command where SMCL extraction yields no options but BUILTIN_COMMANDS defines options, the cache SHALL contain the BUILTIN_COMMANDS options converted to cache format.

**Validates: Requirements 7.3, 7.4**

## Error Handling

### Malformed Patterns

When an option pattern is malformed:
1. Log a warning with the pattern and file path
2. Skip the malformed option
3. Continue processing remaining options
4. Return partial results rather than failing

### Missing Options Section

When no Options section is found:
1. Return empty options array
2. Do not log a warning (many commands have no options)

### SMCL Tag Stripping

When stripping SMCL tags from descriptions:
1. Remove all `{...}` patterns
2. Preserve text content between tags
3. Normalize multiple spaces to single space
4. Trim leading/trailing whitespace

## Testing Strategy

### Unit Tests

1. **Pattern parsing tests**: Test each regex pattern with valid and invalid inputs
2. **Section extraction tests**: Test Options section boundary detection
3. **Description extraction tests**: Test SMCL tag stripping and normalization
4. **Edge case tests**: Empty sections, malformed patterns, missing fields

### Property-Based Tests

Using fast-check to generate random option patterns and verify:
1. Name extraction correctness
2. Abbreviation length correctness
3. Argument detection
4. Round-trip serialization

### Integration Tests

1. Test extraction from real sthlp files (regress, summarize, logit)
2. Verify option counts match expected values
3. Test multi-command file handling (generate.sthlp)

### Test Configuration

- Property tests: minimum 100 iterations
- Tag format: **Feature: option-extraction, Property N: {property_text}**
