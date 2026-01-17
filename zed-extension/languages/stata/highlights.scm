; Syntax highlighting queries for Stata
; This file provides Tree-sitter highlight queries for the Zed editor
;
; Key features:
; - Depth-based highlighting for compound strings (depth 1-6)
; - Depth-based highlighting for local macros (depth 1-6)
; - Global macros use non-depth @variable capture
; - Depth captures apply to entire span (delimiters and contents)

; =============================================================================
; COMMENTS
; =============================================================================

(line_comment) @comment
(block_comment) @comment

; =============================================================================
; STRINGS
; =============================================================================

; Double-quoted strings
(double_string) @string

; Compound strings (depth 1-6)
; Each depth level gets a distinct capture for depth-based coloring
(compound_string_depth_1) @string.depth.1
(compound_string_depth_2) @string.depth.2
(compound_string_depth_3) @string.depth.3
(compound_string_depth_4) @string.depth.4
(compound_string_depth_5) @string.depth.5
(compound_string_depth_6) @string.depth.6

; =============================================================================
; MACROS
; =============================================================================

; Local macros (depth 1-6)
; Each depth level gets a distinct capture for depth-based coloring
; Depth is based only on local macro nesting (not offset by compound string nesting)
(local_macro_depth_1) @variable.macro.local.depth.1
(local_macro_depth_2) @variable.macro.local.depth.2
(local_macro_depth_3) @variable.macro.local.depth.3
(local_macro_depth_4) @variable.macro.local.depth.4
(local_macro_depth_5) @variable.macro.local.depth.5
(local_macro_depth_6) @variable.macro.local.depth.6

; Global macros (non-depth)
(global_macro) @variable

; =============================================================================
; KEYWORDS
; =============================================================================

; Control flow keywords
[
  "if"
  "else"
  "foreach"
  "forvalues"
  "forv"
  "while"
  "continue"
  "break"
  "end"
] @keyword

; Prefix keywords
[
  "by"
  "bysort"
  "bys"
  "quietly"
  "qui"
  "noisily"
  "noi"
  "capture"
  "cap"
  "sortpreserve"
] @keyword

; Qualifier keywords
[
  "in"
  "using"
] @keyword

; File execution keywords
[
  "do"
  "run"
  "include"
] @keyword

; Program definition keywords
(program_definition "program" @keyword)
(program_definition "define" @keyword)
(program_definition "end" @keyword)

; Macro definition keywords
[
  "local"
  "loc"
  "global"
  "gl"
  "tempvar"
  "tempname"
  "tempfile"
] @keyword

; Mata block keywords
(mata_block "mata" @keyword)
(mata_block "end" @keyword)

; =============================================================================
; FUNCTIONS
; =============================================================================

; Program names
(program_definition
  name: (identifier) @function)

; Generic command names
(command
  name: (identifier) @function)

; =============================================================================
; TYPES
; =============================================================================

(type) @type

; =============================================================================
; VARIABLES
; =============================================================================

; Built-in system variables
(builtin_variable) @variable.builtin

; Macro definition names (the name being defined)
(macro_definition
  name: (identifier) @variable)

; =============================================================================
; CONSTANTS
; =============================================================================

; Missing values (., .a, .b, ..., .z)
(missing_value) @constant

; =============================================================================
; NUMBERS
; =============================================================================

(number) @number

; =============================================================================
; OPERATORS
; =============================================================================

(operator) @operator
