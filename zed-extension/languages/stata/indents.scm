; Indentation queries for Stata
; Validates: Requirements 6.1-6.3

; Indent after block openers
; Program definitions increase indentation
(program_definition) @indent

; Mata blocks increase indentation
(mata_block) @indent

; Opening braces increase indentation
"{" @indent

; Outdent on block closers
; Closing braces decrease indentation
"}" @outdent

; 'end' keyword decreases indentation
"end" @outdent

; 'else' always outdents (to align with if)
"else" @outdent.always
