# Requirements Document

## Introduction

The pretty printer (AST formatter) currently deletes frame blocks and prefix command brace blocks when formatting Stata code. When a user formats code containing `frame name { ... }` blocks or prefix command brace blocks like `capture { ... }`, the pretty printer fails to output them, resulting in data loss.

## Glossary

- **Pretty_Printer**: The AST-based formatter that converts parsed AST nodes back into formatted Stata source code
- **Frame_Block**: A Stata construct that executes code in the context of a named data frame, with syntax `frame framename { commands }`
- **Prefix_Command_Brace_Block**: A Stata construct where a prefix command (capture, quietly, noisily, etc.) is followed by a brace block, with syntax `prefix { commands }`
- **ControlFlowNode**: An AST node type that represents control flow structures including if, else, foreach, forvalues, while, and frame blocks
- **CommandNode**: An AST node type that represents Stata commands, which may include an optional body for prefix command brace blocks
- **AST_Formatter**: The formatter mode that uses the Pretty_Printer to rebuild code from the AST

## Requirements

### Requirement 1: Frame Block Preservation

**User Story:** As a Stata developer, I want the pretty printer to preserve frame blocks when formatting my code, so that I don't lose functionality when using the AST formatter.

#### Acceptance Criteria

1. WHEN the Pretty_Printer formats a ControlFlowNode with type 'frame', THE Pretty_Printer SHALL output the frame block with correct syntax
2. WHEN formatting `frame myframe { display "test" }`, THE Pretty_Printer SHALL produce valid Stata code that includes the frame block
3. WHEN formatting nested frame blocks, THE Pretty_Printer SHALL preserve all frame blocks at all nesting levels
4. WHEN formatting frame blocks with multiple commands in the body, THE Pretty_Printer SHALL preserve all commands within the frame block
5. THE Pretty_Printer SHALL apply correct indentation to frame block bodies

### Requirement 2: Frame Block Syntax Correctness

**User Story:** As a Stata developer, I want frame blocks to be formatted with correct Stata syntax, so that the formatted code executes correctly.

#### Acceptance Criteria

1. THE Pretty_Printer SHALL output frame blocks in the format `frame framename {`
2. THE Pretty_Printer SHALL place the opening brace on the same line as the frame command
3. THE Pretty_Printer SHALL indent the body of frame blocks by one level
4. THE Pretty_Printer SHALL place the closing brace on its own line at the same indentation level as the frame command
5. THE Pretty_Printer SHALL add the appropriate statement terminator after the closing brace based on delimiter mode

### Requirement 3: Prefix Command Brace Block Preservation

**User Story:** As a Stata developer, I want the pretty printer to preserve prefix command brace blocks when formatting my code, so that I don't lose functionality when using the AST formatter.

#### Acceptance Criteria

1. WHEN the Pretty_Printer formats a CommandNode with a body property, THE Pretty_Printer SHALL output the prefix command brace block with correct syntax
2. WHEN formatting `capture { display "test" }`, THE Pretty_Printer SHALL produce valid Stata code that includes the brace block
3. WHEN formatting nested prefix command brace blocks, THE Pretty_Printer SHALL preserve all blocks at all nesting levels
4. WHEN formatting prefix command brace blocks with multiple commands in the body, THE Pretty_Printer SHALL preserve all commands within the block
5. THE Pretty_Printer SHALL apply correct indentation to prefix command brace block bodies

### Requirement 4: Prefix Command Brace Block Syntax Correctness

**User Story:** As a Stata developer, I want prefix command brace blocks to be formatted with correct Stata syntax, so that the formatted code executes correctly.

#### Acceptance Criteria

1. THE Pretty_Printer SHALL output prefix command brace blocks in the format `prefix {` where prefix is the command name (or special case `{` for standalone brace blocks)
2. THE Pretty_Printer SHALL place the opening brace on the same line as the prefix command
3. THE Pretty_Printer SHALL indent the body of prefix command brace blocks by one level
4. THE Pretty_Printer SHALL place the closing brace on its own line at the same indentation level as the prefix command
5. THE Pretty_Printer SHALL add the appropriate statement terminator after the closing brace based on delimiter mode

### Requirement 5: Consistency with Other Control Flow

**User Story:** As a Stata developer, I want frame blocks and prefix command brace blocks to be formatted consistently with other control flow structures, so that my code has a uniform style.

#### Acceptance Criteria

1. THE Pretty_Printer SHALL format frame blocks using the same indentation rules as if/else/foreach/forvalues/while blocks
2. THE Pretty_Printer SHALL format prefix command brace blocks using the same indentation rules as control flow blocks
3. THE Pretty_Printer SHALL handle trivia (comments) for frame blocks and prefix command brace blocks the same way as other control flow nodes
4. THE Pretty_Printer SHALL respect the current delimiter mode when adding statement terminators to frame blocks and prefix command brace blocks
