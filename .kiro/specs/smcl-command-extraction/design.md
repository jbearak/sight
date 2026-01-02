# Design Document: SMCL Command Extraction

## Overview

This design describes a proper SMCL parser for extracting command names, abbreviations, and syntax patterns from Stata help files. The current cache generator incorrectly uses help file names as command names, missing commands documented within files (e.g., `replace` in `generate.sthlp`).

## Architecture

```
Help Files (.sthlp)
        ↓
SMCL Tokenizer (tokenize SMCL tags)
        ↓
Command Extractor (find commands in Syntax section)
        ↓
Abbreviation Resolver (parse {cmdab:} patterns)
        ↓
Cache Builder (aggregate into JSON)
```

## Components and Interfaces

### SMCL Command Extractor

```typescript
interface ExtractedCommand {
    name: string;                    // Command name (e.g., "replace")
    min_abbreviation: number;        // Minimum abbreviation length
    syntax: string;                  // Syntax pattern
    description: string;             // Brief description
    source_file: string;             // Help file path
    is_primary: boolean;             // Is this the primary command in the file?
}

interface ExtractionResult {
    commands: ExtractedCommand[];
    warnings: string[];
}

function extract_commands_from_file(file_path: string): ExtractionResult;
```

### SMCL Tag Patterns

The extractor must recognize these patterns:

```typescript
// Pattern 1: viewerdialog - indicates command has dialog
// {viewerdialog "replace" "dialog replace"}
const VIEWERDIALOG_PATTERN = /\{viewerdialog\s+"([^"]+)"\s+"dialog\s+[^"]+"\}/g;

// Pattern 2: cmdab - command with abbreviation
// {cmdab:gl:obal} means "global" with min abbreviation "gl"
const CMDAB_PATTERN = /\{cmdab:([a-z]+):([a-z]+)\}/gi;

// Pattern 3: cmd - command without abbreviation info
// {cmd:replace}
const CMD_PATTERN = /\{cmd:([a-z_][a-z0-9_]*)\}/gi;

// Pattern 4: opt - option/command with abbreviation
// {opt g:enerate} means "generate" with min abbreviation "g"
const OPT_PATTERN = /\{opt\s+([a-z]+):([a-z]+)\}/gi;

// Pattern 5: Title line - primary command
// {p2col:{bf:[D] generate} {hline 2}}
const TITLE_PATTERN = /\{p2col:\{bf:\[[A-Z0-9-]+\]\s+([a-z_][a-z0-9_]*)\}/i;
```

## Data Models

### Enhanced CommandInfo

```typescript
interface CommandInfo {
    name: string;
    syntax: string;
    description: string;
    min_abbreviation: number;
    source_file?: string;      // NEW: Which help file documents this
    aliases?: string[];        // NEW: Alternative names for same command
}
```

## Algorithm

### Command Extraction Algorithm

```typescript
function extract_commands_from_file(file_path: string): ExtractionResult {
    const content = read_file(file_path);
    const commands: ExtractedCommand[] = [];
    const warnings: string[] = [];
    
    // Step 1: Find primary command from title
    const primary_name = extract_primary_command(content);
    
    // Step 2: Find all viewerdialog commands
    const dialog_commands = extract_viewerdialog_commands(content);
    
    // Step 3: Parse Syntax section for command patterns
    const syntax_section = extract_syntax_section(content);
    const syntax_commands = parse_syntax_commands(syntax_section);
    
    // Step 4: Merge and deduplicate
    const all_names = new Set([
        primary_name,
        ...dialog_commands,
        ...syntax_commands.map(c => c.name)
    ].filter(Boolean));
    
    // Step 5: Build command entries
    for (const name of all_names) {
        const syntax_info = syntax_commands.find(c => c.name === name);
        commands.push({
            name,
            min_abbreviation: syntax_info?.min_abbrev || name.length,
            syntax: syntax_info?.syntax || `${name} ...`,
            description: extract_description(content, name),
            source_file: file_path,
            is_primary: name === primary_name
        });
    }
    
    return { commands, warnings };
}
```

### Syntax Section Parsing

```typescript
function extract_syntax_section(content: string): string {
    // Find content between {marker syntax} and next {marker ...}
    const syntax_start = content.indexOf('{marker syntax}');
    if (syntax_start === -1) {
        // Try alternative: {title:Syntax}
        const title_start = content.indexOf('{title:Syntax}');
        if (title_start === -1) return '';
        // Extract until next {title:} or {marker}
    }
    // Extract section content
    // ...
}

function parse_syntax_commands(syntax_section: string): SyntaxCommand[] {
    const commands: SyntaxCommand[] = [];
    
    // Find all {cmd:name} patterns
    for (const match of syntax_section.matchAll(CMD_PATTERN)) {
        commands.push({ name: match[1], min_abbrev: match[1].length });
    }
    
    // Find all {cmdab:abbr:full} patterns
    for (const match of syntax_section.matchAll(CMDAB_PATTERN)) {
        const abbrev = match[1];
        const full = abbrev + match[2];
        commands.push({ name: full, min_abbrev: abbrev.length });
    }
    
    // Find all {opt abbr:full} patterns
    for (const match of syntax_section.matchAll(OPT_PATTERN)) {
        const abbrev = match[1];
        const full = abbrev + match[2];
        commands.push({ name: full, min_abbrev: abbrev.length });
    }
    
    return commands;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do.*

### Property 1: Multi-Command Extraction

*For any* help file containing N `{viewerdialog}` tags, the extractor SHALL return at least N distinct command names.

**Validates: Requirements 1.1, 1.2**

### Property 2: Abbreviation Correctness

*For any* `{cmdab:abbr:full}` pattern, the extracted min_abbreviation SHALL equal the length of `abbr`.

**Validates: Requirements 2.1, 2.4**

### Property 3: Legacy Superset

*For any* command in the legacy BUILTIN_COMMANDS, that command SHALL exist in the generated cache.

**Validates: Requirements 5.1, 5.2**

### Property 4: Syntax Preservation

*For any* extracted command, the syntax field SHALL contain the command name as a prefix.

**Validates: Requirements 3.3**

## Error Handling

### Missing Syntax Section

If a help file lacks a Syntax section:
1. Log a warning
2. Use the file name as the command name (fallback)
3. Use default syntax pattern `{filename} ...`

### Unparseable SMCL

If SMCL parsing fails:
1. Log the error with file path
2. Skip the file
3. Continue processing other files

## Testing Strategy

### Unit Tests

1. Test `{cmdab:}` pattern extraction
2. Test `{viewerdialog}` extraction
3. Test syntax section isolation
4. Test multi-command file parsing (generate.sthlp, drop.sthlp, macro.sthlp)

### Property-Based Tests

1. **Multi-command extraction**: Generate mock SMCL with N viewerdialogs, verify N commands extracted
2. **Abbreviation parsing**: Generate random `{cmdab:X:Y}` patterns, verify min_abbrev = len(X)
3. **Legacy superset**: Verify all 148 legacy commands exist in output

### Integration Tests

1. Parse actual Stata help files
2. Verify `generate.sthlp` yields both `generate` and `replace`
3. Verify `macro.sthlp` yields `local`, `global`, `tempvar`, `tempname`, `tempfile`
4. Verify `drop.sthlp` yields both `drop` and `keep`

## Implementation Notes

### Known Multi-Command Files

Based on analysis, these files document multiple commands:

| Help File | Commands |
|-----------|----------|
| generate.sthlp | generate, replace |
| drop.sthlp | drop, keep |
| macro.sthlp | local, global, tempvar, tempname, tempfile |
| quietly.sthlp | quietly, noisily |
| graph_twoway.sthlp | twoway |
| encode.sthlp | encode, decode |
| destring.sthlp | destring, tostring |
| correlate.sthlp | correlate, pwcorr |
| by.sthlp | by, bysort |
| if.sthlp | if, else |
| do.sthlp | do, run |
| preserve.sthlp | preserve, restore |
| cd.sthlp | cd, pwd |
| log.sthlp | log, cmdlog |
| sysdir.sthlp | sysdir, adopath |
| graph_bar.sthlp | graph bar |
| graph_pie.sthlp | graph pie |
| graph_box.sthlp | graph box |

### Fundamental Commands Without Dedicated Help Files

Some commands are so fundamental they don't have dedicated `.sthlp` files.
These are documented within other help files and must be extracted from
the Syntax sections using `{cmd:}` and `{cmdab:}` patterns:

- **Programming**: `local`, `global`, `tempvar`, `tempname`, `tempfile` (in macro.sthlp)
- **Control flow**: `else` (in if.sthlp)
- **Data preservation**: `restore` (in preserve.sthlp)
- **Prefix commands**: `bysort` (in by.sthlp), `noisily` (in quietly.sthlp)
- **Paired commands**: `replace` (in generate.sthlp), `keep` (in drop.sthlp)

### Fallback Strategy

If SMCL extraction still misses fundamental commands, the design includes
a fallback list of core commands that MUST be in the cache. These are
hardcoded as a safety net:

```typescript
const FUNDAMENTAL_COMMANDS = [
    // Programming constructs
    'local', 'global', 'tempvar', 'tempname', 'tempfile',
    'if', 'else', 'while', 'foreach', 'forvalues',
    // Prefix commands  
    'by', 'bysort', 'quietly', 'noisily', 'capture',
    // Data manipulation pairs
    'generate', 'replace', 'drop', 'keep',
    'preserve', 'restore', 'sort', 'gsort',
    // File operations
    'do', 'run', 'use', 'save', 'clear',
];
```

This ensures the LSP always provides completions for essential commands
even if help file parsing has gaps.

### Abbreviation Examples

| SMCL Pattern | Command | Min Abbrev |
|--------------|---------|------------|
| `{cmdab:gl:obal}` | global | 2 (gl) |
| `{cmdab:loc:al}` | local | 3 (loc) |
| `{opt g:enerate}` | generate | 1 (g) |
| `{cmd:replace}` | replace | 7 (replace) |
| `{cmdab:qui:etly}` | quietly | 3 (qui) |
| `{cmdab:n:oisily}` | noisily | 1 (n) |
