; Syntax highlighting queries for Stata
; This file provides Tree-sitter highlight queries for the Zed editor

; =============================================================================
; COMMENTS
; =============================================================================

(line_comment) @comment
(block_comment) @comment

; =============================================================================
; KEYWORDS
; =============================================================================

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
