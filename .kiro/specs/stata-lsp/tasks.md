# Implementation Plan: Stata LSP

## Overview

This implementation plan breaks down the Stata LSP into incremental tasks, starting with core infrastructure and building up to full feature support. Each task builds on previous work, ensuring no orphaned code.

## Tasks

- [x] 1. Project Setup and Infrastructure
  - [x] 1.1 Initialize TypeScript project with vscode-languageserver dependencies
    - Create package.json with dependencies: vscode-languageserver, vscode-languageserver-textdocument, fast-check
    - Configure tsconfig.json for ES2020 target
    - Set up build scripts and bun commands
    - _Requirements: 1.1_

  - [x] 1.2 Create LSP server entry point and lifecycle handlers
    - Implement server.ts with initialize, initialized, shutdown, exit handlers
    - Return server capabilities (completion, hover, definition, symbols, formatting)
    - Handle pre-initialization requests with error code -32002
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 1.3 Write unit tests for LSP lifecycle
    - Test initialize response contains correct capabilities
    - Test shutdown/exit behavior
    - Test pre-initialization error handling
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 2. Document Store
  - [x] 2.1 Implement DocumentStore class
    - Store document content, version, URI
    - Handle open/update/close operations
    - Support both full and incremental change events
    - Implement version gating for stale result prevention
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 2.2 Write property test for Document Store consistency
    - **Property 4: Document Store Consistency**
    - **Validates: Requirements 2.1, 2.2, 2.3**

- [x] 3. Stata Lexer
  - [x] 3.1 Implement core lexer with token types
    - Define TokenType enum (WORD, NUMBER, STRING, MACRO_REF_LOCAL, MACRO_REF_GLOBAL, etc.)
    - Implement tokenize() function with LexerState tracking
    - Handle delimiter mode state (#delimit cr vs #delimit ;)
    - Emit unified STATEMENT_TERMINATOR token
    - _Requirements: 3.1, 3.2, 3.6, 3.7_

  - [x] 3.2 Implement string and quote handling
    - Handle simple quotes ("string")
    - Handle compound quotes (`"string"')
    - Handle doubling escape convention ("")
    - Detect unbalanced quotes and emit errors
    - _Requirements: 3.5, 6.11_

  - [x] 3.3 Implement comment handling
    - Handle * line comments (start of line only)
    - Handle // line comments (anywhere)
    - Handle /* */ block comments
    - Handle /// continuation comments
    - Detect unbalanced block comments
    - _Requirements: 3.4_

  - [x] 3.4 Implement line continuation (///) handling
    - Join following line to current statement in cr mode
    - Preserve CONTINUATION token for trivia
    - Detect /// without preceding whitespace (warning)
    - Handle /// in semicolon mode (no structural effect)
    - _Requirements: 3.3, 6.12_

  - [x] 3.5 Implement macro reference tokenization
    - Tokenize `name' as single MACRO_REF_LOCAL
    - Tokenize $name as MACRO_REF_GLOBAL
    - Tokenize ${name} as single MACRO_REF_GLOBAL (NOT as braces)
    - _Requirements: 4.2_

  - [ ]* 3.6 Write property test for lexer tokenization
    - **Property 2: Lexer Tokenization Correctness**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

- [x] 4. Checkpoint - Lexer Complete
  - Ensure all lexer tests pass, ask the user if questions arise.

- [x] 5. Stata Parser
  - [x] 5.1 Implement parser infrastructure
    - Define AST node types (CommandNode, ProgramNode, MacroDefNode, etc.)
    - Implement parse() function consuming token stream
    - Handle STATEMENT_TERMINATOR for statement boundaries
    - _Requirements: 4.1_

  - [x] 5.2 Implement command parsing
    - Parse prefix commands (by, quietly, capture)
    - Parse main command with abbreviation expansion
    - Parse variable lists with IdentifierNode (name + range)
    - Parse options after comma
    - _Requirements: 4.1_

  - [x] 5.3 Implement macro definition parsing
    - Parse local macro definitions
    - Parse global macro definitions
    - Handle extended macro syntax (colon form) - extract name, store value as raw text
    - _Requirements: 4.2_

  - [x] 5.4 Implement program definition parsing
    - Parse program define ... end blocks
    - Detect missing end statement
    - _Requirements: 4.3, 6.8_

  - [x] 5.5 Implement control flow parsing
    - Parse if/else blocks
    - Parse foreach/forvalues loops
    - Parse while loops
    - Detect unclosed blocks
    - Detect } else { on same line
    - Detect } not alone on line (block braces only)
    - Detect forvalues with incorrect syntax
    - _Requirements: 4.4, 6.6, 6.7, 6.10, 6.14_

  - [x] 5.6 Implement #delimit directive parsing
    - Parse #delimit cr and #delimit ; directives
    - Create DirectiveNode for round-trip preservation
    - _Requirements: 3.7_

  - [x] 5.7 Implement trivia attachment
    - Attach comments to adjacent AST nodes as leadingTrivia/trailingTrivia
    - Fix skipped test in parser.test.ts for trivia handling
    - _Requirements: 4.5_

  - [ ]* 5.8 Write property test for parser syntax recognition
    - **Property 3: Parser Syntax Recognition**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [x] 6. Pretty Printer
  - [x] 6.1 Implement PrettyPrinter
    - Create src/pretty-printer/index.ts
    - Print AST nodes back to valid Stata source
    - Track #delimit mode for correct statement terminators
    - Preserve trivia (comments)
    - Support configurable indent size/style
    - _Requirements: 4.6_

  - [ ]* 6.2 Write property test for parser round-trip
    - **Property 1: Parser Round-Trip Consistency**
    - **Validates: Requirements 4.6, 4.7**

- [x] 7. Checkpoint - Parser Complete
  - Ensure all parser and pretty-printer tests pass, ask the user if questions arise.

- [x] 8. Command Database
  - [x] 8.1 Create command database structure
    - Create src/commands/index.ts
    - Define CommandInfo and OptionInfo interfaces (already in types/index.ts)
    - Implement CommandDatabase class with lookup, search, expandAbbreviation methods
    - Apply case-insensitive normalization for commands
    - _Requirements: 5.1, 5.2_

  - [x] 8.2 Populate built-in command data
    - Create src/commands/builtin-commands.ts
    - Add common Stata commands with syntax, description, options
    - Include minimum abbreviations for each command (gen, reg, sum, etc.)
    - _Requirements: 5.1, 5.5_

- [x] 9. Semantic Analyzer
  - [x] 9.1 Implement symbol table building
    - Create src/analyzer/index.ts
    - Extract programs, local macros, global macros, variables from AST
    - Apply correct scoping rules (do-file/program scope for locals)
    - Track loop variables with enclosing scope lifetime
    - Apply case-sensitivity rules (macros/variables case-sensitive, programs case-insensitive)
    - _Requirements: 5.3, 8.1, 8.2_

  - [x] 9.2 Implement semantic diagnostics
    - Detect undefined local macro references (heuristic)
    - Detect undefined variable references (heuristic, off by default)
    - _Requirements: 6.3, 6.4, 6.13_

  - [x] 9.3 Implement comment directive parsing
    - Parse // @lsp-ignore-next directive
    - Parse // @lsp-variables directive
    - Suppress diagnostics / seed symbol table accordingly
    - _Requirements: 6.15, 6.16_

- [x] 10. Diagnostics Provider
  - [x] 10.1 Implement DiagnosticsProvider
    - Create src/providers/diagnostics.ts
    - Aggregate diagnostics from lexer, parser, analyzer
    - Publish via textDocument/publishDiagnostics (already wired in server.ts)
    - Clear previous diagnostics on document change
    - Apply version gating
    - _Requirements: 6.1, 6.2, 6.5_

  - [ ]* 10.2 Write property test for diagnostic accuracy
    - **Property 6: Diagnostic Accuracy**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.14**

- [x] 11. Checkpoint - Core Analysis Complete
  - Ensure all analysis tests pass, ask the user if questions arise.

- [x] 12. Completion Provider
  - [x] 12.1 Implement context detection
    - Create src/providers/completion.ts
    - Detect command context (start of statement)
    - Detect option context (after comma)
    - Detect macro context (inside `' or after $)
    - Detect variable context
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 12.2 Implement completion generation
    - Generate command completions from CommandDB
    - Generate option completions for current command
    - Generate symbol completions from SymbolTable
    - Apply user symbol precedence over built-ins
    - Provide fallback completions when AST unavailable
    - Wire into server.ts onCompletion handler (replace stub)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6_

  - [x] 12.3 Implement quote snippet completions
    - Offer `name' snippet on backtick trigger
    - Offer `"text"' snippet on `" trigger
    - Check client snippetSupport capability
    - _Requirements: 5.7, 5.8_
    - [ ]* 12.4 Write property test for completion relevance
    - **Property 5: Completion Relevance**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**

- [x] 13. Hover Provider
  - [x] 13.1 Implement hover for commands
    - Create src/providers/hover.ts
    - Display syntax and description from CommandDB
    - Wire into server.ts onHover handler (replace stub)
    - _Requirements: 7.1_

  - [x] 13.2 Implement hover for symbols
    - Display macro definition location and value
    - Display program signature and location
    - Display variable type/label (best-effort)
    - _Requirements: 7.2, 7.3, 7.4_

  - [ ]* 13.3 Write property test for hover completeness
    - **Property 7: Hover Information Completeness**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [x] 14. Go-to-Definition Provider
  - [x] 14.1 Implement definition lookup
    - Create src/providers/definition.ts
    - Navigate to local macro definition (current file only)
    - Navigate to global macro definition (current file, then workspace)
    - Navigate to program definition (current file, then workspace with precedence)
    - Navigate to included file (do, run, include commands)
    - Return empty result (not error) when not found
    - Return multiple locations for ambiguous cases
    - Wire into server.ts onDefinition handler (replace stub)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 14.2 Write property test for go-to-definition
    - **Property 8: Go-to-Definition Correctness**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

- [x] 15. Symbol Provider
  - [x] 15.1 Implement document symbols
    - Create src/providers/symbols.ts
    - Return hierarchical list of programs, macros, sections
    - Include symbol kind, name, location
    - Wire into server.ts onDocumentSymbol handler (replace stub)
    - _Requirements: 9.1, 9.3_

  - [x] 15.2 Implement workspace symbols
    - Search across open documents and indexed files
    - Wire into server.ts onWorkspaceSymbol handler (replace stub)
    - _Requirements: 9.2, 9.3_

  - [ ]* 15.3 Write property test for symbol completeness
    - **Property 9: Symbol Information Completeness**
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [x] 16. Checkpoint - LSP Features Complete
  - Ensure all LSP feature tests pass, ask the user if questions arise.

- [x] 17. Code Formatter
  - [x] 17.1 Implement CodeFormatter
    - Create src/providers/formatter.ts
    - Wrap PrettyPrinter to produce TextEdits
    - Support document and range formatting
    - Apply configurable formatting options
    - Preserve semantic meaning (whitespace/indentation only)
    - Wire into server.ts onDocumentFormatting and onDocumentRangeFormatting handlers (replace stubs)
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 17.2 Write property test for formatting preservation
    - **Property 10: Formatting Semantic Preservation**
    - **Validates: Requirements 10.1, 10.2, 10.3**

- [x] 18. Configuration Provider
  - [x] 18.1 Implement configuration handling
    - Handle workspace/didChangeConfiguration (already implemented in server.ts)
    - Request config via workspace/configuration (already implemented in server.ts)
    - Trigger re-analysis on config changes (already implemented in server.ts)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 19. Workspace Indexer
  - [x] 19.1 Implement file scanning
    - Scan workspace and ado-path directories for .do/.ado files
    - Extract programs and top-level global macros
    - Cache parsed symbol information
    - _Requirements: 12.1, 12.4_

  - [x] 19.2 Implement file watching
    - Handle file create/modify/delete events
    - Update index incrementally
    - _Requirements: 12.2_

  - [x] 19.3 Implement program resolution
    - Follow Stata resolution order: `current dir → PERSONAL → PLUS → SITE`
    - Support cross-file navigation for programs
    - _Requirements: 12.3, 12.5_

  - [x] 19.4 Write property test for indexer consistency
    - **Property 9: Indexer Consistency**
    - **Validates: Requirements 8.3, 9.2, 11.2**

- [x] 20. Checkpoint - Server Complete
  - Ensure all server tests pass, ask the user if questions arise.

- [x] 21. Client Extension (VS Code / Kiro)
  - [x] 21.1 Create VS Code extension structure
    - `package.json` with language contribution
    - `src/extension.ts` server launcher
    - _Requirements: 13.4_

  - [x] 21.2 Configure client-side features
    - Language configuration (brackets, comments, indentation)
    - Snippets (from built-in list)
    - _Requirements: 13.1, 13.2_

  - [x] 21.3 Create TextMate grammar
    - Create vscode-stata/syntaxes/stata.tmLanguage.json
    - Define syntax highlighting for keywords, commands, comments, strings, macros
  - [x] 21.4 Implement extension entry point
    - Create client/src/extension.ts
    - Start LSP server as child process
    - Establish JSON-RPC communication
    - Register for configuration changes
    - _Requirements: 13.4_

- [ ] 22. Integration Tests
  - [x] 22.1 Write LSP lifecycle integration tests
    - Create tests/integration/lsp-lifecycle.test.ts
    - Test end-to-end initialize/shutdown/exit
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 22.2 Write cross-file navigation tests
    - Create tests/integration/cross-file-navigation.test.ts
    - Test go-to-definition across files
    - Test workspace symbol search
    - _Requirements: 8.2, 8.3, 9.2_

  - [ ] 22.3 Test with real-world Stata files
    - Create tests/integration/real-files.test.ts
    - Validate against sample .do and .ado files
    - Verify no crashes or unexpected errors

- [x] 23. Final Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 24. Documentation
  - [x] 24.1 Create README.md with build and installation instructions
    - Document project overview and features
    - Include prerequisites (Bun runtime)
    - Provide build instructions (bun install, bun run build)
    - Provide installation instructions for VS Code / Kiro
    - Document configuration options
    - Include usage examples
    - _Requirements: 13.4_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
