# Design Document: TextMate Command Sync

## Overview

This feature creates a grammar synchronization module that automatically updates the TextMate grammar's command patterns whenever the command database cache is regenerated. The sync is integrated into the existing `generate-cache.ts` script, ensuring the grammar always stays in sync with the command database.

The generator reads command names and abbreviations from the JSON cache, merges category information from the builtin-commands module, generates optimized regex patterns grouped by category, and updates the TextMate grammar file while preserving its structure.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     generate-cache.ts                                │
│  ┌─────────────────┐     ┌─────────────────┐     ┌───────────────┐  │
│  │  SMCL Extractor │────▶│  Command Cache  │────▶│  Write Cache  │  │
│  └─────────────────┘     └────────┬────────┘     └───────────────┘  │
│                                   │                                  │
│                                   ▼                                  │
│                          ┌─────────────────┐     ┌───────────────┐  │
│                          │  Grammar Sync   │────▶│ Write Grammar │  │
│                          └─────────────────┘     └───────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
           ┌──────────────┐ ┌───────────┐ ┌─────────────┐
           │ Builtin Cmds │ │ Excluded  │ │ Category    │
           │ (categories) │ │ Commands  │ │ Scopes      │
           └──────────────┘ └───────────┘ └─────────────┘
```

The grammar sync operates as part of the cache generation workflow:
1. Cache generation extracts commands from SMCL files
2. After cache is built, grammar sync is automatically triggered
3. Sync reads the generated cache + builtin-commands categories
4. Generates regex patterns grouped by category
5. Updates the TextMate grammar file

## Workflow

```bash
# Single command generates both cache AND updates grammar
bun scripts/generate-cache.ts 18 src/command-database/caches/v18.json

# Output:
# - Cache written to: src/command-database/caches/v18.json
# - Grammar updated: client/syntaxes/stata.tmLanguage.json
# - Commands: 1234, Categories: 5

# Commit both files together
git add src/command-database/caches/v18.json client/syntaxes/stata.tmLanguage.json
git commit -m "Update command database and grammar"
```

The grammar sync can also be run standalone for testing:
```bash
bun scripts/sync-grammar.ts src/command-database/caches/v18.json
```

## Components and Interfaces

### CommandCacheReader

Reads and parses the command database cache file.

```typescript
interface CommandEntry {
    name: string;
    min_abbreviation: number;
    syntax: string;
    description: string;
}

interface CommandCache {
    version: number;
    commands: Record<string, CommandEntry>;
    abbreviations?: Record<string, string>;
}

interface CommandCacheReader {
    /**
     * Load and parse the command cache from a JSON file.
     * @param cache_path Path to the cache JSON file
     * @returns Parsed command cache
     * @throws Error if file cannot be read or parsed
     */
    load_cache(cache_path: string): CommandCache;
    
    /**
     * Extract all command names with their minimum abbreviation lengths.
     * @param cache The loaded command cache
     * @returns Array of command entries with name and min_abbreviation
     */
    extract_commands(cache: CommandCache): CommandEntry[];
}
```

### CategoryMerger

Merges category information from builtin-commands with database commands.

```typescript
type CommandCategory = 
    | 'data_manipulation'
    | 'statistics'
    | 'regression'
    | 'programming'
    | 'file_io'
    | 'other';

interface CategorizedCommand {
    name: string;
    min_abbreviation: number;
    category: CommandCategory;
}

interface CategoryMerger {
    /**
     * Load category mappings from builtin-commands module.
     * @returns Map of command name to category
     */
    load_builtin_categories(): Map<string, CommandCategory>;
    
    /**
     * Merge database commands with category information.
     * Commands without a category get 'other'.
     * @param commands Commands from database
     * @param categories Category mappings from builtin-commands
     * @returns Commands with categories assigned
     */
    merge_categories(
        commands: CommandEntry[],
        categories: Map<string, CommandCategory>
    ): CategorizedCommand[];
    
    /**
     * Group commands by category.
     * @param commands Categorized commands
     * @returns Map of category to commands in that category
     */
    group_by_category(
        commands: CategorizedCommand[]
    ): Map<CommandCategory, CategorizedCommand[]>;
}
```

### PatternGenerator

Generates regex patterns from command entries.

```typescript
interface PatternGeneratorConfig {
    excluded_commands: string[];
}

interface GeneratedPattern {
    pattern: string;
    scope: string;
    command_count: number;
}

interface GeneratedPatterns {
    patterns: GeneratedPattern[];
    total_commands: number;
    excluded_count: number;
}

interface PatternGenerator {
    /**
     * Generate regex patterns grouped by category.
     * @param commands_by_category Commands grouped by category
     * @param config Generator configuration
     * @returns Generated patterns with metadata
     */
    generate_patterns(
        commands_by_category: Map<CommandCategory, CategorizedCommand[]>,
        config: PatternGeneratorConfig
    ): GeneratedPatterns;
    
    /**
     * Generate a regex pattern for a single category.
     * @param commands Commands in this category
     * @param config Generator configuration
     * @returns Generated pattern string
     */
    generate_category_pattern(
        commands: CategorizedCommand[],
        config: PatternGeneratorConfig
    ): string;
    
    /**
     * Generate a regex fragment for a single command with abbreviation support.
     * @param name Full command name
     * @param min_abbrev Minimum abbreviation length
     * @returns Regex fragment (e.g., "gen(erate)?" for generate with min 3)
     */
    generate_command_pattern(name: string, min_abbrev: number): string;
    
    /**
     * Validate that a regex pattern is syntactically correct.
     * @param pattern The regex pattern to validate
     * @returns true if valid, throws Error if invalid
     */
    validate_pattern(pattern: string): boolean;
    
    /**
     * Map category to TextMate scope name.
     * @param category The command category
     * @returns TextMate scope string
     */
    category_to_scope(category: CommandCategory): string;
}

// Category to scope mapping
const CATEGORY_SCOPES: Record<CommandCategory, string> = {
    data_manipulation: 'support.function.data.stata',
    statistics: 'support.function.stats.stata',
    regression: 'support.function.stats.stata',
    programming: 'keyword.control.stata',
    file_io: 'support.function.io.stata',
    other: 'support.function.stata',
};
```

### GrammarUpdater

Updates the TextMate grammar file with new patterns.

```typescript
interface TextMatePattern {
    match?: string;
    name?: string;
    include?: string;
    patterns?: TextMatePattern[];
}

interface TextMateGrammar {
    name: string;
    scopeName: string;
    patterns: Array<{ include: string }>;
    repository: Record<string, { patterns: TextMatePattern[] }>;
}

interface GrammarUpdater {
    /**
     * Load the existing TextMate grammar file.
     * @param grammar_path Path to the grammar JSON file
     * @returns Parsed grammar object
     * @throws Error if file doesn't exist or is invalid
     */
    load_grammar(grammar_path: string): TextMateGrammar;
    
    /**
     * Update the commands patterns in the grammar.
     * Replaces the commands repository entry with category-grouped patterns.
     * @param grammar The grammar object to update
     * @param patterns The generated patterns by category
     * @returns Updated grammar object
     */
    update_commands_patterns(
        grammar: TextMateGrammar,
        patterns: GeneratedPatterns
    ): TextMateGrammar;
    
    /**
     * Update the keywords pattern to include excluded commands.
     * Ensures mata, python are in keywords alongside program, end.
     * @param grammar The grammar object to update
     * @param keywords The complete list of keywords
     * @returns Updated grammar object
     */
    update_keywords_pattern(
        grammar: TextMateGrammar,
        keywords: string[]
    ): TextMateGrammar;
    
    /**
     * Write the updated grammar to file.
     * @param grammar_path Path to write the grammar file
     * @param grammar The grammar object to write
     */
    write_grammar(grammar_path: string, grammar: TextMateGrammar): void;
}
```

### CLI Interface

The grammar sync module exports functions for use by `generate-cache.ts` and also provides a standalone CLI:

```typescript
/**
 * Sync grammar with a command cache.
 * Called automatically by generate-cache.ts after cache generation.
 * @param cache The generated command cache
 * @param grammar_path Path to the TextMate grammar file
 * @returns Sync result with statistics
 */
export function sync_grammar(
    cache: CommandCache,
    grammar_path?: string
): SyncResult;

interface SyncResult {
    success: boolean;
    commands_total: number;
    commands_by_category: Record<string, number>;
    excluded_count: number;
    error?: string;
}
```

Standalone CLI for testing:
```bash
bun scripts/sync-grammar.ts <cache_path> [grammar_path]
```

## Data Models

### Command Entry (from database)

```typescript
interface CommandEntry {
    name: string;           // Full command name (e.g., "generate")
    min_abbreviation: number; // Minimum chars for abbreviation (e.g., 3 for "gen")
}
```

### Categorized Command

```typescript
type CommandCategory = 
    | 'data_manipulation'
    | 'statistics'
    | 'regression'
    | 'programming'
    | 'file_io'
    | 'other';

interface CategorizedCommand {
    name: string;
    min_abbreviation: number;
    category: CommandCategory;
}
```

### Pattern Generation Result

```typescript
interface GeneratedPattern {
    pattern: string;        // The regex pattern string
    scope: string;          // TextMate scope (e.g., "support.function.data.stata")
    command_count: number;  // Number of commands in this pattern
}

interface GeneratedPatterns {
    patterns: GeneratedPattern[];
    total_commands: number;
    excluded_count: number;
}
```

### Excluded Commands Configuration

```typescript
/**
 * Commands excluded from the generated commands pattern.
 * These are handled specially by the lexer for embedded language context.
 * They should be in the keywords pattern instead.
 */
const EXCLUDED_COMMANDS: string[] = [
    'mata',      // Handled by lexer for embedded language context
    'python',    // Handled by lexer for embedded language context
    'end',       // Handled by lexer for block termination
];

/**
 * Keywords that should be in the keywords pattern.
 * Includes existing keywords plus excluded commands.
 */
const KEYWORDS: string[] = [
    // Existing keywords
    'if', 'else', 'foreach', 'forvalues', 'while',
    'program', 'end', 'capture', 'quietly', 'noisily',
    'by', 'sortpreserve',
    // Embedded language delimiters (excluded from commands)
    'mata', 'python',
];
```

### Category to Scope Mapping

```typescript
const CATEGORY_SCOPES: Record<CommandCategory, string> = {
    data_manipulation: 'support.function.data.stata',
    statistics: 'support.function.stats.stata',
    regression: 'support.function.stats.stata',
    programming: 'keyword.control.stata',
    file_io: 'support.function.io.stata',
    other: 'support.function.stata',
};
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Pattern generation completeness

*For any* set of command entries from the command database where commands are not in the excluded list, the generated regex patterns SHALL collectively match every full command name at word boundaries.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Abbreviation pattern correctness

*For any* command with min_abbreviation, the generated regex pattern SHALL match exactly the strings of length min_abbreviation through name.length (inclusive), and SHALL NOT match strings shorter than min_abbreviation. Commands where min_abbreviation equals name.length SHALL have no optional groups in their pattern.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Category assignment correctness

*For any* command that exists in the builtin-commands module, the generated pattern SHALL place that command in a pattern with the scope corresponding to its category. Commands not in builtin-commands SHALL be placed in the 'other' category with scope `support.function.stata`.

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 4: Excluded commands filtering

*For any* command in the excluded commands list (mata, python, end), the generated regex patterns SHALL NOT match that command name.

**Validates: Requirements 5.1**

### Property 5: Generated pattern validity

*For any* set of command entries, all generated patterns SHALL be syntactically valid JavaScript regular expressions that can be compiled without errors.

**Validates: Requirements 6.1**

### Property 6: Grammar structure preservation

*For any* valid TextMate grammar input, updating the commands patterns SHALL preserve all other repository entries (comments, strings, macros, keywords, numbers) with identical content.

**Validates: Requirements 3.1, 3.2**

## Error Handling

### File Errors

| Error Condition | Handling |
|----------------|----------|
| Cache file not found | Exit with error message and code 1 |
| Cache file invalid JSON | Exit with error message and code 1 |
| Grammar file not found | Exit with error message and code 1 |
| Grammar file invalid JSON | Exit with error message and code 1 |
| Cannot write grammar file | Exit with error message and code 1 |

### Validation Errors

| Error Condition | Handling |
|----------------|----------|
| Generated pattern invalid | Exit with error message and code 1, do not modify grammar |
| No commands found in cache | Exit with warning, do not modify grammar |

### CLI Errors

| Error Condition | Handling |
|----------------|----------|
| Missing required arguments | Print usage and exit with code 1 |
| Invalid argument format | Print usage and exit with code 1 |

## Testing Strategy

### Unit Tests

Unit tests verify individual component behavior:

1. **CommandCacheReader tests**
   - Loading valid cache files
   - Handling missing files
   - Handling malformed JSON
   - Extracting command entries correctly

2. **CategoryMerger tests**
   - Loading categories from builtin-commands
   - Merging categories with database commands
   - Assigning 'other' to uncategorized commands
   - Grouping commands by category

3. **PatternGenerator tests**
   - Generating patterns for single commands
   - Handling commands with no abbreviation (min_abbrev == name.length)
   - Handling commands with abbreviations
   - Excluding specified commands
   - Validating generated patterns
   - Mapping categories to correct scopes

4. **GrammarUpdater tests**
   - Loading valid grammar files
   - Preserving non-command patterns
   - Updating command patterns correctly
   - Writing formatted JSON output

### Property-Based Tests

Property-based tests verify universal properties across many generated inputs. Each test runs a minimum of 100 iterations.

1. **Property 1: Pattern generation completeness**
   - Generate random command names not in excluded list
   - Verify patterns collectively match all full command names at word boundaries
   - Tag: **Feature: textmate-command-sync, Property 1: Pattern generation completeness**

2. **Property 2: Abbreviation pattern correctness**
   - Generate random command names with random min_abbreviation values
   - Verify pattern matches exactly strings from min_abbrev to name.length
   - Verify pattern does not match strings shorter than min_abbrev
   - Verify commands with min_abbrev == name.length have no optional groups
   - Tag: **Feature: textmate-command-sync, Property 2: Abbreviation pattern correctness**

3. **Property 3: Category assignment correctness**
   - Generate commands with and without builtin categories
   - Verify categorized commands get correct scope
   - Verify uncategorized commands get 'support.function.stata'
   - Tag: **Feature: textmate-command-sync, Property 3: Category assignment correctness**

4. **Property 4: Excluded commands filtering**
   - Generate patterns including excluded commands in input
   - Verify excluded commands (mata, python, end) are not matched
   - Tag: **Feature: textmate-command-sync, Property 4: Excluded commands filtering**

5. **Property 5: Generated pattern validity**
   - Generate random sets of command entries
   - Verify all generated patterns compile as valid JavaScript regex
   - Tag: **Feature: textmate-command-sync, Property 5: Generated pattern validity**

6. **Property 6: Grammar structure preservation**
   - Generate random grammar structures with various repository entries
   - Update commands patterns
   - Verify all non-command entries are unchanged
   - Tag: **Feature: textmate-command-sync, Property 6: Grammar structure preservation**

### Integration Tests

1. **End-to-end generation**
   - Run generator with real cache file
   - Verify output grammar is valid JSON
   - Verify commands are present in patterns
   - Verify category scopes are correct

2. **CLI behavior**
   - Test argument parsing
   - Test error handling for missing files
   - Test exit codes (0 for success, non-zero for failure)
