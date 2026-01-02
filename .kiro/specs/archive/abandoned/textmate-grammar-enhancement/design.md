# Design Document

## Overview

This design document describes the architecture and implementation approach for enhancing the Stata TextMate grammar (`client/syntaxes/stata.tmLanguage.json`) to achieve feature parity with the kylebarron/language-stata reference grammar, add nested string/macro depth highlighting, and document colorization in the README.

### Current State

The existing grammar provides basic highlighting for:
- Comments (block, line-star, double-slash, triple-slash)
- Strings (compound and double-quoted)
- Macros (local and global)
- Keywords (control flow: if, else, foreach, forvalues, while, program, end, capture, quietly, noisily, by, sortpreserve, mata, python)
- Functions (math, string, date, statistical, random, matrix, programming)
- Commands (large regex with abbreviation patterns)
- Numbers (integer and floating-point)

### Key Gaps

1. Missing command highlighting for: `do`, `run`, `include`, `gen`, `generate`, `egen`, `display`, `use`, `unab`, `list`, `tab`
2. No nested depth highlighting for strings and macros
3. Missing storage types (`byte`, `int`, `long`, `float`, `double`, `str1`-`str2045`, `strL`)
4. Missing built-in variables (`_n`, `_N`, `_b`, `_coef`, `_cons`, `_rc`, `_se`)
5. Missing operators (arithmetic, comparison, logical)
6. Missing missing values (`.`, `.a`-`.z`)
7. No Mata block highlighting
8. No README documentation of colorization groups

## Architecture

### Grammar Repository Structure

The enhanced grammar will organize patterns into logical repositories:

```
repository/
├── comments           # Block, line-star, double-slash, triple-slash
├── strings            # Compound and double strings with depth nesting
├── macros             # Local and global macros with depth nesting
├── keywords           # Control flow, conditionals, loops
├── commands           # Categorized command patterns
│   ├── file-execution # do, run, include
│   ├── data-commands  # gen, generate, egen, use, save
│   └── general        # display, list, tab, unab, etc.
├── functions          # Built-in and user functions
├── types              # Storage types
├── operators          # Arithmetic, comparison, logical
├── constants          # Numbers and missing values
├── variables          # Built-in system variables
└── mata               # Mata block with embedded highlighting
```

### Pattern Priority

TextMate grammars apply patterns in order. The enhanced grammar will use this priority:

1. Comments (highest - prevent other patterns inside comments)
2. Strings (with nested macro support)
3. Macros (local and global)
4. Keywords (control flow)
5. Commands (categorized)
6. Functions
7. Types
8. Operators
9. Constants (numbers, missing values)
10. Variables (built-in)

## Components and Interfaces

### 1. Nested Depth Highlighting System

The grammar will implement six levels of nesting depth for compound strings and macros, matching VS Code's native bracket pair colorization.

#### Scope Naming Convention

```
# Compound strings
string.quoted.compound.depth1.stata
string.quoted.compound.depth2.stata
string.quoted.compound.depth3.stata
string.quoted.compound.depth4.stata
string.quoted.compound.depth5.stata
string.quoted.compound.depth6.stata

# Local macros
variable.other.macro.local.depth1.stata
variable.other.macro.local.depth2.stata
variable.other.macro.local.depth3.stata
variable.other.macro.local.depth4.stata
variable.other.macro.local.depth5.stata
variable.other.macro.local.depth6.stata
```

#### Implementation Approach

TextMate grammars use `begin`/`end` patterns with nested `patterns` arrays. For depth tracking:

```json
{
    "name": "string.quoted.compound.depth1.stata",
    "begin": "`\"",
    "end": "\"'|(?=$)",
    "patterns": [
        { "include": "#compound-string-depth2" },
        { "include": "#macros-depth2" }
    ]
}
```

Each depth level includes patterns for the next depth level, cycling back to depth1 after depth6.

### 2. Command Categories

Commands will be organized into semantic categories with appropriate scope names:

| Category | Scope Name | Commands |
|----------|------------|----------|
| File Execution | `keyword.control.flow.stata` | `do`, `run`, `include` |
| Data Manipulation | `keyword.functions.data.stata` | `gen`, `generate`, `egen`, `use`, `save`, `saveold` |
| Output | `keyword.other.command.stata` | `display`, `di`, `list`, `li`, `l` |
| Tabulation | `keyword.other.command.stata` | `tab`, `tabulate`, `tab1`, `tab2` |
| Variable Expansion | `keyword.other.command.stata` | `unab`, `unabbrev` |
| Macro Commands | `keyword.macro.stata` | `local`, `global`, `tempvar`, `tempname`, `tempfile` |
| General | `keyword.other.command.stata` | All other built-in commands |

### 3. Add-on Commands

Popular add-on commands will be included with `keyword.other.command.addon.stata`:

- Regression: `reghdfe`, `ivreghdfe`, `ivreg2`
- Output: `outreg`, `estout`, `esttab`, `estadd`, `estpost`
- Data manipulation: `gcollapse`, `gcontract`, `gegen`, `gisid`, `glevelsof`, `gquantiles`

**Important**: Any add-on command added to the grammar MUST also be added to the command database cache for completion lists.

### 4. Type Highlighting

Storage types will use `support.type.stata`:

```json
{
    "match": "\\b(byte|int|long|float|double|str[1-9]|str[1-9][0-9]|str[1-9][0-9][0-9]|str[12][0-9][0-9][0-9]|str20[0-3][0-9]|str204[0-5]|strL)\\b",
    "name": "support.type.stata"
}
```

### 5. Missing Values

Missing values will use `constant.language.missing.stata`:

```json
{
    "match": "\\b\\.[a-z]?\\b",
    "name": "constant.language.missing.stata"
}
```

This matches:
- `.` (system missing)
- `.a` through `.z` (extended missing values)

### 6. Built-in Variables

System variables will use `variable.language.stata`:

```json
{
    "match": "\\b(_n|_N|_b|_coef|_cons|_rc|_se)\\b",
    "name": "variable.language.stata"
}
```

### 7. Operators

Operators will be categorized:

```json
{
    "patterns": [
        {
            "match": "[+\\-*/^]",
            "name": "keyword.operator.arithmetic.stata"
        },
        {
            "match": "(==|!=|<=|>=|<|>)",
            "name": "keyword.operator.comparison.stata"
        },
        {
            "match": "[&|!~]",
            "name": "keyword.operator.logical.stata"
        },
        {
            "match": "=",
            "name": "keyword.operator.assignment.stata"
        }
    ]
}
```

### 8. Mata Block Highlighting

Mata blocks will be detected and highlighted with Mata-specific rules:

```json
{
    "begin": "\\b(mata)\\s*:",
    "end": "\\b(end)\\b",
    "name": "meta.embedded.block.mata.stata",
    "patterns": [
        { "include": "#mata-keywords" },
        { "include": "#mata-types" },
        { "include": "#comments" },
        { "include": "#strings" },
        { "include": "#numbers" }
    ]
}
```

## Data Models

### Scope Name Hierarchy

```
source.stata
├── comment.block.stata
├── comment.line.star.stata
├── comment.line.double-slash.stata
├── comment.line.triple-slash.stata
├── string.quoted.compound.stata
│   └── string.quoted.compound.depth[1-6].stata
├── string.quoted.double.stata
├── variable.other.macro.local.stata
│   └── variable.other.macro.local.depth[1-6].stata
├── variable.other.macro.global.stata
├── keyword.control.conditional.stata      # if, else
├── keyword.control.flow.stata             # foreach, forvalues, while, do, run, include
├── keyword.functions.data.stata           # gen, generate, egen, use, save
├── keyword.other.command.stata            # display, list, tab, unab, etc.
├── keyword.other.command.addon.stata      # reghdfe, estout, etc.
├── keyword.macro.stata                    # local, global, tempvar
├── keyword.macro.extendedfcn.stata        # : type, : format, : word count
├── storage.type.function.stata            # program
├── entity.name.function.stata             # program name
├── support.function.builtin.stata         # built-in functions
├── support.function.custom.stata          # user-defined functions
├── support.type.stata                     # byte, int, long, float, double, str*
├── keyword.operator.arithmetic.stata      # + - * / ^
├── keyword.operator.comparison.stata      # == != < > <= >=
├── keyword.operator.logical.stata         # & | ! ~
├── keyword.operator.assignment.stata      # =
├── constant.numeric.stata                 # numbers
├── constant.language.missing.stata        # . .a-.z
├── variable.language.stata                # _n, _N, _b, _coef, _cons, _rc, _se
└── meta.embedded.block.mata.stata         # Mata blocks
```

## Correctness Properties

### Property 1: Command Highlighting Completeness

All commands listed in the requirements must be highlighted with their specified scope names:
- `do`, `run`, `include` → `keyword.control.flow.stata`
- `gen`, `generate`, `egen`, `use`, `save` → `keyword.functions.data.stata`
- `display`, `list`, `tab`, `unab` → `keyword.other.command.stata`

**Verification**: Create test files with each command and verify tokenization output.

### Property 2: Nesting Depth Accuracy

Nested strings and macros must receive correct depth-based scope names:
- Depth 1: outermost element
- Depth 2-6: progressively nested elements
- Depth 7+: cycles back to depth 1

**Verification**: Create test cases with 1-7 levels of nesting and verify scope assignments.

### Property 3: Missing Value Recognition

The grammar must correctly identify:
- System missing (`.`) as `constant.language.missing.stata`
- Extended missing (`.a` through `.z`) as `constant.language.missing.stata`
- NOT match decimal numbers (e.g., `3.14` should be `constant.numeric.stata`)

**Verification**: Test with `.`, `.a`, `.z`, `3.14`, `.5` to verify correct classification.

### Property 4: Type Highlighting Accuracy

Storage types must be highlighted correctly:
- `byte`, `int`, `long`, `float`, `double` → `support.type.stata`
- `str1` through `str2045` → `support.type.stata`
- `strL` → `support.type.stata`
- `str2046` and above → NOT highlighted as type

**Verification**: Test boundary cases for string types.

### Property 5: Operator Precedence

Operators must not interfere with other patterns:
- `*` at line start → comment, not multiplication
- `*` in expression → multiplication operator
- `=` in assignment → assignment operator
- `==` in comparison → comparison operator

**Verification**: Test operators in various contexts.

### Property 6: Mata Block Isolation

Mata blocks must:
- Start with `mata:` and end with `end`
- Apply Mata-specific highlighting within the block
- Not apply Stata command highlighting inside Mata blocks

**Verification**: Test Mata blocks with Mata-specific keywords.

### Property 7: Add-on Command Database Sync

Any add-on command added to the grammar must also exist in the command database cache.

**Verification**: Cross-reference grammar add-on commands with command database entries.

## Error Handling

### Malformed Strings

Unclosed strings should:
- Highlight up to end of line
- Not break highlighting of subsequent lines

Implementation: Use `(?=$)` in end patterns to match end-of-line.

### Unbalanced Nesting

Unbalanced macro delimiters should:
- Highlight the opening delimiter
- Continue highlighting until a matching close or end-of-line

### Invalid Commands

Misspelled or invalid commands should:
- NOT receive command highlighting
- Fall through to default text highlighting

## Testing Strategy

### Unit Tests

1. **Command Tests**: Verify each command category highlights correctly
2. **Nesting Tests**: Verify depth 1-6 and cycling behavior
3. **Type Tests**: Verify all storage types including boundary cases
4. **Missing Value Tests**: Verify `.`, `.a`-`.z` vs decimal numbers
5. **Operator Tests**: Verify operators in various contexts
6. **Mata Tests**: Verify Mata block detection and internal highlighting

### Integration Tests

1. **Real Code Tests**: Test against actual Stata code files
2. **Edge Case Tests**: Test unusual but valid Stata syntax
3. **Performance Tests**: Ensure grammar doesn't cause editor slowdown

### Manual Verification

1. Open test files in VS Code with the extension
2. Verify visual highlighting matches expected behavior
3. Use "Developer: Inspect Editor Tokens and Scopes" to verify scope assignments

## README Documentation

The README will include a new "Syntax Highlighting" section documenting:

1. **Scope Categories**: List of all scope names and what they highlight
2. **Nesting Depth**: Explanation of depth-based highlighting for strings/macros
3. **Theme Customization**: How users can customize colors for each scope
4. **Command Categories**: Which commands fall into which categories

Example documentation format:

```markdown
## Syntax Highlighting

The Stata LSP provides comprehensive syntax highlighting with the following scope categories:

### Comments
- `comment.block.stata`: Block comments (`/* ... */`)
- `comment.line.star.stata`: Star comments (`* ...`)
- `comment.line.double-slash.stata`: Double-slash comments (`// ...`)

### Strings
- `string.quoted.compound.stata`: Compound strings (`` `" ... "' ``)
- `string.quoted.double.stata`: Double-quoted strings (`" ... "`)

### Macros
- `variable.other.macro.local.stata`: Local macros (`` `name' ``)
- `variable.other.macro.global.stata`: Global macros (`$name`, `${name}`)

### Commands
- `keyword.control.flow.stata`: File execution (`do`, `run`, `include`) and loops
- `keyword.functions.data.stata`: Data manipulation (`gen`, `use`, `save`)
- `keyword.other.command.stata`: General commands (`display`, `list`, `tab`)

### Missing Values
- `constant.language.missing.stata`: System missing (`.`) and extended missing (`.a`-`.z`)

### Nesting Depth
Compound strings and local macros support depth-based highlighting with six levels:
- `string.quoted.compound.depth1.stata` through `string.quoted.compound.depth6.stata`
- `variable.other.macro.local.depth1.stata` through `variable.other.macro.local.depth6.stata`

This allows themes to assign different colors to nested elements for improved readability.
```
