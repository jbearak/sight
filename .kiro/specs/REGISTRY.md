# Sight LSP Specification Registry

**Central index for all specification lifecycle management**

*Last Updated: 2026-01-01*  
*Total Specifications: 106*  
*Total Cross-References: 339*

## Overview

This registry serves as the central index for all specifications in the Sight LSP project. It provides comprehensive metadata, dependency mapping, feature grouping, and cross-reference tracking for specification lifecycle management.

**Current Status:** 88 active specifications, 18 archived specifications.

## Metadata Table

| Name | Status | Last Updated | Dependencies | Feature Group | Cross-References | Archive Date |
|------|--------|--------------|--------------|---------------|------------------|--------------|
| scope-cache-optimization | Active | 2025-12-31 | incremental-parsing | Cross-File | 1 | - |
| comprehensive-property-tests | Active | 2025-12-31 | stata-lsp, embedded-language-detection | Cross-File | 4 | - |
| do-command-arguments | Active | 2025-12-31 | stata-lsp, forward-scope-resolution | Cross-File | 10 | - |
| logging-refactor | Active | 2025-12-31 | stata-lsp | Cross-File | 1 | - |
| macro-completion-with-closing-quote | Active | 2025-12-31 | stata-lsp | Cross-File | 1 | - |
| rename-variable-registration | Active | 2025-12-31 | stata-lsp | Cross-File | 1 | - |
| single-quote-string-fix | Completed | 2025-12-31 | stata-lsp | Diagnostics | 2 | 2026-01-01 |
| quoted-path-parsing | Active | 2025-12-31 | stata-lsp, forward-scope-resolution, called-from-directive | Cross-File | 6 | - |
| document-symbols-enhancement | Active | 2025-12-31 | stata-lsp | Cross-File | 1 | - |
| c-local-cross-file-support | Active | 2025-12-31 | stata-lsp, forward-scope-resolution | Cross-File | 4 | - |
| macro-creating-options | Active | 2025-12-31 | stata-lsp | Cross-File | 1 | - |
| interactive-extension-management | Archived | 2025-12-31 | binary-installation, extension-conflict-detection | Cross-File | 2 | 2026-01-01 |
| cross-file-awareness-fixes | Active | 2025-12-31 | cross-file-awareness, stata-lsp | Cross-File | 10 | - |
| confirm-variable-registration | Active | 2025-12-31 | stata-lsp | Cross-File | 2 | - |
| command-database-integration | Active | 2025-12-31 | stata-lsp, command-metadata-system | Cross-File | 3 | - |
| binary-installation | Archived | 2025-12-31 | standalone-binary-distribution | Cross-File | 1 | 2026-01-01 |
| command-database-cleanup | Active | 2025-12-31 | stata-lsp, command-metadata-system | Completion | 3 | - |
| syntax-command-parsing | Active | 2025-12-31 | stata-lsp, option-extraction | Cross-File | 2 | - |
| textmate-grammar-enhancement | Archived | 2025-12-31 | stata-lsp | Cross-File | 2 | 2026-01-01 |
| parent-forward-call-inheritance | Active | 2025-12-31 | working-directory-inheritance, forward-scope-resolution | Cross-File | 2 | - |
| frame-prefix-command | Active | 2025-12-31 | stata-lsp | Completion | 3 | - |
| optional-do-extension | Active | 2025-12-31 | stata-lsp, forward-scope-resolution | Cross-File | 10 | - |
| working-directory-propagation | Active | 2025-12-31 | forward-scope-resolution, working-directory-inheritance | Cross-File | 12 | - |
| diagnostic-false-positives | Active | 2025-12-31 | stata-lsp | Diagnostics | 2 | - |
| disk-symbol-cache | Archived | 2025-12-31 | stata-lsp | Parsing | 1 | 2026-01-01 |
| called-from-directive | Active | 2025-12-31 | forward-scope-resolution, quoted-path-parsing | Cross-File | 7 | - |
| stata-lsp | Active | 2025-12-31 | incremental-parsing, quote-snippets, extended-macro-functions | Core | 3 | - |
| macro-case-sensitivity | Active | 2025-12-31 | stata-lsp | Cross-File | 2 | - |
| token-macro-forward-reference | Active | 2025-12-31 | forward-macro-reference-detection | Cross-File | 4 | - |
| user-configurable-settings | Active | 2025-12-31 | stata-lsp | Cross-File | 36 | - |
| comment-style-normalization | Active | 2025-12-31 | stata-lsp | Diagnostics | 2 | - |
| macro-definition-highlighting | Archived | 2025-12-31 | textmate-grammar-enhancement | Cross-File | 1 | 2026-01-01 |
| completion-improvements | Superseded | 2025-12-31 | stata-lsp, extended-macro-functions, quote-snippets | Cross-File | 4 | 2026-01-01 |
| fix-property-test-failures | Active | 2025-12-31 | syntax-command-parsing | Cross-File | 6 | - |
| completion-improvements-fixes | Active | 2025-12-31 | completion-improvements, stata-lsp | Completion | 15 | - |
| working-directory-inheritance | Active | 2025-12-31 | working-directory-propagation | Cross-File | 1 | - |
| nested-macro-reference-parsing | Completed | 2025-12-31 | stata-lsp | Diagnostics | 2 | 2026-01-01 |
| textmate-command-sync | Archived | 2025-12-31 | stata-lsp | Cross-File | 1 | 2026-01-01 |
| current-file-forward-calls | Active | 2025-12-31 | forward-scope-resolution | Cross-File | 1 | - |
| restore-test-regime | Active | 2025-12-31 | embedded-language-detection | Diagnostics | 3 | - |
| global-macro-execution-order | Active | 2025-12-31 | stata-lsp | Cross-File | 4 | - |
| file-path-handling | Active | 2025-12-31 | stata-lsp, quoted-path-parsing | Cross-File | 2 | - |
| syntax-command-simplification | Active | 2025-12-31 | option-extraction, syntax-command-parsing | Completion | 10 | - |
| workspace-root-fallback-fix | Active | 2025-12-31 | stata-lsp | Cross-File | 1 | - |
| forward-macro-reference-detection | Active | 2025-12-31 | stata-lsp | Cross-File | 1 | - |
| embedded-language-detection | Active | 2025-12-31 | incremental-parsing, stata-lsp | Completion | 8 | - |
| forward-scope-resolution | Active | 2025-12-31 | stata-lsp | Cross-File | 6 | - |
| test-failure-fixes | Active | 2025-12-31 | stata-lsp | Cross-File | 2 | - |
| syntax-command-bugs | Active | 2025-12-31 | stata-lsp, syntax-command-parsing | Cross-File | 6 | - |
| rename-command-options | Active | 2025-12-31 | option-extraction | Completion | 2 | - |
| working-directory-chain-inheritance | Active | 2025-12-31 | working-directory-inheritance, working-directory-propagation | Cross-File | 12 | - |
| large-file-indexing-policy | Active | 2025-12-31 | stata-lsp | Diagnostics | 1 | - |
| option-name-expansion | Active | 2025-12-31 | command-name-expansion | Cross-File | 4 | - |
| command-metadata-system | Superseded | 2025-12-31 | stata-lsp | Cross-File | 3 | 2026-01-01 |
| case-sensitivity-fix | Completed | 2025-12-31 | stata-lsp | Cross-File | 2 | 2026-01-01 |
| rename-to-sight | Active | 2025-12-31 | stata-lsp | Cross-File | 55 | - |
| lsp-performance-optimization | Active | 2025-12-31 | stata-lsp, embedded-language-detection, incremental-parsing, cooperative-async-parsing | Cross-File | 8 | - |
| incremental-parsing | Archived | 2025-12-31 | stata-lsp | Diagnostics | 1 | 2026-01-01 |
| directive-call-site-diagnostics | Active | 2025-12-31 | forward-scope-resolution | Cross-File | 2 | - |
| macro-test-scenarios | Active | 2025-12-31 | stata-lsp, macro-case-sensitivity | Completion | 3 | - |
| forward-scope-working-directory-fix | Active | 2025-12-31 | forward-scope-resolution, working-directory-inheritance | Cross-File | 5 | - |
| namelist-argument-type | Active | 2025-12-31 | stata-lsp, syntax-command-parsing | Cross-File | 5 | - |
| orphan-end-diagnostic | Active | 2025-12-31 | diagnostic-false-positives | Diagnostics | 2 | - |
| cooperative-async-parsing | Archived | 2025-12-31 | stata-lsp | Completion | 1 | 2026-01-01 |
| cross-file-awareness | Superseded | 2025-12-31 | stata-lsp | Cross-File | 6 | 2026-01-01 |
| python-block-end-fix | Active | 2025-12-31 | stata-lsp | Completion | 2 | - |
| expression-keyword-disambiguation | Active | 2025-12-31 | stata-lsp | Diagnostics | 1 | - |
| prefix-colon-and-program-context | Active | 2025-12-31 | stata-lsp | Cross-File | 1 | - |
| option-extraction | Superseded | 2025-12-31 | stata-lsp | Completion | 1 | 2026-01-01 |

## Spec Clusters by Feature Group

### Cross-File (66 specs)
Core cross-file functionality including scope resolution, directive parsing, and workspace awareness.

**Key Specs:**
- `stata-lsp` - Core LSP implementation
- `forward-scope-resolution` - Forward-looking cross-file scope resolution
- `working-directory-inheritance` - Working directory propagation through directive chains
- `cross-file-awareness` - Foundational cross-file capabilities
- `parent-forward-call-diagnostics` - Parent call diagnostic reporting

**Dependencies:**
- Most specs depend on `stata-lsp` as the core foundation
- Forward scope resolution specs form a dependency chain
- Working directory specs have circular dependencies requiring careful implementation order

### Completion (15 specs)
Auto-completion features including command completion, option completion, and macro completion.

**Key Specs:**
- `completion-improvements-fixes` - Core completion enhancements
- `macro-completion-with-closing-quote` - Macro completion with quote handling
- `embedded-language-detection` - Context-aware completions

### Diagnostics (17 specs)
Error detection, warning systems, and diagnostic reporting.

**Key Specs:**
- `diagnostic-false-positives` - Fixes for incorrect error reporting
- `nested-macro-reference-parsing` - Nested macro parsing fixes
- `orphan-end-diagnostic` - Orphaned end statement detection
- `expression-keyword-disambiguation` - Keyword context disambiguation

### Other (2 specs)
Miscellaneous functionality that doesn't fit into major categories.

**Key Specs:**
- `macro-creating-options-first-definition` - First definition handling for macro-creating options
- `egen-command-parsing` - Egen command specific parsing

### Parsing (0 specs)
Core parsing infrastructure and optimizations.

*No active parsing specs - disk-symbol-cache was archived as abandoned.*

## Dependency Mapping

### Core Foundation Dependencies

**stata-lsp** (83 dependents)
The core LSP implementation that most other specs depend on. Critical foundation spec.

**forward-scope-resolution** (18 dependents)
Core cross-file scope resolution functionality. Key dependency for cross-file features.

**working-directory-inheritance** (8 dependents)
Working directory propagation through directive chains. Important for path resolution.

### Major Dependency Chains

1. **Cross-File Resolution Chain:**
   ```
   stata-lsp → forward-scope-resolution → working-directory-inheritance → working-directory-propagation
   ```

2. **Completion Chain:**
   ```
   stata-lsp → completion-improvements-fixes
   ```

3. **Diagnostic Chain:**
   ```
   stata-lsp → diagnostic-false-positives → orphan-end-diagnostic
   ```

## VS Code vs LSP Core Split

### VS Code Extension Specs (88 specs - 83%)
Specifications that affect the VS Code extension client, including UI, configuration, and client-side features.

**Major Categories:**
- Configuration and settings management
- Extension lifecycle and installation
- TextMate grammar and syntax highlighting
- Client-side completion and diagnostics
- Command registration and keybindings

### LSP Core Specs (18 specs - 17%)
Specifications that affect only the core LSP server implementation without client-side changes.

**Major Categories:**
- Core parsing and analysis logic
- Server-side symbol resolution
- Internal caching and performance
- Cross-file scope resolution algorithms

## Cross-Reference Network

### Highly Connected Specs
1. **stata-lsp** - 3 outgoing, 83 incoming references (central hub)
2. **forward-scope-resolution** - 6 outgoing, 18 incoming references (cross-file hub)
3. **working-directory-inheritance** - 1 outgoing, 8 incoming references (path resolution hub)

### Reference Types
- **Direct Mention** (298 refs) - Explicit references in spec content
- **Dependency** (41 refs) - Implementation dependencies between specs

### Cross-Reference Patterns
- Most cross-references flow toward core foundation specs
- Cross-file specs form a tightly connected subgraph
- Completion specs have moderate interconnection
- Diagnostic specs are more loosely coupled

## Specification Lifecycle Status

### Active Specifications (88)
Most specifications are currently active with 4 superseded specifications.

### Archived Specifications (18)
- `cross-file-awareness` - Superseded by done-by-locals-bug (2026-01-01)
- `disk-symbol-cache` - Archived as abandoned (2026-01-01)
- `completion-improvements` - Superseded by completion-improvements-fixes (2026-01-01)
- `command-metadata-system` - Superseded by smcl-syntax-cleanup (2026-01-01)
- `option-extraction` - Superseded by smcl-syntax-cleanup (2026-01-01)

### Implementation Priority
Based on dependency analysis:

**Tier 1 (Foundation):**
- stata-lsp
- forward-scope-resolution
- working-directory-inheritance

**Tier 2 (Core Features):**
- cross-file-awareness
- completion-improvements-fixes
- diagnostic-false-positives

**Tier 3 (Enhancements):**
- All remaining specs

---

*This registry was generated for one-time specification review and cleanup. Future updates should be made manually as needed.*
