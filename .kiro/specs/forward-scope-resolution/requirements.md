---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - stata-lsp: [Core dependency]
Status: Active
Related Specs:
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
  - working-directory-propagation: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature adds "forward-looking" cross-file scope resolution to the Stata LSP. Currently, the LSP supports "backward-looking" directives (`@lsp-done-by`, `@lsp-included-by`) that tell a child file which parent file called it. This feature adds the complementary capability: following `do`, `run`, and `include` commands (and their directive equivalents `@lsp-do`, `@lsp-run`, `@lsp-include`) to understand what symbols get added to scope from called files.

The key difference from the existing system:
- **Existing (backward)**: Child file declares "I was called by parent.do" → LSP inherits parent's symbols into child
- **New (forward)**: Parent file calls "do child.do" → LSP inherits child's exported symbols into parent

This enables the LSP to suppress false-positive "undefined macro" warnings and provide accurate completions when scripts define symbols in called files.

Non-goals / constraints:
- Forward scope resolution is a scope-only operation; it does not splice the callee's AST into the caller's AST.
- When forward-following a callee, the callee's parse/analyze diagnostics are not surfaced onto the caller; they are only shown when the callee file itself is opened in the editor.

## Glossary

- **Caller**: The file containing a `do`, `run`, `include` command or `@lsp-do`, `@lsp-run`, `@lsp-include` directive
- **Callee**: The file being called/included by the caller
- **Forward_Scope_Resolver**: The component that follows forward references to build scope
- **Directive_Parser**: The component that parses LSP directives from comments
- **Symbol_Table**: Data structure containing programs, locals, globals, scalars, matrices, and variables
- **Scope_Inheritance**: Rules determining which symbols from callee are visible in caller
- **Call_Command**: A `do`, `run`, or `include` statement in Stata code
- **Call_Directive**: An `@lsp-do`, `@lsp-run`, or `@lsp-include` comment directive

## Requirements

### Requirement 1: Forward Call Directive Parsing

**User Story:** As a developer, I want to use `@lsp-do`, `@lsp-run`, and `@lsp-include` directives to explicitly tell the LSP which files my script calls, so that symbols defined in those files are recognized.

#### Acceptance Criteria

1. WHEN the Directive_Parser encounters `@lsp-do: "path.do"` in a comment, THE Directive_Parser SHALL parse it as a forward call directive with type `do`
2. WHEN the Directive_Parser encounters `@lsp-run: "path.do"` in a comment, THE Directive_Parser SHALL parse it as a forward call directive with type `run`
3. WHEN the Directive_Parser encounters `@lsp-include: "path.do"` in a comment, THE Directive_Parser SHALL parse it as a forward call directive with type `include`
4. WHEN a forward call directive uses unquoted paths, THE Directive_Parser SHALL accept them with the same rules as existing directives
5. WHEN a forward call directive omits the colon (legacy syntax), THE Directive_Parser SHALL accept it for backward compatibility
6. WHEN a forward call directive specifies `line=N` parameter, THE Directive_Parser SHALL record the call site line
7. WHEN a forward call directive specifies `match="string"` parameter, THE Directive_Parser SHALL record the match string for call site resolution

### Requirement 2: Scope Inheritance Rules

**User Story:** As a developer, I want the LSP to correctly inherit symbols based on whether I use `do`/`run` versus `include`, so that local macro scoping matches Stata's behavior.

Notes:
- For the purposes of scope resolution, `run` is equivalent to `do` (in Stata, `run` primarily suppresses output).

#### Acceptance Criteria

1. WHEN the Forward_Scope_Resolver processes a `do` or `run` call, THE Forward_Scope_Resolver SHALL inherit programs, globals, scalars, matrices, and variables from the callee
2. WHEN the Forward_Scope_Resolver processes a `do` or `run` call, THE Forward_Scope_Resolver SHALL NOT inherit local macros from the callee
3. WHEN the Forward_Scope_Resolver processes an `include` call, THE Forward_Scope_Resolver SHALL inherit all symbols including local macros from the callee
4. WHEN multiple files are called in sequence, THE Forward_Scope_Resolver SHALL accumulate symbols in call order
5. WHEN a callee defines a symbol that already exists in the caller's scope, THE Forward_Scope_Resolver SHALL use the callee's definition (later definition wins)

### Requirement 3: Recursive Resolution

**User Story:** As a developer, I want the LSP to follow nested calls (file A calls B, B calls C), so that symbols defined deep in the call chain are recognized.

#### Acceptance Criteria

1. WHEN a callee file contains forward call directives or commands, THE Forward_Scope_Resolver SHALL recursively resolve those calls
2. WHEN recursion depth exceeds the configured maximum, THE Forward_Scope_Resolver SHALL stop recursion and emit a warning diagnostic
3. WHEN a circular dependency is detected (A calls B calls A), THE Forward_Scope_Resolver SHALL stop recursion and emit a warning diagnostic
4. WHEN recursing through files, THE Forward_Scope_Resolver SHALL ignore `@lsp-done-by` and `@lsp-included-by` directives in callees to prevent infinite loops

### Requirement 4: Ignore Directive Integration

**User Story:** As a developer, I want `@lsp-ignore` and `@lsp-ignore-next` to prevent the LSP from following specific calls, so that I can control which files are processed.

#### Acceptance Criteria

1. WHEN a call command or directive is preceded by `@lsp-ignore-next`, THE Forward_Scope_Resolver SHALL skip that call entirely
2. WHEN a call command or directive has `@lsp-ignore` on the same line, THE Forward_Scope_Resolver SHALL skip that call entirely
3. WHEN a call is ignored, THE Forward_Scope_Resolver SHALL NOT report any callee parse/analyze diagnostics onto the caller (the callee's diagnostics only appear when the callee is opened)

### Requirement 5: Caching and Performance

**User Story:** As a developer, I want the LSP to efficiently cache resolved scopes, so that editing large projects remains responsive.

#### Acceptance Criteria

1. THE Forward_Scope_Resolver SHALL cache parsed file results using content hashes
2. WHEN a cached file's content hash matches the current content, THE Forward_Scope_Resolver SHALL reuse the cached symbols
3. WHEN a file is modified, THE Forward_Scope_Resolver SHALL invalidate cache entries that depend on that file
4. THE Forward_Scope_Resolver SHALL NOT re-read callee files on every caller reparse if content is unchanged
5. WHEN resolving forward scope, THE Forward_Scope_Resolver SHALL reuse the existing file cache infrastructure from ScopeResolver

### Requirement 6: Call Site Filtering

**User Story:** As a developer, I want symbols from called files to only be visible after the call site, so that the LSP accurately reflects Stata's runtime behavior.

#### Acceptance Criteria

1. WHEN a call occurs at line N, THE Forward_Scope_Resolver SHALL make callee symbols visible starting at line N+1
2. WHEN a symbol is referenced before its call site, THE Forward_Scope_Resolver SHALL NOT include it in scope for that reference
3. WHEN multiple calls occur in a file, THE Forward_Scope_Resolver SHALL track each call site independently

### Requirement 7: Diagnostic Suppression

**User Story:** As a developer, I want undefined macro warnings to be suppressed for symbols that are defined in called files, so that I don't see false positives.

#### Acceptance Criteria

1. WHEN a macro is defined in a called file and referenced after the call site, THE Diagnostics_Provider SHALL NOT report an undefined macro warning
2. WHEN a macro is referenced before the call site where it becomes defined, THE Diagnostics_Provider SHALL report an undefined macro warning
3. WHEN a called file cannot be found, THE Diagnostics_Provider SHALL report a warning on the call directive or command
4. WHEN forward-following a callee, THE Diagnostics_Provider SHALL NOT surface the callee's parse/analyze diagnostics onto the caller (callee diagnostics appear only when the callee is opened)

### Requirement 8: Completion Provider Integration

**User Story:** As a developer, I want completions to include symbols from called files, so that I can easily reference macros and programs defined elsewhere.

#### Acceptance Criteria

1. WHEN providing completions after a call site, THE Completion_Provider SHALL include symbols from called files
2. WHEN providing completions before a call site, THE Completion_Provider SHALL NOT include symbols from that call's callee
3. WHEN a symbol comes from a called file, THE Completion_Provider SHALL indicate its source in the completion detail

### Requirement 9: Code Command Detection

**User Story:** As a developer, I want the LSP to automatically detect `do`, `run`, and `include` commands in my code without requiring directives, so that scope resolution works with minimal configuration.

#### Acceptance Criteria

1. WHEN the Parser encounters a `do "path.do"` command, THE Parser SHALL record it as a forward call
2. WHEN the Parser encounters a `run "path.do"` command, THE Parser SHALL record it as a forward call
3. WHEN the Parser encounters an `include "path.do"` command, THE Parser SHALL record it as a forward call
4. WHEN a call command uses an unquoted path, THE Parser SHALL resolve it using the same rules as directives
5. WHEN a call command uses a macro in the path (e.g., `do "`myfile'"` ), THE Parser SHALL NOT attempt to resolve it (macro paths are not statically analyzable)

### Requirement 10: Bidirectional Scope Merging

**User Story:** As a developer, I want both forward (calls) and backward (done-by/included-by) scope resolution to work together, so that complex project structures are fully supported.

#### Acceptance Criteria

1. WHEN a file has both forward calls and backward directives, THE Scope_Resolver SHALL merge symbols from both directions
2. WHEN the same symbol is defined in both a caller (via backward) and a callee (via forward), THE Scope_Resolver SHALL use the definition that appears later in execution order
3. THE Scope_Resolver SHALL process backward directives first, then forward calls, to match Stata's execution model

### Requirement 11: Scope-Only Resolution (No AST Splicing)

**User Story:** As a developer, I want forward scope resolution to update symbol visibility without structurally merging called files into the caller's syntax tree, so that scope resolution remains efficient and does not distort navigation/formatting semantics.

#### Acceptance Criteria

1. WHEN the Forward_Scope_Resolver follows a call, THE Forward_Scope_Resolver SHALL NOT add the callee's AST nodes into the caller's AST
2. WHEN the Forward_Scope_Resolver follows a call, THE Forward_Scope_Resolver SHALL only import the callee's exported symbol table information according to the scope inheritance rules

### Requirement 12: Duplicate Call Optimization

**User Story:** As a developer, I want the LSP to efficiently handle cases where the same file is called multiple times, so that performance is not degraded by redundant processing.

#### Acceptance Criteria

1. WHEN the same file is called multiple times via `do` or `run`, THE Forward_Scope_Resolver SHALL process it only once and reuse the symbols
2. WHEN a file was first called via `do` or `run` and later called via `include`, THE Forward_Scope_Resolver SHALL add only the local macros from the second call (since non-locals are already in scope)
3. WHEN a file was first called via `include`, THE Forward_Scope_Resolver SHALL skip subsequent calls to the same file (all symbols already in scope)
4. THE Forward_Scope_Resolver SHALL track which files have been processed and with what call type during each resolution pass

### Requirement 13: Include Downgrade in Do Chain

**User Story:** As a developer, I want the LSP to correctly handle the case where a file uses `include` but was itself called via `do`, so that local macro scoping is accurate.

#### Acceptance Criteria

1. WHEN a callee contains an `include` directive or command, AND any caller in the recursion path called it via `do` or `run`, THE Forward_Scope_Resolver SHALL treat that `include` as a `do` for scope inheritance purposes
2. WHEN a callee contains an `include` directive or command, AND all callers in the recursion path used `include`, THE Forward_Scope_Resolver SHALL preserve full `include` semantics (locals pass through)
3. THE Forward_Scope_Resolver SHALL track the "effective call type" through the recursion chain

### Requirement 14: Configurable Maximum Depth

**User Story:** As a developer, I want to configure the maximum recursion depth for forward scope resolution, so that I can balance completeness against performance for my project.

#### Acceptance Criteria

1. THE Forward_Scope_Resolver SHALL support a user-configurable `max_forward_depth` setting
2. THE Forward_Scope_Resolver SHALL use a default value of 10 for `max_forward_depth`
3. WHEN recursion depth exceeds `max_forward_depth`, THE Forward_Scope_Resolver SHALL stop recursion and emit a warning diagnostic indicating the depth limit was reached
4. THE `max_forward_depth` setting SHALL be configurable via `.stata-lsp.json` workspace configuration
5. The `max_forward_depth` setting SHALL be documented in README.md