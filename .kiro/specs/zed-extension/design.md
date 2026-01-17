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
├── zed-extension/                    # Zed extension root
│   ├── extension.toml                # Extension manifest
│   ├── Cargo.toml                    # Rust project config
│   ├── LICENSE                       # GPL-3.0 license
│   ├── src/
│   │   └── lib.rs                    # Extension implementation
│   ├── languages/
│   │   └── stata/
│   │       ├── config.toml           # Language configuration
│   │       ├── highlights.scm        # Syntax highlighting queries
│   │       ├── brackets.scm          # Bracket matching queries
│   │       ├── indents.scm           # Auto-indentation queries
│   │       └── outline.scm           # Code outline queries
│   ├── tree-sitter-stata/            # Tree-sitter grammar
│   │   ├── grammar.js                # Grammar definition
│   │   ├── package.json              # Node package for tree-sitter
│   │   ├── bindings/
│   │   │   └── rust/
│   │   │       ├── lib.rs            # Rust bindings
│   │   │       └── build.rs          # Build script
│   │   └── src/                      # Generated parser (after build)
│   │       ├── parser.c
│   │       └── tree_sitter/
│   │           └── parser.h
│   └── server/                       # Bundled LSP server (after build)
│       ├── sight-server              # Compiled binary
│       └── command-database/
│           └── caches/
│               └── v18.json
├── client/                           # VS Code extension (existing)
├── src/                              # LSP server source (existing)
└── scripts/
    └── bump-version.ts               # Updated for Zed extension
```

## Component Design

### Component 1: Extension Manifest (extension.toml)

Declares extension metadata and registers the Stata language with its grammar and language server.

```toml
id = "sight"
name = "Sight - Stata Language Server"
description = "Language support for Stata using LSP"
version = "0.1.8"
schema_version = 1
authors = ["AWS Kiro <kiro@amazon.com>"]
repository = "https://github.com/jbearak/sight"

[grammars.stata]
repository = "."
path = "tree-sitter-stata"

[language_servers.sight]
name = "Sight"
languages = ["stata"]
```

### Component 2: Rust Extension Implementation (src/lib.rs)

Implements the `zed_extension_api::Extension` trait. With the "Fat Bundle" strategy, the implementation is significantly simplified as the binary is guaranteed to be present in the extension directory.

```rust
use zed_extension_api::{self as zed, Result};
use std::fs;

struct SightExtension;

impl zed::Extension for SightExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // The binary is guaranteed to be bundled at ./server/sight-server
        // In Zed WASM, current_dir() is the extension root.
        let server_path = std::env::current_dir()
            .unwrap()
            .join("server")
            .join("sight-server");
            
        if !server_path.exists() {
             return Err(format!(
                 "Sight server binary not found at {:?}. This extension bundle may be corrupt or for the wrong platform.", 
                 server_path
             ).into());
        }

        Ok(zed::Command {
            command: server_path.to_string_lossy().to_string(),
            args: vec!["--stdio".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(SightExtension);
```

### Component 3: Tree-sitter Grammar (tree-sitter-stata/grammar.js)

Defines the Stata grammar for parsing. Key design decisions:

1. **Precedence levels**: Handle operator precedence correctly
2. **Nested macros**: Support up to 6 levels of nesting (matching TextMate)
3. **Context-sensitive parsing**: Handle `*` as both comment and multiplication
4. **Embedded languages**: Recognize Mata blocks using an external scanner for robustness

```javascript
module.exports = grammar({
  name: 'stata',

  // Use external scanner for Mata blocks to correctly handle arbitrary content ending with 'end'
  externals: $ => [
    $._mata_block_content,
  ],

  extras: $ => [/\s/],

  rules: {
    source_file: $ => repeat($._statement),

    _statement: $ => choice(
      $.comment,
      $.program_definition,
      $.control_flow,
      $.command,
      $.macro_definition,
      $.mata_block,
    ),

    // Comments
    comment: $ => choice(
      $.line_comment,
      $.block_comment,
    ),
    
    line_comment: $ => choice(
      seq('//', /.*/),
      seq('///', /.*/),
      seq(/^\s*\*/, /.*/),
    ),
    
    block_comment: $ => seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),

    // Strings with nested macro support
    string: $ => choice(
      $.double_string,
      $.compound_string,
    ),
    
    double_string: $ => seq('"', repeat(choice(/[^"\\`$]+/, $.local_macro, $.global_macro, '""')), '"'),
    
    compound_string: $ => seq('`"', repeat(choice(/[^"'`$]+/, $.local_macro, $.global_macro, $.compound_string)), '"\''),

    // Macros
    local_macro: $ => seq('`', $.identifier, '\''),
    
    global_macro: $ => choice(
      seq('$', $.identifier),
      seq('${', $.identifier, '}'),
    ),

    // Program definitions
    program_definition: $ => seq(
      'program',
      optional('define'),
      field('name', $.identifier),
      repeat($._statement),
      'end',
    ),

    // Control flow
    control_flow: $ => choice(
      $.if_statement,
      $.foreach_loop,
      $.forvalues_loop,
      $.while_loop,
    ),

    if_statement: $ => prec.right(seq(
      'if',
      $._expression,
      '{',
      repeat($._statement),
      '}',
      optional(seq('else', choice($.if_statement, seq('{', repeat($._statement), '}')))),
    )),

    foreach_loop: $ => seq(
      'foreach',
      $.identifier,
      choice('in', 'of'),
      $._expression,
      '{',
      repeat($._statement),
      '}',
    ),

    forvalues_loop: $ => seq(
      choice('forvalues', 'forv'),
      $.identifier,
      '=',
      $._numlist,
      '{',
      repeat($._statement),
      '}',
    ),

    while_loop: $ => seq(
      'while',
      $._expression,
      '{',
      repeat($._statement),
      '}',
    ),

    // Mata blocks
    mata_block: $ => seq(
      'mata',
      optional(':'),
      $._mata_block_content, // Handled by external scanner
      'end',
    ),

    // Commands (simplified - full list in actual implementation)
    command: $ => seq(
      optional($.prefix),
      $.command_name,
      optional($._arguments),
    ),

    prefix: $ => choice(
      'by', 'bysort', 'bys',
      'quietly', 'qui',
      'noisily', 'noi',
      'capture', 'cap',
      'sortpreserve',
    ),

    command_name: $ => $.identifier,

    // Macro definitions
    macro_definition: $ => choice(
      seq(choice('local', 'loc'), $.identifier, optional($._expression)),
      seq(choice('global', 'gl'), $.identifier, optional($._expression)),
      seq(choice('tempvar', 'tempname', 'tempfile'), repeat1($.identifier)),
    ),

    // Types
    type: $ => choice(
      'byte', 'int', 'long', 'float', 'double',
      /str[1-9]/, /str[1-9][0-9]/, /str[1-9][0-9][0-9]/,
      /str1[0-9][0-9][0-9]/, /str20[0-3][0-9]/, /str204[0-5]/,
      'strL',
    ),

    // Built-in variables
    builtin_variable: $ => choice(
      '_n', '_N', '_b', '_coef', '_cons', '_rc', '_se', '_pi',
    ),

    // Missing values
    missing_value: $ => /\.[a-z]?/,

    // Operators
    operator: $ => choice(
      // Arithmetic
      '+', '-', '*', '/', '^',
      // Comparison
      '==', '!=', '~=', '<', '>', '<=', '>=',
      // Logical
      '&', '|', '!', '~',
      // Assignment
      '=',
    ),

    // Numbers
    number: $ => /\d+(\.\d+)?([eE][+-]?\d+)?/,

    // Identifiers
    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,

    // Expressions (simplified)
    _expression: $ => choice(
      $.identifier,
      $.number,
      $.string,
      $.local_macro,
      $.global_macro,
      $.builtin_variable,
      $.missing_value,
      // ... binary expressions, function calls, etc.
    ),

    _arguments: $ => repeat1(choice(
      $.identifier,
      $.number,
      $.string,
      $.local_macro,
      $.global_macro,
    )),

    _numlist: $ => /[0-9\/\(\)]+/,
  },
});
```

#### External Scanner (tree-sitter-stata/src/scanner.c)

An external scanner is required to correctly parse Mata blocks, consuming all content until the `end` keyword is encountered on a new line or in a valid closing context.

```c
#include <tree_sitter/parser.h>
#include <wctype.h>

// ... implementation details for consuming text until "end" keyword ...
```

### Component 4: Language Configuration (languages/stata/config.toml)

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
  { start = "\"", end = "\"", close = true, newline = false, not_in = ["string"] },
  { start = "`", end = "'", close = true, newline = false },
]

word_characters = ["_"]
```

### Component 5: Syntax Highlighting Queries (languages/stata/highlights.scm)

```scheme
; Comments
(line_comment) @comment
(block_comment) @comment

; Strings
(double_string) @string
(compound_string) @string

; Macros
(local_macro) @variable
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

; Mata
(mata_block "mata" @keyword)
(mata_block "end" @keyword)
```

### Component 6: Bracket Matching Queries (languages/stata/brackets.scm)

```scheme
("{" @open "}" @close)
("[" @open "]" @close)
("(" @open ")" @close)
("\"" @open "\"" @close)
("`" @open "'" @close)
```

### Component 7: Indentation Queries (languages/stata/indents.scm)

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

```scheme
(program_definition
  name: (identifier) @name) @item
```

### Component 9: Build Process Integration

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

// In main:
update_extension_toml("zed-extension/extension.toml", new_version);
update_cargo_toml("zed-extension/Cargo.toml", new_version);
console.log("Updated zed-extension/extension.toml and zed-extension/Cargo.toml");
```

### Component 11: Release Automation (CI/CD)

The CI pipeline creates installable extension archives for each platform.

**File**: `.github/workflows/release-extension.yml`

```yaml
name: Release Extension

on:
  release:
    types: [created]

jobs:
  build-extension:
    name: Build Extension (${{ matrix.target }})
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: macos-x64
            bun-target: bun-darwin-x64
          - os: macos-latest
            target: macos-arm64
            bun-target: bun-darwin-arm64
          - os: ubuntu-latest
            target: linux-x64
            bun-target: bun-linux-x64
          - os: ubuntu-latest
            target: linux-arm64
            bun-target: bun-linux-arm64

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
      - name: Assemble Bundle
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

      # 5. Compress and Upload
      - name: Create Archive
        run: |
          cd bundle
          tar -czf ../sight-zed-extension-${{ matrix.target }}.tar.gz sight/

      - name: Upload Release Asset
        uses: softprops/action-gh-release@v1
        with:
          files: sight-zed-extension-${{ matrix.target }}.tar.gz
```

### Component 12: Setup Script Integration

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
**Validates: Requirements 13.1, 13.2**

After running the version bump script, all version fields (package.json, client/package.json, extension.toml, Cargo.toml) SHALL contain the same version string.

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
        
        const ext_version = extension_toml.match(/^version = "(.+)"$/m)?.[1];
        const cargo_version = cargo_toml.match(/^version = "(.+)"$/m)?.[1];
        
        return root_version === client_version &&
               root_version === ext_version &&
               root_version === cargo_version;
    }
);
```

### Property 4: Highlight Queries Cover All Node Types
**Validates: Requirements 4.2-4.9**

For each syntax node type that should be highlighted, the highlights.scm file SHALL contain a corresponding capture rule.

```typescript
// Property: All highlightable node types have capture rules
const REQUIRED_CAPTURES = [
    ['comment', '@comment'],
    ['string', '@string'],
    ['local_macro', '@variable'],
    ['global_macro', '@variable'],
    ['keyword', '@keyword'],
    ['program_definition', '@function'],
    ['number', '@number'],
    ['operator', '@operator'],
    ['type', '@type'],
];

fc.property(
    fc.constantFrom(...REQUIRED_CAPTURES),
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
