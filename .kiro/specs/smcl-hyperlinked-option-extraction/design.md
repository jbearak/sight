# Design Document: SMCL Hyperlinked Option Extraction Fix

## Overview

This design addresses a bug in the SMCL option extraction system where options using hyperlinked argument syntax are not being extracted. The issue is in the `parse_option_pattern()` function in `src/command-database/smcl-extractor.ts`, where the regex patterns don't account for the colon that appears before the opening parenthesis in hyperlinked argument syntax.

The SMCL help files use patterns like `{opth vce:(regress##vcetype:vcetype)}` where:
- `opth` indicates a hyperlinked option
- `vce` is the option name
- `(regress##vcetype:vcetype)` is the argument type with a help link (format: `topic:display`)

The current regex patterns expect the argument to immediately follow the option name or abbreviation suffix, but they fail when a colon precedes the opening parenthesis.

## Architecture

The fix is localized to the `parse_option_pattern()` function in `src/command-database/smcl-extractor.ts`. No architectural changes are required.

```text
┌─────────────────────────────────────────────────────────────────┐
│                    parse_option_pattern()                        │
├─────────────────────────────────────────────────────────────────┤
│  Input: SMCL pattern string like "{opth vce:(topic:display)}"   │
│                                                                  │
│  Pattern Matching Order (most specific first):                   │
│  1. {opt[h] abbrev:rest:(topic:display)} - NEW                  │
│  2. {opt[h] name:(topic:display)} - NEW                         │
│  3. {opt[h] abbrev:rest(argtype)} - existing                    │
│  4. {opt[h] abbrev:rest} - existing                             │
│  5. {opt[h] name(argtype)} - existing                           │
│  6. {opt[h] name} - existing                                    │
│                                                                  │
│  Output: ExtractedOption { name, min_abbreviation, has_argument }│
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Modified Function: `parse_option_pattern()`

**Location**: `src/command-database/smcl-extractor.ts`

**Current Behavior**: The function uses regex patterns to match different option formats. The patterns for options with arguments use `\(([^)]+)\)` to capture the argument type, which works for simple arguments like `(varname)` but fails for hyperlinked arguments like `:(topic:display)` because:
1. The colon before the parenthesis is not expected
2. The `[^)]` character class stops at the first `)`, but hyperlinked arguments may contain nested parentheses in the topic reference

**Proposed Changes**:

Add two new regex patterns to handle hyperlinked arguments:

```typescript
// Pattern for {opt[h] abbrev:rest:(topic:display)} - hyperlinked with abbreviation
const abbrev_hyperlink_arg_match = pattern.match(
    /\{opt[h]?\s+([a-z][a-z0-9_]*):([a-z0-9_]+):\(([^)]+)\)\}/i
);

// Pattern for {opt[h] name:(topic:display)} - hyperlinked without abbreviation
const hyperlink_arg_match = pattern.match(
    /\{opt[h]?\s+([a-z][a-z0-9_]*):\(([^)]+)\)\}/i
);
```

**Pattern Matching Order**: The new patterns must be checked before the existing patterns because they are more specific. The order should be:

1. `{opt[h] abbrev:rest:(topic:display)}` - abbreviation + hyperlinked argument (NEW)
2. `{opt[h] name:(topic:display)}` - simple name + hyperlinked argument (NEW)
3. `{opt[h] abbrev:rest(argtype)}` - abbreviation + simple argument (existing)
4. `{opt[h] abbrev:rest}` - abbreviation, no argument (existing)
5. `{opt[h] name(argtype)}` - simple name + simple argument (existing)
6. `{opt[h] name}` - simple name, no argument (existing)

### Interface: ExtractedOption (unchanged)

```typescript
interface ExtractedOption {
    name: string;           // Full option name (lowercase)
    min_abbreviation: number; // Minimum abbreviation length
    description: string;    // Cleaned description text
    has_argument: boolean;  // Whether option takes an argument
    argument_type?: string; // Argument type if has_argument is true
}
```

## Data Models

No changes to data models are required. The `ExtractedOption` interface remains unchanged.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Hyperlinked Argument Extraction (Simple Name)

*For any* valid option name and *for any* valid hyperlinked argument content (topic:display format), when parsing a pattern `{opt name:(content)}` or `{opth name:(content)}`, the Option_Parser SHALL produce an ExtractedOption with `name` equal to the option name (lowercase), `has_argument` set to true, and `argument_type` containing the hyperlinked argument content.

**Validates: Requirements 1.1, 1.3, 4.1, 4.3**

### Property 2: Hyperlinked Argument Extraction (With Abbreviation)

*For any* valid abbreviation part, *for any* valid rest part, and *for any* valid hyperlinked argument content, when parsing a pattern `{opt abbrev:rest:(content)}` or `{opth abbrev:rest:(content)}`, the Option_Parser SHALL produce an ExtractedOption with `name` equal to `abbrev + rest` (lowercase), `min_abbreviation` equal to the length of `abbrev`, `has_argument` set to true, and `argument_type` containing the hyperlinked argument content.

**Validates: Requirements 1.2, 1.4**

### Property 3: Backward Compatibility

*For any* valid option pattern in the existing supported formats (`{opt[h] name}`, `{opt[h] abbrev:rest}`, `{opt[h] name(argtype)}`, `{opt[h] abbrev:rest(argtype)}`), the Option_Parser SHALL continue to produce the same ExtractedOption as before the fix.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Note: Backward compatibility is verified by the existing property tests in `tests/property/option-extraction.prop.test.ts`. No new property tests are needed for this - the existing tests serve as regression tests.

## Error Handling

The existing error handling approach is preserved:
- Malformed patterns return `null` from `parse_option_pattern()`
- The caller (`extract_options_from_section()`) skips null results gracefully
- No exceptions are thrown for invalid input

## Testing Strategy

### Unit Tests

1. **Hyperlinked argument patterns**: Test specific examples of the new patterns
   - `{opth vce:(regress##vcetype:vcetype)}` → name="vce", has_argument=true
   - `{opth by:(varlist:groupvar)}` → name="by", has_argument=true
   - `{opt ef:orm:(strings:string)}` → name="eform", min_abbreviation=2, has_argument=true

2. **Backward compatibility**: Verify existing patterns still work
   - `{opt noconstant}` → name="noconstant", has_argument=false
   - `{opt l:evel(#)}` → name="level", min_abbreviation=1, has_argument=true

3. **Integration test**: Extract options from mock `regress.sthlp` content and verify `vce` is included

### Property-Based Tests

Property tests should be added to `tests/property/option-extraction.prop.test.ts`:

1. **Property 1**: Generate random option names and hyperlinked argument content (topic:display format), test both `{opt}` and `{opth}` tags, verify extraction produces correct name and has_argument=true
2. **Property 2**: Generate random abbreviation parts, rest parts, and hyperlinked argument content, test both `{opt}` and `{opth}` tags, verify extraction produces correct name, min_abbreviation, and has_argument=true
3. **Property 3**: Existing property tests in the file already cover backward compatibility - run them to verify no regressions

**Configuration**: Minimum 100 iterations per property test.

**Tag format**: `Feature: smcl-hyperlinked-option-extraction, Property N: [property description]`
