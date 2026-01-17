; Syntax highlighting queries for Stata
; This file is referenced by the Rust bindings

; Comments
(line_comment) @comment
(block_comment) @comment

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
