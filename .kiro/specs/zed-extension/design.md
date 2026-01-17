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
│   ├── tree-sitter-stata/            # Tree-sitter grammar (Req 3.3)
│   │   ├── grammar.js                # Grammar definition (Req 3.1)
│   │   ├── package.json              # Node package for tree-sitter
│   │   ├── bindings/
│   │   │   └── rust/
│   │   │       ├── lib.rs            # Rust bindings
│   │   │       └── build.rs          # Build script
│   │   └── src/                      # Generated parser (after build)
│   │       ├── parser.c
│   │       └── tree_sitter/
│   │           └── parser.h
│   └── server/                       # Bundled LSP server (Req 11.1)
│       ├── sight-server              # Compiled binary (Req 10.4)
│       └── command-database/
│           └── caches/
│               └── v18.json          # Command database (Req 11.4)
├── client/                           # VS Code extension (existing)
├── src/                              # LSP server source (existing)
└── scripts/
    └── bump-version.ts               # Updated for Zed extension (Req 13.3)
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
repository = "."
path = "tree-sitter-stata"

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

### Component 3: Tree-sitter Grammar (tree-sitter-stata/grammar.js)

**Validates: Requirements 3.1-3.15**

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

    // Atoms
    number: _ => /\d+(\.\d+)?([eE][+-]?\d+)?/,
    missing_value: _ => /\.[a-z]?/,
    builtin_variable: _ => choice('_n', '_N', '_b', '_coef', '_cons', '_rc', '_se', '_pi'),

    identifier: _ => /[A-Za-z_][A-Za-z0-9_]*/,
  },
});
```

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

; Global macros (non-depth)
(global_macro) @variable

; Keywords
["if" "else" "foreach" "forvalues" "forv" "while" "continue" "break" "end"] @keyword
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
(type) @type

; Built-in variables
(builtin_variable) @variable.builtin

; Missing values
(missing_value) @constant

; Numbers
(number) @number

; Operators
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
    "build:zed:grammar": "cd zed-extension/tree-sitter-stata && tree-sitter generate",
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
update_package_json("zed-extension/tree-sitter-stata/package.json", new_version);
console.log("Updated zed-extension files");
```

**Design Decision**: All three Zed extension version files (extension.toml, Cargo.toml, tree-sitter-stata/package.json) are updated together to maintain consistency across the extension ecosystem. This ensures the Tree-sitter grammar version stays synchronized with the extension version.

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
   cd zed-extension/tree-sitter-stata
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

### Property 1: Grammar Parses All Comment Styles
**Validates: Requirements 3.5**

For any valid Stata comment (line comment with `//`, `*`, `///`, or block comment with `/* */`), the Tree-sitter grammar SHALL produce a comment node.

```typescript
// Property: All comment styles produce comment nodes
fc.property(
    fc.oneof(
        fc.constant('// comment'),
        fc.constant('/// continuation comment'),
        fc.constant('* line comment'),
        fc.constant('/* block comment */'),
    ),
    (comment_text) => {
        const tree = parser.parse(comment_text);
        const root = tree.rootNode;
        return root.descendantsOfType('comment').length > 0 ||
               root.descendantsOfType('line_comment').length > 0 ||
               root.descendantsOfType('block_comment').length > 0;
    }
);
```

### Property 2: Grammar Parses Nested Local Macros
**Validates: Requirements 3.7**

For any nested local macro reference up to depth 6, the Tree-sitter grammar SHALL correctly parse the nesting structure.

```typescript
// Property: Nested macros parse correctly up to depth 6
fc.property(
    fc.integer({ min: 1, max: 6 }),
    (depth) => {
        const macro = '`'.repeat(depth) + 'name' + '\''.repeat(depth);
        const tree = parser.parse(`display ${macro}`);
        // Verify correct nesting depth in AST
        let node = tree.rootNode.descendantsOfType('local_macro')[0];
        let actual_depth = 0;
        while (node) {
            actual_depth++;
            node = node.descendantsOfType('local_macro')[0];
        }
        return actual_depth === depth;
    }
);
```

### Property 3: Version Synchronization
**Validates: Requirements 13.1-13.6**

After running the version bump script, all version fields (package.json, client/package.json, extension.toml, Cargo.toml, tree-sitter-stata/package.json) SHALL contain the same version string.

```typescript
// Property: All version files stay synchronized
fc.property(
    fc.constantFrom('patch', 'minor', 'major'),
    async (bump_type) => {
        // Run bump script
        await exec(`bun scripts/bump-version.ts ${bump_type}`);
        
        // Read all version files
        const root_version = JSON.parse(readFileSync('package.json')).version;
        const client_version = JSON.parse(readFileSync('client/package.json')).version;
        const extension_toml = readFileSync('zed-extension/extension.toml', 'utf-8');
        const cargo_toml = readFileSync('zed-extension/Cargo.toml', 'utf-8');
        const ts_package = JSON.parse(readFileSync('zed-extension/tree-sitter-stata/package.json')).version;
        
        const ext_version = extension_toml.match(/^version = "(.+)"$/m)?.[1];
        const cargo_version = cargo_toml.match(/^version = "(.+)"$/m)?.[1];
        
        return root_version === client_version &&
               root_version === ext_version &&
               root_version === cargo_version &&
               root_version === ts_package;
    }
);
```

### Property 4: Highlight Queries Cover All Node Types
**Validates: Requirements 4.2-4.13**

For each syntax node type that should be highlighted, the highlights.scm file SHALL contain a corresponding capture rule. Depth-based captures (1-6) are required for compound strings and local macros.

```typescript
// Property: All highlightable node types have capture rules
const REQUIRED_CAPTURES = [
    ['comment', '@comment'],
    ['string', '@string'],
    ['global_macro', '@variable'],
    ['keyword', '@keyword'],
    ['program_definition', '@function'],
    ['number', '@number'],
    ['operator', '@operator'],
    ['type', '@type'],
];

// Depth-based captures for compound strings and local macros
const DEPTH_CAPTURES = [
    ['compound_string_depth_1', '@string.depth.1'],
    ['compound_string_depth_2', '@string.depth.2'],
    ['compound_string_depth_3', '@string.depth.3'],
    ['compound_string_depth_4', '@string.depth.4'],
    ['compound_string_depth_5', '@string.depth.5'],
    ['compound_string_depth_6', '@string.depth.6'],
    ['local_macro_depth_1', '@variable.macro.local.depth.1'],
    ['local_macro_depth_2', '@variable.macro.local.depth.2'],
    ['local_macro_depth_3', '@variable.macro.local.depth.3'],
    ['local_macro_depth_4', '@variable.macro.local.depth.4'],
    ['local_macro_depth_5', '@variable.macro.local.depth.5'],
    ['local_macro_depth_6', '@variable.macro.local.depth.6'],
];

fc.property(
    fc.constantFrom(...REQUIRED_CAPTURES, ...DEPTH_CAPTURES),
    ([node_type, capture]) => {
        const highlights = readFileSync('zed-extension/languages/stata/highlights.scm', 'utf-8');
        return highlights.includes(capture);
    }
);
```

### Property 5: Bracket Pairs Are Symmetric
**Validates: Requirements 5.2-5.6**

For each bracket pair defined in brackets.scm, there SHALL be both an @open and @close capture.

```typescript
// Property: All bracket pairs have open and close captures
const BRACKET_PAIRS = [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
    ['"', '"'],
    ['`', '\''],
];

fc.property(
    fc.constantFrom(...BRACKET_PAIRS),
    ([open, close]) => {
        const brackets = readFileSync('zed-extension/languages/stata/brackets.scm', 'utf-8');
        const has_open = brackets.includes(`"${open}" @open`);
        const has_close = brackets.includes(`"${close}" @close`);
        return has_open && has_close;
    }
);
```

## Testing Strategy

### Unit Tests

1. **Grammar Tests**: Parse sample Stata files and verify AST structure
2. **Query Tests**: Verify highlight/bracket/indent queries produce expected captures
3. **Extension Tests**: Verify lib.rs correctly locates and spawns the server

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
