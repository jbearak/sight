; Bracket matching queries for Stata
; Validates: Requirements 5.1-5.6

; Curly braces
("{" @open "}" @close)

; Square brackets
(lbracket) @open
(rbracket) @close

; Parentheses
(lparen) @open
(rparen) @close

; Double quotes
("\"" @open "\"" @close)

; Stata local macro delimiters (backtick and single quote)
("`" @open "'" @close)
