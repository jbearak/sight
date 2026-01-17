; Syntax highlighting queries for Stata
; This file is referenced by the Rust bindings

; Comments
(line_comment) @comment
(block_comment) @comment

; Strings
(double_string) @string

; Compound strings (depth 1-6)
(compound_string_depth_1) @string
(compound_string_depth_2) @string
(compound_string_depth_3) @string
(compound_string_depth_4) @string
(compound_string_depth_5) @string
(compound_string_depth_6) @string

; Local macros (depth 1-6)
(local_macro_depth_1) @variable
(local_macro_depth_2) @variable
(local_macro_depth_3) @variable
(local_macro_depth_4) @variable
(local_macro_depth_5) @variable
(local_macro_depth_6) @variable

; Global macros
(global_macro) @variable

; Keywords
[
  "program"
  "define"
  "end"
  "mata"
  "local"
  "loc"
  "global"
  "gl"
  "tempvar"
  "tempname"
  "tempfile"
] @keyword

; Prefixes
(prefix) @keyword

; Program names
(program_definition
  name: (identifier) @function)

; Command names
(command
  name: (identifier) @function)

; Macro definition names
(macro_definition
  name: (identifier) @variable)

; Numbers
(number) @number

; Missing values
(missing_value) @constant

; Built-in variables
(builtin_variable) @variable.builtin

; Types
(type) @type

; Operators
(operator) @operator
