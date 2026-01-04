# Requirements Document

## Introduction

This feature fixes a false positive in the indentation diagnostic analyzer where lines inside prefix command brace blocks (e.g., `capture { }`, `quietly { }`, `noisily { }`) are incorrectly flagged as "unnecessarily indented." In Stata, prefix commands can be followed by a brace block that groups multiple statements, and lines inside these blocks should be indented. The current implementation doesn't recognize these brace blocks as valid indentation contexts because they are parsed as `command` nodes with `name: "{"` rather than as block nodes with a `body` array.

## Glossary

- **Prefix_Command**: A command that modifies the behavior of subsequent commands (e.g., `capture`, `quietly`, `noisily`, `by`, `bysort`)
- **Brace_Block**: A group of statements enclosed in `{ }` that follows a prefix command
- **Indentation_Diagnostic_Analyzer**: The component that detects indentation issues in Stata code
- **Expected_Depth**: The computed nesting depth for a line based on AST traversal

## Requirements

### Requirement 1: Recognize Prefix Command Brace Blocks

**User Story:** As a developer, I want the LSP to correctly recognize prefix command brace blocks as valid indentation contexts, so that I don't receive false positive indentation warnings.

#### Acceptance Criteria

1. WHEN a command node has `name: "{"` (indicating a brace block), THE Indentation_Diagnostic_Analyzer SHALL recognize it as a block that increases indentation depth
2. WHEN computing expected depths, THE Indentation_Diagnostic_Analyzer SHALL increase depth for lines inside prefix command brace blocks
3. THE Indentation_Diagnostic_Analyzer SHALL handle nested prefix command brace blocks correctly

### Requirement 2: Skip Unnecessary Indentation Check for Brace Block Contents

**User Story:** As a developer, I want lines inside prefix command brace blocks to be excluded from unnecessary indentation diagnostics, so that I can properly indent my code.

#### Acceptance Criteria

1. WHEN a line is inside a prefix command brace block, THE Indentation_Diagnostic_Analyzer SHALL NOT emit an unnecessary indentation diagnostic for that line
2. WHEN multiple prefix commands are nested (e.g., `capture noisily { }`), THE Indentation_Diagnostic_Analyzer SHALL correctly compute the expected indentation depth

### Requirement 3: Support Common Prefix Commands

**User Story:** As a developer, I want all common prefix commands with brace blocks to be recognized.

#### Acceptance Criteria

1. THE Indentation_Diagnostic_Analyzer SHALL recognize brace blocks following `capture`
2. THE Indentation_Diagnostic_Analyzer SHALL recognize brace blocks following `quietly`
3. THE Indentation_Diagnostic_Analyzer SHALL recognize brace blocks following `noisily`
4. THE Indentation_Diagnostic_Analyzer SHALL recognize brace blocks following any prefix command that uses the `{ }` syntax

### Requirement 4: Formatter Preserves Brace Block Indentation

**User Story:** As a developer, I want the formatter to preserve correct indentation inside prefix command brace blocks, so that my code style is maintained.

#### Acceptance Criteria

1. WHEN formatting a document with prefix command brace blocks, THE Source_Preserving_Formatter SHALL NOT remove indentation from lines inside the brace block
2. WHEN formatting a document with prefix command brace blocks, THE Source_Preserving_Formatter SHALL preserve the existing indentation structure
3. WHEN a line inside a brace block has correct indentation (one level deeper than the prefix command), THE Source_Preserving_Formatter SHALL NOT modify that line's indentation
