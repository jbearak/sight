; Bracket matching queries for Stata
; Validates: Requirements 5.1-5.6

; Curly braces
("{" @open "}" @close)

; Square brackets
("[" @open "]" @close)

; Parentheses
("(" @open ")" @close)

; Double quotes
("\"" @open "\"" @close)

; Stata local macro delimiters (backtick and single quote)
("`" @open "'" @close)
