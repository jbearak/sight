# Design Document

## Overview

This document specifies the technical design for adding Zed editor extension support to the Sight LSP project. The extension provides Stata language support in Zed with feature parity to the existing VS Code extension, including syntax highlighting via Tree-sitter, LSP integration, and Stata-specific editing features.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Zed Editor                                   │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Sight Zed Extension (WASM)                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │   │
│  │  │ Extension   │  │ Language    │  │ Tree-sitter      │    │   │
│  │  │ Trait Impl  │  │ Config      │  │ Grammar          │    │   │
│  │  │ (lib.rs)    │  │ (config.toml)│  │ (tree-sitter-    │    │   │
│  │  │             │  │             │  │  stata/)         │    │   │
│  │  └──────┬──────┘  └─────────────┘  └──────────────────┘    │   │
│  │         │                                                    │   │
│  │         │ Spawns LSP                                        │   │
│  │         ▼                                                    │   │
│  │  ┌─────────────────────────────────────────────────────┐   │   │
│  │  │           Sight LSP Server (Binary)                  │   │   │
│  │  │  ┌─────────────┐  ┌─────────────────────────────┐   │   │   │
│  │  │  │ server.js   │  │ command-database/caches/    │   │   │   │
│  │  │  │ (bundled)   │  │ (v18.json, etc.)            │   │   │   │
│  │  │  └─────────────┘  └─────────────────────────────┘   │   │   │
│  │  └─────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
sight/
├── zed-extension/                    # Zed extension root (Req 1.1)
│   ├── extension.toml                # Extension manifest (Req 1.2)
│   ├── Cargo.toml                    # Rust project config (Req 1.3)
│   ├── LICENSE                       # GPL-3.0 license (Req 1.6)
│   ├── src/
│   │   └── lib.rs                    # Extension implementation (Req 1.4)
│   ├── languages/
│   │   └── stata/                    # Language config directory (Req 1.5)
│   │       ├── config.toml           # Language configuration (Req 2.3)
│   │       ├── highlights.scm        # Syntax highlighting queries (Req 4.1)
│   │       ├── brackets.scm          # Bracket matching queries (Req 5.1)
│   │       ├── indents.scm           # Auto-indentation queries (Req 6.1)
│   │       └── outline.scm           # Code outline queries (Req 7.1)
│   └── server/                       # Bundled LSP server (Req 11.1)
│       ├── sight-server              # Compiled binary (Req 10.4)
│       └── command-database/
│           └── caches/
│               └── v18.json          # Command database (Req 11.4)
├── client/                           # VS Code extension (existing)
├── src/                              # LSP server source (existing)
└── scripts/
    └── bump-version.ts               # Updated for Zed extension (Req 13.3)
../tree-sitter-stata/                 # External grammar repo (referenced by extension.toml)
```

## Component Design

### Component 1: Extension Manifest (extension.toml)

**Validates: Requirements 1.2, 2.1, 12.1-12.6**

Declares extension metadata and registers the Stata language with its grammar and language server.

```toml
id = "sight"
name = "Sight - Stata Language Server"
description = "Language support for Stata using LSP"
version = "0.1.8"
schema_version = 1
authors = ["Jonathan Marc Bearak"]
repository = "https://github.com/jbearak/sight"

[grammars.stata]
repository = "https://github.com/jbearak/tree-sitter-stata"
rev = "<commit-sha>"

[language_servers.sight]
name = "Sight"
languages = ["stata"]
```

Note: keep `authors` accurate (do not leave placeholder values).

### Component 2: Rust Extension Implementation (src/lib.rs)

**Validates: Requirements 1.4, 10.1-10.5, 11.1-11.3**

Implements the `zed_extension_api::Extension` trait. With the "Fat Bundle" strategy, the implementation is significantly simplified as the binary is guaranteed to be present in the extension directory.

```rust
use zed_extension_api::{self as zed, Result};

struct SightExtension;

impl zed::Extension for SightExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // The binary is guaranteed to be bundled at ./server/sight-server.
        // NOTE: confirm Zed's extension working directory contract; if it differs,
        // switch to a Zed-provided API for locating bundled assets.
        let server_path = std::env::current_dir()?
            .join("server")
            .join("sight-server");

        if !server_path.exists() {
            return Err(format!(
                "Sight server binary not found at {:?}. This extension bundle may be corrupt or for the wrong platform.",
                server_path
            )
            .into());
        }

        Ok(zed::Command {
            command: server_path.to_string_lossy().into_owned(),
            args: vec!["--stdio".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(SightExtension);
```

### Component 3: Tree-sitter Grammar (external repo: tree-sitter-stata)

**Validates: Requirements 3.1-3.19**

#### Architectural Note: Zed Highlighting vs VS Code

**Important**: Zed's highlighting architecture differs significantly from VS Code:

| Feature | VS Code | Zed |
|---------|---------|-----|
| Base syntax highlighting | TextMate grammar | Tree-sitter grammar |
| Semantic highlighting | LSP semantic tokens | **Not supported** (Issue #7450) |
| Structure features | TextMate + LSP | Tree-sitter |

Since Zed does NOT support LSP semantic tokens, **all highlighting must come from the Tree-sitter grammar**. In VS Code, the TextMate grammar provides base highlighting and the LSP can augment it with semantic information (e.g., distinguishing built-in functions from user functions). In Zed, Tree-sitter is the sole source of highlighting.

**Scope Decision**: We intentionally do NOT embed command/function lists in the Tree-sitter grammar because:

1. **Maintenance burden**: Stata versions change, and embedding command lists would require grammar updates for each Stata release
2. **Grammar bloat**: The TextMate grammar's command lists add significant size; Tree-sitter grammars should be lean
3. **LSP handles semantics**: The Sight LSP server already provides semantic information (completions, hover, diagnostics) - duplicating this in the grammar is unnecessary
4. **Syntactic vs semantic**: Tree-sitter is a syntactic parser, not a semantic analyzer. It cannot determine whether `myprogram` is a built-in command or user-defined program.

**What the grammar DOES highlight** (syntactic constructs):
- Comments (all 4 styles)
- Strings (double, compound with depth)
- Macros (local with depth, global)
- Control flow keywords (`if`, `else`, `foreach`, `forvalues`, `while`, `continue`, `break`, `end`)
- Type keywords (`byte`, `int`, `long`, `float`, `double`, `str*`, `strL`)
- Built-in variables (`_n`, `_N`, `_b`, `_coef`, `_cons`, `_rc`, `_se`, `_pi`, `_skip`, `_dup`, `_newline`, `_column`, `_continue`, `_request`, `_char`)
- Operators (arithmetic, comparison, logical, assignment, interaction `#`)
- Program definitions (keyword + name)
- Mata blocks (all 5 forms)
- Generic commands (as function calls - the LSP provides semantic detail via hover/completion)

**What the grammar does NOT highlight** (semantic constructs - handled by LSP):
- Built-in commands vs user programs (all commands highlighted as `@function`)
- Built-in functions vs user functions
- Defined vs undefined variables/macros
- Command options and subcommands

This approach provides good base highlighting while keeping the grammar maintainable and letting the LSP handle semantic intelligence.

---

Defines the Stata grammar for parsing. Key design decisions:

1. **Precedence levels**: Handle operator precedence correctly
2. **Nested depth modeling for highlighting**:
   - Support up to 6 levels of nesting for compound strings and local macros.
   - Encode the nesting depth into the parse tree via distinct node types (or fields) per depth so that Zed highlight queries can target each depth with a distinct capture.
   - Depth is independent per construct:
     - local macro depth is based only on nested local macros
     - compound string depth is based only on nested compound strings
     - local macros inside compound strings do not have their depth offset by compound string nesting
3. **Wrap-around**: Depth-based highlighting wraps after depth 6 (i.e., deeper nesting reuses depth 1..6 captures).
4. **Context-sensitive parsing**: Handle `*` as both comment and multiplication
5. **Embedded languages**: Recognize Mata blocks using simple grammar rules (no external scanner needed)
6. **Macro expansion in strings**: Allow global macro references (`$name`, `${name}`) inside double-quoted strings
7. **Nested macro references**: Allow global macros inside local macros (e.g., `` `$global' ``)
8. **Control flow keywords**: Parse `if`, `else`, `foreach`, `forvalues`, `while`, `continue`, `break` as distinct keyword nodes
9. **Type keywords**: Parse Stata types (`byte`, `int`, `long`, `float`, `double`, `str1`-`str2045`, `strL`)
10. **Complete built-in variables**: Include all TextMate-recognized built-in variables

```javascript
// Minimal, buildable starting point.
// Notes:
// - This deliberately does NOT attempt to encode a full list of Stata commands.
// - Disambiguating `*` (comment vs multiplication) requires line-awareness; this
//   example uses an external token to represent "start of line".

module.exports = grammar({
  name: 'stata',

  externals: $ => [
    $._line_start,          // emitted by an external scanner at beginning-of-line
  ],

  // Only treat spaces/tabs as extras; keep newlines meaningful for line-aware rules.
  extras: $ => [/[ \t]+/],

  rules: {
    source_file: $ => repeat(choice($._statement, $._newline)),

    _newline: _ => /\r?\n/,

    _statement: $ => choice(
      $.comment,
      $.program_definition,
      $.mata_block,
      $.macro_definition,
      $.command,
    ),

    // Comments
    comment: $ => choice(
      $.line_comment,
      $.block_comment,
    ),

    line_comment: $ => choice(
      token(seq('//', /[^\n]*/)),
      token(seq('///', /[^\n]*/)),
      // `*` is a comment only if it is the first non-whitespace token on the line.
      token(seq($._line_start, '*', /[^\n]*/)),
    ),

    block_comment: $ => token(seq('/*', /[^]*?/, '*/')),

    // Strings
    // NOTE: for depth-based highlighting we will model compound strings as nested nodes
    // (up to depth 6) rather than a single token.
    double_string: $ => token(seq('"', repeat(choice(/[^"\\\n]+/, /\\./, '""')), '"')),

    // Compound strings (depth 1-6; wrap-around behavior via nesting rules)
    // Example structure (illustrative): compound_string_depth_1 contains
    // compound_string_depth_2 and/or local_macro_depth_1 nodes.
    // The exact internal structure may evolve as the grammar matures.
    compound_string_depth_1: $ => seq('`"', repeat(choice(
      $.compound_string_depth_2,
      $.local_macro_depth_1,
      $._compound_string_text
    )), "\"'"),
    compound_string_depth_2: $ => seq('`"', repeat(choice(
      $.compound_string_depth_3,
      $.local_macro_depth_1,
      $._compound_string_text
    )), "\"'"),
    compound_string_depth_3: $ => seq('`"', repeat(choice(
      $.compound_string_depth_4,
      $.local_macro_depth_1,
      $._compound_string_text
    )), "\"'"),
    compound_string_depth_4: $ => seq('`"', repeat(choice(
      $.compound_string_depth_5,
      $.local_macro_depth_1,
      $._compound_string_text
    )), "\"'"),
    compound_string_depth_5: $ => seq('`"', repeat(choice(
      $.compound_string_depth_6,
      $.local_macro_depth_1,
      $._compound_string_text
    )), "\"'"),
    compound_string_depth_6: $ => seq('`"', repeat(choice(
      // wrap-around
      $.compound_string_depth_1,
      $.local_macro_depth_1,
      $._compound_string_text
    )), "\"'"),

    // This is a stand-in for non-delimiter content inside a compound string.
    // It intentionally excludes newlines.
    _compound_string_text: _ => token(/[^\n]+/),

    string: $ => choice(
      $.double_string,
      $.compound_string_depth_1,
      $.compound_string_depth_2,
      $.compound_string_depth_3,
      $.compound_string_depth_4,
      $.compound_string_depth_5,
      $.compound_string_depth_6,
    ),

    // Macros
    // NOTE: for depth-based highlighting we will model local macros as nested nodes
    // (up to depth 6) rather than a single token.
    local_macro_depth_1: $ => seq('`', choice($.identifier, $.local_macro_depth_2), "'"),
    local_macro_depth_2: $ => seq('`', choice($.identifier, $.local_macro_depth_3), "'"),
    local_macro_depth_3: $ => seq('`', choice($.identifier, $.local_macro_depth_4), "'"),
    local_macro_depth_4: $ => seq('`', choice($.identifier, $.local_macro_depth_5), "'"),
    local_macro_depth_5: $ => seq('`', choice($.identifier, $.local_macro_depth_6), "'"),
    local_macro_depth_6: $ => seq('`', choice(
      // wrap-around
      $.identifier,
      $.local_macro_depth_1
    ), "'"),

    // Global macros remain non-depth.
    global_macro: $ => choice(
      token(seq('$', $.identifier)),
      token(seq('${', $.identifier, '}')),
    ),

    // Program definitions
    program_definition: $ => seq(
      'program',
      optional('define'),
      field('name', $.identifier),
      repeat(choice($._statement, $._newline)),
      'end',
    ),

    // Mata blocks - supports all valid forms:
    // 1. mata\n...\nend (multiline)
    // 2. mata:\n...\nend (multiline with colon)
    // 3. mata { ... } (brace-delimited)
    // 4. mata: expr (inline with colon)
    // 5. mata expr (inline without colon)
    mata_block: $ => choice(
      // Brace-delimited: mata { ... }
      seq('mata', optional(':'), '{', repeat($._mata_brace_content), '}'),
      // Multiline: mata ... end
      seq('mata', optional(':'), $._newline, repeat($._mata_line), 'end'),
      // Inline: mata: expr or mata expr (on same line, no end required)
      seq('mata', optional(':'), $._mata_inline_content),
    ),
    
    _mata_line: $ => seq(/[^\n]*/, $._newline),
    _mata_inline_content: _ => token(prec(-1, /[^\n{]+/)),
    _mata_brace_content: _ => /[^{}]+/,

    // Macro definitions
    macro_definition: $ => choice(
      seq(choice('local', 'loc'), $.identifier, optional($._rest_of_line)),
      seq(choice('global', 'gl'), $.identifier, optional($._rest_of_line)),
      seq(choice('tempvar', 'tempname', 'tempfile'), repeat1($.identifier)),
    ),

    // Commands (generic)
    command: $ => seq(
      optional($.prefix),
      field('name', $.identifier),
      optional($._rest_of_line),
    ),

    prefix: $ => choice(
      'by', 'bysort', 'bys',
      'quietly', 'qui',
      'noisily', 'noi',
      'capture', 'cap',
      'sortpreserve',
    ),

    _rest_of_line: _ => token(/[^\n]+/),

    // Control flow keywords (parsed as distinct nodes for highlighting)
    control_keyword: _ => choice(
      'if', 'else',                              // Conditional
      'foreach', 'forvalues', 'forv', 'while',  // Loop
      'continue', 'break',                       // Control
      'end',                                     // Block terminator
    ),

    // Type keywords
    type_keyword: _ => choice(
      'byte', 'int', 'long', 'float', 'double',  // Numeric types
      /str[1-9]/, /str[1-9][0-9]/, /str[1-9][0-9][0-9]/, /str[12][0-9][0-9][0-9]/, /str20[0-3][0-9]/, /str204[0-5]/,  // String types str1-str2045
      'strL',                                     // Long string type
    ),

    // Atoms
    number: _ => /\d+(\.\d+)?([eE][+-]?\d+)?/,
    missing_value: _ => /\.[a-z]?/,
    builtin_variable: _ => choice(
      '_n', '_N',                                          // Observation
      '_b', '_coef', '_cons', '_rc', '_se',                // Estimation
      '_pi',                                               // Constants
      '_skip', '_dup', '_newline', '_column', '_continue', '_request', '_char',  // Display
    ),

    // Operators (including interaction operator #)
    operator: _ => choice(
      '+', '-', '*', '/', '^',           // Arithmetic
      '==', '!=', '~=', '<', '>', '<=', '>=',  // Comparison
      '&', '|', '!', '~',                // Logical
      '=',                               // Assignment
      '#',                               // Interaction
    ),

    identifier: _ => /[A-Za-z_][A-Za-z0-9_]*/,
  },
});
```

#### Grammar Enhancements for TextMate Parity

The following enhancements bring the Tree-sitter grammar to parity with the TextMate grammar:

**1. Global macros inside double strings:**
```javascript
// Update double_string to allow macro expansion
double_string: $ => seq(
  '"',
  repeat(choice(
    /[^"$\\\r\n]+/,           // Regular content (excluding $)
    /\\./,                     // Escape sequences
    '""',                      // Escaped quote
    $.global_macro,            // Allow $name and ${name}
  )),
  '"',
),
```

**2. Global macros inside local macros:**
```javascript
// Update local_macro_depth_* to allow global_macro
local_macro_depth_1: $ => seq(
  '`',
  choice(
    $.local_macro_depth_2,
    $.global_macro,            // Allow $global inside `...'
    $._macro_name,
  ),
  "'",
),
```

**3. Control flow and type keywords:**
These are parsed as distinct node types so highlights.scm can apply appropriate captures.

#### External Scanner Notes
This design requires an external scanner to emit `$._line_start` at the beginning of each line (when the next character is `*`) so that `*` comments can be recognized without mis-parsing multiplication. The scanner is conservative and only emits the token when both conditions are met: at line start AND the next character is `*`.

Note: Mata blocks do NOT use an external scanner. They are parsed using simple grammar rules with `repeat($._mata_line)` where `_mata_line` matches any content until a newline. This approach is simpler and more robust than external scanner-based tokenization.

#### External Scanner (tree-sitter-stata/src/scanner.c)

The external scanner handles only line-start detection for `*` comments. It emits `$._line_start` when at the beginning of a line AND the next character is `*`. This conservative approach prevents mis-parsing multiplication as comments.

```c
#include <tree_sitter/parser.h>
#include <wctype.h>

// Implementation handles _line_start token emission
// Only emits when: (1) at line start, AND (2) next char is '*'
```

### Component 4: Language Configuration (languages/stata/config.toml)

**Validates: Requirements 2.2-2.4, 8.1-8.6, 9.1-9.4**

Configures language settings including file associations, auto-closing pairs, and comment delimiters. The extension relies on Zed's built-in bracket/autoclose engine for handling interactions inside strings and compound strings (Requirement 8.6) - no custom runtime quote logic is needed in the extension.

```toml
name = "Stata"
grammar = "stata"
path_suffixes = ["do", "ado", "mata"]
line_comments = ["// ", "* "]
block_comment = ["/* ", " */"]
autoclose_before = ";:.,=}])>` \n\t"

brackets = [
  { start = "{", end = "}", close = true, newline = true },
  { start = "[", end = "]", close = true, newline = false },
  { start = "(", end = ")", close = true, newline = false },
  { start = "\"", end = "\"", close = true, newline = false },
  { start = "`", end = "'", close = true, newline = false },
]

word_characters = ["_"]
```

**Design Decision - Compound String Auto-Closing**: Stata's compound strings use `` `"..."' `` delimiters and support nesting via alternating quote styles: `` `"outer `"inner"' outer"' ``. This requires `""` auto-closing to work *inside* compound strings.

We intentionally omit `not_in = ["string"]` for double quotes because:
1. The Tree-sitter grammar defines compound strings as `compound_string_depth_N` nodes, which may not be recognized by Zed as "string" context anyway
2. Even if they were, we *want* `""` pairs to auto-close inside compound strings to support the nested pattern
3. The minor inconvenience of `""` auto-closing inside regular double-quoted strings is acceptable given Stata's compound string semantics

If testing reveals issues with unwanted auto-closing in regular strings, we can explore whether Zed's `not_in` can target specific node types (e.g., `not_in = ["double_string"]` but not compound strings).

### Component 5: Syntax Highlighting Queries (languages/stata/highlights.scm)

**Validates: Requirements 4.1-4.13**

The Zed extension uses depth-based captures for nested compound strings and
nested local macros. Depth is encoded in the Tree-sitter parse tree up to depth
6, and highlighting wraps after depth 6.

Important behaviors:
- The capture applies to the entire span (delimiters and contents).
- Local macro depth is based only on local macro nesting (not offset by being
  inside a compound string).
- Global macros remain non-depth and use the plain `@variable` capture.

```scheme
; Comments
(line_comment) @comment
(block_comment) @comment

; Strings
(double_string) @string

; Compound strings (depth 1-6)
(compound_string_depth_1) @string.depth.1
(compound_string_depth_2) @string.depth.2
(compound_string_depth_3) @string.depth.3
(compound_string_depth_4) @string.depth.4
(compound_string_depth_5) @string.depth.5
(compound_string_depth_6) @string.depth.6

; Local macros (depth 1-6)
(local_macro_depth_1) @variable.macro.local.depth.1
(local_macro_depth_2) @variable.macro.local.depth.2
(local_macro_depth_3) @variable.macro.local.depth.3
(local_macro_depth_4) @variable.macro.local.depth.4
(local_macro_depth_5) @variable.macro.local.depth.5
(local_macro_depth_6) @variable.macro.local.depth.6

; Global macros (non-depth) - including inside strings and local macros
(global_macro) @variable

; Control flow keywords
(control_keyword) @keyword

; Prefix keywords
["by" "bysort" "bys" "quietly" "qui" "noisily" "noi" "capture" "cap" "sortpreserve"] @keyword
["in" "using"] @keyword
["do" "run" "include"] @keyword

; Program definitions
(program_definition "program" @keyword)
(program_definition "define" @keyword)
(program_definition "end" @keyword)
(program_definition name: (identifier) @function)

; Macro definitions
["local" "loc" "global" "gl" "tempvar" "tempname" "tempfile"] @keyword

; Types
(type_keyword) @type

; Built-in variables (all TextMate-recognized)
(builtin_variable) @variable.builtin

; Missing values
(missing_value) @constant

; Numbers
(number) @number

; Operators (including interaction #)
(operator) @operator

; Mata blocks - all forms (multiline, brace-delimited, inline)
(mata_block "mata" @keyword)
(mata_block "end" @keyword)
(mata_block "{" @punctuation.bracket)
(mata_block "}" @punctuation.bracket)

; Generic commands
(command name: (identifier) @function)
```

### Component 6: Bracket Matching Queries (languages/stata/brackets.scm)

**Validates: Requirements 5.1-5.6**

```scheme
("{" @open "}" @close)
("[" @open "]" @close)
("(" @open ")" @close)
("\"" @open "\"" @close)
("`" @open "'" @close)
```

### Component 7: Indentation Queries (languages/stata/indents.scm)

**Validates: Requirements 6.1-6.3**

```scheme
; Indent after block openers
(program_definition) @indent
(if_statement "{" @indent)
(foreach_loop "{" @indent)
(forvalues_loop "{" @indent)
(while_loop "{" @indent)
(mata_block) @indent

; Outdent on block closers
"}" @outdent
"end" @outdent
"else" @outdent.always
```

### Component 8: Outline Queries (languages/stata/outline.scm)

**Validates: Requirements 7.1-7.3**

```scheme
(program_definition
  name: (identifier) @name) @item
```

### Component 9: Build Process Integration

**Validates: Requirements 13.3, 13.4, 13.5**

#### Build Script Updates

The build process needs to:
1. Compile the Tree-sitter grammar
2. Build the Rust extension to WASM
3. Bundle the LSP server binary
4. Copy command database caches

Add to `package.json`:
```json
{
  "scripts": {
    "build:zed": "bun scripts/build-zed-extension.ts",
    "build:zed:grammar": "cd ../tree-sitter-stata && tree-sitter generate",
    "build:zed:wasm": "cd zed-extension && cargo build --release --target wasm32-wasi"
  }
}
```

#### Version Synchronization

Update `scripts/bump-version.ts` to include Zed extension files:

```typescript
// Add to bump-version.ts
function update_extension_toml(path: string, new_version: string): void {
    let content = readFileSync(path, "utf-8");
    content = content.replace(/^version = ".*"$/m, `version = "${new_version}"`);
    writeFileSync(path, content);
}

function update_cargo_toml(path: string, new_version: string): void {
    let content = readFileSync(path, "utf-8");
    content = content.replace(/^version = ".*"$/m, `version = "${new_version}"`);
    writeFileSync(path, content);
}

function update_package_json(path: string, new_version: string): void {
    const content = JSON.parse(readFileSync(path, "utf-8"));
    content.version = new_version;
    writeFileSync(path, JSON.stringify(content, null, 2) + "\n");
}

// In main:
update_extension_toml("zed-extension/extension.toml", new_version);
update_cargo_toml("zed-extension/Cargo.toml", new_version);
console.log("Updated zed-extension files");
```

**Design Decision**: Zed extension version files (extension.toml, Cargo.toml) are updated in this repo. The Tree-sitter grammar version is maintained in the external tree-sitter-stata repo.

### Component 10: Documentation Updates

**Validates: Requirements 15.1-15.4**

The following documentation files need updates to reflect the Zed extension:

#### DEVELOPMENT.md Updates

Add a new section documenting Zed extension development:

```markdown
## Zed Extension Development

### Prerequisites

- **Rust** (stable toolchain): For compiling the extension to WASM
- **Cargo**: Rust package manager
- **tree-sitter-cli**: For generating the Tree-sitter parser (`npm install -g tree-sitter-cli`)
- **Bun**: For building the LSP server binary

### Build Process

1. Generate the Tree-sitter grammar:
   ```bash
   cd ../tree-sitter-stata
   tree-sitter generate
   ```

2. Build the WASM extension:
   ```bash
   cd zed-extension
   cargo build --release --target wasm32-wasi
   ```

3. Bundle the LSP server:
   ```bash
   bun build --compile --outfile=zed-extension/server/sight-server ./src/server.ts
   ```

4. Copy command database caches:
   ```bash
   cp -r src/command-database/caches/* zed-extension/server/command-database/caches/
   ```

### Testing Locally

Install as a dev extension by symlinking to Zed's extension directory:
```bash
ln -s $(pwd)/zed-extension ~/.config/zed/extensions/installed/sight
```
```

#### AGENTS.md Updates

Add Zed extension to the system overview section, documenting:
- The `zed-extension/` directory structure
- Tree-sitter grammar location and purpose
- Relationship to the existing VS Code client

### Component 11: Release Automation (CI/CD)

**Validates: Requirements 16.1-16.6**

The CI pipeline extends the existing release workflows to include the Zed extension:
1. `.github/workflows/release-build.yml` (tag-triggered) builds the Zed extension archives and uploads them as workflow artifacts.
2. `.github/workflows/release-publish.yml` (`workflow_dispatch`) downloads the artifacts from the matching build run and attaches the Zed extension archives to the GitHub Release.

**Archive Naming Convention**: Archives follow the pattern `sight-zed-extension-{target}.tar.gz` (or `.zip` on Windows), where `{target}` matches the existing binary target naming (e.g., `darwin-arm64`, `linux-x64`).

**File**: Extend `.github/workflows/release-build.yml`

```yaml
# Add to existing release-build.yml workflow
# This shows the Zed extension build job to add

  build-zed-extension:
    name: Build Zed Extension (${{ matrix.target }})
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        include:
          # Aligned with existing TARGETS in scripts/build-binary.ts
          - os: macos-latest
            target: darwin-arm64
            bun-target: bun-darwin-arm64
          - os: ubuntu-latest
            target: linux-x64
            bun-target: bun-linux-x64
          - os: ubuntu-latest
            target: linux-arm64
            bun-target: bun-linux-arm64
          - os: windows-latest
            target: windows-x64
            bun-target: bun-windows-x64
          - os: windows-latest
            target: windows-arm64
            bun-target: bun-windows-arm64

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      
      # 1. Install dependencies
      - name: Install dependencies
        run: bun install

      # 2. Build Server Binary
      - name: Build Server Binary
        run: |
          bun build --compile --target=${{ matrix.bun-target }} --outfile=sight-server ./src/server.ts

      # 3. Build WASM Extension (requires Rust)
      - name: Install Rust
        uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
          target: wasm32-wasi
          override: true
          
      - name: Build WASM
        run: |
          cd zed-extension
          cargo build --release --target wasm32-wasi

      # 4. Assemble Extension Bundle
      - name: Assemble Bundle (Unix)
        if: runner.os != 'Windows'
        run: |
          mkdir -p bundle/sight
          # Copy extension manifest and code
          cp zed-extension/extension.toml bundle/sight/
          cp zed-extension/target/wasm32-wasi/release/sight_extension.wasm bundle/sight/extension.wasm
          
          # Copy language config and grammar
          mkdir -p bundle/sight/languages/stata
          cp zed-extension/languages/stata/* bundle/sight/languages/stata/
          cp -r zed-extension/tree-sitter-stata bundle/sight/
          
          # Copy server binary and caches
          mkdir -p bundle/sight/server/command-database/caches
          cp sight-server bundle/sight/server/
          cp -r src/command-database/caches/* bundle/sight/server/command-database/caches/

      - name: Assemble Bundle (Windows)
        if: runner.os == 'Windows'
        shell: pwsh
        run: |
          New-Item -ItemType Directory -Force -Path bundle/sight
          # Copy extension manifest and code
          Copy-Item zed-extension/extension.toml bundle/sight/
          Copy-Item zed-extension/target/wasm32-wasi/release/sight_extension.wasm bundle/sight/extension.wasm
          
          # Copy language config and grammar
          New-Item -ItemType Directory -Force -Path bundle/sight/languages/stata
          Copy-Item zed-extension/languages/stata/* bundle/sight/languages/stata/
          Copy-Item -Recurse zed-extension/tree-sitter-stata bundle/sight/
          
          # Copy server binary and caches
          New-Item -ItemType Directory -Force -Path bundle/sight/server/command-database/caches
          Copy-Item sight-server.exe bundle/sight/server/
          Copy-Item -Recurse src/command-database/caches/* bundle/sight/server/command-database/caches/

      # 5. Compress and Upload
      - name: Create Archive (Unix)
        if: runner.os != 'Windows'
        run: |
          cd bundle
          tar -czf ../sight-zed-extension-${{ matrix.target }}.tar.gz sight/

      - name: Create Archive (Windows)
        if: runner.os == 'Windows'
        shell: pwsh
        run: |
          cd bundle
          Compress-Archive -Path sight -DestinationPath ../sight-zed-extension-${{ matrix.target }}.zip

      - name: Upload workflow artifact
        uses: actions/upload-artifact@v4
        with:
          name: sight-zed-extension-${{ matrix.target }}
          path: |
            sight-zed-extension-${{ matrix.target }}.tar.gz
            sight-zed-extension-${{ matrix.target }}.zip
```

**File**: Extend `.github/workflows/release-publish.yml`

Add steps to download and attach Zed extension archives:

```yaml
# Add to existing release-publish.yml workflow

      - name: Download Zed Extension Artifacts
        uses: actions/download-artifact@v4
        with:
          pattern: sight-zed-extension-*
          merge-multiple: true
          
      - name: Attach Zed Extensions to Release
        uses: softprops/action-gh-release@v1
        with:
          tag_name: ${{ github.event.inputs.tag }}
          files: |
            sight-zed-extension-*.tar.gz
            sight-zed-extension-*.zip
```

### Component 12: Setup Script Integration

**Validates: Requirements 14.1-14.5**

Update `setup.sh` to include Zed extension:

```bash
# Add after VS Code extension installation

# Step 5: Build and install Zed extension
echo "Building Zed extension..."
if command -v tree-sitter &> /dev/null && command -v cargo &> /dev/null; then
    # Build Tree-sitter grammar
    cd zed-extension/tree-sitter-stata
    tree-sitter generate
    cd ../..
    
    # Copy server binary to Zed extension
    mkdir -p zed-extension/server/command-database/caches
    cp bin/sight-server-* zed-extension/server/sight-server 2>/dev/null || \
        cp dist/sight-server.js zed-extension/server/sight-server
    cp -r src/command-database/caches/* zed-extension/server/command-database/caches/
    
    echo -e "${GREEN}✓ Zed extension built${NC}"
    
    # Install to Zed if available
    if command -v zed &> /dev/null; then
        echo "Installing Zed extension as dev extension..."
        # Zed dev extensions are installed by symlinking to ~/.config/zed/extensions/installed/
        ZED_EXT_DIR="$HOME/.config/zed/extensions/installed/sight"
        mkdir -p "$(dirname "$ZED_EXT_DIR")"
        rm -rf "$ZED_EXT_DIR"
        ln -s "$(pwd)/zed-extension" "$ZED_EXT_DIR"
        echo -e "${GREEN}✓ Zed extension installed${NC}"
    else
        echo -e "${YELLOW}Zed not found - skipping Zed extension installation${NC}"
    fi
else
    echo -e "${YELLOW}tree-sitter or cargo not found - skipping Zed extension build${NC}"
    echo "Install with: brew install tree-sitter && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
fi
```

## Correctness Properties

### Property 1: Line Comments Preserve Arbitrary Content
**Validates: Requirements 3.5**

For any arbitrary text content (excluding newlines), wrapping it in a line comment (`//`, `///`, or `*` at line start) SHALL produce a valid comment node, and the content SHALL be preserved in the parse tree.

```typescript
// Property: Line comments preserve arbitrary content
fc.property(
    fc.tuple(
        fc.constantFrom('//', '///', '* '),
        fc.string().filter(s => !s.includes('\n') && !s.includes('\r'))
    ),
    ([prefix, content]) => {
        const source = prefix === '* ' ? `* ${content}` : `${prefix} ${content}`;
        const tree = parser.parse(source);
        const comment_node = tree.rootNode.descendantsOfType('line_comment')[0];
        return comment_node !== undefined && comment_node.text.includes(content);
    }
);
```

### Property 2: Block Comments Preserve Arbitrary Content
**Validates: Requirements 3.5**

For any arbitrary text content (excluding `*/`), wrapping it in a block comment SHALL produce a valid block_comment node.

```typescript
// Property: Block comments preserve arbitrary content
fc.property(
    fc.string().filter(s => !s.includes('*/')),
    (content) => {
        const source = `/* ${content} */`;
        const tree = parser.parse(source);
        const comment_node = tree.rootNode.descendantsOfType('block_comment')[0];
        return comment_node !== undefined;
    }
);
```

### Property 3: Nested Local Macros Parse to Correct Depth
**Validates: Requirements 3.7, 3.13, 3.14**

For any nesting depth 1-6, a nested local macro reference SHALL parse to a tree with the correct depth of `local_macro_depth_N` nodes.

```typescript
// Property: Nested local macros parse to correct depth
fc.property(
    fc.tuple(
        fc.integer({ min: 1, max: 6 }),
        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/).filter(s => s.length > 0 && s.length < 20)
    ),
    ([depth, name]) => {
        const macro = '`'.repeat(depth) + name + "'".repeat(depth);
        const tree = parser.parse(`display ${macro}`);
        
        // Find the outermost local macro node
        const find_macro_depth = (node: any): number => {
            for (let i = 1; i <= 6; i++) {
                if (node.type === `local_macro_depth_${i}`) {
                    // Check for nested macro
                    for (const child of node.children) {
                        const child_depth = find_macro_depth(child);
                        if (child_depth > 0) return child_depth + 1;
                    }
                    return 1;
                }
            }
            for (const child of node.children || []) {
                const d = find_macro_depth(child);
                if (d > 0) return d;
            }
            return 0;
        };
        
        return find_macro_depth(tree.rootNode) === depth;
    }
);
```

### Property 4: Nested Compound Strings Parse to Correct Depth
**Validates: Requirements 3.6, 3.13, 3.14**

For any nesting depth 1-6, a nested compound string SHALL parse to a tree with the correct depth of `compound_string_depth_N` nodes.

```typescript
// Property: Nested compound strings parse to correct depth
fc.property(
    fc.tuple(
        fc.integer({ min: 1, max: 6 }),
        fc.string().filter(s => !s.includes('`') && !s.includes("'") && !s.includes('"') && !s.includes('\n'))
    ),
    ([depth, content]) => {
        // Build nested compound string: `"outer `"inner"' outer"'
        let str = content;
        for (let i = 0; i < depth; i++) {
            str = '`"' + str + "\"'";
        }
        const tree = parser.parse(`display ${str}`);
        
        const find_compound_depth = (node: any): number => {
            for (let i = 1; i <= 6; i++) {
                if (node.type === `compound_string_depth_${i}`) {
                    for (const child of node.children) {
                        const child_depth = find_compound_depth(child);
                        if (child_depth > 0) return child_depth + 1;
                    }
                    return 1;
                }
            }
            for (const child of node.children || []) {
                const d = find_compound_depth(child);
                if (d > 0) return d;
            }
            return 0;
        };
        
        return find_compound_depth(tree.rootNode) === depth;
    }
);
```

### Property 5: Mata Block Forms All Parse as mata_block
**Validates: Requirements 3.10**

All five Mata block forms SHALL parse to a `mata_block` node.

```typescript
// Property: All Mata block forms parse as mata_block
fc.property(
    fc.constantFrom(
        'mata 1 + 2',                           // inline without colon
        'mata: 3 + 4',                          // inline with colon
        'mata\nreal x\nend',                    // multiline without colon
        'mata:\nreal y\nend',                   // multiline with colon
        'mata {\n    real z\n}',                // brace-delimited
    ),
    (source) => {
        const tree = parser.parse(source);
        const mata_nodes = tree.rootNode.descendantsOfType('mata_block');
        return mata_nodes.length === 1;
    }
);
```

### Property 6: Double Strings Preserve Content
**Validates: Requirements 3.6**

For any string content (excluding unescaped quotes and newlines), wrapping in double quotes SHALL produce a valid double_string node.

```typescript
// Property: Double strings preserve content
fc.property(
    fc.string().filter(s => !s.includes('"') && !s.includes('\n') && !s.includes('\r')),
    (content) => {
        const source = `display "${content}"`;
        const tree = parser.parse(source);
        const string_nodes = tree.rootNode.descendantsOfType('double_string');
        return string_nodes.length >= 1;
    }
);
```

### Property 7: Global Macros Parse with Valid Identifiers
**Validates: Requirements 3.8**

For any valid Stata identifier, both `$name` and `${name}` forms SHALL parse as global_macro nodes.

```typescript
// Property: Global macros parse with valid identifiers
fc.property(
    fc.tuple(
        fc.constantFrom('$', '${'),
        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/).filter(s => s.length > 0 && s.length < 32)
    ),
    ([prefix, name]) => {
        const macro = prefix === '${' ? `\${${name}}` : `$${name}`;
        const source = `display ${macro}`;
        const tree = parser.parse(source);
        const global_nodes = tree.rootNode.descendantsOfType('global_macro');
        return global_nodes.length >= 1;
    }
);
```

### Property 8: Program Definitions Parse with Valid Names
**Validates: Requirements 3.9**

For any valid Stata identifier as program name, both `program name` and `program define name` forms SHALL parse as program_definition nodes with the correct name field.

```typescript
// Property: Program definitions parse with valid names
fc.property(
    fc.tuple(
        fc.boolean(),  // whether to include 'define'
        fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/).filter(s => s.length > 0 && s.length < 32)
    ),
    ([use_define, name]) => {
        const source = use_define 
            ? `program define ${name}\nend`
            : `program ${name}\nend`;
        const tree = parser.parse(source);
        const prog_nodes = tree.rootNode.descendantsOfType('program_definition');
        if (prog_nodes.length !== 1) return false;
        const name_field = prog_nodes[0].childForFieldName('name');
        return name_field !== null && name_field.text === name;
    }
);
```

### Property 9: Identifiers Accept Valid Stata Names
**Validates: Requirements 3.11**

Any string matching the Stata identifier pattern `[A-Za-z_][A-Za-z0-9_]*` SHALL parse as an identifier when used as a command name.

```typescript
// Property: Valid identifiers parse correctly
fc.property(
    fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]*$/).filter(s => s.length > 0 && s.length < 32),
    (name) => {
        const tree = parser.parse(name);
        // Should parse as a command with the identifier as name
        const has_identifier = tree.rootNode.descendantsOfType('identifier').some(
            node => node.text === name
        );
        return has_identifier;
    }
);
```

### Property 10: Numbers Parse in All Valid Formats
**Validates: Requirements 3.11**

Integer, decimal, and scientific notation numbers SHALL all parse as number nodes.

```typescript
// Property: Numbers parse in all valid formats
fc.property(
    fc.oneof(
        fc.integer({ min: 0, max: 999999 }).map(n => n.toString()),
        fc.float({ min: 0, max: 999999, noNaN: true }).map(n => n.toFixed(3)),
        fc.tuple(fc.float({ min: 1, max: 99, noNaN: true }), fc.integer({ min: -10, max: 10 }))
            .map(([base, exp]) => `${base.toFixed(2)}e${exp >= 0 ? '+' : ''}${exp}`)
    ),
    (num_str) => {
        const source = `display ${num_str}`;
        const tree = parser.parse(source);
        const num_nodes = tree.rootNode.descendantsOfType('number');
        return num_nodes.length >= 1;
    }
);
```

## Testing Strategy

### Unit Tests

Unit tests verify specific examples and edge cases with deterministic inputs.

#### Grammar Unit Tests
1. **Comment Parsing**: Verify each comment style parses correctly
   - `// line comment` → line_comment node
   - `/// continuation` → line_comment node
   - `* star comment` (at line start) → line_comment node
   - `/* block */` → block_comment node
   - Nested block comments

2. **String Parsing**: Verify string literals parse correctly
   - `"simple string"` → double_string node
   - `"string with ""escaped"" quotes"` → double_string node
   - `` `"compound string"' `` → compound_string_depth_1 node
   - Empty strings
   - Macros inside strings (global macros in double strings)

3. **Macro Parsing**: Verify macro references parse correctly
   - `` `local' `` → local_macro_depth_1 node
   - `$global` → global_macro node
   - `${global}` → global_macro node
   - Numeric positional args: `` `1' ``, `` `0' ``
   - Global macros inside local macros: `` `$global' ``

4. **Mata Block Parsing**: Verify all 5 Mata forms parse correctly
   - `mata expr` (inline)
   - `mata: expr` (inline with colon)
   - `mata\n...\nend` (multiline)
   - `mata:\n...\nend` (multiline with colon)
   - `mata { ... }` (brace-delimited)

5. **Program Definition Parsing**: Verify program definitions parse correctly
   - `program name\nend`
   - `program define name\nend`
   - Program with body content

6. **Macro Definition Parsing**: Verify macro definitions parse correctly
   - `local name value`
   - `global name value`
   - `tempvar name1 name2`

#### Query File Unit Tests
1. **Highlights Coverage**: Verify highlights.scm contains captures for all required node types
2. **Brackets Symmetry**: Verify brackets.scm has matching @open/@close for all pairs
3. **Indents Rules**: Verify indents.scm has @indent/@outdent for block constructs

#### Configuration Unit Tests
1. **Extension Manifest**: Verify extension.toml has all required fields
2. **Language Config**: Verify config.toml has correct file associations and comment delimiters
3. **Version Consistency**: Verify all version files match (without running bump script)

### Property-Based Tests

Property-based tests verify universal properties hold across randomly generated inputs.

1. **Line Comment Content Preservation** (Property 1): Any text wrapped in `//` parses as comment
2. **Block Comment Content Preservation** (Property 2): Any text wrapped in `/* */` parses as comment
3. **Nested Local Macro Depth** (Property 3): Depth 1-6 nesting parses to correct tree depth
4. **Nested Compound String Depth** (Property 4): Depth 1-6 nesting parses to correct tree depth
5. **Mata Block Forms** (Property 5): All 5 forms parse as mata_block
6. **Double String Content** (Property 6): Arbitrary content in quotes parses as string
7. **Global Macro Identifiers** (Property 7): Valid identifiers parse in both `$` forms
8. **Program Definition Names** (Property 8): Valid identifiers parse as program names
9. **Identifier Validity** (Property 9): Stata identifier pattern parses correctly
10. **Number Formats** (Property 10): Integer, decimal, scientific notation all parse

### TextMate Parity Tests

Parity tests verify the Tree-sitter grammar produces equivalent highlighting for constructs covered by the TextMate grammar. These tests compare the node types/captures produced by Tree-sitter against the expected TextMate scopes.

**Scope Mapping** (TextMate → Tree-sitter):
| TextMate Scope | Tree-sitter Node/Capture |
|----------------|--------------------------|
| `comment.block.stata` | `block_comment` → `@comment` |
| `comment.line.star.stata` | `line_comment` → `@comment` |
| `comment.line.double-slash.stata` | `line_comment` → `@comment` |
| `comment.line.triple-slash.stata` | `line_comment` → `@comment` |
| `string.quoted.double.stata` | `double_string` → `@string` |
| `string.quoted.compound.depth1-6.stata` | `compound_string_depth_1-6` → `@string.depth.1-6` |
| `variable.other.macro.local.depth1-6.stata` | `local_macro_depth_1-6` → `@variable.macro.local.depth.1-6` |
| `variable.other.macro.global.stata` | `global_macro` → `@variable` |
| `keyword.control.mata.stata` | `mata_block` "mata"/"end" → `@keyword` |
| `storage.type.function.stata` | `program_definition` "program" → `@keyword` |
| `entity.name.function.stata` | `program_definition` name → `@function` |
| `keyword.control.conditional.stata` | "if"/"else" → `@keyword` |
| `keyword.control.flow.stata` | "foreach"/"forvalues"/"while" → `@keyword` |
| `keyword.control.prefix.stata` | `prefix` → `@keyword` |
| `support.type.stata` | type keywords → `@type` |
| `variable.language.stata` | `builtin_variable` → `@variable.builtin` |
| `constant.language.missing.stata` | `missing_value` → `@constant` |
| `keyword.operator.*.stata` | `operator` → `@operator` |
| `constant.numeric.stata` | `number` → `@number` |

**Parity Test Categories**:
1. Comments (4 styles)
2. Strings (double, compound depth 1-6)
3. Macros (local depth 1-6, global, nested)
4. Mata blocks (keyword highlighting)
5. Program definitions (keyword + name)
6. Control flow keywords
7. Prefix keywords
8. Types
9. Built-in variables
10. Missing values
11. Operators
12. Numbers
13. Macros inside strings
14. Global macros inside local macros

### Integration Tests

1. **Build Process**: Verify complete build produces all required artifacts
2. **Version Sync**: Verify bump-version.ts updates all files correctly
3. **Setup Script**: Verify setup.sh handles Zed presence/absence correctly

### Manual Testing

1. Open Stata files in Zed and verify syntax highlighting
2. Test bracket matching and auto-closing
3. Test LSP features (completions, hover, go-to-definition)
4. Test auto-indentation behavior

## Dependencies

### Build Dependencies

- **Rust** (stable): For compiling the Zed extension to WASM
- **Cargo**: Rust package manager
- **tree-sitter-cli**: For generating the Tree-sitter parser
- **Bun**: For building the LSP server

### Runtime Dependencies

- **Zed**: Target editor (version with extension support)
- **Sight LSP Server**: Bundled with extension

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tree-sitter grammar complexity | High | Start with core syntax, iterate |
| Zed extension API changes | Medium | Pin to stable API version |
| Server binary size | Low | Use release builds with optimization |
| Cross-platform compatibility | Medium | Test on macOS, Linux; document Windows limitations |

## Future Considerations

1. **Semantic highlighting**: Add Tree-sitter queries for semantic tokens
2. **Code folding**: Add folding queries for collapsible regions
3. **Snippets**: Add Stata code snippets
4. **Zed themes**: Ensure compatibility with Zed's theme system
