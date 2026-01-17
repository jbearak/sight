; Syntax highlighting queries for Stata
; This file provides Tree-sitter highlight queries for the Zed editor

; =============================================================================
; COMMENTS
; =============================================================================

(line_comment) @comment
(block_comment) @comment

; =============================================================================
; STRINGS
; =============================================================================

(double_string) @string

; Compound strings (depth 1-6)
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
(local_macro_depth_1) @variable.macro.local.depth.1
(local_macro_depth_2) @variable.macro.local.depth.2
(local_macro_depth_3) @variable.macro.local.depth.3
(local_macro_depth_4) @variable.macro.local.depth.4
(local_macro_depth_5) @variable.macro.local.depth.5
(local_macro_depth_6) @variable.macro.local.depth.6

; Global macros (non-depth) - including inside strings and local macros
(global_macro) @variable

; =============================================================================
; KEYWORDS
; =============================================================================

; Control flow keywords
(control_keyword) @keyword

; Program definition keywords
[
  "program"
  "define"
  "end"
  "mata"
] @keyword

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

; Prefix keywords
(prefix) @keyword

; Additional keywords parsed as identifiers
((identifier) @keyword
  (#match? @keyword "^(in|using|do|run|include)$"))

; =============================================================================
; TYPES
; =============================================================================

; Stata type keywords
(type_keyword) @type

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
; VARIABLES
; =============================================================================

; Macro definition names (the name being defined)
(macro_definition
  name: (identifier) @variable)

; Built-in variables (all TextMate-recognized)
(builtin_variable) @variable.builtin

; =============================================================================
; LITERALS
; =============================================================================

; Numbers
(number) @number

; Missing values
(missing_value) @constant

; =============================================================================
; OPERATORS
; =============================================================================

; Operators (including interaction #)
(operator) @operator

; =============================================================================
; MATA BLOCKS
; =============================================================================

; Mata block punctuation
(mata_block "{" @punctuation.bracket)
(mata_block "}" @punctuation.bracket)
