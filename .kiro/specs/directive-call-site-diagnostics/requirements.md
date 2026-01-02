---
Last Updated: 2025-01-01
Change History:
  - 2025-01-01: Added standardized change tracking headers
Dependencies:
  - forward-scope-resolution: [Core dependency]
Status: Active
Related Specs:
  - forward-scope-resolution: [Related cross-file spec]
  - cross-file-awareness: [Related cross-file spec]
  - working-directory-inheritance: [Related cross-file spec]
---

# Requirements Document

## Introduction

This feature improves diagnostic messaging for cross-file directives (`@lsp-done-by`, `@lsp-run-by`, `@lsp-included-by`) when the LSP cannot identify the call site in the parent file, or when there's a mismatch between the directive type and the actual call type used in the parent. The goal is to provide informative messages that help users understand the resolution behavior without being overly alarming.

## Glossary

- **Scope_Resolver**: The component that resolves cross-file scopes by following directive chains
- **Call_Site**: The line in a parent file where a child file is called via `do`, `run`, or `include`
- **Directive_Type**: The type of backward directive used (`done-by`, `run-by`, or `included-by`)
- **Call_Type**: The actual command used in the parent file (`do`, `run`, or `include`)
- **Text_Inference**: The process of scanning parent file content to find `do`/`run`/`include` statements referencing the child file
- **Reverse_Deps**: Cached call edges from previous forward scope resolution

## Requirements

### Requirement 1: Emit Information When Call Site Cannot Be Identified

**User Story:** As a developer, I want to be informed when the LSP cannot identify the call site line in the parent file, so that I understand why the LSP is using default assumptions for symbol inheritance.

#### Acceptance Criteria

1. WHEN the Scope_Resolver cannot identify the call site line via reverse deps or text inference AND the user has NOT specified an explicit `line=` or `match=` parameter, THEN the Scope_Resolver SHALL emit an information-level diagnostic indicating the call site could not be identified
2. WHEN the user has specified an explicit `line=` parameter in the directive AND the line exists in the parent file AND the line contains a valid call statement, THEN the Scope_Resolver SHALL NOT emit a "cannot identify call site" diagnostic
3. WHEN the user has specified an explicit `line=` parameter in the directive AND the line does NOT exist in the parent file (line number exceeds file length), THEN the Scope_Resolver SHALL emit a warning-level diagnostic indicating the specified line is out of bounds
4. WHEN the user has specified an explicit `line=` parameter in the directive AND the line exists but does NOT contain a `do`/`run`/`include` command or `@lsp-do`/`@lsp-run`/`@lsp-include` directive, THEN the Scope_Resolver SHALL emit a warning-level diagnostic indicating the line does not contain a valid call statement
5. WHEN the user has specified an explicit `match=` parameter in the directive AND the match string is found, THEN the Scope_Resolver SHALL NOT emit a "cannot identify call site" diagnostic
6. WHEN the user has specified an explicit `match=` parameter in the directive AND the match string is NOT found, THEN the Scope_Resolver SHALL emit a warning-level diagnostic indicating the match string was not found in the parent file
7. THE information diagnostic message SHALL indicate which parent file was searched and suggest using `line=` or `match=` parameters for explicit call site specification

### Requirement 2: Retain Warning for included-by with do/run Mismatch

**User Story:** As a developer, I want to be warned when I use `@lsp-included-by` but the parent file actually uses `do` or `run`, so that I understand local macros will not be inherited as expected.

#### Acceptance Criteria

1. WHEN the directive type is `included-by` AND the detected call type is `do` or `run`, THEN the Scope_Resolver SHALL emit a warning-level diagnostic
2. THE warning message SHALL explain that local macros will not be inherited via `do`/`run`
3. THE warning SHALL be emitted regardless of whether the call site was identified via reverse deps or text inference

### Requirement 3: Emit Information for done-by/run-by with include Mismatch

**User Story:** As a developer, I want to be informed when I use `@lsp-done-by` or `@lsp-run-by` but the parent file actually uses `include`, so that I understand the inheritance behavior may differ from my expectation.

#### Acceptance Criteria

1. WHEN the directive type is `done-by` or `run-by` AND the detected call type is `include`, THEN the Scope_Resolver SHALL emit an information-level diagnostic
2. THE information message SHALL explain that `include` provides full inheritance (including local macros) even though the directive suggests `do`/`run` semantics
3. THE information SHALL be emitted regardless of whether the call site was identified via reverse deps or text inference

### Requirement 4: Warn on Mixed Call Types in Parent File

**User Story:** As a developer, I want to be warned when the parent file contains both `do`/`run` and `include` statements referencing my file, so that I understand there may be ambiguity in the inheritance behavior.

#### Acceptance Criteria

1. WHEN the parent file contains both `do`/`run` AND `include` statements referencing the child file, THEN the Scope_Resolver SHALL emit a warning-level diagnostic
2. THE warning message SHALL explain that the parent file has multiple call types and the first one found will be used
3. THE warning SHALL suggest using `line=` or `match=` to specify which call site to use

### Requirement 5: Diagnostic Source Attribution

**User Story:** As a developer, I want diagnostics to be attributed to the correct location in my code, so that I can easily navigate to the relevant directive.

#### Acceptance Criteria

1. WHEN emitting call-site-related diagnostics, THE Scope_Resolver SHALL set the diagnostic range to the directive's location in the child file
2. THE diagnostic SHALL include source attribution indicating which parent file was involved

### Requirement 6: Configurable Diagnostic Severity

**User Story:** As a developer, I want to be able to configure or suppress these informational diagnostics, so that I can reduce noise if I understand the behavior.

#### Acceptance Criteria

1. THE information-level diagnostics for call site identification failures SHALL respect the existing cross-file diagnostic configuration
2. THE warning-level diagnostic for `included-by` with `do`/`run` mismatch SHALL NOT be suppressible (it indicates a semantic issue)

### Requirement 7: Documentation

**User Story:** As a developer, I want to understand the diagnostic messages I may encounter when using cross-file directives, so that I can resolve issues effectively.

#### Acceptance Criteria

1. THE README SHALL document the diagnostic messages emitted for call site identification scenarios
2. THE documentation SHALL explain when information-level vs warning-level diagnostics are emitted
3. THE documentation SHALL provide examples of how to use `line=` and `match=` parameters to specify explicit call sites
4. THE documentation SHALL explain the difference between `@lsp-done-by`/`@lsp-run-by` and `@lsp-included-by` in terms of inheritance behavior
